# FP-11.10 — Store-Wide Use-Case & Error Matrix

> 11 required scenarios. Each row: trigger, preconditions, backend response (evidenced), frontend
> behavior, refetch, retry safety, could-it-have-executed, evidence, gap. Specification-only.

| # | Scenario | Preconditions | Backend response | Frontend behavior | Refetch | Retry safe? | Executed? | Evidence | Gap |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Stock out after PDP open | Sellable variant viewed; stock drops to 0 | Inventory `out_of_stock`; cart add still draft-accepted; checkout 409 short | Row `غير متوفر` + disabled add; cart preserves line; checkout maps 409 → reduce/remove/retry | Inventory + cart re-read | Yes (reads/mutations per contract) | No (rejected, nothing committed) | inventory serialize + orders 409 | None |
| 2 | Price change display→submit | Snapshot older than live variant price | Reprice `{repriced}`; estimate new nets; creation 409 `drifted[]`, cart ACTIVE | Old→new disclosure + explicit re-confirm (D30-A); never submit stale as final | Reprice + estimate | New key after review only | No (409 rejects pre-commit) | cart writes/reprice + orders drift | None |
| 3 | Offer expires with cart lines | Promo/autos evaluated earlier; window ends or usage exhausts | Estimate drops discount / coupon `applicable:false+reason`; creation recomputes live | Benefit omitted silently (no phantom badge); totals from fresh responses only | Re-estimate | Yes (dry-run) | No | promotions engine + estimate | G-P1: no promo-change event stream (learn via reprice/estimate/creation) |
| 4 | Customer session expiry | 30d TTL lapses / revoked / password-change-nuke | 401 generic on next call | Login prompt; input preserved; post-login reselect + NEW key; never reuse stale auth | Session + cart re-read | New attempt | No | customers/session + FP-11.5 §11 | None |
| 5 | Guest cart/order credentials | Guest cart bearer vs per-order credential vs session (three distinct secrets) | 400 both-sides / 404 gone-cart / 401-410-404 order reads | Exact-secret routing (never interchanged); mint/re-paste/recover paths per FP-11.5 §§6/11/13 | Per-flow re-read | Same-key resolve (ambiguity); fresh mint (gone) | Ambiguous possible | cart owner + guest-access + BGGO-D014 | D39 BLOCKED (lost-credential unrecoverable) |
| 6 | Invalid/incomplete address | Missing city/phone or overlong/foreign id | 400 shape / 404 address-gone / 422 ladder | Field errors (saved) or complete-both-objects (guest); re-list + reselect on 404 | Addresses re-list | After fix only | No | validation + E11–E13 (FP-11.5) | None |
| 7 | Image load failure | Null/404/transport on gallery | `{primary:null, gallery:[]}` or fetch throw | Neutral placeholder; layout-stable slots; per-row retry; grid intact | Per-row retry | Yes | No | catalog media + FP-11.1 E6 | None |
| 8 | Network request failure | Any call; transport/timeout/500 | None / 500 envelope | Offline/unknown-state badges; state preserved; no destructive action; reads retried, mutations re-read-first | Mandatory re-read | Reads yes; mutations re-read-first (deltas never blind) | **Must assume possible** | FP-11.8.7 §2 | None |
| 9 | Repeated add/submit taps | Rapid taps on add-to-cart / `تأكيد الطلب` | Add aggregates (UPSERT sum); creation keyed (same-key replay) | Single-flight + coalesce; stepper latest-wins; submit locked till response | Newest confirmed echo | Same-key only (submit); re-read first (add) | Possible (add sums — intended) | cart writes + orders idempotency | None |
| 10 | Unauthorized screen/action | Missing permission / foreign resource / expired session | 401 / 403 / 404-masked | Login / forbidden / not-found states; protected info never shown from prior access | Session (+record on 403-stale) | No (403 never re-fired to "test") | No | rbac + D45 | None |
| 11 | Dead product/order link | Unknown/inactive id; consumed cart; deleted address | 404 (unknown≡foreign) / 410 (expired credential) | Not-found + supported path back (listing/mint/re-list); gone-cart → fresh mint | Fresh read | N/A ( navigation, not mutation) | No |routes + FP-11.4 S-GUEST-GONE | None |

Guidance rules honored: stale price never final; expired offers never shown; expired sessions never
reused; image fallback never breaks layout; conflicts re-read (never stale-as-latest); timeout never
assumed unexecuted; permission denial never leaks protected data. No invented API responses or rules.

---

*End of FP-11.10 — specification-only.*
