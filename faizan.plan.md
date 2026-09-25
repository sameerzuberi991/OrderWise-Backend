# Faizan — backend plan

**Role:** Core Engine Lead (proposal §9, Table 2)
**You own:** the proactive sales & engagement engine (discounts, reorder reminders,
pricing, negotiation), its explanations, trace logging, and the LLM-as-judge
evaluation. This is the project's core academic contribution.
**Frontend counterpart:** [`faizan.plan.md`](https://github.com/sameerzuberi991/OrderWise-Frontend/blob/main/faizan.plan.md) in `OrderWise-Frontend`.

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

- `services/reorder.js` has a **history-based reorder suggestion**: the retailer's
  most-ordered products at their usual quantity. It uses no prediction and gives no
  explanation. This is the seed of your reorder engine.
- There are **no** tables for offers, discount rules, price floors or decision traces.
  `products.unit_price` is the only price.
- Pricing is fixed list price. There is no discount or negotiation logic.
- The stack is Node + Express on Supabase. Per the proposal, the backend moves to
  **FastAPI (Python)**. Build the engine in Python from day one; don't extend the JS.

---

## Phase 0 — Foundation (Aug – Sep 2026)

- [x] Proposal finalization & defense (Aug)
- [ ] Literature review: reorder prediction, discount-rule systems (Sep)
- [ ] Write the **core engine** sections of the SRS/SDS: engine inputs, decision
      types, explanation generation, trace schema
- [ ] Design the engine's schema (Postgres, keep it in `schema.sql` / migrations):
  - `offers` / `discount_rules` — product or category, min qty, retailer segment,
    validity window, stackable or not
  - `price_floor` per product (distributor-defined, never crossed)
  - `decision_traces` (JSONB): inputs, rules fired, chosen action, price, generated
    explanation, model + prompt version, latency
- [ ] Agree the **engine interface** with Unaiza and Sameer, and write it down
      (see *Interfaces* below)

**Done when:** schema and interface are written up and agreed. The engine can be
built without waiting on NLU.

## Phase 1 — Engine v1 (Oct – Nov 2026)

Build in a Python package inside the FastAPI app (e.g. `app/engine/`).

- [ ] **Reorder prediction.** Go beyond "most ordered": per retailer × product,
      estimate consumption from the gaps between past orders. Predict days of stock
      left and the stock-out date. Schedule a reminder N days before.
- [ ] **Discount matching.** Pick the offers that apply to a retailer and basket,
      and resolve conflicts deterministically (e.g. best single offer, or stack if
      allowed).
- [ ] **Rule-based pricing.** List price, then offer, then result. **Enforce the
      price floor in code**, not in a prompt.
- [ ] **Explanation generation.** The LLM (Claude) receives *only* the decision trace
      and phrases it in the retailer's language. Add a template fallback for when
      the LLM is unavailable (NFR: graceful degradation).
- [ ] Keep **decisions deterministic and separate from wording**, so correctness can
      be tested without the LLM.
- [ ] Pytest unit tests for every rule path.

**Done when:** given a retailer + basket, the engine returns a decision, a price and
an explanation, and the tests pass without network access.

## Phase 2 — Integration + trace logging (Dec 2026)

- [ ] Integrate engine v1 with Unaiza's WhatsApp agent (intent in, decision out)
- [ ] **Trace logging live from day one.** Every decision writes a `decision_traces`
      row. This seeds the FYP-II evaluation, so don't skip it.
- [ ] Celery scheduled job: daily reminder run → reminders sent through Unaiza's
      WhatsApp send function
- [ ] Expose read APIs Sameer's dashboard needs: applicable offers for a retailer,
      reorder suggestions with explanations
- [ ] Prepare FYP-I demo scenarios: a retailer receives a reminder and a discount,
      each with an explanation

**FYP-I deliverable:** core engine v1 working end-to-end (discounts + reminders +
rule-based pricing + explanations). Price negotiation is deferred to FYP-II.

## Phase 3 — Engine v2: price negotiation (Jan – Feb 2027)

- [ ] Negotiation policy: counter-offer ladder between list price and floor, max
      rounds, concessions tied to order size and khata standing
- [ ] **Hard invariant: never settle below the floor.** Prove it with property-based
      tests (e.g. Hypothesis) across random offer sequences.
- [ ] Every negotiation turn is a logged decision with its own explanation
- [ ] Unaiza owns the dialogue layer. You own what price to offer and why.

## Phase 4 — LLM-as-judge evaluation (Mar – Apr 2027)

- [ ] Trace → eval-dataset conversion scripts
- [ ] **Decision correctness:** compare the engine's action and price against the
      outcome expected from the distributor's rules for that situation
- [ ] **Explanation faithfulness:** does the explanation reflect the logged trace,
      or is it a plausible but ungrounded rationale?
- [ ] Judge prompts, scoring rubric and versioning
- [ ] Calibrate the judge against a small human-labelled sample and report the
      agreement

## Phase 5 — Results & report (Apr – May 2027)

- [ ] Run the full evaluation over sampled traces, then analyze and visualize the results
- [ ] Write the evaluation chapter and your module's parts of the final report
- [ ] Final defense demo

---

## Interfaces

**You provide:**
- `decide(intent, retailer_context) -> Decision`, where `Decision` is
  `{ action, items, price, applied_offers, explanation, trace_id }`
  - `action` is one of `assist_order | suggest_discount | send_reminder | negotiate`
- The reminder schedule (Celery), which calls Unaiza's `send_message`
- Read APIs for offers and suggestions (used by Sameer's dashboards)
- The `decision_traces` schema. Sameer's reconciliation explanations should log in
  the same format.

**You depend on:**
- **Unaiza:** the structured `Intent` object from the NLU layer, and `send_message`
- **Sameer:** khata balances (for negotiation and credit context), and the distributor
  UI for configuring offers and price floors

## Notes

- Keep the LLM out of the decision path. It only phrases the explanation. This keeps
  "decision correctness" measurable and the floor guarantee enforceable.
- Record model and prompt versions in every trace, so FYP-II results are reproducible.
