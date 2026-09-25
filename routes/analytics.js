import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();
const DAY = 24 * 60 * 60 * 1000;

// Load orders + items once and aggregate in Node — all aggregation stays
// server-side; the browser only renders what these endpoints return.
async function loadOrders(sinceMs) {
  const { data, error } = await supabase
    .from('orders')
    .select(
      'id, status, created_at, retailer_id, retailers(area), order_items(quantity, products(name, unit_price))'
    )
    .gte('created_at', new Date(Date.now() - sinceMs).toISOString());
  if (error) throw new Error(error.message);
  return data.map((o) => ({
    ...o,
    total: o.order_items.reduce((s, i) => s + i.quantity * Number(i.products.unit_price), 0),
  }));
}

// GET /analytics/summary — stat cards.
router.get('/summary', async (_req, res) => {
  try {
    const week = await loadOrders(7 * DAY);
    const activeRetailers = new Set(week.map((o) => o.retailer_id)).size;
    res.json({
      ordersThisWeek: week.length,
      valueThisWeek: week.reduce((s, o) => s + o.total, 0),
      activeRetailers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/orders-per-day — last 14 days, zero-filled for the line chart.
router.get('/orders-per-day', async (_req, res) => {
  try {
    const orders = await loadOrders(14 * DAY);
    const byDay = new Map();
    for (let d = 13; d >= 0; d--) {
      const day = new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
      byDay.set(day, 0);
    }
    for (const o of orders) {
      const day = o.created_at.slice(0, 10);
      if (byDay.has(day)) byDay.set(day, byDay.get(day) + 1);
    }
    res.json([...byDay.entries()].map(([day, orders]) => ({ day, orders })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/top-products — top 5 by total quantity, last 6 weeks.
router.get('/top-products', async (_req, res) => {
  try {
    const orders = await loadOrders(42 * DAY);
    const byProduct = new Map();
    for (const o of orders)
      for (const i of o.order_items)
        byProduct.set(i.products.name, (byProduct.get(i.products.name) || 0) + i.quantity);
    const top = [...byProduct.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, quantity]) => ({ name, quantity }));
    res.json(top);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /analytics/by-area — sell-through table, last 6 weeks.
router.get('/by-area', async (_req, res) => {
  try {
    const orders = await loadOrders(42 * DAY);
    const byArea = new Map();
    for (const o of orders) {
      const entry = byArea.get(o.retailers.area) || { orders: 0, value: 0, fulfilled: 0 };
      entry.orders += 1;
      entry.value += o.total;
      if (o.status === 'fulfilled') entry.fulfilled += 1;
      byArea.set(o.retailers.area, entry);
    }
    res.json(
      [...byArea.entries()]
        .map(([area, e]) => ({ area, ...e }))
        .sort((a, b) => b.value - a.value)
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
