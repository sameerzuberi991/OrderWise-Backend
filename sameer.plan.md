# Sameer — backend plan

**Role:** Apps & Reconciliation Lead (proposal §9, Table 2)
**You own (backend side):** the APIs behind the retailer and distributor dashboards,
khata (credit ledger), invoice reconciliation (OCR and manual entry), and the
offline-sync API for the mobile app.
**Frontend counterpart:** [`sameer.plan.md`](https://github.com/sameerzuberi991/OrderWise-Frontend/blob/main/sameer.plan.md) in `OrderWise-Frontend`.
Most of your work is there.

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

- `routes/orders.js`: order list and "fulfill". Status is only `pending | fulfilled`.
- `routes/inventory.js`: product CRUD, restock, expiry dates, soft-delete.
- `routes/analytics.js`: summary, orders per day, top products, **by-area**. The
  by-area endpoint served the **Brand** persona, which is now **out of scope**.
  Keep orders-per-day and top-products for the distributor's demand overview.
- There is **no** auth or roles, **no** khata/ledger, and **no** invoices or reconciliation.
- The stack is Node + Express on Supabase. Per the proposal, the backend moves to
  **FastAPI (Python)**.

---

## Phase 0 — Foundation (Aug – Sep 2026)

- [x] Proposal finalization & defense (Aug)
- [ ] Literature review: OCR / invoice matching, offline sync & conflict resolution (Sep)
- [ ] Write the **apps, khata and reconciliation** sections of the SRS/SDS
- [ ] Khata schema: a ledger of entries (debit on order delivery, credit on payment,
      adjustments), with the balance derived from entries rather than stored
- [ ] Invoice schema: `invoices`, `invoice_lines`, `reconciliation_results`
- [ ] *Suggested owner (unassigned in the proposal, confirm as a team):* **auth +
      RBAC** at the API gateway, with `retailer` and `distributor` roles. Your apps
      are its first consumer. Decide the login method as a team; phone + OTP over
      WhatsApp fits the users.

## Phase 1 — Retailer APIs (Oct – Nov 2026)

- [ ] Port orders and inventory endpoints from Express to FastAPI
- [ ] Retailer endpoints:
  - order history and live status, plus **one-tap reorder** of a past order
  - khata balance and statement of dues
  - active offers and reorder suggestions, **proxied from Faizan's engine** with
    their explanations
- [ ] RBAC: a retailer only ever sees their own data
- [ ] Pytest integration tests for every endpoint

## Phase 2 — Reconciliation v1, retailer side + FYP-I (Dec 2026)

- [ ] Invoice upload → **Celery OCR job** (Tesseract `eng+urd`, with image cleanup
      first: deskew, threshold)
- [ ] Line-item extraction from the OCR text (LLM structured output, or rules for
      known layouts)
- [ ] Manual-entry path that produces the same line-item structure
- [ ] Matching against the retailer's orders and khata. pgvector handles fuzzy
      product names, then diff quantities, prices and totals.
- [ ] Explanation for every flagged discrepancy, **logged in Faizan's trace format**
- [ ] FYP-I demo: a retailer reconciles an invoice

**FYP-I deliverable:** reconciliation v1, with the OCR → diff → explanation pipeline
working against the retailer's records.

## Phase 3 — Distributor APIs + reconciliation v2 (Jan – Feb 2027)

- [ ] Order intake across all retailers, with a richer status flow
      (e.g. pending → confirmed → dispatched → delivered)
- [ ] Product configuration: prices, **price floors**, offers and discount rules.
      The schema is Faizan's; you expose the CRUD with validation.
- [ ] Receivables: khata per retailer (who owes what)
- [ ] Reconciliation v2: a cross-retailer reconciliation view and status per retailer
- [ ] Demand and order-volume overview, plus top products (reuse the analytics logic)
- [ ] Remove the by-area and Brand-only analytics (out of scope)

## Phase 4 — Offline sync API (Mar – Apr 2027)

- [ ] **Idempotent order submission** with a client-generated UUID, so replays never
      duplicate
- [ ] A sync endpoint that accepts a batch of queued offline actions, replayed via Celery
- [ ] **Deterministic conflict rules** against current server state: stock ran out,
      price changed, or an offer expired. Re-price, flag the conflict and return it
      to the app.
- [ ] Tests for every conflict case (NFR: no data loss)

## Phase 5 — Testing & docs (Apr – May 2027)

- [ ] Your module's API tests, bug fixes and Postman collection
- [ ] Testing Manual and User Manual (retailer + distributor)
- [ ] Your parts of the final report, and the final defense demo

---

## Interfaces

**You provide:**
- Auth + RBAC (if confirmed as yours), khata balance and ledger, orders API
- Reconciliation results with explanations (logged as traces)
- Product, price floor and offer configuration APIs

**You depend on:**
- **Faizan:** offers, reorder suggestions, the trace format, and the offers/floors schema
- **Unaiza:** phone → retailer identity via WhatsApp; orders placed through the agent
