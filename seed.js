// Seed script — idempotent: wipes demo data and re-inserts a known-good state.
// Safe (and encouraged) to re-run right before the demo: `npm run seed`.
import { supabase } from './db.js';

// DEMO: set DEMO_PHONE in .env to your real WhatsApp number so the
// phone you test with maps to the first retailer. Falls back to a placeholder.
const DEMO_PHONE = process.env.DEMO_PHONE || '923001111111';

// expiryInDays: best-before relative to today (negative = already expired, so the
// Inventory page can demo "remove expired"). Omit for products we don't date.
const PRODUCTS = [
  { name: 'National Biryani Masala 39g', sku: 'NF-BIR-39', unit_price: 150, stock_level: 240 },
  { name: 'National Tikka Masala 39g', sku: 'NF-TIK-39', unit_price: 150, stock_level: 180 },
  { name: 'National Qorma Masala 39g', sku: 'NF-QOR-39', unit_price: 150, stock_level: 200 },
  { name: 'National Chaat Masala 50g', sku: 'NF-CHA-50', unit_price: 140, stock_level: 160 },
  { name: 'National Tomato Ketchup 800g', sku: 'NF-KET-800', unit_price: 550, stock_level: 35, expiryInDays: 18 },
  { name: 'National Mixed Pickle 1kg', sku: 'NF-PIC-1000', unit_price: 520, stock_level: 90, expiryInDays: 120 },
  { name: 'Danedar Black Tea 190g', sku: 'GT-TEA-190', unit_price: 600, stock_level: 140, expiryInDays: 210 },
  { name: 'Egg & Milk Biscuits Family Pack', sku: 'GT-BIS-FP', unit_price: 120, stock_level: 300, expiryInDays: 25 },
  { name: 'Beauty Bar Soap 130g', sku: 'GT-SOP-130', unit_price: 125, stock_level: 220 },
  // DEMO: already expired — the one to pull with "remove expired stock".
  { name: 'Rose Syrup 800ml', sku: 'GT-SYR-800', unit_price: 400, stock_level: 60, expiryInDays: -6 },
];

// A YYYY-MM-DD string `days` from today, or null.
function dateInDays(days) {
  if (days == null) return null;
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

const RETAILERS = [
  { name: 'Bismillah Kiryana Store', phone: DEMO_PHONE, area: 'Saddar' },
  { name: 'Al-Madina General Store', phone: '923002222222', area: 'Korangi' },
  { name: 'Karachi Super Mart', phone: '923003333333', area: 'Gulshan-e-Iqbal' },
  { name: 'Faisal Traders', phone: '923004444444', area: 'North Nazimabad' },
  { name: 'New Quetta Store', phone: '923005555555', area: 'Saddar' },
];

// Deterministic RNG so every re-seed produces the same believable history.
let rngState = 42;
function rand() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

async function wipe() {
  // Delete in FK order. `neq id 0` = "all rows" (Supabase requires a filter).
  for (const table of ['order_items', 'orders', 'products', 'retailers']) {
    const { error } = await supabase.from(table).delete().neq('id', 0);
    if (error) throw new Error(`wiping ${table}: ${error.message}`);
  }
}

async function insert(table, rows) {
  const { data, error } = await supabase.from(table).insert(rows).select();
  if (error) throw new Error(`inserting ${table}: ${error.message}`);
  return data;
}

async function main() {
  console.log('Wiping existing demo data…');
  await wipe();

  console.log('Inserting products and retailers…');
  // Every row must carry the same keys: on a bulk insert PostgREST inserts an
  // explicit NULL for any key a row omits (ignoring the column default), so a
  // product without expiry_flag would violate the NOT NULL constraint.
  const products = await insert(
    'products',
    // Uniform keys on every row (see note above): derive the date columns and
    // strip the seed-only `expiryInDays` helper before inserting.
    PRODUCTS.map(({ expiryInDays, ...p }) => ({
      stock_level: 0,
      ...p,
      expiry_date: dateInDays(expiryInDays),
      expiry_flag: expiryInDays != null && expiryInDays <= 30,
      active: true,
    }))
  );
  const retailers = await insert('retailers', RETAILERS);

  // 32 historical orders spread over the past 6 weeks. Each retailer leans on
  // a few "usual" products so the reorder suggestion looks personal, not random.
  console.log('Inserting historical orders…');
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const usualByRetailer = retailers.map((_, i) =>
    // Overlapping windows of 5 products per retailer keep top-products charts interesting.
    [0, 1, 2, 3, 4].map((k) => products[(i * 2 + k) % products.length])
  );

  let orderCount = 0;
  for (let i = 0; i < 32; i++) {
    const retailer = retailers[i % retailers.length];
    const usual = usualByRetailer[i % retailers.length];
    const daysAgo = randInt(0, 41);
    const createdAt = new Date(now - daysAgo * DAY - randInt(0, 12) * 60 * 60 * 1000);
    // Recent orders stay pending so the distributor dashboard isn't empty on load.
    const status = daysAgo < 2 ? 'pending' : 'fulfilled';

    const [order] = await insert('orders', {
      retailer_id: retailer.id,
      status,
      created_at: createdAt.toISOString(),
    });

    const itemCount = randInt(1, 4);
    const picked = [...usual].sort(() => rand() - 0.5).slice(0, itemCount);
    await insert(
      'order_items',
      picked.map((p) => ({ order_id: order.id, product_id: p.id, quantity: randInt(2, 12) }))
    );
    orderCount++;
  }

  console.log(`Done: ${products.length} products, ${retailers.length} retailers, ${orderCount} orders.`);
  console.log(`Demo retailer: ${RETAILERS[0].name} (${DEMO_PHONE})`);
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
