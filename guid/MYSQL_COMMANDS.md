# MySQL Commands Used in This Project

This file documents **every MySQL command/query used by the Smart Cold-Chain Logistics system**, plus the read-only commands used to inspect and verify the database during development.

- Database: `cold_chain` (MySQL 8+, InnoDB, `utf8mb4`)
- Driver: `mysql2` / `mysql2/promise` with **prepared statements** (`pool.execute(sql, params)`)
- Application code does **not** use Prisma Client at runtime — `lib/prisma.ts` is a throwing stub and `prisma/schema.prisma` is descriptive only.
- MongoDB stores telemetry/alerts separately; see `MONGODB_COMMANDS.md`.

---

## 1. How MySQL is reached

### 1.1 Connection pools

| File | Connection source | Notes |
|---|---|---|
| `lib/db.ts` | `DB_HOST` (default `localhost`), `DB_PORT` (`3306`), `DB_USER` (`root`), `DB_PASSWORD` (`""`), `DB_NAME` (`cold_chain`) | Shared pool used by most routes. `connectionLimit: 10`, `queueLimit: 0`. **Never call `pool.end()`** — process-wide. |
| `lib/dashboard-data.ts` | Hardcoded `localhost / root / cold_chain` | Per-call pool, `connectTimeout: 5000`, closed with `pool.end()` after the dashboard query completes. |
| `app/monitoring/api/route.tsx` | `MYSQL_HOST` (default `127.0.0.1`), `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` (default `cold_chain`) | Module-level pool. |
| `app/monitoring/alerts/route.tsx` | Same `MYSQL_*` variables | Module-level pool. |
| `app/monitoring/gps-telemetry/route.tsx` | Hardcoded `localhost / root / cold_chain` | Only one MySQL query (looks up `route_id`). |
| `app/analytics/api/route.tsx` | Hardcoded `localhost / root / cold_chain` | All analytics SELECTs. |
| `scripts/seed.ts`, `scripts/migrate-karnataka.ts` | Hardcoded `localhost / root / cold_chain` | Closed in `finally`. |

> `.env` / `.env.example` currently define `DATABASE_URL`, `MONGODB_URI`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. The app does **not** read `DATABASE_URL`; it uses `DB_*` / `MYSQL_*` (defaults apply locally) and `MONGODB_URI`.

### 1.2 Helper functions (`lib/db.ts`)

```sql
-- nextId(table, column): manual primary-key allocation (domain tables have no AUTO_INCREMENT)
SELECT COALESCE(MAX(${column}), 0) + 1 AS next_id FROM ${table}
```
`table` and `column` come only from hard-coded allowlists, never user input. `sqlParam(value)` is not SQL — it converts JSON input to `string | number | boolean | null` for bound parameters.

---

## 2. Useful mysql CLI commands (manual inspection/verification)

These were used during development to inspect the live database (read-only):

```bash
mysql -u root cold_chain -e "SHOW TABLES;"
mysql -u root cold_chain -e "DESCRIBE USER; DESCRIBE CUSTOMER; DESCRIBE SHIPMENT;"
mysql -u root cold_chain -e "SHOW CREATE TABLE SHIPMENT\G"
mysql -u root cold_chain -e "SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME,
  REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA='cold_chain' AND REFERENCED_TABLE_NAME IN ('CUSTOMER','USER');"
mysql -u root cold_chain -e "SELECT COUNT(*) FROM SHIPMENT;"
mysql -u root cold_chain -e "SELECT user_id, username, role_id, is_active FROM USER;"
```

Useful project commands:

```bash
npm run seed                          # ts-node scripts/seed.ts (seeds MySQL + MongoDB)
npx ts-node scripts/migrate-karnataka.ts  # data migration/repair script
npm run db:push                       # Prisma CLI only (not used by the running app)
npm run db:studio                     # Prisma Studio (optional, schema is descriptive)
```

Neither the seed nor the migration issues `DELETE`, `DROP`, or `TRUNCATE` on MySQL tables. The migration script only uses `INSERT ... ON DUPLICATE KEY UPDATE` and `UPDATE` with `CASE` expressions.

---

## 3. Schema (11 tables)

| Table | Key columns | Purpose |
|---|---|---|
| `ROLE` | `role_id` PK, `role_name` UNIQUE, `is_active` | 1=ADMIN, 2=DISPATCHER, 3=CUSTOMER |
| `USER` | `user_id` PK, `role_id` FK→ROLE, `username` UNIQUE, `email` UNIQUE, `password_hash`, `is_active` | Login accounts; bcrypt hash |
| `CUSTOMER` | `customer_id` PK, `user_id` UNIQUE FK→USER, `name`, `company_name`, `address`, `phone` | Customer profile linked 1:1 to a login |
| `DRIVER` | `driver_id` PK, `user_id` UNIQUE nullable FK→USER, `license_no` UNIQUE, `phone`, `status` | Operational driver profiles (no login in live DB) |
| `VEHICLE` | `vehicle_id` PK, `reg_no` UNIQUE, `vehicle_type`, `capacity_kg`, `status` | Refrigerated fleet |
| `WAREHOUSE` | `warehouse_id` PK, `name`, `address`, `city`, `latitude`, `longitude`, `is_archived` | Karnataka hubs; archives supported |
| `ROUTE` | `route_id` PK, `origin_warehouse_id` FK→WAREHOUSE, `destination_warehouse_id` FK→WAREHOUSE, `distance_km`, `estimated_duration_minutes` | Origin/destination pairs |
| `PRODUCT` | `product_id` PK, `name`, `category`, `min_temp_c`, `max_temp_c`, `min_humidity`, `max_humidity` | Accepted environmental ranges |
| `SHIPMENT` | `shipment_id` PK, `customer_id` FK→CUSTOMER, `created_by` FK→USER, `route_id` FK→ROUTE, `vehicle_id` FK→VEHICLE, `driver_id` FK→DRIVER, `status`, `risk_status`, `dispatched_at`, `expected_delivery`, `delivered_at` | Core shipment record |
| `SHIPMENT_ITEM` | composite PK (`shipment_id`,`product_id`) with FKs to SHIPMENT/PRODUCT, `quantity` | Products carried per shipment |
| `SHIPMENT_STATUS_HISTORY` | `history_id` PK **AUTO_INCREMENT**, `shipment_id` FK→SHIPMENT, `changed_by` FK→USER, `old_status`, `new_status`, `changed_at` DEFAULT CURRENT_TIMESTAMP, `remarks` | Immutable status audit trail |

Only `SHIPMENT_STATUS_HISTORY.history_id` auto-increments; every other insert allocates the id with `nextId()`.

### 3.1 Creating the database and tables (DDL)

The application never creates tables at runtime — the seed script assumes they already exist. Use this DDL (captured from the live database with `SHOW CREATE TABLE`) to create a fresh schema. Tables are created in foreign-key-safe order; `DROP TABLE`/`DROP DATABASE` are intentionally not included.

```sql
CREATE DATABASE IF NOT EXISTS cold_chain
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE cold_chain;
```

```sql
CREATE TABLE `ROLE` (
  `role_id` int NOT NULL,
  `role_name` varchar(50) NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`role_id`),
  UNIQUE KEY `role_name` (`role_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `USER` (
  `user_id` int NOT NULL,
  `role_id` int DEFAULT NULL,
  `username` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `user_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `ROLE` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `CUSTOMER` (
  `customer_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  `company_name` varchar(100) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`customer_id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `customer_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `USER` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `DRIVER` (
  `driver_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  `license_no` varchar(50) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `status` varchar(20) DEFAULT 'AVAILABLE',
  PRIMARY KEY (`driver_id`),
  UNIQUE KEY `license_no` (`license_no`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `driver_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `USER` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `VEHICLE` (
  `vehicle_id` int NOT NULL,
  `reg_no` varchar(50) NOT NULL,
  `vehicle_type` varchar(50) NOT NULL,
  `capacity_kg` float NOT NULL,
  `status` varchar(20) DEFAULT 'AVAILABLE',
  PRIMARY KEY (`vehicle_id`),
  UNIQUE KEY `reg_no` (`reg_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `WAREHOUSE` (
  `warehouse_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `address` varchar(255) NOT NULL,
  `city` varchar(100) NOT NULL,
  `latitude` float DEFAULT NULL,
  `longitude` float DEFAULT NULL,
  `is_archived` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `ROUTE` (
  `route_id` int NOT NULL,
  `origin_warehouse_id` int DEFAULT NULL,
  `destination_warehouse_id` int DEFAULT NULL,
  `distance_km` float NOT NULL,
  `estimated_duration_minutes` float NOT NULL,
  PRIMARY KEY (`route_id`),
  KEY `origin_warehouse_id` (`origin_warehouse_id`),
  KEY `destination_warehouse_id` (`destination_warehouse_id`),
  CONSTRAINT `route_ibfk_1` FOREIGN KEY (`origin_warehouse_id`) REFERENCES `WAREHOUSE` (`warehouse_id`),
  CONSTRAINT `route_ibfk_2` FOREIGN KEY (`destination_warehouse_id`) REFERENCES `WAREHOUSE` (`warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `PRODUCT` (
  `product_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `category` varchar(50) NOT NULL,
  `min_temp_c` float NOT NULL,
  `max_temp_c` float NOT NULL,
  `min_humidity` float NOT NULL,
  `max_humidity` float NOT NULL,
  PRIMARY KEY (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `SHIPMENT` (
  `shipment_id` int NOT NULL,
  `customer_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `route_id` int DEFAULT NULL,
  `vehicle_id` int DEFAULT NULL,
  `driver_id` int DEFAULT NULL,
  `status` varchar(20) NOT NULL,
  `risk_status` varchar(20) NOT NULL DEFAULT 'LOW',
  `dispatched_at` datetime DEFAULT NULL,
  `expected_delivery` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  PRIMARY KEY (`shipment_id`),
  KEY `customer_id` (`customer_id`),
  KEY `created_by` (`created_by`),
  KEY `route_id` (`route_id`),
  KEY `vehicle_id` (`vehicle_id`),
  KEY `driver_id` (`driver_id`),
  CONSTRAINT `shipment_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `CUSTOMER` (`customer_id`),
  CONSTRAINT `shipment_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `USER` (`user_id`),
  CONSTRAINT `shipment_ibfk_3` FOREIGN KEY (`route_id`) REFERENCES `ROUTE` (`route_id`),
  CONSTRAINT `shipment_ibfk_4` FOREIGN KEY (`vehicle_id`) REFERENCES `VEHICLE` (`vehicle_id`),
  CONSTRAINT `shipment_ibfk_5` FOREIGN KEY (`driver_id`) REFERENCES `DRIVER` (`driver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `SHIPMENT_ITEM` (
  `shipment_id` int NOT NULL,
  `product_id` int NOT NULL,
  `quantity` int DEFAULT '1',
  PRIMARY KEY (`shipment_id`,`product_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `shipment_item_ibfk_1` FOREIGN KEY (`shipment_id`) REFERENCES `SHIPMENT` (`shipment_id`),
  CONSTRAINT `shipment_item_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `PRODUCT` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `SHIPMENT_STATUS_HISTORY` (
  `history_id` int NOT NULL AUTO_INCREMENT,
  `shipment_id` int DEFAULT NULL,
  `changed_by` int DEFAULT NULL,
  `old_status` varchar(20) DEFAULT NULL,
  `new_status` varchar(20) NOT NULL,
  `changed_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `remarks` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`history_id`),
  KEY `shipment_id` (`shipment_id`),
  KEY `changed_by` (`changed_by`),
  CONSTRAINT `shipment_status_history_ibfk_1` FOREIGN KEY (`shipment_id`) REFERENCES `SHIPMENT` (`shipment_id`),
  CONSTRAINT `shipment_status_history_ibfk_2` FOREIGN KEY (`changed_by`) REFERENCES `USER` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

Notes:

- The live `SHIPMENT_STATUS_HISTORY` table also carries a current `AUTO_INCREMENT=66` counter; it is omitted above so a fresh schema starts at 1.
- Table and column names are **uppercase** and there are no `created_at`/`updated_at` columns. Do not regenerate the schema from `prisma/schema.prisma` (see §5).
- `DRIVER.user_id` is nullable, so drivers exist as profiles without login accounts.
- After creating the schema, run `npm run seed` to insert the demo roles, users, customers and master data.

---

## 4. Queries by application area

### 4.1 Login and session (`app/api/login/route.tsx`, `lib/auth.ts`)

```sql
-- Login: verify username + active role, then bcrypt.compare against password_hash
SELECT u.user_id, u.username, u.email, u.password_hash, u.is_active,
       r.role_name, c.customer_id, c.company_name, c.name AS customer_name
FROM USER u
JOIN ROLE r ON r.role_id = u.role_id
LEFT JOIN CUSTOMER c ON c.user_id = u.user_id
WHERE u.username = ? AND r.is_active = TRUE

-- Every authenticated request: re-read the account so role changes/deactivation take effect
SELECT u.user_id, u.username, u.email, r.role_name,
       c.customer_id, c.company_name, c.name AS customer_name
FROM USER u
JOIN ROLE r ON r.role_id = u.role_id
LEFT JOIN CUSTOMER c ON c.user_id = u.user_id
WHERE u.user_id = ? AND u.is_active = TRUE AND r.is_active = TRUE

-- Ownership check for a CUSTOMER session
SELECT customer_id FROM SHIPMENT WHERE shipment_id = ?
```
`proxy.ts` only reads the signed `cc_session` cookie — no SQL. `CUSTOMER` sessions are added to Mongo/MySQL queries as `shipment_id IN (...)` or `s.customer_id = ?`.

### 4.2 Generic detail routes (`lib/crud-route.ts`)

`createDetailRoute("SHIPMENT" | "PRODUCT" | "DRIVER" | "VEHICLE" | "WAREHOUSE" | "ROUTE")` generates:

```sql
SELECT * FROM <table> WHERE <primaryKey> = ?
UPDATE <table> SET <allowed columns> = ? WHERE <primaryKey> = ?
DELETE FROM SHIPMENT_STATUS_HISTORY WHERE shipment_id = ?   -- shipment deletion only
DELETE FROM SHIPMENT_ITEM WHERE shipment_id = ?             -- shipment deletion only
DELETE FROM <table> WHERE <primaryKey> = ?
```
Columns are restricted by `TABLE_CONFIG` allowlist; `CUSTOMER` sessions may only `GET SHIPMENT` and only for their own shipment.

### 4.3 Resource CRUD

```sql
-- Products (app/products/api)
SELECT * FROM PRODUCT
INSERT INTO PRODUCT (product_id, name, category, min_temp_c, max_temp_c, min_humidity, max_humidity) VALUES (?,?,?,?,?,?,?)
UPDATE PRODUCT SET name=?, category=?, min_temp_c=?, max_temp_c=?, min_humidity=?, max_humidity=? WHERE product_id=?
DELETE FROM PRODUCT WHERE product_id=?

-- Drivers (app/drivers/api) — no login created, user_id stays NULL
SELECT * FROM DRIVER
INSERT INTO DRIVER (driver_id, name, license_no, phone, status) VALUES (?,?,?,?,?)
UPDATE DRIVER SET name=?, license_no=?, phone=?, status=? WHERE driver_id=?
SELECT COUNT(*) AS count FROM SHIPMENT WHERE driver_id=?   -- FK guard
DELETE FROM DRIVER WHERE driver_id=?

-- Vehicles (app/vehicles/api)
SELECT * FROM VEHICLE
INSERT INTO VEHICLE (vehicle_id, reg_no, vehicle_type, capacity_kg, status) VALUES (?,?,?,?,?)
UPDATE VEHICLE SET reg_no=?, vehicle_type=?, capacity_kg=?, status=? WHERE vehicle_id=?
SELECT COUNT(*) AS count FROM SHIPMENT WHERE vehicle_id=?   -- FK guard
DELETE FROM VEHICLE WHERE vehicle_id=?

-- Warehouses (app/warehouses/api) — supports soft archive
SELECT * FROM WAREHOUSE ORDER BY warehouse_id              -- ?archived=true
SELECT * FROM WAREHOUSE WHERE is_archived = 0 ORDER BY warehouse_id  -- default
INSERT INTO WAREHOUSE (warehouse_id, name, address, city, latitude, longitude) VALUES (?,?,?,?,?,?)
UPDATE WAREHOUSE SET name=?, address=?, city=?, latitude=?, longitude=? WHERE warehouse_id=?
SELECT COUNT(*) AS count FROM ROUTE WHERE (origin_warehouse_id=? OR destination_warehouse_id=?) AND is_archived=0
UPDATE WAREHOUSE SET is_archived=? WHERE warehouse_id=?     -- 1 archive / 0 restore
SELECT COUNT(*) AS count FROM ROUTE WHERE origin_warehouse_id=? OR destination_warehouse_id=?
DELETE FROM WAREHOUSE WHERE warehouse_id=?

-- Routes (app/routes/api)
SELECT r.*, w1.name AS origin_name, w2.name AS destination_name
FROM ROUTE r LEFT JOIN WAREHOUSE w1 ON r.origin_warehouse_id=w1.warehouse_id
             LEFT JOIN WAREHOUSE w2 ON r.destination_warehouse_id=w2.warehouse_id
INSERT INTO ROUTE (route_id, origin_warehouse_id, destination_warehouse_id, distance_km, estimated_duration_minutes) VALUES (?,?,?,?,?)
UPDATE ROUTE SET origin_warehouse_id=?, destination_warehouse_id=?, distance_km=?, estimated_duration_minutes=? WHERE route_id=?
SELECT COUNT(*) AS count FROM SHIPMENT WHERE route_id=?     -- FK guard
DELETE FROM ROUTE WHERE route_id=?
```

### 4.4 Shipments (`app/shipments/api/route.tsx`, detail via `crud-route`)

```sql
-- List (dynamic WHERE for status / customer_id; CUSTOMER forced to own id)
SELECT s.*, c.company_name AS customer_name, u.username AS creator_name,
       v.reg_no AS vehicle_reg, d.name AS driver_name,
       r.distance_km, r.estimated_duration_minutes
FROM SHIPMENT s
JOIN CUSTOMER c ON s.customer_id=c.customer_id
JOIN USER u ON s.created_by=u.user_id
LEFT JOIN VEHICLE v ON s.vehicle_id=v.vehicle_id
LEFT JOIN DRIVER d ON s.driver_id=d.driver_id
LEFT JOIN ROUTE r ON s.route_id=r.route_id
[WHERE s.status = ?] [AND s.customer_id = ?]

-- Create + initial audit entry (single source statement)
INSERT INTO SHIPMENT (shipment_id, customer_id, created_by, route_id, vehicle_id, driver_id,
                      status, risk_status, dispatched_at, expected_delivery, delivered_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?)
INSERT INTO SHIPMENT_STATUS_HISTORY (shipment_id, changed_by, old_status, new_status, changed_at, remarks)
VALUES (?, ?, ?, ?, NOW(), 'Shipment created')
```
CREATED shipments are shown in their own section in the UI; status changes append to `SHIPMENT_STATUS_HISTORY`.

### 4.5 Customers (`app/customers/api/route.tsx`, `app/customers/api/[id]/route.ts`)

Creating a customer writes **two tables in one transaction** (default password `123456`, bcrypt cost 10):

```sql
SELECT c.customer_id, c.user_id, c.name, c.company_name, c.address, c.phone, u.username, u.email
FROM CUSTOMER c LEFT JOIN USER u ON u.user_id=c.user_id
[WHERE c.customer_id = ?] ORDER BY c.name

INSERT INTO USER (user_id, role_id, username, email, password_hash, is_active)
VALUES (?, 3, ?, ?, ?, TRUE)
INSERT INTO CUSTOMER (customer_id, user_id, name, company_name, address, phone)
VALUES (?,?,?,?,?,?)

-- Update: blank password keeps the stored hash
UPDATE CUSTOMER SET name=?, company_name=?, address=?, phone=? WHERE customer_id=?
UPDATE USER SET username=?, email=?, password_hash=? WHERE user_id=?   -- new password
UPDATE USER SET username=?, email=? WHERE user_id=?                    -- unchanged password

-- Delete guards + transactional delete (profile first: CUSTOMER.user_id → USER.user_id)
SELECT COUNT(*) AS n FROM SHIPMENT WHERE customer_id=? OR created_by=?
SELECT COUNT(*) AS n FROM SHIPMENT_STATUS_HISTORY WHERE changed_by=?
DELETE FROM CUSTOMER WHERE customer_id=?
DELETE FROM USER WHERE user_id=?
```
`ER_DUP_ENTRY` (duplicate username/email) is translated into HTTP 400. `CUSTOMER` sessions receive HTTP 403 for create/update/delete.

### 4.6 Monitoring (`app/monitoring/api/route.tsx`, `alerts/route.tsx`, `gps-telemetry/route.tsx`)

```sql
-- Product thresholds from shipment items
SELECT si.shipment_id, p.product_id, p.name, p.min_temp_c, p.max_temp_c, p.min_humidity, p.max_humidity
FROM SHIPMENT_ITEM si JOIN PRODUCT p ON p.product_id=si.product_id
[WHERE si.shipment_id = ?] ORDER BY si.shipment_id, p.product_id

SELECT risk_status FROM SHIPMENT WHERE shipment_id=?
SELECT shipment_id FROM SHIPMENT ORDER BY shipment_id   -- visibility enumeration
SELECT s.shipment_id, s.customer_id, s.status, s.risk_status, c.name AS customer_name
FROM SHIPMENT s LEFT JOIN CUSTOMER c ON c.customer_id=s.customer_id WHERE s.shipment_id=?
UPDATE SHIPMENT SET risk_status=? WHERE shipment_id=?   -- derived from OPEN Mongo alerts
SELECT route_id FROM SHIPMENT WHERE shipment_id=? LIMIT 1
```
Readings, alerts, GPS points and logs themselves are MongoDB documents, not MySQL rows.

### 4.7 Analytics (`app/analytics/api/route.tsx`)

```sql
SELECT shipment_id FROM SHIPMENT WHERE customer_id=?     -- scope CUSTOMER queries

SELECT COUNT(*) AS total,
       SUM(CASE WHEN s.status NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN s.status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,
       SUM(CASE WHEN s.status='DELAYED' THEN 1 ELSE 0 END) AS delayed_count
FROM SHIPMENT s WHERE 1=1 [AND s.customer_id=?]

SELECT s.status, COUNT(*) AS count FROM SHIPMENT s WHERE 1=1 [AND s.customer_id=?]
GROUP BY s.status ORDER BY count DESC

SELECT si.shipment_id, GROUP_CONCAT(p.name ORDER BY p.name SEPARATOR ', ') AS product_names
FROM SHIPMENT_ITEM si JOIN PRODUCT p ON si.product_id=p.product_id GROUP BY si.shipment_id

SELECT r.route_id, ow.name AS origin, dw.name AS destination, r.distance_km,
       r.estimated_duration_minutes, COUNT(s.shipment_id) AS shipment_count,
       SUM(CASE WHEN s.delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
       SUM(CASE WHEN s.delivered_at IS NOT NULL AND s.expected_delivery IS NOT NULL
                AND s.delivered_at <= s.expected_delivery THEN 1 ELSE 0 END) AS on_time,
       AVG(CASE WHEN s.delivered_at IS NOT NULL AND s.dispatched_at IS NOT NULL
                THEN TIMESTAMPDIFF(MINUTE, s.dispatched_at, s.delivered_at) END) AS actual_avg_minutes
FROM ROUTE r
LEFT JOIN WAREHOUSE ow ON r.origin_warehouse_id=ow.warehouse_id
LEFT JOIN WAREHOUSE dw ON r.destination_warehouse_id=dw.warehouse_id
LEFT JOIN SHIPMENT s ON s.route_id=r.route_id [AND s.customer_id=?]
GROUP BY r.route_id ORDER BY r.route_id
```
`GET_overview` adds grouped counts by customer, route, driver and vehicle plus a delivery-performance aggregate using `TIMESTAMPDIFF(MINUTE, ...)`.

### 4.8 Dashboard (`lib/dashboard-data.ts`)

Six SELECTs in parallel: shipment KPI counts, status breakdown, latest 8 shipments with customer/route/city names, warehouse coordinates for the map, product thresholds, and the latest 6 status-history rows. Failures are reported in `data.errors` as `MySQL: ...` while MongoDB telemetry still renders.

### 4.9 Seed and migration scripts

`scripts/seed.ts` creates roles 1–3, users 1–4 (all password `123456`), customers 1–2, drivers 1–2, vehicles 1–3, warehouses 1–7, products 1–4, routes 1–6, shipments 1–5, 8 shipment items and 13 status-history rows. Techniques used:

```sql
INSERT IGNORE INTO ROLE (...) VALUES (...), (...), (...)
INSERT IGNORE INTO PRODUCT (...) VALUES (...)
INSERT INTO CUSTOMER (...) VALUES (...) ON DUPLICATE KEY UPDATE name=VALUES(name), ...
INSERT INTO SHIPMENT (...) VALUES (...) ON DUPLICATE KEY UPDATE status=VALUES(status), ...
SELECT IS_NULLABLE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='DRIVER' AND COLUMN_NAME='user_id'
UPDATE USER SET is_active=FALSE WHERE username IN ('driver1','driver2') OR user_id IN (5,6)
```

`scripts/migrate-karnataka.ts` uses `INSERT ... ON DUPLICATE KEY UPDATE` plus `UPDATE ... CASE` to normalize warehouse/route/customer/driver/vehicle names and coordinates, and ends with a verification `SELECT shipment_id, route_id, dispatched_at, status FROM SHIPMENT WHERE shipment_id BETWEEN 1 AND 5 ORDER BY shipment_id`.

---

## 5. Integrity rules that matter

1. **Every ID is allocated manually** via `MAX(id)+1` except `SHIPMENT_STATUS_HISTORY.history_id`.
2. **All mutations use bound parameters** — table/column names only come from allowlists.
3. **Delete guards** count dependent `SHIPMENT`/`ROUTE` rows before deleting drivers, vehicles, routes, warehouses and customers.
4. **Two-table operations are transactional**: customer create/update/delete; shipment deletion removes its history and items in the same request.
5. **`DRIVER.user_id` is nullable in the live DB** — drivers are profiles only, with no usable login. The login route also rejects usernames like `driver1`.
6. **Warehouses support archiving** (`is_archived`) instead of destructive deletion when still referenced by routes.
7. **Prisma caveat**: `prisma/schema.prisma` and `npm run db:push` are not authoritative. The live schema uses uppercase table names, no `created_at/updated_at` columns, and a nullable `DRIVER.user_id`; do not regenerate the DB from Prisma.
