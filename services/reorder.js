import { supabase } from '../db.js';

// Suggest a reorder from history: the retailer's most-ordered products, with a
// quantity of "what they usually take per order", rounded.
export async function suggestReorder(retailerId) {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_items(quantity, product_id, products(id, name, unit_price))')
    .eq('retailer_id', retailerId);
  if (error) throw new Error(`loading order history: ${error.message}`);

  const byProduct = new Map(); // product_id → { product, totalQty, orderCount }
  for (const order of orders) {
    for (const item of order.order_items) {
      const entry = byProduct.get(item.product_id) || {
        product: item.products,
        totalQty: 0,
        orderCount: 0,
      };
      entry.totalQty += item.quantity;
      entry.orderCount += 1;
      byProduct.set(item.product_id, entry);
    }
  }

  const items = [...byProduct.values()]
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 4)
    .map((e) => ({
      product_id: e.product.id,
      name: e.product.name,
      unit_price: Number(e.product.unit_price),
      quantity: Math.max(1, Math.round(e.totalQty / e.orderCount)),
    }));

  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  return { items, total };
}

// The retailer's most recent order, in the same { items, total } shape used for
// confirmation. Returns null if they have no order history yet.
export async function getLastOrder(retailerId) {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, created_at, order_items(quantity, products(id, name, unit_price))')
    .eq('retailer_id', retailerId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`loading last order: ${error.message}`);

  const order = orders?.[0];
  if (!order || order.order_items.length === 0) return null;

  const items = order.order_items.map((i) => ({
    product_id: i.products.id,
    name: i.products.name,
    unit_price: Number(i.products.unit_price),
    quantity: i.quantity,
  }));
  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  return { orderId: order.id, items, total };
}

// Full product catalogue for the build-your-own-order flow.
export async function getCatalog() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, unit_price, stock_level')
    .eq('active', true)
    .order('name');
  if (error) throw new Error(`loading catalog: ${error.message}`);
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    unit_price: Number(p.unit_price),
    stock_level: p.stock_level,
  }));
}

// Persist a confirmed suggestion as a pending order; returns the order id.
export async function placeOrder(retailerId, suggestion) {
  const { data: order, error } = await supabase
    .from('orders')
    .insert({ retailer_id: retailerId, status: 'pending' })
    .select()
    .single();
  if (error) throw new Error(`creating order: ${error.message}`);

  const { error: itemsError } = await supabase.from('order_items').insert(
    suggestion.items.map((i) => ({
      order_id: order.id,
      product_id: i.product_id,
      quantity: i.quantity,
    }))
  );
  if (itemsError) throw new Error(`creating order items: ${itemsError.message}`);

  return order.id;
}
