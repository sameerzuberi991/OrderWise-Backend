// Pure helpers for the order bot's conversation — no I/O, unit-testable.

const PKR = (n) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
export { PKR };

export const RULE = '━━━━━━━━━━━━━━━━━━';

// --- Parsing --------------------------------------------------------------

// Pull an explicit quantity out of a free-text item line WITHOUT being fooled by
// pack sizes baked into product names ("50g", "800ml", "39g"). Only a leading
// number, or a number after an explicit "x", counts as a quantity.
//   "3 tikka"          → { qty: 3,    query: "tikka" }
//   "tikka masala x 2" → { qty: 2,    query: "tikka masala" }
//   "Chaat Masala 50g" → { qty: null, query: "Chaat Masala 50g" }
export function parseQuantity(text) {
  const t = String(text || '').trim();
  let m = t.match(/^(\d{1,4})\s*(?:x|×)?\s+(.+)$/i);
  if (m) return { qty: toQty(m[1]), query: m[2].trim() };
  m = t.match(/^(.+?)\s*(?:x|×)\s*(\d{1,4})$/i);
  if (m) return { qty: toQty(m[2]), query: m[1].trim() };
  return { qty: null, query: t };
}

function toQty(s) {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// A quantity reply on its own ("5", "x5", "5 units"). Returns null if not a
// sensible positive integer.
export function parseCount(text) {
  const m = String(text || '').match(/\d{1,4}/);
  if (!m) return null;
  return toQty(m[0]);
}

// A catalogue line-number pick, optionally with a quantity. This is the primary
// way retailers choose items — typing "3" beats typing a product name on a phone
// keyboard. Returns null when the text isn't a pure numeric selection, so the
// caller can fall back to name matching.
//   "3"      → { index: 3, qty: null }
//   "#3"     → { index: 3, qty: null }
//   "3 x 5"  → { index: 3, qty: 5 }
//   "3x5"    → { index: 3, qty: 5 }
//   "3 tikka"→ null  (has a name — not a pure selection)
export function parseSelection(text) {
  const t = String(text || '').trim();
  let m = t.match(/^#?(\d{1,3})$/);
  if (m) return { index: parseInt(m[1], 10), qty: null };
  m = t.match(/^#?(\d{1,3})\s*(?:x|×|\*)\s*(\d{1,4})$/i);
  if (m) return { index: parseInt(m[1], 10), qty: toQty(m[2]) };
  return null;
}

// "remove 2" / "delete 2" / "rm 2" → 2. Returns null if not a remove command.
export function parseRemove(text) {
  const m = String(text || '')
    .trim()
    .match(/^(?:remove|delete|del|rm|drop)\s*#?(\d{1,3})$/i);
  return m ? parseInt(m[1], 10) : null;
}

// Case-insensitive product match: an exact name wins outright, otherwise every
// product whose name contains the query. Returns an array (0, 1, or many).
export function matchProducts(catalog, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const exact = catalog.filter((p) => p.name.toLowerCase() === q);
  if (exact.length) return exact;
  return catalog.filter((p) => p.name.toLowerCase().includes(q));
}

// --- Stock ----------------------------------------------------------------

export function inStock(product) {
  return Number(product?.stock_level ?? 0) > 0;
}

// Cap a requested quantity at what's actually on the shelf, accounting for what
// the cart already claims. Returns the grantable amount plus why it was capped.
export function clampToStock(product, requested, cart = []) {
  const stock = Number(product?.stock_level ?? 0);
  const alreadyInCart = cart
    .filter((i) => i.product_id === product.id)
    .reduce((sum, i) => sum + i.quantity, 0);
  const room = Math.max(0, stock - alreadyInCart);
  if (requested <= room) return { qty: requested, capped: false, room, stock, alreadyInCart };
  return { qty: room, capped: true, room, stock, alreadyInCart };
}

// --- Cart -----------------------------------------------------------------

// Add (or top up) a line in the cart, mutating and returning it.
export function addToCart(cart, product, quantity) {
  const existing = cart.find((i) => i.product_id === product.id);
  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.push({
      product_id: product.id,
      name: product.name,
      unit_price: product.unit_price,
      quantity,
    });
  }
  return cart;
}

// Drop a 1-based line from the cart. Returns the removed line, or null if the
// index doesn't exist.
export function removeFromCart(cart, lineNumber) {
  const idx = lineNumber - 1;
  if (idx < 0 || idx >= cart.length) return null;
  return cart.splice(idx, 1)[0];
}

export function cartTotal(items) {
  return items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
}

export function cartUnits(items) {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

// --- Formatting -----------------------------------------------------------

// Numbered line items with per-line subtotals.
export function formatItems(items) {
  return items
    .map((i, idx) => `${idx + 1}. ${i.name} × ${i.quantity} — ${PKR(i.quantity * i.unit_price)}`)
    .join('\n');
}

// The numbered catalogue, with price and live stock per line. This is what the
// retailer picks from, so line numbers here are the selection indices.
export function formatCatalog(catalog) {
  return catalog
    .map((p, idx) => {
      const stock = Number(p.stock_level ?? 0);
      let availability;
      if (stock <= 0) availability = '❌ out of stock';
      else if (stock <= 40) availability = `⚠️ only ${stock} left`;
      else availability = `${stock} in stock`;
      return `*${idx + 1}* · ${p.name}\n     ${PKR(p.unit_price)} · ${availability}`;
    })
    .join('\n');
}

// The cart, as its own reviewable screen.
export function formatCart(items) {
  if (items.length === 0) return '🧾 Your order is empty.';
  return (
    `🧾 *YOUR ORDER*\n\n${formatItems(items)}\n\n` +
    `${items.length} line${items.length === 1 ? '' : 's'} · ${cartUnits(items)} units · ` +
    `Total: *${PKR(cartTotal(items))}*`
  );
}

// Full order summary + total, ready to confirm.
export function formatSummary(items, { heading, area } = {}) {
  const head = heading ? `${heading}\n\n` : '';
  const deliver = area ? `\nDeliver to: *${area}*\n` : '';
  return (
    `${head}${formatItems(items)}\n\n` +
    `Total: *${PKR(cartTotal(items))}*\n${deliver}\n` +
    `Reply *CONFIRM* to place this order.\n` +
    `*back* to keep editing · *cancel* to discard.`
  );
}
