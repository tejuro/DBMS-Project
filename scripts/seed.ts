/// Seed Script — Smart Cold-Chain Logistics Monitoring System
/// Populates MySQL and MongoDB with Karnataka-only demo data for all three roles.
/// Run with: npx ts-node scripts/seed.ts
///
/// Idempotence: fixed-ID demo rows use INSERT IGNORE or INSERT ... ON DUPLICATE KEY
/// UPDATE. No DELETE / DROP / TRUNCATE is performed, so genuine user rows are kept.
/// The demo-managed IDs are 1..7 (warehouses), 1..6 (routes), 1..5 (shipments),
/// 1..3 (vehicles/customers/products), 1..2 (drivers) and 1..6 (users).
///
/// Driver/FK decision: the live MySQL DRIVER.user_id column is NULLABLE
/// (verified with information_schema), so drivers 1..2 are seeded with
/// user_id = NULL and NO driver login accounts are created. If a deployment uses
/// the stricter Prisma schema (DRIVER.user_id required), USER 5/6 are inserted
/// as inactive placeholders instead. Either way username driver1/driver2 is
/// forced is_active = FALSE, so drivers never become login accounts.

import mysql, { type Pool } from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cold_chain_monitoring';
const CREATED_AT = '2026-11-19T18:00:00Z';

type Coordinates = { latitude: number; longitude: number };

/** Exact Karnataka coordinates — used for warehouses and interpolated GPS tracks. */
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

/** Route IDs are fixed so the GPS simulator can reference the same corridors. */
const ROUTES = [
  { id: 1, origin: 1, destination: 2, distance: 150, duration: 210 }, // Bengaluru → Mysuru
  { id: 2, origin: 1, destination: 3, distance: 350, duration: 450 }, // Bengaluru → Mangaluru
  { id: 3, origin: 1, destination: 4, distance: 410, duration: 510 }, // Bengaluru → Hubballi
  { id: 4, origin: 2, destination: 6, distance: 210, duration: 300 }, // Mysuru → Shivamogga
  { id: 5, origin: 4, destination: 5, distance: 115, duration: 150 }, // Hubballi → Belagavi
  { id: 6, origin: 1, destination: 7, distance: 70, duration: 100 }, // Bengaluru → Tumakuru
] as const;

type SeedShipment = {
  id: number;
  customerId: number;
  createdBy: number;
  routeId: number;
  vehicleId: number;
  driverId: number | null;
  status: string;
  riskStatus: string;
  dispatchedAt: string | null;
  expectedDelivery: string | null;
  deliveredAt: string | null;
  /** Fraction of the route already covered — drives progressive GPS points. */
  maxProgress: number;
};

const SHIPMENTS: SeedShipment[] = [
  { id: 1, customerId: 1, createdBy: 1, routeId: 1, vehicleId: 1, driverId: 1, status: 'DELIVERED', riskStatus: 'LOW', dispatchedAt: '2026-11-16T08:00:00Z', expectedDelivery: '2026-11-16T12:00:00Z', deliveredAt: '2026-11-16T11:45:00Z', maxProgress: 1 },
  { id: 2, customerId: 1, createdBy: 2, routeId: 2, vehicleId: 2, driverId: 2, status: 'IN_TRANSIT', riskStatus: 'MEDIUM', dispatchedAt: '2026-11-18T08:00:00Z', expectedDelivery: '2026-11-18T16:30:00Z', deliveredAt: null, maxProgress: 0.65 },
  { id: 3, customerId: 2, createdBy: 1, routeId: 3, vehicleId: 1, driverId: 1, status: 'DELAYED', riskStatus: 'HIGH', dispatchedAt: '2026-11-17T09:00:00Z', expectedDelivery: '2026-11-17T18:30:00Z', deliveredAt: null, maxProgress: 0.45 },
  { id: 4, customerId: 2, createdBy: 2, routeId: 4, vehicleId: 3, driverId: 2, status: 'OUT_FOR_DELIVERY', riskStatus: 'CRITICAL', dispatchedAt: '2026-11-19T06:00:00Z', expectedDelivery: '2026-11-19T11:30:00Z', deliveredAt: null, maxProgress: 0.85 },
  { id: 5, customerId: 1, createdBy: 2, routeId: 1, vehicleId: 1, driverId: null, status: 'CREATED', riskStatus: 'LOW', dispatchedAt: null, expectedDelivery: null, deliveredAt: null, maxProgress: 0 },
];

type GpsDoc = {
  shipment_id: number;
  route_id: number;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  progress: number;
  source: 'seed';
  recorded_at: Date;
};

const warehouseById = new Map<number, (typeof WAREHOUSES)[number]>(WAREHOUSES.map((w) => [w.id, w]));
const routeById = new Map<number, (typeof ROUTES)[number]>(ROUTES.map((r) => [r.id, r]));

const round2 = (value: number) => Math.round(value * 100) / 100;

/** MySQL DATETIME columns need 'YYYY-MM-DD HH:MM:SS', not ISO 8601 'T'/'Z'. */
const mysqlDateTime = (iso: string | null): string | null =>
  iso ? new Date(iso).toISOString().replace('T', ' ').replace('Z', '') : null;

/** Compass bearing (degrees) from one coordinate to the next. */
function headingBetween(from: Coordinates, to: Coordinates): number {
  const dLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const dLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.round((((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360);
}

/** Deterministic, progressive GPS fixes along the shipment's assigned route. */
function buildGpsHistory(): GpsDoc[] {
  const docs: GpsDoc[] = [];
  const POINTS = 9;
  for (const shipment of SHIPMENTS) {
    const route = routeById.get(shipment.routeId);
    const originWarehouse = warehouseById.get(route?.origin ?? 1);
    const destinationWarehouse = warehouseById.get(route?.destination ?? 1);
    if (!route || !originWarehouse || !destinationWarehouse) continue;

    const origin = CITY_COORDS[originWarehouse.city];
    const destination = CITY_COORDS[destinationWarehouse.city];
    const startTime = new Date(shipment.dispatchedAt ?? CREATED_AT).getTime();
    const totalMinutes = route.duration * shipment.maxProgress;

    for (let i = 0; i < POINTS; i += 1) {
      const progress = round2((i / (POINTS - 1)) * shipment.maxProgress);
      const latitude = round2((origin.latitude + (destination.latitude - origin.latitude) * progress) * 10000) / 10000;
      const longitude = round2((origin.longitude + (destination.longitude - origin.longitude) * progress) * 10000) / 10000;
      const previous: Coordinates = i === 0
        ? origin
        : {
            latitude: origin.latitude + (destination.latitude - origin.latitude) * round2(((i - 1) / (POINTS - 1)) * shipment.maxProgress),
            longitude: origin.longitude + (destination.longitude - origin.longitude) * round2(((i - 1) / (POINTS - 1)) * shipment.maxProgress),
          };
      const current: Coordinates = { latitude, longitude };
      docs.push({
        shipment_id: shipment.id,
        route_id: route.id,
        latitude,
        longitude,
        // Moving fixes stay in the realistic 35–70 km/h band. A CREATED
        // shipment is parked at the origin, hence speed 0 for that single fix.
        speed: shipment.maxProgress === 0 ? 0 : 35 + ((i * 7) % 36),
        heading: headingBetween(previous, current),
        progress,
        source: 'seed',
        recorded_at: new Date(startTime + Math.round((totalMinutes * 60000 * i) / (POINTS - 1))),
      });
    }
  }
  return docs;
}

async function main() {
  console.log('🌱 Starting seed process (Karnataka demo data)...\n');

  const pool: Pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    database: 'cold_chain',
    waitForConnections: true,
    connectionLimit: 10,
  });

  let mongoConnected = false;
  try {
    // 1. MySQL -----------------------------------------------------------------
    console.log('1️⃣ Setting up MySQL...');
    const passwordHash = await bcrypt.hash('123456', 10);

    await pool.execute(
      'INSERT IGNORE INTO ROLE (role_id, role_name, is_active) VALUES (1, "ADMIN", TRUE), (2, "DISPATCHER", TRUE), (3, "CUSTOMER", TRUE)'
    );

    // Fixed login accounts — all use password 123456.
    await pool.execute(
      'INSERT IGNORE INTO USER (user_id, role_id, username, email, password_hash, is_active) VALUES ' +
        '(1, 1, "admin", "admin@coldchain.com", ?, TRUE), ' +
        '(2, 2, "dispatcher", "dispatcher@coldchain.com", ?, TRUE), ' +
        '(3, 3, "customer1", "customer1@coldchain.com", ?, TRUE), ' +
        '(4, 3, "customer2", "customer2@coldchain.com", ?, TRUE)',
      [passwordHash, passwordHash, passwordHash, passwordHash]
    );

    await pool.execute(
      'INSERT INTO CUSTOMER (customer_id, user_id, name, company_name, address, phone) VALUES ' +
        '(1, 3, "FreshFlow Foods", "FreshFlow Foods Pvt Ltd", "12 Industrial Estate, Bengaluru, Karnataka 560001", "+91-98800-11223"), ' +
        '(2, 4, "Arctic Pharma", "Arctic Pharma Logistics Pvt Ltd", "45 Industrial Estate, Mysuru, Karnataka 570001", "+91-98800-44556") ' +
        'ON DUPLICATE KEY UPDATE name = VALUES(name), company_name = VALUES(company_name), address = VALUES(address), phone = VALUES(phone)'
    );

    // Check whether DRIVER.user_id really allows NULL in this deployment.
    const [driverColumn] = await pool.execute(
      'SELECT IS_NULLABLE AS is_nullable FROM information_schema.COLUMNS ' +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DRIVER' AND COLUMN_NAME = 'user_id'"
    ) as [Array<{ is_nullable: string }>, unknown];
    const driverUserNullable = driverColumn.length > 0 && driverColumn[0].is_nullable === 'YES';

    if (!driverUserNullable) {
      // Legacy FK only: inactive placeholders, never working logins.
      await pool.execute(
        'INSERT IGNORE INTO USER (user_id, role_id, username, email, password_hash, is_active) VALUES ' +
          '(5, 2, "driver1", "driver1@coldchain.com", ?, FALSE), ' +
          '(6, 2, "driver2", "driver2@coldchain.com", ?, FALSE)',
        [passwordHash, passwordHash]
      );
    }
    // Defensive: demote any existing driver login rows (including legacy ids 5/6).
    await pool.execute("UPDATE USER SET is_active = FALSE WHERE username IN ('driver1', 'driver2') OR user_id IN (5, 6)");

    const driverSql = driverUserNullable
      ? 'INSERT INTO DRIVER (driver_id, user_id, name, license_no, phone, status) VALUES ' +
        '(1, NULL, "Ramesh Kumar", "KA-01-20190012345", "+91-98450-11223", "AVAILABLE"), ' +
        '(2, NULL, "Suresh Naik", "KA-02-20190067890", "+91-98450-44556", "BUSY") ' +
        'ON DUPLICATE KEY UPDATE user_id = NULL, name = VALUES(name), license_no = VALUES(license_no), phone = VALUES(phone), status = VALUES(status)'
      : 'INSERT INTO DRIVER (driver_id, user_id, name, license_no, phone, status) VALUES ' +
        '(1, 5, "Ramesh Kumar", "KA-01-20190012345", "+91-98450-11223", "AVAILABLE"), ' +
        '(2, 6, "Suresh Naik", "KA-02-20190067890", "+91-98450-44556", "BUSY") ' +
        'ON DUPLICATE KEY UPDATE name = VALUES(name), license_no = VALUES(license_no), phone = VALUES(phone), status = VALUES(status)';
    await pool.execute(driverSql);

    await pool.execute(
      'INSERT INTO VEHICLE (vehicle_id, reg_no, vehicle_type, capacity_kg, status) VALUES ' +
        '(1, "KA-01-AB-1234", "Reefer Truck", 5000, "AVAILABLE"), ' +
        '(2, "KA-02-CD-5678", "Insulated Van", 2000, "AVAILABLE"), ' +
        '(3, "KA-03-EF-9012", "Cargo Container", 10000, "MAINTENANCE") ' +
        'ON DUPLICATE KEY UPDATE reg_no = VALUES(reg_no), vehicle_type = VALUES(vehicle_type), capacity_kg = VALUES(capacity_kg), status = VALUES(status)'
    );

    for (const warehouse of WAREHOUSES) {
      const coords = CITY_COORDS[warehouse.city];
      await pool.execute(
        'INSERT INTO WAREHOUSE (warehouse_id, name, address, city, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), city = VALUES(city), latitude = VALUES(latitude), longitude = VALUES(longitude)',
        [warehouse.id, warehouse.name, warehouse.address, warehouse.city, coords.latitude, coords.longitude]
      );
    }

    await pool.execute(
      'INSERT IGNORE INTO PRODUCT (product_id, name, category, min_temp_c, max_temp_c, min_humidity, max_humidity) VALUES ' +
        '(1, "Vaccines", "Pharmaceutical", 2, 8, 30, 70), ' +
        '(2, "Frozen Food", "Food", -20, -15, 40, 60), ' +
        '(3, "Fresh Produce", "Food", 4, 10, 60, 80), ' +
        '(4, "Pharmaceuticals", "Pharmaceutical", 15, 25, 40, 60)'
    );

    for (const route of ROUTES) {
      await pool.execute(
        'INSERT INTO ROUTE (route_id, origin_warehouse_id, destination_warehouse_id, distance_km, estimated_duration_minutes) VALUES (?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE origin_warehouse_id = VALUES(origin_warehouse_id), destination_warehouse_id = VALUES(destination_warehouse_id), distance_km = VALUES(distance_km), estimated_duration_minutes = VALUES(estimated_duration_minutes)',
        [route.id, route.origin, route.destination, route.distance, route.duration]
      );
    }

    for (const shipment of SHIPMENTS) {
      await pool.execute(
        'INSERT INTO SHIPMENT (shipment_id, customer_id, created_by, route_id, vehicle_id, driver_id, status, risk_status, dispatched_at, expected_delivery, delivered_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE customer_id = VALUES(customer_id), created_by = VALUES(created_by), route_id = VALUES(route_id), vehicle_id = VALUES(vehicle_id), driver_id = VALUES(driver_id), status = VALUES(status), risk_status = VALUES(risk_status), dispatched_at = VALUES(dispatched_at), expected_delivery = VALUES(expected_delivery), delivered_at = VALUES(delivered_at)',
        [
          shipment.id, shipment.customerId, shipment.createdBy, shipment.routeId, shipment.vehicleId,
          shipment.driverId, shipment.status, shipment.riskStatus, mysqlDateTime(shipment.dispatchedAt),
          mysqlDateTime(shipment.expectedDelivery), mysqlDateTime(shipment.deliveredAt),
        ]
      );
    }

    await pool.execute(
      'INSERT IGNORE INTO SHIPMENT_ITEM (shipment_id, product_id, quantity) VALUES ' +
        '(1, 1, 100), (1, 4, 50), (2, 1, 200), (2, 3, 150), (3, 2, 80), (4, 2, 300), (4, 1, 120), (5, 3, 200)'
    );

    // Explicit history_id values keep this INSERT IGNORE idempotent on re-runs.
    await pool.execute(
      'INSERT IGNORE INTO SHIPMENT_STATUS_HISTORY (history_id, shipment_id, changed_by, old_status, new_status, changed_at, remarks) VALUES ' +
        '(1, 1, 1, NULL, "CREATED", "2026-11-16 07:30:00", "Shipment created in Bengaluru"), ' +
        '(2, 1, 1, "CREATED", "CONFIRMED", "2026-11-16 07:45:00", "Shipment confirmed for dispatch"), ' +
        '(3, 1, 1, "CONFIRMED", "IN_TRANSIT", "2026-11-16 08:00:00", "Dispatched from Bengaluru Cold Hub"), ' +
        '(4, 1, 1, "IN_TRANSIT", "DELIVERED", "2026-11-16 11:45:00", "Delivered at Mysuru Distribution Centre"), ' +
        '(5, 2, 2, NULL, "CREATED", "2026-11-18 07:30:00", "Shipment created in Bengaluru"), ' +
        '(6, 2, 2, "CREATED", "IN_TRANSIT", "2026-11-18 08:00:00", "Dispatched towards Mangaluru"), ' +
        '(7, 3, 1, NULL, "CREATED", "2026-11-17 08:30:00", "Shipment created in Bengaluru"), ' +
        '(8, 3, 1, "CREATED", "IN_TRANSIT", "2026-11-17 09:00:00", "Dispatched towards Hubballi"), ' +
        '(9, 3, 1, "IN_TRANSIT", "DELAYED", "2026-11-17 14:00:00", "Delayed on the Bengaluru-Hubballi route"), ' +
        '(11, 4, 2, NULL, "CREATED", "2026-11-19 05:30:00", "Shipment created in Mysuru"), ' +
        '(12, 4, 2, "CREATED", "IN_TRANSIT", "2026-11-19 06:00:00", "Dispatched towards Shivamogga"), ' +
        '(13, 4, 2, "IN_TRANSIT", "OUT_FOR_DELIVERY", "2026-11-19 10:30:00", "Out for delivery in Shivamogga"), ' +
        '(14, 5, 2, NULL, "CREATED", "2026-11-19 18:00:00", "Shipment created at Bengaluru Cold Hub")'
    );
    console.log('   ✅ MySQL seeded (Karnataka warehouses, routes, vehicles, drivers, shipments)');

    // 2. MongoDB ---------------------------------------------------------------
    console.log('\n2️⃣ Setting up MongoDB...');
    await mongoose.connect(MONGO_URI);
    mongoConnected = true;
    const db = mongoose.connection.db;
    if (!db) throw new Error('MongoDB connection has no database');

    const collectionNames = new Set((await db.listCollections().toArray()).map((c) => c.name));
    for (const name of ['sensor_readings', 'alerts', 'gps_telemetry', 'monitoring_logs']) {
      if (!collectionNames.has(name)) await db.createCollection(name);
    }

    await db.collection('sensor_readings').createIndex({ shipment_id: 1, timestamp: -1 });
    await db.collection('sensor_readings').createIndex({ sensor_id: 1, timestamp: -1 });
    await db.collection('alerts').createIndex({ shipment_id: 1, status: 1 });
    await db.collection('alerts').createIndex({ detected_at: -1, status: 1 });
    await db.collection('gps_telemetry').createIndex({ shipment_id: 1, recorded_at: -1 });
    await db.collection('gps_telemetry').createIndex({ shipment_id: 1, route_id: 1, progress: 1 });
    await db.collection('monitoring_logs').createIndex({ created_at: -1 });
    await db.collection('monitoring_logs').createIndex({ shipment_id: 1, event_type: 1 });

    // Only one OPEN alert per (shipment, alert_type). Partial index ignores
    // RESOLVED/already-closed alerts. Skipped with a warning if legacy
    // duplicate OPEN alerts exist (the migration script can clean those).
    try {
      await db.collection('alerts').createIndex(
        { shipment_id: 1, alert_type: 1 },
        {
          name: 'uniq_open_alert_per_shipment_type',
          unique: true,
          partialFilterExpression: { status: 'OPEN' },
        }
      );
    } catch (error) {
      console.warn('   ⚠️  Could not create partial unique OPEN-alert index:', (error as Error).message);
    }

    // One sensor reading cannot satisfy incompatible multi-product ranges, so
    // seed readings use the first product of each shipment as the reference.
    const referenceProductByShipment: Record<number, { product_id: number; product_name: string }> = {
      1: { product_id: 1, product_name: 'Vaccines' },
      2: { product_id: 1, product_name: 'Vaccines' },
      3: { product_id: 2, product_name: 'Frozen Food' },
      4: { product_id: 1, product_name: 'Vaccines' },
      5: { product_id: 3, product_name: 'Fresh Produce' },
    };
    const sensorReadings = [
      { shipment_id: 1, sensor_id: 'TEMP-001', temperature: 3.5, humidity: 55.2, timestamp: new Date('2026-11-16T09:00:00Z') },
      { shipment_id: 1, sensor_id: 'HUM-001', temperature: 3.2, humidity: 52.8, timestamp: new Date('2026-11-16T10:00:00Z') },
      { shipment_id: 2, sensor_id: 'TEMP-002', temperature: 4.2, humidity: 58.5, timestamp: new Date('2026-11-18T09:00:00Z') },
      { shipment_id: 2, sensor_id: 'TEMP-003', temperature: 6.8, humidity: 51.2, timestamp: new Date('2026-11-18T12:00:00Z') },
      { shipment_id: 3, sensor_id: 'TEMP-004', temperature: -12.5, humidity: 45.0, timestamp: new Date('2026-11-17T15:00:00Z') },
      { shipment_id: 4, sensor_id: 'TEMP-005', temperature: -10.2, humidity: 55.3, timestamp: new Date('2026-11-19T07:00:00Z') },
      { shipment_id: 4, sensor_id: 'HUM-002', temperature: -9.8, humidity: 30.0, timestamp: new Date('2026-11-19T09:00:00Z') },
    ].map((reading) => ({
      ...reading,
      ...(referenceProductByShipment[reading.shipment_id] ?? { product_id: null, product_name: null }),
      source: 'seed',
    }));
    for (const reading of sensorReadings) {
      await db.collection('sensor_readings').updateOne(
        { shipment_id: reading.shipment_id, sensor_id: reading.sensor_id, timestamp: reading.timestamp },
        { $setOnInsert: reading },
        { upsert: true }
      );
    }

    const alerts = [
      { shipment_id: 3, alert_type: 'TEMPERATURE', severity: 'HIGH', message: 'Temperature above permitted maximum', detected_at: new Date('2026-11-17T15:30:00Z'), status: 'RESOLVED', resolved_at: new Date('2026-11-18T10:00:00Z') },
      { shipment_id: 4, alert_type: 'TEMPERATURE', severity: 'CRITICAL', message: 'Temperature below minimum threshold', detected_at: new Date('2026-11-19T07:30:00Z'), status: 'OPEN', resolved_at: null },
      { shipment_id: 4, alert_type: 'HUMIDITY', severity: 'MEDIUM', message: 'Humidity below minimum threshold', detected_at: new Date('2026-11-19T09:30:00Z'), status: 'OPEN', resolved_at: null },
      { shipment_id: 2, alert_type: 'ROUTINE', severity: 'LOW', message: 'Routine temperature check', detected_at: new Date('2026-11-18T10:00:00Z'), status: 'RESOLVED', resolved_at: new Date('2026-11-18T10:30:00Z') },
    ];
    for (const alert of alerts) {
      await db.collection('alerts').updateOne(
        { shipment_id: alert.shipment_id, alert_type: alert.alert_type, detected_at: alert.detected_at },
        { $setOnInsert: alert },
        { upsert: true }
      );
    }

    for (const gps of buildGpsHistory()) {
      await db.collection('gps_telemetry').updateOne(
        { shipment_id: gps.shipment_id, route_id: gps.route_id, progress: gps.progress, source: gps.source },
        { $setOnInsert: gps },
        { upsert: true }
      );
    }

    const monitoringLogs = [
      { event_type: 'SYSTEM_START', shipment_id: 1, message: 'Monitoring system initialized for Karnataka routes', metadata: { source: 'seed' }, created_at: new Date('2026-11-19T12:00:00Z') },
      { event_type: 'TEMPERATURE_CHECK', shipment_id: 2, message: 'Temperature reading within range', metadata: { sensor: 'TEMP-002', source: 'seed' }, created_at: new Date('2026-11-19T12:05:00Z') },
      { event_type: 'ALERT_GENERATED', shipment_id: 4, message: 'Critical temperature violation detected', metadata: { severity: 'CRITICAL', source: 'seed' }, created_at: new Date('2026-11-19T12:10:00Z') },
    ];
    for (const log of monitoringLogs) {
      await db.collection('monitoring_logs').updateOne(
        { shipment_id: log.shipment_id, event_type: log.event_type, created_at: log.created_at },
        { $setOnInsert: log },
        { upsert: true }
      );
    }

    console.log('   ✅ MongoDB collections, indexes and Karnataka telemetry seeded');
    console.log('\n🌱 Seed complete!');
  } finally {
    await pool.end();
    if (mongoConnected) await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('❌ Seed failed:', error);
  process.exit(1);
});
