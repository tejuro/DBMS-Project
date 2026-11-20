# Smart Cold-Chain Logistics — Project Guide

A complete guide to what this project does, its roles and features, how it is built, and how to use it.

---

## 1. What this project does

This is a full-stack **cold-chain logistics monitoring and risk-analytics system** for a Karnataka-only distribution network. It tracks temperature-sensitive goods (vaccines, frozen food, fresh produce, pharmaceuticals) from warehouse to delivery, and combines:

- **Business data in MySQL** — users, roles, customers, drivers, vehicles, warehouses, routes, products, shipments and status history.
- **Telemetry data in MongoDB** — sensor readings, alerts, GPS tracks, GPS sessions and monitoring logs.
- **A browser dashboard** for three roles (Administrator, Dispatcher, Customer), with CRUD screens, a sensor simulator, a live GPS map, alert lifecycle management and analytics.

The application runs at `http://localhost:3000`. Any first visit with no valid session is redirected to the **Sign In** page.

---

## 2. Technology stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.4.6 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4, custom Card/Input/Button/ResourceManager components |
| Auth | Custom HMAC-signed `cc_session` cookie (8 h, httpOnly) + bcryptjs password hashes |
| Relational DB | MySQL 8 via `mysql2` raw prepared SQL (`cold_chain`, 11 tables) |
| Document DB | MongoDB via `mongoose` connection + native driver (`cold_chain_monitoring`, 5 collections) |
| Maps / charts | Leaflet + React Leaflet (OpenStreetMap tiles), Recharts |
| Validation | Zod, ESLint 9, TypeScript strict checks |
| Scripts | `ts-node` seed and Karnataka migration scripts |

Detailed SQL and Mongo references live in `guid/MYSQL_COMMANDS.md` and `guid/MONGODB_COMMANDS.md`.

---

## 3. How to run it

### 3.1 Prerequisites

- Node.js 20+, MySQL 8 running on `localhost:3306` (database `cold_chain` with the 11 application tables already created), MongoDB on `localhost:27017`.

> The seed script inserts rows; it does **not** create MySQL tables. `prisma/schema.prisma` is descriptive only — `lib/prisma.ts` is a throwing stub and the runtime never uses Prisma Client.

### 3.2 Configure environment

`.env` (values shown are names/templates, not secrets):

```ini
DATABASE_URL=mysql://root:@localhost:3306/cold_chain?connection_limit=10
MONGODB_URI=mongodb://localhost:27017/cold_chain_monitoring
NEXTAUTH_SECRET=<a strong random secret>
NEXTAUTH_URL=http://localhost:3000
```

Note: app code reads `MONGODB_URI`, `NEXTAUTH_SECRET`, and (with defaults) `DB_*` in `lib/db.ts` and `MYSQL_*` in monitoring routes. `DATABASE_URL` is legacy Prisma config and is not read at runtime.

### 3.3 Install, seed, start

```bash
npm install
npm run seed                              # populates MySQL + MongoDB demo data (idempotent)
npm run dev                               # development server
# or
npm run build && npm run start            # production server
```

Optional data repair: `npx ts-node scripts/migrate-karnataka.ts`.

### 3.4 Sign in

Open `http://localhost:3000` → redirected to `/auth/signin`.

| Username | Password | Role |
|---|---|---|
| `admin` | `123456` | ADMIN |
| `dispatcher` | `123456` | DISPATCHER |
| `customer1` | `123456` | CUSTOMER (FreshFlow Foods) |
| `customer2` | `123456` | CUSTOMER (Arctic Pharma) |

The sign-in page also has one-click demo-account buttons. Drivers are operational profiles, not login accounts.

---

## 4. Roles and permissions

`ADMIN` and `DISPATCHER` are both "operational" roles in code — they currently have the **same** permissions. `CUSTOMER` is a restricted, read-only role.

| Capability | ADMIN | DISPATCHER | CUSTOMER |
|---|---|---|---|
| Dashboard, Shipments | ✅ | ✅ | ✅ (own data only) |
| Customers page | ✅ full CRUD | ✅ full CRUD | ❌ hidden; own row only via API, no controls |
| Products / Drivers / Vehicles / Warehouses / Routes | ✅ full CRUD | ✅ full CRUD | ❌ API returns 403 |
| Add / Edit / Delete shipments | ✅ | ✅ | ❌ controls hidden, API returns 403 |
| Monitoring / GPS / Analytics pages | ✅ | ✅ | ✅ scoped to own shipments |
| Generate simulated readings / GPS actions | ✅ | ✅ | ✅ only for own shipments (ownership checked) |
| Acknowledge / resolve alerts | ✅ | ✅ | ✅ only for own shipments |
| Navigation shown | All sections | All sections | Dashboard, Shipments + Intelligence (Monitoring, GPS Tracking, Analytics) |

Notes:

- UI hides controls that would fail, but **API routes are the authoritative permission boundary** (`getSessionUser()` re-reads the account from MySQL on every request; deactivated accounts stop working immediately).
- CUSTOMER sessions cannot choose an arbitrary `customer_id` — list/create queries force their own customer id.
- Customer creation is transactional across MySQL `USER` + `CUSTOMER` (role id 3, default password `123456`); blank password on edit keeps the existing hash; deletion is refused while shipments/history reference the customer.

---

## 5. Features by page

| Page | What it does |
|---|---|
| `/auth/signin` | Centered sign-in card; form validation, demo-account buttons, bcrypt-backed login, sets `cc_session`. |
| `/` — Dashboard | KPI cards (shipments, active, delivered, delayed, alerts), status breakdown, recent shipments, alert feed, trend sparkline, interactive Karnataka map. |
| `/dashboard` | Alternate dashboard route using the same data source. |
| `/shipments` | Main workspace: filterable shipment list, separate CREATED section, Add/Edit modal (above the Leaflet map), Delete with dependency cleanup, status history, customer/route/vehicle/driver details. |
| `/customers` | Customer profiles with linked logins: Add/Edit/Delete, username/email/password fields; mutation controls hidden for CUSTOMER sessions. |
| `/products` | Product master with temperature/humidity thresholds used by the simulator. |
| `/drivers` | Driver profiles (license, phone, status). No login accounts in the live DB. |
| `/vehicles` | Refrigerated fleet (registration, type, capacity, status). |
| `/warehouses` | Karnataka hubs with coordinates; archive/restore and delete guards. |
| `/routes` | Origin/destination warehouse pairs with distance and estimated duration. |
| `/monitoring` | Sensor simulator (generates readings), threshold checks, violation alerts, Recharts trend charts, alert lifecycle `OPEN → ACKNOWLEDGED → RESOLVED`, risk status recomputation. |
| `/gps-tracking` | Leaflet map with route polyline and vehicle marker, GPS session controls (Start / Pause / Resume / Stop / Manual update), telemetry table. |
| `/analytics` | KPIs, shipments-by-status, route performance (on-time %, average transit minutes), violation reports, customer/route/driver/vehicle overview charts. |

---

## 6. How the pieces fit together

```
Browser
  │  proxy.ts  ── no valid signed cookie ──> /auth/signin
  ▼
App Router pages (app/**/page.tsx) ──> AppShell (sidebar + topbar, except sign-in)
  │
  ├── /api/* fetch calls (rewritten in next.config.ts to module route handlers)
  │      ├── MySQL (mysql2): master data, users, shipments, analytics SQL
  │      └── MongoDB (mongoose connection + native driver): readings, alerts, GPS, logs
  └── getDashboardData() server helper (MySQL KPIs + Mongo telemetry)
```

- Session: `POST /api/login` verifies the bcrypt hash, issues `cc_session` (HMAC-signed, 8 hours). `proxy.ts` verifies the cookie on every page request without a DB lookup; APIs do the authoritative RBAC check.
- Writes: `POST/PUT/DELETE` for most resources go through shared `ResourceManager` UI + per-resource route handlers. Shipment detail operations use the generic `createDetailRoute()` factory with a strict column allowlist.
- Simulation loop: `POST /api/monitoring` inserts a reading → validates against product thresholds → upserts a deduplicated OPEN alert (or refreshes it) → writes a log → recomputes `SHIPMENT.risk_status` in MySQL.
- GPS loop: `POST /api/monitoring/gps-telemetry` upserts a per-shipment session and inserts interpolated points along the route; the map reads the latest 200 points.
- Alert loop: `PATCH /api/monitoring/alerts` compares and sets the current status, logs the transition, recomputes risk.

---

## 7. API endpoints

| URL | Methods | Purpose |
|---|---|---|
| `/api/login`, `/api/logout`, `/api/auth/me` | POST / POST / GET | Session lifecycle and current user |
| `/api/customers`, `/api/customers/:id` | GET, POST / GET, PUT, DELETE | Customer + login management |
| `/api/products`, `/api/products/:id` | GET, POST / GET, PUT, DELETE | Product thresholds |
| `/api/drivers`, `/api/drivers/:id` | GET, POST / GET, PUT, DELETE | Driver profiles |
| `/api/vehicles`, `/api/vehicles/:id` | GET, POST / GET, PUT, DELETE | Vehicle fleet |
| `/api/warehouses`, `/api/warehouses/:id` | GET, POST / GET, PUT, DELETE, PATCH (archive) | Warehouses |
| `/api/routes`, `/api/routes/:id` | GET, POST / GET, PUT, DELETE | Routes |
| `/api/shipments`, `/api/shipments/:id` | GET, POST / GET, PUT, DELETE | Shipments + status history |
| `/api/monitoring` (`/generate`, `/readings`) | GET, POST | Simulator, readings, alerts, risk |
| `/api/monitoring/alerts` | GET, PATCH | Alert list and lifecycle |
| `/api/monitoring/gps-telemetry` | GET, POST | GPS sessions and telemetry |
| `/api/analytics` and `/api/analytics/overview`, `/shipments-by-status`, `/route-performance`, `/violation-reports` | GET | Analytics data |

All endpoints require the session cookie; mutations additionally require an operational role (or ownership for the customer-scoped monitoring actions).

---

## 8. Typical workflows

1. **Add a customer** — sign in as admin/dispatcher → Customers → **Add Customer** → fill name, company, phone, address, username, email, password (blank → `123456`) → the API creates the login and profile together. The new user can sign in immediately.
2. **Create a shipment** — Shipments → **Add Shipment** → select customer, route, vehicle, driver, dates and status → the API inserts the shipment and its first status-history row.
3. **Simulate a temperature violation** — Monitoring → choose shipment → **Generate reading** → the deterministic simulator produces a reading; repeated hot/dry patterns open or refresh an alert and update the shipment's risk badge.
4. **Resolve an alert** — Monitoring → alert list → Acknowledge → Resolve. Each step is logged and risk is recomputed from the remaining OPEN alerts.
5. **Track a vehicle** — GPS Tracking → choose shipment → **Start** → **Manual update / step** → watch the marker follow the Karnataka route → **Stop**.
6. **Review performance** — Analytics → check KPI cards, status distribution, route performance and violation reports (customer sessions see only their own shipments).

---

## 9. Verification performed

- `tsc --noEmit`, `eslint`, and `npm run build` all pass; Next.js reports `Proxy (Middleware)` in the build output.
- Fresh-session HTTP checks confirm protected pages redirect to `/auth/signin`, invalid/expired cookies redirect, sign-in CSS loads, APIs still return JSON, and login/logout work.
- Browser checks confirm first-visit redirect, centered sign-in card (0 px offset at mobile/desktop widths), form and demo-account login, dashboard and page navigation, role-based nav, shipment/customer CRUD, alert lifecycle, GPS actions, modal stacking above the map, and no console errors.
- API, CRUD, UI-layout and role-based regression suites all pass; MySQL was verified clean after tests (no leftover test customers or users).

A quick manual smoke test after changes:

```bash
npm run build && npm run start
# fresh browser (clear cookies) → http://localhost:3000 → must show Sign In
# sign in as admin, dispatcher and customer1; check nav and CRUD visibility
curl -b /tmp/jar -c /tmp/jar -X POST http://localhost:3000/api/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"123456"}'
curl -b /tmp/jar http://localhost:3000/api/auth/me
```

---

## 10. Important caveats / accuracy notes

1. Old root docs (`SYSTEM_SUMMARY.md`, `DEVELOPMENT_STATUS.md`) are stale: they list passwords `admin123`/`customer123`, 3 routes, 6 GPS documents and "MongoDB aggregation". The real values are **`123456` for all demo accounts**, **6 routes**, **37 seed GPS documents**, and `find()` + JavaScript reductions (no `aggregate()`).
2. `prisma/schema.prisma` has no `datasource` block, uses lowercase `@@map` names and includes columns that do not exist live; do not use `db:push` to regenerate the working database.
3. `DATABASE_URL` is unused; local DB settings come from `DB_*`, `MYSQL_*` or hardcoded defaults.
4. MongoDB has no TTL/retention job; telemetry grows indefinitely.
5. `ADMIN` and `DISPATCHER` currently have identical capabilities — there is no admin-only feature in code.
6. Drivers are seeded with `user_id = NULL` because the live `DRIVER.user_id` column is nullable; driver1/driver2 accounts (if present) are disabled.
