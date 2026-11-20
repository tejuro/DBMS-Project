import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { getMongoDb } from "@/lib/mongo";
import { getSessionUser, canAccessShipment } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Shared module-level pool. Route modules are long-lived: never call `.end()`
 * here, or the next request in the same process would fail with "pool closed".
 */
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "cold_chain",
  waitForConnections: true,
  connectionLimit: 10,
});

type MongoDb = Awaited<ReturnType<typeof getMongoDb>>;
type Session = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
type JsonDoc = Record<string, any>;

interface ProductThreshold {
  shipment_id: number;
  product_id: number;
  name: string;
  min_temp_c: number;
  max_temp_c: number;
  min_humidity: number;
  max_humidity: number;
  reference?: boolean;
}

interface ReadingView {
  id: string | null;
  shipment_id: number;
  sensor_id: string;
  temperature: number;
  humidity: number;
  timestamp: string;
  source: string;
  product_id: number | null;
  product_name: string | null;
}

interface AlertView {
  id: string | null;
  shipment_id: number;
  alert_type: string;
  severity: string;
  message: string;
  status: string;
  detected_at: string;
  acknowledged_at: string | null;
  last_detected_at: string | null;
  resolved_at: string | null;
  product_id: number | null;
  product_name: string | null;
  source: string;
}

const SEVERITY_RANK: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

let alertIndexPromise: Promise<void> | null = null;

function toNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  return null;
}

function isCustomer(user: Session): boolean {
  const role = (user as { role?: unknown } | null)?.role;
  return typeof role === "string" && role.toUpperCase() === "CUSTOMER";
}

function serializeReading(doc: JsonDoc | null | undefined): ReadingView {
  const reading = doc ?? {};
  return {
    id: reading._id?.toString?.() ?? (typeof reading.id === "string" ? reading.id : null),
    shipment_id: toNumber(reading.shipment_id),
    sensor_id: typeof reading.sensor_id === "string" ? reading.sensor_id : "UNKNOWN",
    temperature: toNumber(reading.temperature),
    humidity: toNumber(reading.humidity),
    timestamp: toIso(reading.timestamp) ?? "",
    source: typeof reading.source === "string" ? reading.source : "seed",
    product_id: reading.product_id == null ? null : toNumber(reading.product_id),
    product_name: typeof reading.product_name === "string" ? reading.product_name : null,
  };
}

function serializeAlert(doc: JsonDoc | null | undefined): AlertView {
  const alert = doc ?? {};
  return {
    id: alert._id?.toString?.() ?? (typeof alert.id === "string" ? alert.id : null),
    shipment_id: toNumber(alert.shipment_id),
    alert_type: typeof alert.alert_type === "string" ? alert.alert_type : "UNKNOWN",
    severity: typeof alert.severity === "string" ? alert.severity : "LOW",
    message: typeof alert.message === "string" ? alert.message : "",
    status: typeof alert.status === "string" ? alert.status : "OPEN",
    detected_at:
      toIso(alert.detected_at) ?? toIso(alert.created_at) ?? "",
    acknowledged_at: toIso(alert.acknowledged_at),
    last_detected_at: toIso(alert.last_detected_at),
    resolved_at: toIso(alert.resolved_at),
    product_id: alert.product_id == null ? null : toNumber(alert.product_id),
    product_name: typeof alert.product_name === "string" ? alert.product_name : null,
    source: typeof alert.source === "string" ? alert.source : "seed",
  };
}

function toThreshold(row: JsonDoc, reference = false): ProductThreshold {
  return {
    shipment_id: toNumber(row.shipment_id),
    product_id: toNumber(row.product_id),
    name: typeof row.name === "string" ? row.name : `Product ${toNumber(row.product_id)}`,
    min_temp_c: toNumber(row.min_temp_c),
    max_temp_c: toNumber(row.max_temp_c),
    min_humidity: toNumber(row.min_humidity),
    max_humidity: toNumber(row.max_humidity),
    reference,
  };
}

async function loadThresholds(shipmentId?: number): Promise<ProductThreshold[]> {
  const params: number[] = [];
  const where = shipmentId != null ? "WHERE si.shipment_id = ?" : "";
  if (shipmentId != null) params.push(shipmentId);

  const [rows] = await pool.execute(
    `SELECT si.shipment_id, p.product_id, p.name, p.min_temp_c, p.max_temp_c,
            p.min_humidity, p.max_humidity
       FROM SHIPMENT_ITEM si
       JOIN PRODUCT p ON p.product_id = si.product_id
       ${where}
      ORDER BY si.shipment_id, p.product_id`,
    params
  );

  const seenShipments = new Set<number>();
  return (rows as JsonDoc[]).map((row) => {
    const shipment = toNumber(row.shipment_id);
    // The first product for each shipment is the reference used by the simulator.
    const reference = !seenShipments.has(shipment);
    seenShipments.add(shipment);
    return toThreshold(row, reference);
  });
}

async function loadRiskStatus(shipmentId: number | null): Promise<string | null> {
  if (shipmentId == null) return null;
  const [rows] = await pool.execute(
    "SELECT risk_status FROM SHIPMENT WHERE shipment_id = ?",
    [shipmentId]
  );
  const row = (rows as JsonDoc[])[0];
  return row ? String(row.risk_status ?? "LOW") : null;
}

/**
 * CUSTOMERs only ever receive their own shipments. A null/empty result means
 * "nothing accessible"; authorization for an explicit shipment id is checked
 * separately before this is called.
 */
async function getVisibleShipmentIds(
  user: Session,
  requestedId: number | null
): Promise<number[]> {
  const [rows] = await pool.execute(
    "SELECT shipment_id FROM SHIPMENT ORDER BY shipment_id"
  );
  const allIds = (rows as JsonDoc[])
    .map((row) => toNumber(row.shipment_id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!isCustomer(user)) return requestedId != null ? [requestedId] : allIds;
  if (requestedId != null) return [requestedId];

  const checks = await Promise.all(
    allIds.map((id) => canAccessShipment(user, id).catch(() => false))
  );
  return allIds.filter((_, index) => checks[index]);
}

/**
 * Partial unique index: at most one OPEN alert per shipment/type among alerts
 * created by this simulator. Existing seed alerts (which have no dedupe_key)
 * are deliberately excluded so the index can be created even when legacy
 * duplicate seed rows are present.
 */
async function ensureAlertIndexes(db: MongoDb): Promise<void> {
  if (!alertIndexPromise) {
    alertIndexPromise = db
      .collection("alerts")
      .createIndex(
        { shipment_id: 1, alert_type: 1, dedupe_key: 1 },
        {
          name: "unique_open_simulator_alerts",
          unique: true,
          partialFilterExpression: {
            status: "OPEN",
            dedupe_key: { $exists: true },
          },
        }
      )
      .then(() => undefined)
      .catch((error) => {
        // Do not break generation if legacy data prevents index creation;
        // the atomic upsert below still provides the primary dedup guard.
        console.error("Could not create open-alert unique index:", error);
      });
  }
  return alertIndexPromise;
}

async function recomputeRisk(
  db: MongoDb,
  shipmentId: number
): Promise<{ riskStatus: string; openAlerts: AlertView[] }> {
  const docs = await db
    .collection("alerts")
    .find({ shipment_id: shipmentId, status: "OPEN" })
    .toArray();

  // Risk is derived from *all* currently OPEN alerts, never from the latest
  // reading, so a single in-range reading cannot silently clear a CRITICAL risk.
  let riskStatus = "LOW";
  let bestRank = SEVERITY_RANK.LOW;
  for (const doc of docs as JsonDoc[]) {
    const severity = String(doc.severity ?? "LOW").toUpperCase();
    const rank = SEVERITY_RANK[severity];
    if (rank != null && rank > bestRank) {
      bestRank = rank;
      riskStatus = severity;
    }
  }

  // SHIPMENT has no updated_at column in this schema: only risk_status.
  await pool.execute(
    "UPDATE SHIPMENT SET risk_status = ? WHERE shipment_id = ?",
    [riskStatus, shipmentId]
  );

  return {
    riskStatus,
    openAlerts: (docs as JsonDoc[]).map(serializeAlert),
  };
}

function buildChartData(readings: ReadingView[], thresholds: ProductThreshold[]) {
  const referenceByShipment = new Map<number, ProductThreshold>();
  for (const threshold of thresholds) {
    if (
      threshold.reference &&
      !referenceByShipment.has(threshold.shipment_id)
    ) {
      referenceByShipment.set(threshold.shipment_id, threshold);
    }
  }

  return [...readings]
    .sort((a, b) => {
      const left = Date.parse(a.timestamp);
      const right = Date.parse(b.timestamp);
      return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right);
    })
    .map((reading) => {
      const time = Date.parse(reading.timestamp);
      const validTime = Number.isNaN(time) ? null : time;
      const reference = referenceByShipment.get(reading.shipment_id);
      return {
        label: validTime == null
          ? "—"
          : new Date(validTime).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            }),
        temperature: reading.temperature,
        humidity: reading.humidity,
        t: validTime ?? 0,
        shipment_id: reading.shipment_id,
        ...(reference
          ? {
              tempMin: reference.min_temp_c,
              tempMax: reference.max_temp_c,
              humidityMin: reference.min_humidity,
              humidityMax: reference.max_humidity,
              referenceProduct: reference.name,
            }
          : {}),
      };
    });
}

/** GET - readings, alerts, MySQL thresholds and chart-ready history. */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get("shipment_id");
    const shipmentId = rawId ? Number(rawId) : null;
    if (
      shipmentId != null &&
      (!Number.isInteger(shipmentId) || shipmentId <= 0)
    ) {
      return NextResponse.json(
        { error: "shipment_id must be a positive integer" },
        { status: 400 }
      );
    }

    if (
      shipmentId != null &&
      isCustomer(user) &&
      !(await canAccessShipment(user, shipmentId))
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const visibleIds = await getVisibleShipmentIds(user, shipmentId);
    const db = await getMongoDb();

    const readingQuery: JsonDoc = {};
    const alertQuery: JsonDoc = {};
    if (shipmentId != null) {
      readingQuery.shipment_id = shipmentId;
      alertQuery.shipment_id = shipmentId;
    } else {
      // Empty $in simply returns nothing for a CUSTOMER with no shipments.
      readingQuery.shipment_id = { $in: visibleIds };
      alertQuery.shipment_id = { $in: visibleIds };
    }

    const [readingDocs, alertDocs, thresholdRows, riskStatus] = await Promise.all([
      db
        .collection("sensor_readings")
        .find(readingQuery)
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray(),
      db
        .collection("alerts")
        .find(alertQuery)
        .sort({ detected_at: -1 })
        .limit(100)
        .toArray(),
      loadThresholds(shipmentId ?? undefined),
      loadRiskStatus(shipmentId),
    ]);

    const visibleSet = new Set(visibleIds);
    const readings = (readingDocs as JsonDoc[])
      .map(serializeReading)
      .filter((reading) =>
        shipmentId != null
          ? reading.shipment_id === shipmentId
          : visibleSet.has(reading.shipment_id)
      );
    const alerts = (alertDocs as JsonDoc[])
      .map(serializeAlert)
      .filter((alert) =>
        shipmentId != null
          ? alert.shipment_id === shipmentId
          : visibleSet.has(alert.shipment_id)
      );
    const thresholds = (thresholdRows as ProductThreshold[]).filter((row) =>
      shipmentId != null
        ? row.shipment_id === shipmentId
        : visibleSet.has(row.shipment_id)
    );

    return NextResponse.json({
      readings,
      alerts,
      thresholds,
      chartData: buildChartData(readings, thresholds),
      riskStatus,
      simulated: true,
    });
  } catch (error) {
    console.error("Error fetching monitoring data:", error);
    return NextResponse.json(
      { error: "Failed to fetch monitoring data" },
      { status: 500 }
    );
  }
}

/** POST - generate one simulated reading and reconcile alerts/risk. */
export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: JsonDoc;
    try {
      body = (await request.json()) as JsonDoc;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const shipmentId = toNumber(body?.shipment_id, NaN);
    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      return NextResponse.json(
        { error: "shipment_id must be a positive integer" },
        { status: 400 }
      );
    }

    if (isCustomer(user) && !(await canAccessShipment(user, shipmentId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [[shipmentRows], [productRows]] = await Promise.all([
      pool.execute(
        `SELECT s.shipment_id, s.customer_id, s.status, s.risk_status,
                c.name AS customer_name
           FROM SHIPMENT s
           LEFT JOIN CUSTOMER c ON c.customer_id = s.customer_id
          WHERE s.shipment_id = ?`,
        [shipmentId]
      ),
      pool.execute(
        `SELECT p.product_id, p.name, p.min_temp_c, p.max_temp_c,
                p.min_humidity, p.max_humidity
           FROM SHIPMENT_ITEM si
           JOIN PRODUCT p ON p.product_id = si.product_id
          WHERE si.shipment_id = ?
          ORDER BY p.product_id`,
        [shipmentId]
      ),
    ]);

    if (!(shipmentRows as JsonDoc[]).length) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    const products = (productRows as JsonDoc[]).map((row) =>
      toThreshold({ ...row, shipment_id: shipmentId })
    );
    if (!products.length) {
      return NextResponse.json(
        { error: "Shipment has no products with stored thresholds" },
        { status: 400 }
      );
    }

    /*
     * One POST produces ONE sensor reading. A multi-product shipment can hold
     * incompatible ranges (vaccines 2–8°C and frozen -20..-15°C, for example),
     * so no single value could satisfy every product. We therefore generate
     * around the FIRST product (lowest product_id) and expose that product as
     * the stable "reference" in thresholds/chart limits.
     */
    const reference = products[0];

    const db = await getMongoDb();
    const existingCount = await db
      .collection("sensor_readings")
      .countDocuments({ shipment_id: shipmentId });
    const sequence = existingCount + 1;

    // Deterministic violations: the 5th reading is too hot, the 7th too dry.
    // `simulate_violation: true` forces both in the same reading.
    const forceViolation = body?.simulate_violation === true;
    const injectHighTemperature = forceViolation || sequence % 5 === 0;
    const injectLowHumidity = forceViolation || sequence % 7 === 0;

    const drift = (min: number, max: number, seed: number) => {
      const range = Math.max(0, max - min);
      const fraction = 0.35 + ((seed * 37) % 41) / 100;
      return round1(min + range * fraction);
    };

    const temperature = injectHighTemperature
      ? round1(reference.max_temp_c + 2.5)
      : drift(reference.min_temp_c, reference.max_temp_c, sequence);
    const humidity = injectLowHumidity
      ? round1(Math.max(0, reference.min_humidity - 8))
      : drift(reference.min_humidity, reference.max_humidity, sequence + 1);

    const timestamp = new Date();
    const readingDoc = {
      shipment_id: shipmentId,
      sensor_id: "TEMP-101",
      temperature,
      humidity,
      timestamp,
      source: "simulator",
      product_id: reference.product_id,
      product_name: reference.name,
      sequence,
    };
    const insertResult = await db
      .collection("sensor_readings")
      .insertOne(readingDoc);
    const newReading = serializeReading({
      ...readingDoc,
      _id: insertResult.insertedId,
    });

    // Evaluate against the reference product only - other products may have
    // fundamentally incompatible limits and are shown separately in the UI.
    const violations = new Map<
      string,
      { type: string; severity: string; message: string }
    >();
    const range = `${round1(reference.min_temp_c)}–${round1(reference.max_temp_c)}°C`;
    const humidityRange = `${round1(reference.min_humidity)}–${round1(reference.max_humidity)}%`;

    if (temperature > reference.max_temp_c) {
      violations.set("HIGH_TEMPERATURE", {
        type: "HIGH_TEMPERATURE",
        severity: "CRITICAL",
        message: `Temperature ${round1(temperature)}°C exceeds ${reference.name} limit ${range}.`,
      });
    }
    if (temperature < reference.min_temp_c) {
      violations.set("LOW_TEMPERATURE", {
        type: "LOW_TEMPERATURE",
        severity: "HIGH",
        message: `Temperature ${round1(temperature)}°C is below ${reference.name} limit ${range}.`,
      });
    }
    if (humidity < reference.min_humidity) {
      violations.set("LOW_HUMIDITY", {
        type: "LOW_HUMIDITY",
        severity: "MEDIUM",
        message: `Humidity ${round1(humidity)}% is below ${reference.name} limit ${humidityRange}.`,
      });
    }
    if (humidity > reference.max_humidity) {
      violations.set("HIGH_HUMIDITY", {
        type: "HIGH_HUMIDITY",
        severity: "CRITICAL",
        message: `Humidity ${round1(humidity)}% exceeds ${reference.name} limit ${humidityRange}.`,
      });
    }

    await ensureAlertIndexes(db);
    const alertCollection = db.collection("alerts");
    const opened: AlertView[] = [];

    for (const violation of violations.values()) {
      const dedupeKey = `${shipmentId}:${violation.type}`;
      const result = await alertCollection.updateOne(
        {
          shipment_id: shipmentId,
          alert_type: violation.type,
          status: "OPEN",
          dedupe_key: dedupeKey,
        },
        {
          $setOnInsert: {
            shipment_id: shipmentId,
            alert_type: violation.type,
            status: "OPEN",
            detected_at: timestamp,
            acknowledged_at: null,
            resolved_at: null,
            product_id: reference.product_id,
            product_name: reference.name,
            source: "simulator",
            dedupe_key: dedupeKey,
          },
          // Refresh details on an existing OPEN alert, but never its status.
          $set: {
            severity: violation.severity,
            message: violation.message,
            last_detected_at: timestamp,
          },
        },
        { upsert: true }
      );

      if (result.upsertedCount === 1) {
        const created = result.upsertedId
          ? await alertCollection.findOne({ _id: result.upsertedId as any })
          : null;
        opened.push(
          serializeAlert(
            created ?? {
              _id: result.upsertedId,
              shipment_id: shipmentId,
              alert_type: violation.type,
              severity: violation.severity,
              message: violation.message,
              status: "OPEN",
              detected_at: timestamp,
              last_detected_at: timestamp,
              source: "simulator",
            }
          )
        );

        await db.collection("monitoring_logs").insertOne({
          event_type: "ALERT_GENERATED",
          shipment_id: shipmentId,
          alert_id: result.upsertedId?.toString() ?? null,
          alert_type: violation.type,
          severity: violation.severity,
          message: violation.message,
          metadata: {
            source: "simulator",
            reading_id: newReading.id,
            product_id: reference.product_id,
            product_name: reference.name,
          },
          created_at: timestamp,
        });
      }
    }

    const { riskStatus, openAlerts } = await recomputeRisk(db, shipmentId);

    return NextResponse.json({
      success: true,
      simulated: true,
      newReading,
      alerts: opened,
      openAlerts,
      riskStatus,
      thresholds: products,
    });
  } catch (error) {
    console.error("Error generating simulated reading:", error);
    return NextResponse.json(
      { error: "Failed to generate simulated reading" },
      { status: 500 }
    );
  }
}
