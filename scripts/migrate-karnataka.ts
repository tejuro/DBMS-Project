/// Safe, idempotent in-place migration to Karnataka-only demo geography.
///
/// Usage (from the project root):
///   npx ts-node scripts/migrate-karnataka.ts
///
/// What it does:
///   MySQL (cold_chain):
///     - INSERT ... ON DUPLICATE KEY UPDATE WAREHOUSE ids 1..7 and ROUTE ids 1..6.
///     - UPDATE CUSTOMER ids 1,2 and DRIVER ids 1,2 (Indian names/addresses/phones).
///     - UPDATE USER ids 5,6 -> is_active = FALSE (driver profiles are not logins).
///     - UPDATE VEHICLE ids 1..3 registration numbers to KA registrations.
///   MongoDB (cold_chain_monitoring):
///     - Delete ONLY foreign/clearly-demo docs:
///         gps_telemetry: latitude > 40 OR longitude < 0 OR shipment_id = 1001
///         alerts / sensor_readings / monitoring_logs: shipment_id = 1001
///     - Upsert a fresh progressive Karnataka GPS history for shipments 1..5.
///
/// Safety: no DROP, TRUNCATE, schema change, or delete by unknown criteria.
/// Every other row/document is preserved. Re-running is safe: MySQL updates are
/// deterministic and Mongo GPS docs use a stable (shipment_id, route_id,
/// progress, source) key with $setOnInsert. Before/after counts are printed.

import mysql, { type Pool } from 'mysql2/promise';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cold_chain_monitoring';

type Coordinates = { latitude: number; longitude: number };

const CITY_COORDS: Record<string, Coordinates> = {
  Bengaluru: { latitude: 12.9716, longitude: 77.5946 },
  Mysuru: { latitude: 12.2958, longitude: 76.6394 },
  Mangaluru: { latitude: 12.9141, longitude: 74.8560 },
  Hubballi: { latitude: 15.3647, longitude: 75.1240 },
  Belagavi: { latitude: 15.8497, longitude: 74.4977 },
  Shivamogga: { latitude: 13.9299, longitude: 75.5681 },
  Tumakuru: { latitude: 13.3379, longitude: 77.1173 },
};

const WAREHOUSES = [
  { id: 1, name: 'Bengaluru Cold Hub', city: 'Bengaluru', address: '12 Industrial Estate, Bengaluru, Karnataka 560001' },
  { id: 2, name: 'Mysuru Distribution Centre', city: 'Mysuru', address: '18 Industrial Estate, Mysuru, Karnataka 570001' },
  { id: 3, name: 'Mangaluru Cold Storage', city: 'Mangaluru', address: '21 Industrial Estate, Mangaluru, Karnataka 575001' },
  { id: 4, name: 'Hubballi Logistics Hub', city: 'Hubballi', address: '7 Industrial Estate, Hubballi, Karnataka 580020' },
  { id: 5, name: 'Belagavi Cold Store', city: 'Belagavi', address: '9 Industrial Estate, Belagavi, Karnataka 590001' },
  { id: 6, name: 'Shivamogga Distribution', city: 'Shivamogga', address: '14 Industrial Estate, Shivamogga, Karnataka 577201' },
  { id: 7, name: 'Tumakuru Cross-dock', city: 'Tumakuru', address: '5 Industrial Estate, Tumakuru, Karnataka 572101' },
] as const;

const ROUTES = [
  { id: 1, origin: 1, destination: 2, distance: 150, duration: 210 },
  { id: 2, origin: 1, destination: 3, distance: 350, duration: 450 },
  { id: 3, origin: 1, destination: 4, distance: 410, duration: 510 },
  { id: 4, origin: 2, destination: 6, distance: 210, duration: 300 },
  { id: 5, origin: 4, destination: 5, distance: 115, duration: 150 },
  { id: 6, origin: 1, destination: 7, distance: 70, duration: 100 },
] as const;

const warehouseById = new Map<number, (typeof WAREHOUSES)[number]>(WAREHOUSES.map((w) => [w.id, w]));
const routeById = new Map<number, (typeof ROUTES)[number]>(ROUTES.map((r) => [r.id, r]));

const round2 = (value: number) => Math.round(value * 100) / 100;

function headingBetween(from: Coordinates, to: Coordinates): number {
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.round((((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360);
}

type ShipmentRoute = { shipment_id: number; route_id: number; dispatched_at: Date | string | null; status: string };

/** Progressive GPS fixes along each shipment's assigned Karnataka route. */
function buildGpsDocs(shipments: ShipmentRoute[]) {
  const docs: Array<Record<string, unknown>> = [];
  const POINTS = 9;
  for (const shipment of shipments) {
    const route = routeById.get(shipment.route_id);
    const originWarehouse = warehouseById.get(route?.origin ?? -1);
    const destinationWarehouse = warehouseById.get(route?.destination ?? -1);
    if (!route || !originWarehouse || !destinationWarehouse) continue;

    const origin = CITY_COORDS[originWarehouse.city];
    const destination = CITY_COORDS[destinationWarehouse.city];
    // DELIVERED shipments cover the full route; CREATED shipments are parked.
    const maxProgress = shipment.status === 'DELIVERED' ? 1 : shipment.status === 'CREATED' ? 0 : 0.7;
    const startTime = shipment.dispatched_at
      ? new Date(shipment.dispatched_at).getTime()
      : new Date('2026-11-19T18:00:00Z').getTime();
    const pointCount = maxProgress === 0 ? 1 : POINTS;

    for (let i = 0; i < pointCount; i += 1) {
      const progress = round2((i / (pointCount - 1 || 1)) * maxProgress);
      const latitude = round2((origin.latitude + (destination.latitude - origin.latitude) * progress) * 10000) / 10000;
      const longitude = round2((origin.longitude + (destination.longitude - origin.longitude) * progress) * 10000) / 10000;
      const previousProgress = round2(((i - 1 < 0 ? 0 : i - 1) / (pointCount - 1 || 1)) * maxProgress);
      const previous: Coordinates = {
        latitude: origin.latitude + (destination.latitude - origin.latitude) * previousProgress,
        longitude: origin.longitude + (destination.longitude - origin.longitude) * previousProgress,
      };
      docs.push({
        shipment_id: shipment.shipment_id,
        route_id: route.id,
        latitude,
        longitude,
        speed: maxProgress === 0 ? 0 : 35 + ((i * 7) % 36), // 35–70 km/h while moving
        heading: headingBetween(previous, { latitude, longitude }),
        progress,
        source: 'migrate',
        recorded_at: new Date(startTime + Math.round((route.duration * maxProgress * 60000 * i) / (pointCount - 1 || 1))),
      });
    }
  }
  return docs;
}

async function countRows(pool: Pool, table: string, where = ''): Promise<number> {
  const [rows] = await pool.execute(`SELECT COUNT(*) AS n FROM ${table} ${where}`);
  return Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
}

function logTable(name: string, scoped: string, before: number, after: number, note: string) {
  console.log(`   ${name} (${scoped}): before=${before} after=${after} — ${note}`);
}

async function main() {
  console.log('🇮🇳 Karnataka geography migration — starting\n');

  const pool: Pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    database: 'cold_chain',
    waitForConnections: true,
    connectionLimit: 10,
  });
  let mongoConnected = false;

  try {
    // ---- MySQL ---------------------------------------------------------------
    console.log('1️⃣ MySQL (cold_chain)');

    const beforeWarehouses = await countRows(pool, 'WAREHOUSE', 'WHERE warehouse_id BETWEEN 1 AND 7');
    const beforeRoutes = await countRows(pool, 'ROUTE', 'WHERE route_id BETWEEN 1 AND 6');
    const beforeCustomers = await countRows(pool, 'CUSTOMER', 'WHERE customer_id IN (1, 2)');
    const beforeDrivers = await countRows(pool, 'DRIVER', 'WHERE driver_id IN (1, 2)');
    const beforeInactiveDrivers = await countRows(pool, 'USER', 'WHERE user_id IN (5, 6) AND is_active = FALSE');
    const beforeVehicles = await countRows(pool, 'VEHICLE', 'WHERE vehicle_id BETWEEN 1 AND 3');

    for (const warehouse of WAREHOUSES) {
      const coords = CITY_COORDS[warehouse.city];
      await pool.execute(
        'INSERT INTO WAREHOUSE (warehouse_id, name, address, city, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), city = VALUES(city), latitude = VALUES(latitude), longitude = VALUES(longitude)',
        [warehouse.id, warehouse.name, warehouse.address, warehouse.city, coords.latitude, coords.longitude]
      );
    }

    for (const route of ROUTES) {
      await pool.execute(
        'INSERT INTO ROUTE (route_id, origin_warehouse_id, destination_warehouse_id, distance_km, estimated_duration_minutes) VALUES (?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE origin_warehouse_id = VALUES(origin_warehouse_id), destination_warehouse_id = VALUES(destination_warehouse_id), distance_km = VALUES(distance_km), estimated_duration_minutes = VALUES(estimated_duration_minutes)',
        [route.id, route.origin, route.destination, route.distance, route.duration]
      );
    }

    await pool.execute(
      'UPDATE CUSTOMER SET name = CASE customer_id WHEN 1 THEN "FreshFlow Foods" WHEN 2 THEN "Arctic Pharma" END, ' +
        'company_name = CASE customer_id WHEN 1 THEN "FreshFlow Foods Pvt Ltd" WHEN 2 THEN "Arctic Pharma Logistics Pvt Ltd" END, ' +
        'address = CASE customer_id WHEN 1 THEN "12 Industrial Estate, Bengaluru, Karnataka 560001" WHEN 2 THEN "45 Industrial Estate, Mysuru, Karnataka 570001" END, ' +
        'phone = CASE customer_id WHEN 1 THEN "+91-98800-11223" WHEN 2 THEN "+91-98800-44556" END ' +
        'WHERE customer_id IN (1, 2)'
    );

    // DRIVER.user_id is nullable in the live DB: detach demo drivers from
    // login rows so they are profiles only. Keep the FK when it is NOT NULL.
    const [driverColumn] = await pool.execute(
      'SELECT IS_NULLABLE AS is_nullable FROM information_schema.COLUMNS ' +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DRIVER' AND COLUMN_NAME = 'user_id'"
    ) as [Array<{ is_nullable: string }>, unknown];
    const driverUserNullable = driverColumn.length > 0 && driverColumn[0].is_nullable === 'YES';
    const detachUsers = driverUserNullable ? ', user_id = NULL' : '';
    await pool.execute(
      `UPDATE DRIVER SET name = CASE driver_id WHEN 1 THEN "Ramesh Kumar" WHEN 2 THEN "Suresh Naik" END, ` +
        `license_no = CASE driver_id WHEN 1 THEN "KA-01-20190012345" WHEN 2 THEN "KA-02-20190067890" END, ` +
        `phone = CASE driver_id WHEN 1 THEN "+91-98450-11223" WHEN 2 THEN "+91-98450-44556" END${detachUsers} ` +
        'WHERE driver_id IN (1, 2)'
    );

    // Driver rows are profiles, never active login accounts. The username guard
    // avoids deactivating an unrelated user who happens to hold id 5 or 6.
    await pool.execute(
      "UPDATE USER SET is_active = FALSE WHERE user_id IN (5, 6) AND username IN ('driver1', 'driver2')"
    );

    await pool.execute(
      'UPDATE VEHICLE SET reg_no = CASE vehicle_id ' +
        'WHEN 1 THEN "KA-01-AB-1234" WHEN 2 THEN "KA-02-CD-5678" WHEN 3 THEN "KA-03-EF-9012" END ' +
        'WHERE vehicle_id IN (1, 2, 3)'
    );

    const [shipmentRows] = await pool.execute(
      'SELECT shipment_id, route_id, dispatched_at, status FROM SHIPMENT WHERE shipment_id BETWEEN 1 AND 5 ORDER BY shipment_id'
    ) as [ShipmentRoute[], unknown];

    logTable('WAREHOUSE', 'ids 1..7', beforeWarehouses, await countRows(pool, 'WAREHOUSE', 'WHERE warehouse_id BETWEEN 1 AND 7'), '7 Karnataka warehouses upserted');
    logTable('ROUTE', 'ids 1..6', beforeRoutes, await countRows(pool, 'ROUTE', 'WHERE route_id BETWEEN 1 AND 6'), '6 Karnataka routes upserted');
    logTable('CUSTOMER', 'ids 1,2', beforeCustomers, await countRows(pool, 'CUSTOMER', 'WHERE customer_id IN (1, 2)'), 'Indian names/addresses/+91 phones');
    logTable('DRIVER', 'ids 1,2', beforeDrivers, await countRows(pool, 'DRIVER', 'WHERE driver_id IN (1, 2)'), `Indian names/licenses/phones; user_id detached=${driverUserNullable}`);
    logTable('USER', 'ids 5,6 inactive', beforeInactiveDrivers, await countRows(pool, 'USER', 'WHERE user_id IN (5, 6) AND is_active = FALSE'), 'driver1/driver2 deactivated (no login)');
    logTable('VEHICLE', 'ids 1..3', beforeVehicles, await countRows(pool, 'VEHICLE', 'WHERE vehicle_id BETWEEN 1 AND 3'), 'KA registration numbers');

    // ---- MongoDB -------------------------------------------------------------
    console.log('\n2️⃣ MongoDB (cold_chain_monitoring)');
    await mongoose.connect(MONGO_URI);
    mongoConnected = true;
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB connection has no database');

    const collectionNames = new Set((await db.listCollections().toArray()).map((c) => c.name));
    const targetCollections = ['sensor_readings', 'alerts', 'gps_telemetry', 'monitoring_logs'] as const;
    const beforeTotals: Record<string, number> = {};
    for (const name of targetCollections) {
      beforeTotals[name] = collectionNames.has(name) ? await db.collection(name).countDocuments({}) : 0;
    }
    const foreignGpsBefore = collectionNames.has('gps_telemetry')
      ? await db.collection('gps_telemetry').countDocuments({ $or: [{ latitude: { $gt: 40 } }, { longitude: { $lt: 0 } }, { shipment_id: 1001 }] })
      : 0;
    const demoOtherBefore: Record<string, number> = {};
    for (const name of ['alerts', 'sensor_readings', 'monitoring_logs'] as const) {
      demoOtherBefore[name] = collectionNames.has(name)
        ? await db.collection(name).countDocuments({ shipment_id: 1001 })
        : 0;
    }
    console.log(`   Foreign/demo docs before: gps_telemetry=${foreignGpsBefore}, alerts=${demoOtherBefore.alerts}, sensor_readings=${demoOtherBefore.sensor_readings}, monitoring_logs=${demoOtherBefore.monitoring_logs}`);

    let deletedGps = 0;
    if (collectionNames.has('gps_telemetry')) {
      const result = await db.collection('gps_telemetry').deleteMany({
        $or: [{ latitude: { $gt: 40 } }, { longitude: { $lt: 0 } }, { shipment_id: 1001 }],
      });
      deletedGps = result.deletedCount;
    }
    const deletedByCollection: Record<string, number> = { gps_telemetry: deletedGps };
    for (const name of ['alerts', 'sensor_readings', 'monitoring_logs'] as const) {
      if (!collectionNames.has(name)) {
        deletedByCollection[name] = 0;
        continue;
      }
      const result = await db.collection(name).deleteMany({ shipment_id: 1001 });
      deletedByCollection[name] = result.deletedCount;
    }

    if (!collectionNames.has('gps_telemetry')) await db.createCollection('gps_telemetry');
    const gpsDocs = buildGpsDocs(shipmentRows);
    let insertedGps = 0;
    for (const doc of gpsDocs) {
      const result = await db.collection('gps_telemetry').updateOne(
        { shipment_id: doc.shipment_id, route_id: doc.route_id, progress: doc.progress, source: 'migrate' },
        { $setOnInsert: doc },
        { upsert: true }
      );
      insertedGps += result.upsertedCount;
    }

    // Same indexes as the seed script (including the guarded partial unique
    // OPEN-alert index) so the demo behaves consistently after migration.
    for (const name of ['sensor_readings', 'alerts', 'gps_telemetry', 'monitoring_logs']) {
      if (!collectionNames.has(name)) await db.createCollection(name);
    }
    await db.collection('sensor_readings').createIndex({ shipment_id: 1, timestamp: -1 });
    await db.collection('alerts').createIndex({ shipment_id: 1, status: 1 });
    await db.collection('gps_telemetry').createIndex({ shipment_id: 1, recorded_at: -1 });
    await db.collection('gps_telemetry').createIndex({ shipment_id: 1, route_id: 1, progress: 1 });
    await db.collection('monitoring_logs').createIndex({ shipment_id: 1, event_type: 1 });
    try {
      await db.collection('alerts').createIndex(
        { shipment_id: 1, alert_type: 1 },
        { name: 'uniq_open_alert_per_shipment_type', unique: true, partialFilterExpression: { status: 'OPEN' } }
      );
    } catch (error) {
      console.warn(`   ⚠️  Could not create partial unique OPEN-alert index: ${(error as Error).message}`);
    }

    for (const name of targetCollections) {
      const after = await db.collection(name).countDocuments({});
      const renamed = name === 'gps_telemetry' ? `${name} (deleted foreign/demo=${deletedGps}, inserted progressive=${insertedGps})` : `${name} (deleted demo 1001=${deletedByCollection[name]})`;
      console.log(`   ${renamed}: before=${beforeTotals[name]} after=${after}`);
    }
    const foreignGpsAfter = await db.collection('gps_telemetry').countDocuments({ $or: [{ latitude: { $gt: 40 } }, { longitude: { $lt: 0 } }, { shipment_id: 1001 }] });
    console.log(`   Foreign/demo GPS docs remaining: ${foreignGpsAfter}`);

    console.log('\n✅ Karnataka migration complete (all other rows/documents preserved).');
  } finally {
    await pool.end();
    if (mongoConnected) await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
