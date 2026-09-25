import { Router } from 'express';
import { supabase } from '../db.js';

const router = Router();

const COLUMNS = 'id, name, sku, unit_price, stock_level, expiry_flag, expiry_date, active';

// "Expiring soon" badge is derived from the due date: within 30 days (or past).
function flagFor(expiryDate) {
  if (!expiryDate) return false;
  const due = new Date(expiryDate);
  return due.getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// GET /inventory — every active product with full detail, expiring items first.
router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select(COLUMNS)
    .eq('active', true)
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .order('name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map((p) => ({ ...p, unit_price: Number(p.unit_price) })));
});

// POST /inventory — add a brand-new stock item (with an optional due date).
router.post('/', async (req, res) => {
  const { name, sku, unit_price, stock_level, expiry_date } = req.body || {};

  if (!name?.trim() || !sku?.trim()) {
    return res.status(400).json({ error: 'Name and SKU are required.' });
  }
  const price = Number(unit_price);
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'Unit price must be a positive number.' });
  }
  const stock = Number.isFinite(Number(stock_level)) ? Math.max(0, Math.trunc(Number(stock_level))) : 0;
  const due = expiry_date || null;

  const { data, error } = await supabase
    .from('products')
    .insert({
      name: name.trim(),
      sku: sku.trim(),
      unit_price: price,
      stock_level: stock,
      expiry_date: due,
      expiry_flag: flagFor(due),
      active: true,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    // 23505 = unique_violation (duplicate SKU).
    if (error.code === '23505') return res.status(409).json({ error: `SKU "${sku}" already exists.` });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json({ ...data, unit_price: Number(data.unit_price) });
});

// POST /inventory/:id/restock — add units to what's on hand.
router.post('/:id/restock', async (req, res) => {
  const amount = Math.trunc(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'Restock amount must be a non-zero number.' });
  }
  const { data: current, error: readErr } = await supabase
    .from('products')
    .select('stock_level')
    .eq('id', req.params.id)
    .single();
  if (readErr) return res.status(404).json({ error: 'Product not found.' });

  const next = Math.max(0, current.stock_level + amount);
  const { data, error } = await supabase
    .from('products')
    .update({ stock_level: next })
    .eq('id', req.params.id)
    .select(COLUMNS)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, unit_price: Number(data.unit_price) });
});

// PATCH /inventory/:id — edit name / price / stock / due date.
router.patch('/:id', async (req, res) => {
  const { name, unit_price, stock_level, expiry_date } = req.body || {};
  const patch = {};

  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Name cannot be empty.' });
    patch.name = String(name).trim();
  }
  if (unit_price !== undefined) {
    const price = Number(unit_price);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Unit price must be positive.' });
    patch.unit_price = price;
  }
  if (stock_level !== undefined) {
    const stock = Number(stock_level);
    if (!Number.isFinite(stock) || stock < 0) return res.status(400).json({ error: 'Stock cannot be negative.' });
    patch.stock_level = Math.trunc(stock);
  }
  if (expiry_date !== undefined) {
    patch.expiry_date = expiry_date || null; // '' clears the date
    patch.expiry_flag = flagFor(patch.expiry_date);
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No fields to update.' });
  }

  const { data, error } = await supabase
    .from('products')
    .update(patch)
    .eq('id', req.params.id)
    .select(COLUMNS)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, unit_price: Number(data.unit_price) });
});

// DELETE /inventory/:id — pull an item off the shelf (soft-delete: order
// history and analytics keep referencing it).
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('products')
    .update({ active: false })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// POST /inventory/remove-expired — pull everything past its due date at once.
router.post('/remove-expired', async (_req, res) => {
  const { data, error } = await supabase
    .from('products')
    .update({ active: false })
    .lt('expiry_date', today())
    .eq('active', true)
    .select('id, name');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ removed: data.length, items: data.map((p) => p.name) });
});

export default router;
