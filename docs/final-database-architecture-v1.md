# FINAL DATABASE ARCHITECTURE v1 — Hyper Al-Moatasem / هايبر المعتصم (PRODUCTION GATE)

> Status: PRODUCTION ARCHITECTURE GATE (no SQL, no code, no migrations, no implementation).
> Phase 1 + Phase 2 + Phase 4 + Phase 5 FROZEN and untouched — verified by content scans
> (retired tokens `is_available`/`payment_status` appear only in removal comments; zero
> FLOAT/REAL/DOUBLE column types; all timestamps TIMESTAMPTZ; anchors `gen_random_uuid`,
> GENERATED `available_quantity`, `sale_step_grams`, `NUMERIC(12,3)` present).
> This revision ADDS three production domains (Catalog media, Payments, Delivery) and closes
> Prisma readiness. Conventions: UUID PKs (app v7, `gen_random_uuid()` backstop for PG 15+),
> `NUMERIC(10,2)` money, `NUMERIC(12,3)` quantities, soft-delete pattern, append-only
> histories, RESTRICT-by-default FKs, lowercase spaceless identifiers, READ COMMITTED + row locks.

## 1. Architecture overview

Single-branch hypermarket (Matai Center + nearby delivery, Arabic/EGP, 20k+ products, piece +
weighted goods, guest checkout via phone identity, promos/coupons, online/cash payments, local
delivery) run through one RBAC plane. All business truth lives in frozen domains; new domains
attach without duplicating entities (§31: no `admin_product_price`, no `admin_inventory`,
no `admin_order`, no provider-specific payment tables, no vehicle/route tracking tables).

## 2. Domain boundaries

| Domain | Tables | Status |
|---|---|---|
| Catalog | categories, brands, products, product_variants, product_codes, **product_images** | P1 frozen + 1 additive gallery |
| Inventory | inventory, inventory_movements, product_price_history (+ VIEW, not a table) | P1 frozen |
| Customer | customers, customer_addresses | P2 frozen |
| Cart | carts, cart_items | P2 frozen |
| Orders | orders, order_items, order_status_history, order_item_replacements (+ SEQUENCE, not a table) | P2 frozen |
| Promotions | promotions, promotion_targets, promotion_rules, promotion_buy_get_rules, coupons, coupon_usages, order_discounts | P4 frozen |
| Payments | **payments, payment_transactions** | NEW v1 (provider-agnostic) |
| Delivery | **delivery_zones, delivery_drivers, deliveries** | NEW v1 (minimal: no vehicles/routes/tracking) |
| Administration | users, roles, user_roles, permissions, role_permissions, audit_logs, store_settings, notifications | P5 frozen |
| Operations | (notifications, store_settings live here; no report/stat tables — reports are future queries/views) | frozen |

**37 tables** = 8 + 8 + 7 + 8 + 6 new. + 1 VIEW + 1 SEQUENCE (not tables).

## 3. Complete table inventory

Frozen 31 tables: full columns in `docs/phase{1,2,4}-erd.mmd` + §4 of prior docs (recapped in the ERD file).

### NEW — `product_images` (catalog gallery; frozen `products.image` stays as cover fallback)

id UUID PK; product_id NOT NULL FK→products **CASCADE** (images have no independent history —
codes precedent); url VARCHAR(500) NOT NULL; alt_text VARCHAR(200) NULL; sort_order INT ≥0;
is_primary BOOL default FALSE + partial UQ(product_id) WHERE is_primary (one primary —
codes precedent); created_at. No updated_at (replace, don't edit), no deleted_at (hard-deletable
by admin). Justification: 20k-product storefront needs galleries; explicitly NOT image_variants/
processing/CDN tables (rejected scope).

### NEW — `payments` (provider-agnostic attempts; order state NEVER stored here or on orders)

id UUID PK; order_id NOT NULL FK→orders RESTRICT (no UQ — retries/partials allowed, history
preserved); method VARCHAR(20) CHECK(CASH_ON_DELIVERY, CARD_ONLINE, WALLET) NOT NULL
(generic rails, never provider names); amount NUMERIC(10,2) ≥0 NOT NULL (agreed collectible,
snapshot of order total at creation); currency VARCHAR(3) NOT NULL DEFAULT 'EGP' (frozen
single-currency, future-proof tag); status VARCHAR(20) CHECK(PENDING, AUTHORIZED,
PARTIALLY_PAID, PAID, OVERPAID, REFUNDED, VOIDED, FAILED) default PENDING;
provider_ref VARCHAR(128) NULL + partial UQ WHERE NOT NULL (provider-callback idempotency);
created_at/updated_at. Never deleted. `orders.payment_status` stays RETIRED — payment state
derives from here + transactions (no duplicate source of truth).

### NEW — `payment_transactions` (immutable money ledger; mirrors `inventory_movements` shape)

id UUID PK (append-only); payment_id NOT NULL FK→payments RESTRICT; type CHECK(PAYMENT,
AUTHORIZATION, CAPTURE, REFUND, VOID, ADJUSTMENT) NOT NULL (no more types — rejected scope);
amount NUMERIC(10,2) NOT NULL CHECK(<>0, signed: charges +, refunds −);
previous_paid NUMERIC(10,2) ≥0; new_paid NUMERIC(10,2) ≥0 + CHECK(new = prev + amount);
reason NULL; created_by NULL; created_at (no updated_at/deleted_at — immutable).
Under/over-payment rule (§payment business rule): net_paid (SUM signed amounts per payment)
vs `orders.total_final` ⇒ shortfall = additional-due (collect before delivery, recorded as
further PAYMENT rows), excess = refund (REFUND rows; history never rewritten). No new tables.

### NEW — `delivery_zones` / `delivery_drivers` / `deliveries` (minimal V1)

zones: id PK; name VARCHAR(80) UQ NOT NULL; delivery_fee NUMERIC(10,2) ≥0 NOT NULL;
is_active BOOL default TRUE; created/updated. (No geometry — Matai + nearby; deferred.)
drivers: id PK; name VARCHAR(120) NOT NULL; phone VARCHAR(20) NOT NULL UQ (digits 8–15 —
frozen pattern; doubles as roster identity); vehicle VARCHAR(30) NULL free text (fleet detail
deferred); is_active BOOL default TRUE; created/updated; deleted_at NULL + CHECK(deleted ⇒
!active). NOT linked to users (drivers may hold no dashboard account — deliberate unlink).
deliveries: id PK; order_id NOT NULL UQ FK→orders RESTRICT (one delivery per order V1);
zone_id NULL FK→zones RESTRICT; driver_id NULL FK→drivers RESTRICT (offboard via is_active;
history pins the row); status CHECK(PENDING,ASSIGNED,OUT_FOR_DELIVERY,DELIVERED,FAILED,
CANCELLED) default PENDING (transitions app-enforced + `audit_logs` rows with
entity_type='deliveries' — no history table in V1 scope); scheduled_at NULL; delivered_at NULL;
failure_reason NULL; created/updated. Never deleted.

## 4. Relationships (45 FK — 39 frozen + 6 new, all RESTRICT except 4 documented)

New: product_images→products CASCADE · payments→orders RESTRICT · payment_transactions→payments
RESTRICT · deliveries→orders RESTRICT (+UQ) · deliveries→zones RESTRICT · deliveries→drivers
RESTRICT. Frozen 39 unchanged (incl. carts→orders SET NULL, codes CASCADE, notifications CASCADE).

## 5. Promotion types / 6. Targeting / 7. Rule engine / 8. Priority+stacking

Frozen verbatim: PERCENTAGE, FIXED_AMOUNT, BUY_X_GET_Y, FIXED_PRICE (incl. buy/get params,
same/cross-variant, weighted sets, inventory-consumption boundary); targets VARIANT, PRODUCT,
BRAND, CATEGORY (OR-match, subtree-inclusive, no FK — documented trade-off); one conjunctive
rule row; evaluation priority DESC → specificity → age; sequential compounding; layers
line-autos → order-autos → one coupon; deterministic specificity resolution (never UI best-price).

## 9. Coupon engine

Frozen: normalized UQ codes, own window + parent-effective, minimums on gross, global +
per-customer limits via row-lock + conditional bump, immutable usages (est+final), no new types.

## 10. Weighted products

Frozen: `NUMERIC(12,3)` (0.125/0.250/0.500/0.475/1.250 exact); one loose KG variant +
`sale_step_grams` (125/250/500/1000 offered); requested vs actual; R7 commit predicate;
no per-weight variants. Admin/delivery/promo paths reuse counting units — no conversions invented.

## 11. Cart integration

Frozen: cart holds draft state only (no final promo/discount/price truth); checkout recomputes
from live price + promos + stock + coupon; `price_checked_at` stays base-price signal.

## 12. Checkout integration

Frozen boundaries + additive promo steps, then payments attach post-commit: order → payment
attempt(s) → transactions; coupon/counter bumps stay in-checkout-tx; no boundary moved.

## 13. Order snapshots

Frozen: item snapshots (names/brand/code/unit/type/step/frozen price) + promo snapshots
(`order_discounts` rows) + `discount_total` = checkout-estimate meaning (amended R19 — admin
reporting MUST NOT reinterpret it). Catalog edits never rewrite order history.

## 14. Discount allocation

Frozen: deterministic pro-rata + largest-remainder into ALLOCATION rows; mirrors feed
`order_items.discount_amount`; sums reconcile exactly (50.00, never 49.99/50.01).

## 15. Inventory boundary

Frozen: promo outputs discounts; inventory consumes TAKEN qty only (BXGY free units fully
reserved); admin adjustments run the frozen tx (conditional UPDATE + `FOR UPDATE` +
`ADJUSTMENT` movement + audit row, one tx); invariant `quantity = available + reserved`
via GENERATED column + CHECKs; movement types unchanged (7).

## 16. Concurrency

Frozen proofs stand: inventory oversell (240-gate), checkout idempotency, coupon/promo limits
(120-gate). Added surfaces use identical primitives: `provider_ref` partial UQ (callback
idempotency), payment-row locks for capture/refund sequencing, zone/driver rows never contended
(reference data). No isolation change (READ COMMITTED).

## 17. Money + rounding

EGP only; all money `NUMERIC(10,2)` (payments/fee/tx amounts); percent (5,2); qty (12,3);
per-line `ROUND(x,2)` half-away (PG `round`); signed tx amounts ≠ 0 with ledger math CHECK;
zero FLOAT/REAL/DOUBLE (verified by scan); precision/scale explicit per column above.

## 18. Performance (20k+ products; fast growers: orders/items/movements/audit/payment_tx)

No scan-everything evaluation (cart-scoped promos); no per-column indexes. New indexes, each
justified: product_images(product_id, sort_order) + primary partial (gallery fetch);
payments(order_id, created_at) (order payment trail) + provider_ref partial UQ (callback
idempotency) + (status, created_at) (settlement sweeps); payment_transactions(payment_id,
created_at) (ledger read) + (type) (refund/recon reports); zones (active); drivers (active);
deliveries(order UQ, status, driver, zone) (assignment + driver queue + zone reporting).
Frozen indexes unchanged. No premature partitioning (documented gate: revisit on measured growth).

## 19. Security

Backend-only pricing (frontend sends no amounts; checkout recomputes; DB CHECKs); coupon
normalization server-side + race-safe bumps; payment amounts server-derived from order totals
(never client-submitted); no secrets in DB (passwords/hashes/tokens/provider secrets banned
from audit payloads, settings, notifications); no password system invented; disabled users
authorize nothing; privilege changes audited; UI restriction ≠ backend authorization ≠ DB
integrity — separate layers.

## 20. Audit boundary

Deferred nothing new: delivery transitions + payment captures/refunds + grant changes join the
frozen audit matrix as `audit_logs` rows (entity_types `deliveries`, `payments`, existing
sets). Still never audited: SELECTs, cart reads, derived reads, immutable rows.

## 21. Future payment/refund compatibility (built-in, not implemented)

Net-paid vs `total_final` reconciliation, ADJUSTMENT/REFUND rows preserving history, allocation
rows attributing every piastre on item cancel, usages finals — all present; payment methods stay
generic rails; provider specifics remain opaque strings.

## 22. ERD

`docs/final-erd-v1.mmd` — all 37 tables, PKs, FKs with cardinalities + delete behavior, key
uniques/indexes annotated, domain-grouped.

## 23. Architecture document

This file (`docs/final-database-architecture-v1.md`).

## 24. Final conflict check (reconciliation report)

Checked against shipped files (not memory): retired `is_available`/`payment_status` appear
ONLY in removal comments — NOT reintroduced · inventory invariant GENERATED, never stored ·
weight NUMERIC + single-variant + sale_step intact · codes VARCHAR + global UQ intact ·
money NUMERIC-only (comment-word false positives excluded) · UUIDv7 app-side + backstop intact ·
all-TZ timestamps intact · guest model unified, no admin↔customer link · cart draft-only ·
snapshot chains intact · estimate/final duality + `discount_total`-as-estimate intact ·
promo 4-types/4-targets/priority/stackability/rules/coupon-races intact · BXGY table + semantics
intact · `password_hash`/sessions NOT added (frozen omission respected) · no `admin_*`
duplicates · no provider/vehicle/route/report/branch tables added.

```text
NO CONFLICTS
```

## 25. Final gate + Prisma readiness

```text
FINAL ERD v1 — READY FOR REVIEW
```
(NOT "production ready" — that claim comes after implementation + verification.)

**Prisma mapping (no schema written; per-table pattern):** model names PascalCase
(`ProductVariant`, `OrderItem`, `PaymentTransaction`…), fields camelCase;
UUID→`String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid` (app sends v7;
backstop only); `NUMERIC(10,2)`/`(12,3)`→`Decimal @db.Decimal(10,2)`; VARCHAR→`String`
(+`@db.VarChar(n)`); TEXT→`String`; BOOLEAN→`Boolean`; INT→`Int`; TIMESTAMPTZ→`DateTime
@db.Timestamptz`; JSONB→`Json`; relations via FKs (self-FKs + polymorphic `target_id`/
`entity_id` stay relation-less UUIDs — documented, mirrors frozen trade-off).
**Enum candidates (app-layer only — DB keeps VARCHAR+CHECK, frozen):**
`ProductType, Unit, MovementType, CartStatus, OrderStatus, ItemStatus, ReplacementStatus,
PromoType, PromoScope, PromoStatus, TargetType, DiscountKind, PaymentMethod, PaymentStatus,
TxType, DeliveryStatus, ActorType, SettingType` — implement as Prisma enums over String
columns WITHOUT migrating to native PG enums.
**Database-level migration / SQL requirements (Prisma cannot express — must ship as SQL):**
all CHECK constraints; partial unique indexes (6); `GENERATED` column; triggers
(`set_updated_at`, transition guards, anti-cycle); `product_stock_status` VIEW;
`order_number_seq` + formatted numbers; `INET` column (`Unsupported("inet")` or raw SQL —
options documented, no silent choice); money ROUND math + ledger self-checks (service +
CHECKs); row-locking transactions (client `$transaction` + raw SQL for conditional bumps).

**Deferred decisions (explicit):** auth mechanism/sessions/password policy; audit +
notification retention; delivery assignment detail + geometry; JSONB GIN indexes;
multi-branch (`branch_id` absent by design); partitioning (on measured growth);
full-text search; report views.
