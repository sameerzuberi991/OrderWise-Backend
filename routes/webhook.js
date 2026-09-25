import { Router } from 'express';
import { supabase } from '../db.js';
import { sendText } from '../services/whatsapp.js';
import { getLastOrder, getCatalog, suggestReorder, placeOrder } from '../services/reorder.js';
import {
  PKR,
  RULE,
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
  formatItems,
  formatCatalog,
  formatCart,
  formatSummary,
} from '../services/conversation.js';

const router = Router();

// DEMO: conversation state lives in memory (phone → session). A server restart
// just resets everyone to the menu — fine for a demo. Production would keep this
// in Redis or a `conversations` table so the server stays stateless.
//   session.step: 'menu' | 'browsing' | 'awaiting_qty' | 'cart' | 'confirming'
//   session.cart:    line items being built
//   session.catalog: cached product list (selection indices point into this)
//   session.pending: product awaiting a quantity reply
//   session.review:  the { items, total } order awaiting CONFIRM
const sessions = new Map();

function getSession(phone) {
  return sessions.get(phone) || { step: 'menu', cart: [] };
}

function save(phone, session) {
  sessions.set(phone, session);
  return session;
}

// GET /webhook — Meta verification handshake. WaSender has no GET handshake
// (it verifies via the X-Webhook-Signature header on POST), so this is a no-op
// for WaSender but harmless to leave mounted.
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Pull { from, text } out of either provider's payload (and the /retailer
// simulator, which mimics the Meta shape). Returns null for anything that isn't
// an inbound text message (status callbacks, receipts, media, echoes of our own
// sends), so the caller can just acknowledge those.
function normalizeInbound(body) {
  // Meta / simulator shape: entry[].changes[].value.messages[]
  const meta = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (meta) {
    if (meta.type !== 'text') return null;
    return { from: meta.from, text: (meta.text?.body || '').trim() };
  }

  // WaSender shape: data.messages is a single object.
  const msg = body?.data?.messages;
  if (msg) {
    if (msg.key?.fromMe) return null; // ignore echoes of our own outbound
    // Prefer the "cleaned" phone fields — remoteJid can be a @lid, not a number.
    const from = msg.key?.cleanedSenderPn || msg.key?.cleanedParticipantPn || msg.key?.remoteJid;
    const text = (msg.messageBody || msg.message?.conversation || '').trim();
    if (!from || !text) return null;
    return { from, text };
  }

  return null;
}

// WaSender signs each webhook with the X-Webhook-Signature header, which must
// equal the Webhook Secret you set in the dashboard. We only enforce this for
// WaSender-shaped payloads that carry the header, so the Meta handshake and the
// local /retailer simulator (neither sends the header) are unaffected.
function wasenderSignatureOk(req) {
  const secret = process.env.WASENDER_WEBHOOK_SECRET;
  const signature = req.get('x-webhook-signature');
  if (!secret) return true; // not configured → don't block
  if (!signature) return true; // no header → not a WaSender request
  return signature === secret;
}

// POST /webhook — incoming messages. Real WhatsApp (Meta or WaSender) and the
// /retailer simulator all funnel through here; normalizeInbound() smooths over
// the payload differences so the logic below is provider-agnostic.
router.post('/', async (req, res) => {
  try {
    if (!wasenderSignatureOk(req)) {
      console.warn('Rejected webhook: bad X-Webhook-Signature');
      return res.status(401).json({ error: 'invalid signature' });
    }

    const inbound = normalizeInbound(req.body);
    if (!inbound) {
      // Status callbacks (delivered/read receipts etc.) — acknowledge and move on.
      return res.status(200).json({ replies: [] });
    }

    const { from, text } = inbound;
    console.log(`← inbound from ${from}: ${text}`);

    const replies = await handleMessage(from, text);

    // Send via WhatsApp (no-ops without creds) AND return replies in the HTTP
    // response — Meta ignores the body, the chat simulator renders it.
    for (const reply of replies) await sendText(from, reply);
    return res.status(200).json({ replies });
  } catch (err) {
    console.error('Webhook error:', err.message);
    // DEMO: always 200 so Meta doesn't retry-storm us mid-demo.
    return res
      .status(200)
      .json({ replies: ['Sorry, something went wrong on our side. Please try again.'] });
  }
});

const CONFIRM_WORDS = ['confirm', 'yes', 'y', 'ok', 'okay', 'haan', 'ji', 'pakka'];
const DONE_WORDS = ['done', 'finish', 'finished', 'checkout', 'bas'];
const CANCEL_WORDS = ['cancel', 'stop', 'exit', 'reset', 'discard'];
const MENU_WORDS = ['menu', 'start', 'home', 'back'];
const CART_WORDS = ['cart', 'order', 'basket', 'total'];
const HELP_WORDS = ['help', 'commands', '?', 'madad'];
const GREETING_RE = /\b(salaam|salam|assalam|aoa|hi|hello|hey)\b/i;

// --- Screens --------------------------------------------------------------

function menuText(name) {
  return (
    `Salaam *${name}*! 👋\n` +
    `Welcome to *OrderWise* — order your stock right here on WhatsApp.\n\n` +
    `*1* · Reorder my last order\n` +
    `*2* · Start a new order\n` +
    `*3* · My usual basket\n` +
    `*4* · Browse catalogue & stock\n\n` +
    `${RULE}\n` +
    `Reply with a number *1–4*, or *help* anytime.`
  );
}

function helpText() {
  return (
    `🆘 *HOW TO ORDER*\n\n` +
    `While browsing the catalogue:\n` +
    `• *3* — pick item 3 (I'll ask how many)\n` +
    `• *3 x 5* — add 5 of item 3 straight away\n` +
    `• type a name, e.g. *ketchup*\n\n` +
    `Anytime:\n` +
    `• *cart* — see your order so far\n` +
    `• *remove 2* — drop line 2 from your order\n` +
    `• *clear* — empty your order\n` +
    `• *done* — finish and review\n` +
    `• *menu* — back to the main menu\n` +
    `• *cancel* — discard everything`
  );
}

function catalogText(catalog) {
  return (
    `🛒 *CATALOGUE* — ${catalog.length} items\n\n` +
    `${formatCatalog(catalog)}\n\n` +
    `${RULE}\n` +
    `Add an item: reply *3* or *3 x 5*\n` +
    `*cart* — view order · *done* — finish`
  );
}

function cartScreen(cart) {
  if (cart.length === 0) {
    return `🧾 Your order is empty.\n\nReply with an item number to add something, or *menu* to go back.`;
  }
  return (
    `${formatCart(cart)}\n\n` +
    `${RULE}\n` +
    `*done* — review & confirm\n` +
    `*remove 2* — drop a line · *clear* — empty\n` +
    `Or reply an item number to add more.`
  );
}

// --- Router ---------------------------------------------------------------

async function handleMessage(phone, text) {
  const { data: retailer, error } = await supabase
    .from('retailers')
    .select('id, name, area')
    .eq('phone', phone)
    .maybeSingle();
  // A DB failure must not masquerade as "number not registered".
  if (error) throw new Error(`retailer lookup: ${error.message}`);

  if (!retailer) {
    return [
      'Salaam! This number is not registered with OrderWise yet. ' +
        'Please contact your distributor to get set up.',
    ];
  }

  const session = getSession(phone);
  const lower = text.trim().toLowerCase();

  // --- Global commands, available from any step ---
  if (HELP_WORDS.includes(lower)) return [helpText()];

  if (CANCEL_WORDS.includes(lower)) {
    sessions.delete(phone);
    return [`No problem — order discarded.\n\n${menuText(retailer.name)}`];
  }

  // "back" from the confirm screen means "keep editing", not "main menu".
  if (MENU_WORDS.includes(lower)) {
    if (lower === 'back' && session.step === 'confirming' && session.cart?.length) {
      save(phone, { ...session, step: 'cart' });
      return [cartScreen(session.cart)];
    }
    save(phone, { ...session, step: 'menu' });
    return [menuText(retailer.name)];
  }

  if (CART_WORDS.includes(lower) && session.step !== 'awaiting_qty') {
    save(phone, { ...session, step: 'cart' });
    return [cartScreen(session.cart || [])];
  }

  if (lower === 'clear' && session.cart?.length) {
    save(phone, { ...session, step: 'browsing', cart: [] });
    return [`🗑️ Order cleared.\n\nReply an item number to start adding, or *menu* to go back.`];
  }

  const removeLine = parseRemove(lower);
  if (removeLine !== null) return handleRemove(phone, session, removeLine);

  // --- Step-specific handling ---
  if (session.step === 'awaiting_qty') return handleAwaitingQty(phone, session, text);
  if (session.step === 'confirming') return handleConfirming(phone, retailer, session, lower);
  if (session.step === 'browsing' || session.step === 'cart') {
    return handleBrowsing(phone, retailer, session, text, lower);
  }

  // --- Main menu ---
  if (lower === '1') return startReorderLast(phone, retailer, session);
  if (lower === '2') return startNewOrder(phone, retailer, session);
  if (lower === '3') return startUsualBasket(phone, retailer, session);
  if (lower === '4') return startNewOrder(phone, retailer, session);

  save(phone, { ...session, step: 'menu' });
  if (GREETING_RE.test(lower)) return [menuText(retailer.name)];
  return [`Sorry, I didn't catch that.\n\n${menuText(retailer.name)}`];
}

// --- Option 1: reorder the last order -------------------------------------
async function startReorderLast(phone, retailer, session) {
  const last = await getLastOrder(retailer.id);
  if (!last) {
    save(phone, { ...session, step: 'menu' });
    return [
      `You don't have any past orders yet, ${retailer.name}.\n\n` +
        `Reply *2* to build your first order.`,
    ];
  }
  // Land on the cart, not straight into confirm — the retailer can still edit.
  save(phone, { ...session, step: 'cart', cart: last.items, catalog: null });
  return [
    `🔁 *Your last order* (#${last.orderId})\n\n${formatItems(last.items)}\n\n` +
      `Total: *${PKR(cartTotal(last.items))}*\n\n` +
      `${RULE}\n` +
      `*done* — confirm as-is\n` +
      `*remove 2* — drop a line · *2* — add more items`,
  ];
}

// --- Option 3: the usual basket (most-ordered items across history) --------
async function startUsualBasket(phone, retailer, session) {
  const usual = await suggestReorder(retailer.id);
  if (!usual.items.length) {
    save(phone, { ...session, step: 'menu' });
    return [
      `We don't have enough order history to work out your usual basket yet.\n\n` +
        `Reply *2* to build an order.`,
    ];
  }
  save(phone, { ...session, step: 'cart', cart: usual.items, catalog: null });
  return [
    `⭐ *Your usual basket*\n` +
      `Based on what you order most often:\n\n${formatItems(usual.items)}\n\n` +
      `Total: *${PKR(cartTotal(usual.items))}*\n\n` +
      `${RULE}\n` +
      `*done* — confirm · *remove 2* — drop a line\n` +
      `*2* — browse the catalogue for more`,
  ];
}

// --- Option 2 / 4: browse and build --------------------------------------
async function startNewOrder(phone, retailer, session) {
  const catalog = await getCatalog();
  const next = save(phone, {
    ...session,
    step: 'browsing',
    cart: session.cart || [],
    catalog,
  });
  const intro = next.cart.length
    ? `Adding to your existing order (${cartUnits(next.cart)} units so far).\n\n`
    : `Let's build your order, ${retailer.name}. 🛒\n\n`;
  return [intro + catalogText(catalog)];
}

// Make sure a session has a catalogue to resolve selections against — the
// reorder/usual-basket flows land in the cart without loading one.
async function ensureCatalog(phone, session) {
  if (session.catalog?.length) return session.catalog;
  const catalog = await getCatalog();
  save(phone, { ...session, catalog });
  session.catalog = catalog;
  return catalog;
}

async function handleBrowsing(phone, retailer, session, text, lower) {
  const cart = (session.cart ||= []);

  if (DONE_WORDS.includes(lower) || CONFIRM_WORDS.includes(lower)) {
    if (cart.length === 0) {
      return ['Your order is empty. Reply with an item number to add something first.'];
    }
    save(phone, { ...session, step: 'confirming', review: { items: cart, total: cartTotal(cart) } });
    return [
      formatSummary(cart, { heading: '🧾 *CONFIRM YOUR ORDER*', area: retailer.area }),
    ];
  }

  const catalog = await ensureCatalog(phone, session);

  // 1) Numbered selection — the primary path ("3" or "3 x 5").
  const selection = parseSelection(text);
  if (selection) {
    const product = catalog[selection.index - 1];
    if (!product) {
      return [
        `❌ There's no item *${selection.index}*. Pick a number between 1 and ${catalog.length}, ` +
          `or reply *4* to see the catalogue again.`,
      ];
    }
    return addOrAskQty(phone, session, product, selection.qty);
  }

  // 2) Fall back to matching by name ("ketchup", "3 tikka masala").
  const { qty, query } = parseQuantity(text);
  if (!query || query.length < 2) {
    return [
      `Please reply with an item number (e.g. *3*), or an item name.\n` +
        `*cart* to review · *done* to finish · *help* for commands.`,
    ];
  }

  const matches = matchProducts(catalog, query);
  if (matches.length === 0) {
    return [
      `❌ Sorry, we don't stock "${query.trim()}".\n\n` +
        `Reply *4* to see the catalogue, or try another name.`,
    ];
  }
  if (matches.length > 1) {
    const opts = matches
      .slice(0, 8)
      .map((p) => `*${catalog.indexOf(p) + 1}* · ${p.name}`)
      .join('\n');
    return [`Which one did you mean?\n\n${opts}\n\nReply with its number.`];
  }

  return addOrAskQty(phone, session, matches[0], qty);
}

// Shared by numbered and name-based selection: add straight away if a quantity
// came with the message, otherwise ask for one.
function addOrAskQty(phone, session, product, qty) {
  if (!inStock(product)) {
    return [
      `❌ *${product.name}* is out of stock right now.\n\n` +
        `Pick another item, or *done* to finish your order.`,
    ];
  }

  if (qty == null) {
    save(phone, { ...session, step: 'awaiting_qty', pending: product });
    return [
      `*${product.name}*\n${PKR(product.unit_price)} each · ${product.stock_level} in stock\n\n` +
        `How many? Reply with a number (e.g. *5*).`,
    ];
  }

  return [addWithStockCheck(phone, session, product, qty)];
}

// Apply a quantity against live stock, then report what landed in the cart.
function addWithStockCheck(phone, session, product, requested) {
  const cart = (session.cart ||= []);
  const { qty, capped, room, stock } = clampToStock(product, requested, cart);

  if (qty === 0) {
    save(phone, { ...session, step: 'browsing', pending: null });
    return (
      `⚠️ Your order already claims all ${stock} available units of ` +
      `*${product.name}*.\n\nPick another item, or *done* to finish.`
    );
  }

  addToCart(cart, product, qty);
  save(phone, { ...session, step: 'browsing', cart, pending: null });

  const capNote = capped
    ? `⚠️ Only ${room} unit${room === 1 ? '' : 's'} of *${product.name}* available — ` +
      `added ${qty} instead of ${requested}.\n\n`
    : `✅ Added *${qty} × ${product.name}*.\n\n`;

  return (
    `${capNote}*Your order*\n${formatItems(cart)}\n\n` +
    `Total: *${PKR(cartTotal(cart))}*\n\n` +
    `Add another item, or *done* to finish.`
  );
}

function handleAwaitingQty(phone, session, text) {
  // Defensive: if we lost the pending product (restart mid-flow), don't crash.
  if (!session.pending) {
    save(phone, { ...session, step: 'browsing' });
    return ['Which item did you want? Reply with its number, or *4* to see the catalogue.'];
  }

  const n = parseCount(text);
  if (!n) {
    return [
      `Please reply with a quantity — just a number, e.g. *5*.\n` +
        `(Or *cancel* to start over.)`,
    ];
  }
  return [addWithStockCheck(phone, session, session.pending, n)];
}

function handleRemove(phone, session, lineNumber) {
  const cart = session.cart || [];
  if (cart.length === 0) return ['Your order is empty — nothing to remove.'];

  const removed = removeFromCart(cart, lineNumber);
  if (!removed) {
    return [
      `❌ There's no line *${lineNumber}* in your order.\n\n${formatCart(cart)}`,
    ];
  }

  save(phone, { ...session, step: cart.length ? 'cart' : 'browsing', cart });
  const tail = cart.length
    ? `\n\n${formatCart(cart)}\n\n*done* — confirm · or add more items.`
    : `\n\nYour order is now empty. Reply an item number to add something.`;
  return [`🗑️ Removed *${removed.name}*.${tail}`];
}

// --- Confirmation (shared by every flow) ----------------------------------
async function handleConfirming(phone, retailer, session, lower) {
  const review = session.review || { items: session.cart || [], total: cartTotal(session.cart || []) };

  if (CONFIRM_WORDS.includes(lower) || DONE_WORDS.includes(lower)) {
    if (!review.items.length) {
      save(phone, { ...session, step: 'browsing' });
      return ['Your order is empty — nothing to confirm.'];
    }
    const orderId = await placeOrder(retailer.id, review);
    sessions.delete(phone);
    return [
      `✅ *Order #${orderId} confirmed!*\n\n` +
        `${formatItems(review.items)}\n\n` +
        `Total: *${PKR(review.total)}*\n` +
        `Deliver to: *${retailer.area}*\n\n` +
        `Your distributor has been notified. Shukriya! 🙏\n\n` +
        `Reply *menu* to place another order.`,
    ];
  }

  // Let a number keep editing rather than dead-ending on the confirm screen.
  if (parseSelection(lower)) {
    save(phone, { ...session, step: 'browsing' });
    return handleBrowsing(phone, retailer, session, lower, lower);
  }

  return [
    `Reply *CONFIRM* to place this order.\n` +
      `*back* to keep editing · *cancel* to discard.`,
  ];
}

export default router;
