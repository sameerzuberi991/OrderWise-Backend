# OrderWise — backend

API and WhatsApp agent for OrderWise (FYP, FAST-NUCES Karachi, 2026–27).
Split out of the Zanjeer hackathon monorepo with its full commit history; the
web dashboards live in [`orderwise-web`](../orderwise-web).

> **Status:** this is the Node + Express prototype carried over from the
> hackathon. The code still uses the Zanjeer name — the rebrand is the next
> step. Per the proposal, the backend will move to FastAPI (Python).

## Setup

```bash
npm install
cp .env.example .env      # Supabase + WhatsApp credentials, PORT, DEMO_PHONE
npm run seed              # wipes and re-seeds demo data (idempotent)
npm run dev               # http://localhost:3001
```

Apply `schema.sql` once in the Supabase SQL editor (or `psql`) before seeding.
The server uses the service key — no RLS and no auth yet.

## API

| Route | What |
|---|---|
| `GET/POST /webhook` | WhatsApp webhook — Meta verify handshake + inbound messages (Meta and WaSender payloads) |
| `/orders` | Orders for the distributor dashboard, fulfil action, stock sidebar |
| `/inventory` | Products: list, add, restock, edit price/stock/due date, soft-delete, remove expired |
| `/analytics` | Summary, orders per day, top products, sales by area |

The web app talks to this server only through its base URL (`VITE_API_URL`),
so allow its origin via CORS when deploying.

## The order bot

A state machine over WhatsApp: `menu → browsing → awaiting_qty → cart → confirming`.

| Reply | Does |
|---|---|
| `1` / `2` / `3` / `4` | reorder last order · browse & build · usual basket · catalogue |
| `3` or `3 x 5` | pick catalogue item 3 (asks quantity) or add 5 of it |
| `ketchup` | match by name, disambiguating if several match |
| `cart` · `remove 2` · `clear` · `done` | review, drop a line, empty, finish |
| `help` · `menu` · `cancel` | available at any step |

Stock is enforced (out-of-stock refused, over-orders capped at what's available).
Pure, unit-tested helpers are in `services/conversation.js`; routing is in
`routes/webhook.js`. Session state is an in-memory `Map` — a restart resets
conversations.

## WhatsApp provider

`WHATSAPP_PROVIDER` selects `meta` or `wasender` (blank auto-detects: WaSender if
`WASENDER_API_KEY` is set, else Meta).

- **WaSender:** set `WASENDER_API_KEY`; point the session's Webhook URL at
  `https://<host>/webhook` and set `WASENDER_WEBHOOK_SECRET` to the same secret.
- **Meta Cloud API:** set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_VERIFY_TOKEN`, and register the webhook in the Meta console.

## Tests

```bash
npm test
```
