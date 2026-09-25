import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();

// GET /orders — latest orders with retailer + items, ready for the dashboard.
router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, status, created_at, retailers(name, area), order_items(quantity, products(name, unit_price))'
    )
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) return res.status(500).json({ error: error.message });

  const orders = data.map((o) => ({
    id: o.id,
    status: o.status,
    created_at: o.created_at,
    retailer: o.retailers.name,
    area: o.retailers.area,
    items: o.order_items.map((i) => ({ name: i.products.name, quantity: i.quantity })),
    total: o.order_items.reduce((sum, i) => sum + i.quantity * Number(i.products.unit_price), 0),
  }));
  res.json(orders);
});

// POST /orders/:id/fulfill — the distributor's one action.
router.post('/:id/fulfill', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'fulfilled' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /orders/products — stock sidebar (levels, due date, expiry badge).
router.get('/products', async (_req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, stock_level, expiry_flag, expiry_date')
    .eq('active', true)
    .order('stock_level', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
