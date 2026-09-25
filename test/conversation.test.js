import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuantity,
  parseCount,
  parseSelection,
  parseRemove,
  matchProducts,
  inStock,
  clampToStock,
  addToCart,
  removeFromCart,
  cartTotal,
  cartUnits,
  formatCatalog,
} from '../services/conversation.js';

const CATALOG = [
  { id: 1, name: 'National Biryani Masala 39g', unit_price: 150, stock_level: 240 },
  { id: 2, name: 'National Tikka Masala 39g', unit_price: 150, stock_level: 180 },
  { id: 3, name: 'National Chaat Masala 50g', unit_price: 140, stock_level: 12 },
  { id: 4, name: 'Danedar Black Tea 190g', unit_price: 600, stock_level: 0 },
];

test('parseQuantity: leading number', () => {
  assert.deepEqual(parseQuantity('3 tikka'), { qty: 3, query: 'tikka' });
  assert.deepEqual(parseQuantity('3 x tikka masala'), { qty: 3, query: 'tikka masala' });
});

test('parseQuantity: trailing number only with explicit x', () => {
  assert.deepEqual(parseQuantity('tikka masala x 2'), { qty: 2, query: 'tikka masala' });
});

test('parseQuantity: not fooled by pack sizes in names', () => {
  // "50g" must NOT be read as a quantity of 50.
  assert.deepEqual(parseQuantity('National Chaat Masala 50g'), {
    qty: null,
    query: 'National Chaat Masala 50g',
  });
});

test('parseQuantity: bare item name has no quantity', () => {
  assert.deepEqual(parseQuantity('biryani'), { qty: null, query: 'biryani' });
});

test('parseCount: extracts a positive integer, else null', () => {
  assert.equal(parseCount('5'), 5);
  assert.equal(parseCount('x5'), 5);
  assert.equal(parseCount('none'), null);
  assert.equal(parseCount('0'), null);
});

test('matchProducts: unique substring match', () => {
  const m = matchProducts(CATALOG, 'biryani');
  assert.equal(m.length, 1);
  assert.equal(m[0].id, 1);
});

test('matchProducts: ambiguous query returns several', () => {
  assert.equal(matchProducts(CATALOG, 'masala').length, 3);
});

test('matchProducts: unknown item returns none', () => {
  assert.equal(matchProducts(CATALOG, 'chocolate').length, 0);
});

test('matchProducts: exact name beats substring', () => {
  const m = matchProducts(CATALOG, 'National Tikka Masala 39g');
  assert.equal(m.length, 1);
  assert.equal(m[0].id, 2);
});

test('addToCart: adds new and tops up existing lines', () => {
  const cart = [];
  addToCart(cart, CATALOG[0], 2);
  addToCart(cart, CATALOG[1], 3);
  addToCart(cart, CATALOG[0], 4); // top up product 1
  assert.equal(cart.length, 2);
  assert.equal(cart.find((i) => i.product_id === 1).quantity, 6);
  assert.equal(cartTotal(cart), 6 * 150 + 3 * 150);
  assert.equal(cartUnits(cart), 9);
});

// --- Numbered catalogue selection -----------------------------------------

test('parseSelection: bare line number', () => {
  assert.deepEqual(parseSelection('3'), { index: 3, qty: null });
  assert.deepEqual(parseSelection('#3'), { index: 3, qty: null });
});

test('parseSelection: line number with quantity', () => {
  assert.deepEqual(parseSelection('3 x 5'), { index: 3, qty: 5 });
  assert.deepEqual(parseSelection('3x5'), { index: 3, qty: 5 });
  assert.deepEqual(parseSelection('3 * 5'), { index: 3, qty: 5 });
});

test('parseSelection: a name is not a selection', () => {
  assert.equal(parseSelection('3 tikka'), null);
  assert.equal(parseSelection('ketchup'), null);
  assert.equal(parseSelection('done'), null);
});

test('parseRemove: recognises remove commands only', () => {
  assert.equal(parseRemove('remove 2'), 2);
  assert.equal(parseRemove('rm 2'), 2);
  assert.equal(parseRemove('delete #10'), 10);
  assert.equal(parseRemove('2'), null);
  assert.equal(parseRemove('remove everything'), null);
});

// --- Stock ----------------------------------------------------------------

test('inStock: reflects stock_level', () => {
  assert.equal(inStock(CATALOG[0]), true);
  assert.equal(inStock(CATALOG[3]), false);
});

test('clampToStock: grants what is available', () => {
  const r = clampToStock(CATALOG[2], 5, []); // 12 in stock
  assert.deepEqual({ qty: r.qty, capped: r.capped }, { qty: 5, capped: false });
});

test('clampToStock: caps an over-order at the stock level', () => {
  const r = clampToStock(CATALOG[2], 50, []); // asks 50, only 12
  assert.deepEqual({ qty: r.qty, capped: r.capped }, { qty: 12, capped: true });
});

test('clampToStock: counts what the cart already claims', () => {
  const cart = [];
  addToCart(cart, CATALOG[2], 10); // 10 of the 12 already claimed
  const r = clampToStock(CATALOG[2], 5, cart);
  assert.deepEqual({ qty: r.qty, capped: r.capped, room: r.room }, { qty: 2, capped: true, room: 2 });
});

test('clampToStock: zero room when the cart holds everything', () => {
  const cart = [];
  addToCart(cart, CATALOG[2], 12);
  assert.equal(clampToStock(CATALOG[2], 1, cart).qty, 0);
});

// --- Cart editing ---------------------------------------------------------

test('removeFromCart: drops the given 1-based line', () => {
  const cart = [];
  addToCart(cart, CATALOG[0], 2);
  addToCart(cart, CATALOG[1], 3);
  const removed = removeFromCart(cart, 1);
  assert.equal(removed.product_id, 1);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].product_id, 2);
});

test('removeFromCart: out-of-range line returns null and changes nothing', () => {
  const cart = [];
  addToCart(cart, CATALOG[0], 2);
  assert.equal(removeFromCart(cart, 9), null);
  assert.equal(removeFromCart(cart, 0), null);
  assert.equal(cart.length, 1);
});

// --- Catalogue rendering --------------------------------------------------

test('formatCatalog: numbers lines and flags stock state', () => {
  const out = formatCatalog(CATALOG);
  assert.match(out, /\*1\* · National Biryani Masala 39g/);
  assert.match(out, /240 in stock/);
  assert.match(out, /only 12 left/);        // low stock warning
  assert.match(out, /out of stock/);        // zero stock
});
