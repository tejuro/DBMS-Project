# MongoDB Commands Used in This Project

This file documents every MongoDB operation used by the Smart Cold-Chain Logistics system: connection setup, collections, queries, indexes, seed/migration behavior, and useful `mongosh` commands for inspection.

- Database: `cold_chain_monitoring` (name comes from the URI path)
- Library: `mongoose` is used **only as a connection factory**; all CRUD uses the native driver returned by `mongoose.connection.db`
- MySQL continues to hold all domain/CRUD data — see `MYSQL_COMMANDS.md`

---

## 1. Connection (`lib/mongo.ts`)

```ts
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/cold_chain_monitoring";

export async function getMongoDb() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    return mongoose.connection.db;
  }
  if (!globalForMongo.mongoConnectionPromise) {
    globalForMongo.mongoConnectionPromise = mongoose
      .connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
      .then(() => mongoose.connection)
      .catch((error) => {
        globalForMongo.mongoConnectionPromise = undefined; // allow retry
        throw error;
      });
  }
  const connection = await globalForMongo.mongoConnectionPromise;
  if (!connection.db) throw new Error("MongoDB connection has no database");
  return connection.db;
}
```

- One shared connection promise is cached on `globalThis` (safe with Next.js hot reload and concurrent requests).
- No Mongoose `Schema` / `model()` definitions exist; no app-level `disconnect()` (long-lived Next.js process). Scripts call `mongoose.disconnect()` in `finally`.
- `mongoose.Types.ObjectId.isValid()` / `new mongoose.Types.ObjectId()` are used only in the alert PATCH route to validate and convert alert ids.

---

## 2. Collections and document shapes

### `sensor_readings` — temperature/humidity telemetry

```js
{
  _id: ObjectId,
  shipment_id: Number,      // FK (logical) to MySQL SHIPMENT
  sensor_id: String,        // seed: "TEMP-001", simulator: "TEMP-101"
  temperature: Number,
  humidity: Number,
  timestamp: Date,
  product_id: Number | null,
  product_name: String | null,
  source: String,           // "seed" | "simulator"
  sequence: Number          // simulator only
}
```

### `alerts` — violations and their lifecycle

```js
{
  _id: ObjectId,
  shipment_id: Number,
  alert_type: String,       // TEMPERATURE / HUMIDITY / ROUTINE (seed)
                            // HIGH_TEMPERATURE / LOW_TEMPERATURE /
                            // LOW_HUMIDITY / HIGH_HUMIDITY (simulator)
  severity: String,         // LOW | MEDIUM | HIGH | CRITICAL
  message: String,
  detected_at: Date,
  status: String,           // OPEN -> ACKNOWLEDGED -> RESOLVED
  resolved_at: Date | null,
  acknowledged_at: Date | null,
  last_detected_at: Date,   // simulator/ACK refresh
  updated_at: Date,         // PATCH
  product_id: Number, product_name: String,
  source: String,           // "seed" | "simulator"
  dedupe_key: String        // `${shipmentId}:${violation.type}` (simulator)
}
```

### `gps_telemetry` — GPS track points

```js
{
  _id: ObjectId,
  shipment_id: Number,
  route_id: Number,
  latitude: Number, longitude: Number,
  speed: Number, heading: Number,
  progress: Number,         // 0..1
  source: String,           // "seed" | "migrate" | "simulator" | "manual"
  recorded_at: Date,
  timestamp: Date           // legacy fallback read by serializer
}
```

### `gps_sessions` — simulator state (one document per shipment)

```js
{
  _id: ObjectId,
  shipment_id: Number,      // stable key
  status: "RUNNING" | "PAUSED" | "STOPPED",
  progress: Number,
  last_latitude: Number, last_longitude: Number, last_speed: Number,
  updated_at: Date
}
```
This collection is created implicitly by the first upsert (the seed does not pre-create it).

### `monitoring_logs` — audit trail

```js
{
  _id: ObjectId,
  event_type: String,       // SYSTEM_START | TEMPERATURE_CHECK | ALERT_GENERATED |
                            // ALERT_ACKNOWLEDGED | ALERT_RESOLVED
  shipment_id: Number,
  alert_id: String | null, alert_type: String, severity: String,
  message: String,
  metadata: { source: String, sensor, reading_id, product_id, product_name,
              previous_status, status },
  created_at: Date
}
```

---

## 3. Operations by file

### 3.1 Dashboard reads (`lib/dashboard-data.ts`)

Six parallel reads; failures are collected as `MongoDB: ...` errors without breaking MySQL sections:

```js
db.collection("alerts").find({ status: "OPEN" }).sort({ detected_at: -1 }).limit(6).toArray();
db.collection("sensor_readings").find().sort({ timestamp: -1 }).limit(200).toArray();
db.collection("gps_telemetry").find().sort({ recorded_at: -1 }).limit(12).toArray();
db.collection("sensor_readings").find().sort({ timestamp: 1 }).limit(16).toArray();
db.collection("alerts").countDocuments({ severity: "CRITICAL", status: "OPEN" });
db.collection("alerts").countDocuments({ status: "OPEN" });
```
Newest readings feed averages; oldest 16 feed trend charts; GPS points feed the dashboard map.

### 3.2 Analytics (`app/analytics/api/route.tsx`)

```js
// KPI counts + projected readings (CUSTOMER scoped with shipment_id $in list)
db.collection("alerts").countDocuments({ ...mongoMatch, severity: "CRITICAL", status: "OPEN" });
db.collection("alerts").countDocuments({ ...mongoMatch, status: "OPEN" });
db.collection("sensor_readings")
  .find(mongoMatch, { projection: { shipment_id: 1, product_id: 1, temperature: 1, humidity: 1 } })
  .limit(1000).toArray();

// Violation reports (joined in JS with MySQL product names)
db.collection("alerts").find(alertQuery).sort({ detected_at: -1 }).limit(50).toArray();
db.collection("sensor_readings").find(readingQuery).sort({ timestamp: -1 }).limit(300).toArray();

// Overview distributions
db.collection("alerts").find(query,
  { projection: { severity: 1, alert_type: 1, status: 1 } }).toArray();
```
There is **no `aggregate()` pipeline** in the project — all grouping/statistics are computed in JavaScript after `find()`.

### 3.3 Monitoring simulator (`app/monitoring/api/route.tsx`)

```js
// Partial unique index, created once per process
db.collection("alerts").createIndex(
  { shipment_id: 1, alert_type: 1, dedupe_key: 1 },
  { name: "unique_open_simulator_alerts", unique: true,
    partialFilterExpression: { status: "OPEN", dedupe_key: { $exists: true } } }
);

// Risk = highest severity among OPEN alerts, then written back to MySQL
await db.collection("alerts").find({ shipment_id: shipmentId, status: "OPEN" }).toArray();
await pool.execute("UPDATE SHIPMENT SET risk_status = ? WHERE shipment_id = ?", [...]);

// GET monitoring data
db.collection("sensor_readings").find(readingQuery).sort({ timestamp: -1 }).limit(100).toArray();
db.collection("alerts").find(alertQuery).sort({ detected_at: -1 }).limit(100).toArray();

// POST: one deterministic reading per call
const sequence = await db.collection("sensor_readings")
  .countDocuments({ shipment_id: shipmentId }) + 1;
await db.collection("sensor_readings").insertOne(readingDoc);

// Alert upsert: create only when absent; refresh severity/message on an existing OPEN alert
await db.collection("alerts").updateOne(
  { shipment_id: shipmentId, alert_type: violation.type, status: "OPEN", dedupe_key },
  { $setOnInsert: { /* new OPEN alert fields */ },
    $set: { severity, message, last_detected_at: timestamp } },
  { upsert: true }
);
await db.collection("alerts").findOne({ _id: result.upsertedId });
await db.collection("monitoring_logs").insertOne({ event_type: "ALERT_GENERATED", ... });
```
Violations are deterministic (`sequence % 5` → hot, `sequence % 7` → dry), so demo behavior is repeatable.

### 3.4 Alert lifecycle (`app/monitoring/alerts/route.tsx`)

```js
const objectId = new mongoose.Types.ObjectId(alertId); // after isValid() check
db.collection("alerts").findOne({ _id: objectId });
db.collection("alerts").find(query).sort({ detected_at: -1 }).limit(100).toArray();

// Compare-and-set enforces OPEN -> ACKNOWLEDGED -> RESOLVED
db.collection("alerts").findOneAndUpdate(
  { _id: objectId, status: currentStatus },
  { $set: { status: nextStatus, updated_at: now,
            acknowledged_at: now /* ACK */, resolved_at: now /* RESOLVED */,
            last_detected_at: existing.last_detected_at ?? now } },
  { returnDocument: "after" }
);
db.collection("monitoring_logs").insertOne({
  event_type: nextStatus === "ACKNOWLEDGED" ? "ALERT_ACKNOWLEDGED" : "ALERT_RESOLVED", ...
});
```
The `status: currentStatus` filter prevents two simultaneous actions from skipping a lifecycle step.

### 3.5 GPS tracking (`app/monitoring/gps-telemetry/route.tsx`)

```js
// GET
db.collection("gps_telemetry").find(query).sort({ recorded_at: -1 }).limit(200).toArray();
db.collection("gps_sessions").findOne({ shipment_id: shipmentId });

// POST helpers
await db.collection("gps_sessions").updateOne(
  { shipment_id: shipmentId },
  { $set: { shipment_id, status, progress, last_latitude, last_longitude,
            last_speed, updated_at: new Date() } },
  { upsert: true }
);
await db.collection("gps_telemetry").findOne(
  { shipment_id: shipmentId }, { sort: { recorded_at: -1 } }
);
await db.collection("gps_telemetry").insertOne({
  shipment_id, route_id, recorded_at, latitude, longitude,
  speed, heading, progress, source: "simulator" | "manual"
});
```
Actions: `start`, `pause`, `resume`, `stop`, `step`, `manual`. `pause/resume/stop` only update the session; `start/step/manual` also insert trail points. Route geometry comes from MySQL `SHIPMENT.route_id` + `lib/gps-route.ts`.

### 3.6 Seed script (`scripts/seed.ts`)

```js
await mongoose.connect(MONGO_URI);
const collectionNames = new Set((await db.listCollections().toArray()).map(c => c.name));
for (const name of ["sensor_readings", "alerts", "gps_telemetry", "monitoring_logs"]) {
  if (!collectionNames.has(name)) await db.createCollection(name);
}

// Every insert is an idempotent upsert with $setOnInsert (re-runs never overwrite)
await db.collection("sensor_readings").updateOne(
  { shipment_id, sensor_id, timestamp }, { $setOnInsert: reading }, { upsert: true });
await db.collection("alerts").updateOne(
  { shipment_id, alert_type, detected_at }, { $setOnInsert: alert }, { upsert: true });
await db.collection("gps_telemetry").updateOne(
  { shipment_id, route_id, progress, source: "seed" }, { $setOnInsert: gps }, { upsert: true });
await db.collection("monitoring_logs").updateOne(
  { shipment_id, event_type, created_at }, { $setOnInsert: log }, { upsert: true });

await mongoose.disconnect(); // in finally
```
Clean-database results: **7 readings, 4 alerts, 37 unique GPS points, 3 logs**. The GPS generator makes 9 points for each of the 5 shipments, but shipment 5 is `CREATED` (all points have `progress: 0` and the same key), so 45 upserts yield 37 documents (4 × 9 + 1). No deletes or drops.

### 3.7 Migration script (`scripts/migrate-karnataka.ts`)

```js
// Count before/after
await db.collection(name).countDocuments({});

// Remove only explicitly foreign/demo docs
await db.collection("gps_telemetry").deleteMany({
  $or: [{ latitude: { $gt: 40 } }, { longitude: { $lt: 0 } }, { shipment_id: 1001 }] });
await db.collection("alerts").deleteMany({ shipment_id: 1001 });
await db.collection("sensor_readings").deleteMany({ shipment_id: 1001 });
await db.collection("monitoring_logs").deleteMany({ shipment_id: 1001 });

// Upsert fresh Karnataka GPS history with a distinct source
await db.collection("gps_telemetry").updateOne(
  { shipment_id, route_id, progress, source: "migrate" },
  { $setOnInsert: doc }, { upsert: true });
```
In-flight shipments get 9 points, `CREATED` shipments 1 point. Because `source` is part of the key, `source: "migrate"` docs coexist with `source: "seed"` docs (up to 37 + 37). The script prints before/after counts and a foreign-document recheck, then disconnects. No `DROP`, no schema change.

---

## 4. Indexes

| Collection | Keys | Options | Created by |
|---|---|---|---|
| `sensor_readings` | `{ shipment_id: 1, timestamp: -1 }` | — | seed, migration |
| `sensor_readings` | `{ sensor_id: 1, timestamp: -1 }` | — | seed |
| `alerts` | `{ shipment_id: 1, status: 1 }` | — | seed, migration |
| `alerts` | `{ detected_at: -1, status: 1 }` | — | seed |
| `alerts` | `{ shipment_id: 1, alert_type: 1 }` | unique, `uniq_open_alert_per_shipment_type`, partial `{ status: "OPEN" }` | seed, migration |
| `alerts` | `{ shipment_id: 1, alert_type: 1, dedupe_key: 1 }` | unique, `unique_open_simulator_alerts`, partial `{ status: "OPEN", dedupe_key: { $exists: true } }` | runtime simulator |
| `gps_telemetry` | `{ shipment_id: 1, recorded_at: -1 }` | — | seed, migration |
| `gps_telemetry` | `{ shipment_id: 1, route_id: 1, progress: 1 }` | — | seed, migration |
| `monitoring_logs` | `{ created_at: -1 }` | — | seed |
| `monitoring_logs` | `{ shipment_id: 1, event_type: 1 }` | — | seed, migration |
| `gps_sessions` | *(none)* | — | — |

Both partial-unique index creations are wrapped in `try/catch` — legacy duplicate OPEN alerts only produce a warning, not a crash. There are **no TTL indexes and no retention job**: telemetry documents persist indefinitely. No `dropIndex` / `dropCollection` / `dropDatabase` calls exist.

### 4.1 One-time setup in `mongosh` (collections + indexes)

MongoDB creates collections implicitly on first insert, but `scripts/seed.ts` creates these four explicitly and then creates the indexes. To reproduce the same setup manually in a fresh `cold_chain_monitoring` database:

```bash
mongosh "mongodb://localhost:27017/cold_chain_monitoring"
```

```js
// 1. Create the four collections the seed script expects.
db.createCollection("sensor_readings");
db.createCollection("alerts");
db.createCollection("gps_telemetry");
db.createCollection("monitoring_logs");
// gps_sessions is created implicitly by the first upsert from the GPS simulator.

// 2. Regular indexes (same calls as scripts/seed.ts).
db.sensor_readings.createIndex({ shipment_id: 1, timestamp: -1 });
db.sensor_readings.createIndex({ sensor_id: 1, timestamp: -1 });
db.alerts.createIndex({ shipment_id: 1, status: 1 });
db.alerts.createIndex({ detected_at: -1, status: 1 });
db.gps_telemetry.createIndex({ shipment_id: 1, recorded_at: -1 });
db.gps_telemetry.createIndex({ shipment_id: 1, route_id: 1, progress: 1 });
db.monitoring_logs.createIndex({ created_at: -1 });
db.monitoring_logs.createIndex({ shipment_id: 1, event_type: 1 });

// 3. Partial unique indexes. These fail on legacy duplicate OPEN alerts;
//    the seed/migration scripts wrap them in try/catch and only warn.
db.alerts.createIndex(
  { shipment_id: 1, alert_type: 1 },
  { name: "uniq_open_alert_per_shipment_type", unique: true,
    partialFilterExpression: { status: "OPEN" } }
);
db.alerts.createIndex(
  { shipment_id: 1, alert_type: 1, dedupe_key: 1 },
  { name: "unique_open_simulator_alerts", unique: true,
    partialFilterExpression: { status: "OPEN", dedupe_key: { $exists: true } } }
);
```

Run `npm run seed` after this to populate the demo readings, alerts, GPS points and logs. The seed script performs these same `createCollection`/`createIndex` calls itself, so the manual setup is only needed when you want an empty-but-indexed database.

---

## 5. Useful `mongosh` commands (for manual inspection)

No raw `mongosh` commands ship with the repository. These read-only commands are useful for checking the same data:

```bash
mongosh "mongodb://localhost:27017/cold_chain_monitoring"

db.getCollectionNames()
db.sensor_readings.countDocuments({})
db.alerts.countDocuments({ status: "OPEN" })
db.alerts.find({ status: "OPEN" }).sort({ detected_at: -1 }).limit(5).pretty()
db.sensor_readings.find({ shipment_id: 1 }).sort({ timestamp: -1 }).limit(5).pretty()
db.gps_telemetry.find({ shipment_id: 2 }).sort({ recorded_at: -1 }).limit(5).pretty()
db.gps_sessions.find({}).pretty()
db.monitoring_logs.find({}).sort({ created_at: -1 }).limit(5).pretty()
db.alerts.getIndexes()
db.gps_telemetry.getIndexes()
```

---

## 6. Things to remember

1. Mongo is for **time-series telemetry, alerts, GPS and logs**; MySQL remains authoritative for users, shipments and all master data.
2. Customer sessions are scoped by a `shipment_id: { $in: [...] }` filter derived from MySQL before any Mongo query runs.
3. Alert deduplication uses two distinct partial unique indexes; seed alerts (no `dedupe_key`) are unaffected by the simulator index.
4. `gps_sessions` has no index; `findOne` on `gps_telemetry` with a `recorded_at` sort is unindexed — fine at demo scale.
5. `npm run seed` seeds **both** databases. There is no npm script for the migration; run `npx ts-node scripts/migrate-karnataka.ts`.
