# ADMIN PREVIEW — HANDOFF FOR THE OWNER

This is the real application, running locally, on an isolated scratch
database. Nothing here is a prototype and nothing here is a mock-up: the
screenshots in this folder were taken by driving the running app in a real
browser.

---

## 1. The preview URL

```
http://localhost:3132/admin
```

The server is already running. If it is not, the "How to run it again"
section below restarts it.

* It runs on **port 3132**, not 3131 — so it never touches the dev server or
  the test database on 3131.
* It points at the **scratch** database `hyper_almoatasem_scratch`. The
  production-named database and the preview database are **not** connected,
  and the launcher refuses to start against any database that is not on the
  scratch allowlist.

## 2. The home URL

```
http://localhost:3132/admin
```

The same URL. The home page is the operations centre: the attention board
(what needs you now), the real counters, the order-state board, the last
orders, the stock watch, and the work lanes.

## 3. The products URL

```
http://localhost:3132/admin/products
```

Product list, with search, sale-method filter, unit filter, category filter,
brand filter and server-side pagination. Add a product at
`/admin/products/new`; a product's own page at `/admin/products/{id}`.

## 4. The orders URL

```
http://localhost:3132/admin/orders
```

Order list with filters for state, number, customer name and customer phone.
An order's own page is at `/admin/orders/{id}` — that is where the next
allowed step (start preparing, cancel, propose a replacement) lives.

## 5. The inventory URL

```
http://localhost:3132/admin/inventory
```

Balance review, add quantity, adjust quantity, and the warning threshold —
four separate operations, each in its own panel, plus the movement ledger.

## 6. The remaining section URLs

| Section | URL |
|---|---|
| Categories and brands | `http://localhost:3132/admin/taxonomy` |
| Promotions | `http://localhost:3132/admin/promotions` |
| Coupons | `http://localhost:3132/admin/coupons` |
| Customers | `http://localhost:3132/admin/customers` |
| Store staff accounts | `http://localhost:3132/admin/users` |
| Roles | `http://localhost:3132/admin/roles` |
| Permissions catalogue | `http://localhost:3132/admin/permissions` |
| Store settings | `http://localhost:3132/admin/settings` |
| Delivery zones | `http://localhost:3132/admin/delivery-zones` |
| Change log | `http://localhost:3132/admin/audit-logs` |
| Sign in | `http://localhost:3132/admin/login` |

The same list is also the rail on the left of every page (the top bar's
«الأقسام» button on a phone).

## 7. The actual screen images

All in `docs/data-sources/perf/admin-preview/`:

| Image | What it shows |
|---|---|
| `01-home.png` | the operations centre |
| `02-orders.png` | the order list with its filters |
| `03-products.png` | the product list |
| `04-product-new.png` | the add-product form |
| `05-taxonomy.png` | categories and brands, both lists and both forms |
| `06-inventory.png` | the four inventory operations and the movement ledger |
| `07-promotions.png` | the offer list and the offer form |
| `08-coupons.png` | the code list and the code form |
| `09-customers.png` | the customer list |
| `10-users.png` | the staff accounts |
| `11-roles.png` | the roles |
| `12-permissions.png` | the permission catalogue, grouped by section |
| `13-settings.png` | the store settings |
| `14-delivery-zones.png` | the delivery zones |
| `15-audit-logs.png` | the change log |
| `16-product-detail.png` | a product's own page |
| `17-order-detail.png` | an order's own page |
| `18-customer-detail.png` | a customer's own page |
| `19-mobile-*.png` | home, products, orders, inventory, customers at 390 px |
| `19-tablet-*.png` | the same five at 834 px |
| `20-reduced-motion-home.png` | the home page with reduced motion on |

The capture run that produced them also recorded, per page: the HTTP status,
the console errors, the failed requests, the number of resources requested
and the bytes transferred — all in `capture-report.json`.

**The result of the capture run: 28 page loads, every one HTTP 200, 0 console
errors, 0 failed requests.**

## 8. How to try the interface

1. Open **http://localhost:3132/admin**.
2. It asks you to sign in. The account is:
   * **email:** `owner@hyper-al-moatasem.local`
   * **password:** it is in the file
     `C:/Users/MEGA/.qoder/preview-admin-credentials.txt` (one line
     `email: …`, one line `password: …`). It was generated fresh for this
     preview and is **not** written anywhere in the repository. If it was
     shown before and should not be reused, run step 3 below to generate a
     new one.
3. To make a new password:
   ```bash
   node scripts/preview-set-admin-password.mjs --db hyper_almoatasem_scratch
   ```
   It generates a random password, refuses any database that is not on the
   scratch allowlist, and writes the credential to the same file outside the
   repository. The password is never printed to the terminal and never typed
   on a command line.
4. Once you are in, the rail on the left carries every section. The home page
   is the fastest way to see the whole thing: every number on it is counted
   live from the database when the page opens.
5. The home page greets you with **«أهلًا بيك يا مالك المتجر»**. The account in
   this scratch database is still carrying the English placeholder name it was
   seeded with (`System Owner`), and the panel deliberately does not print an
   English name where it is speaking to you — it uses the Arabic name of your
   role instead. Your own account page (`/admin/users/{id}`) shows the stored
   name exactly as it is and lets you change it; the moment you give the
   account an Arabic name, the greeting uses it. **Changing that name is a
   write, so it was not done for you here.**

To regenerate the screenshots yourself:

```bash
node scripts/preview-shots.mjs
```

## 9. How to run the preview again

```bash
cd /d/Hyper_el-moatasem
node scripts/preview-admin.mjs --db hyper_almoatasem_scratch --port 3132
```

That is all. The launcher:

* refuses to start if the database is not on the scratch allowlist;
* uses its own build directory (`.next-preview-3132`), so it never collides
  with the dev server on 3131 and never writes to the shared `.next`;
* never prints the connection string, the user, the password or a token.

Stop it with `Ctrl+C` in the terminal that started it.

The first start compiles, so give it a moment before opening the browser.

## 10. What could not be tested

Stated plainly, because it matters:

* **Nothing was written to the database.** The preview points at a scratch
  database, and every operation run against it was a `SELECT`. Creating an
  offer, a coupon, a delivery zone, a role, a staff account or a product was
  **not** performed against it — that is a write, and writing was not
  authorised. The write paths are covered by the unit suite (549 tests), not
  by the live preview. **So: the forms and their buttons are proven by the
  tests, not by clicking "save" in the preview.**
* **A signed-in account with fewer permissions** was not exercised in the live
  app — creating one is a write. The forbidden state was proven for an
  anonymous visitor (every admin route redirects to the sign-in page), and
  the permission gate is covered by the unit suite.
* **Safari and Firefox** were not used. The visual and performance passes ran
  on the system Chrome.
* **The production and the preview databases were never connected to**, and no
  migration was run against any database.
* **The 3D viewport on a real phone** was measured at 390 px in the browser
  (it falls back to the static frame, and no 3D chunk is requested), but it
  was not run on physical hardware.
* **Payment and delivery integrations** are outside the admin panel and were
  not touched.

---

## Safety summary

| Constraint | How it was honoured |
|---|---|
| The preview must not connect to the production or preview database | the launcher allows only allowlisted scratch databases and refuses anything else |
| The test database on 3131 must not be written | the preview uses port 3132 and a separate build directory; 3131 was never touched |
| No commit, push, deploy or go-live | none were performed |
| No production or preview migration | none were run |
| No deletion or merge of customers, products, categories or brands | no data was deleted or merged; the customer list was checked, not pruned |
| Passwords must not be exposed | the password lives in a file outside the repository and is never printed |
| `scripts/set-super-admin-password-local.ps1` must not be touched | it was not touched |
| The store's own design must not change | the admin has its own tokens and its own CSS file (`src/app/admin/admin.css`); the storefront's styles were not modified |
