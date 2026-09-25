# Unaiza — backend plan

**Role:** WhatsApp / NLU Lead (proposal §9, Table 2)
**You own:** the WhatsApp Business Cloud API integration, the webhook layer,
code-switched (Urdu / English / Roman Urdu) intent extraction, product resolution,
and the multi-turn dialogue (including negotiation dialogue).
**Frontend counterpart:** [`unaiza.plan.md`](https://github.com/sameerzuberi991/OrderWise-Frontend/blob/main/unaiza.plan.md) in `OrderWise-Frontend`.

---

## Project phases (whole team)

| # | Phase | When | Goal |
|---|-------|------|------|
| 0 | Foundation | Aug – Sep 2026 | Proposal defended, literature review, SRS/SDS, FastAPI + TypeScript skeletons, shared interfaces agreed |
| 1 | Retailer slice build | Oct – Nov 2026 | Each module's v1 built in isolation against agreed interfaces |
| 2 | Integration & FYP-I defense | Dec 2026 | Retailer vertical slice working end-to-end, live demo |
| 3 | Negotiation & distributor | Jan – Feb 2027 | Engine v2 (negotiation), distributor features |
| 4 | Mobile, robustness, evaluation | Mar – Apr 2027 | Mobile app + offline sync, code-switch hardening, LLM-as-judge built |
| 5 | Prove it & wrap up | Apr – May 2027 | Run evaluation, testing, manuals, final report, final defense |

Phases run in this order. Phase 2 cannot start until each member's Phase 1
interfaces are stable.

---

## Where the code is today

- `routes/webhook.js` holds a working WhatsApp order bot with a **numbered menu**:
  reorder last, new order, usual basket, browse catalogue, cart editing, confirm.
- `services/conversation.js` has **rule-based parsing**: quantities, line-number
  picks, name matching. There is no LLM and no Urdu/Roman Urdu understanding.
- `services/whatsapp.js` supports **Meta Cloud API** and **WasenderAPI** (an
  unofficial gateway). The proposal specifies the **Meta WhatsApp Business Cloud API**.
- Sessions live **in memory**, so a restart wipes every conversation.
- Webhook verification and WaSender signature checks exist, with tests in
  `test/webhook.test.js` and `test/conversation.test.js`.
- The stack is Node + Express. Per the proposal, the backend moves to **FastAPI
  (Python)**.

---

## Phase 0 — Foundation (Aug – Sep 2026)

- [x] Proposal finalization & defense (Aug)
- [ ] Literature review: code-switched NLU, WhatsApp Business API (Sep)
- [ ] **Start Meta Business verification and the WhatsApp Business Cloud API setup
      now.** Approval and message-template review take weeks and block Phase 1.
- [ ] Write the **WhatsApp agent + NLU** sections of the SRS/SDS
- [ ] Define the `Intent` schema with Faizan (see *Interfaces*)
- [ ] *Suggested owner (unassigned in the proposal, confirm as a team):* **FastAPI
      project skeleton.** Includes app layout, config, Postgres connection, and a
      port of the webhook handshake, signature checks and inbound-payload
      normalization from `routes/webhook.js`. You're the first consumer of it.

**Done when:** a FastAPI service receives and replies to a WhatsApp message, and
the `Intent` schema is agreed.

## Phase 1 — WhatsApp Business API integration (Oct – Nov 2026)

- [ ] Send and receive on the Meta Cloud API with the approved business number
- [ ] Webhook security: verify `X-Hub-Signature-256` on every POST
- [ ] **Message templates.** Get templates approved for reorder reminders and offers.
      WhatsApp only allows free-form messages within 24 hours of the retailer's last
      message, so Faizan's proactive reminders *need* templates.
- [ ] Move session state from memory to **Redis**
- [ ] Respond fast, process async: acknowledge the webhook immediately and handle
      the message on **Celery** (NFR: webhook bursts)
- [ ] Handle status callbacks (delivered/read) and ignore echoes of your own messages
- [ ] Port the existing numbered-menu flow to Python as the **fallback path**
- [ ] Port the existing tests to pytest

## Phase 2 — Code-switched intent extraction + FYP-I (Dec 2026)

- [ ] Claude with structured JSON output: message → `Intent`
      (`order | reorder | price_query | negotiate | khata_query | greeting | other`,
      plus line items and the detected language/script)
- [ ] **Product resolution with pgvector.** Embed product names and aliases
      (Roman Urdu spellings, brand shorthand) and resolve free text to SKUs.
- [ ] Units and shorthand: "2 dozen", "1 peti", "carton", "adha", Urdu numerals
- [ ] Build a **labelled test set** of realistic messages (Urdu script, Roman Urdu,
      English, mixed) and track intent and item accuracy
- [ ] Groq fallback when the Claude budget or availability is a problem
- [ ] Integrate with Faizan's engine: intent in, then render the engine's decision
      and explanation as the reply
- [ ] FYP-I demo: a retailer places an order over WhatsApp in code-switched language

**FYP-I deliverable:** a working WhatsApp agent that turns code-switched messages
into structured orders through the WhatsApp Business API.

## Phase 3 — Multi-turn negotiation dialogue (Jan – Feb 2027)

- [ ] Negotiation dialogue state: track the offer, counter-offer and round across turns
- [ ] Recognize haggling phrases ("thora kam karo", "last price?", "itna nahi") and
      accept/reject
- [ ] Hand every price decision to Faizan's engine. **The dialogue never invents a
      price.**
- [ ] Render counter-offers and explanations in the language the retailer used

## Phase 4 — Code-switch robustness (Mar – Apr 2027)

- [ ] Grow the test set: spelling variation, typos, mixed scripts, multi-item messages
- [ ] Graceful degradation: when the LLM is down, fall back to the numbered menu
- [ ] Latency: replies within a few seconds under normal load (NFR)
- [ ] Refine the dialogue based on traces from Phase 2–3 testing

## Phase 5 — Final testing & docs (Apr – May 2027)

- [ ] End-to-end tests of the WhatsApp flows, and bug fixes
- [ ] Your module's parts of the Testing Manual, User Manual and final report
- [ ] Final defense demo

---

## Interfaces

**You provide:**
- `Intent` — `{ type, items: [{ product_id | query, qty, unit }], language, raw_text }`
- `send_message(phone, text | template)`, used by Faizan's reminder jobs
- Conversation/session state in Redis

**You depend on:**
- **Faizan:** `decide(intent, retailer_context) -> Decision`, with its explanation text
- **Sameer:** retailer identity and auth (phone → retailer), and khata data for
  khata queries

*Suggested owner (unassigned in the proposal):* **deployment of the public webhook
endpoint** (AWS ECS/EC2 + Docker). You need a stable public URL for Meta first.
