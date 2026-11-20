import mysql from "mysql2/promise";
import { getMongoDb } from "@/lib/mongo";

const MYSQL_CONFIG = {
  host: "localhost",
  user: "root",
  database: "cold_chain",
  connectTimeout: 5000,
};

export type ShipmentRow = {
  shipment_id: number;
  customer: string;
  status: string;
  risk_status: string;
  route_name: string;
  expected_delivery: string | null;
};

export type SensorReading = {
  id: string;
  sensor_id: string;
  shipment_id: number;
  product_id: number | null;
  temperature: number;
  humidity: number;
  timestamp: string;
};

export type AlertRow = {
  id: string;
  shipment_id: number;
  alert_type: string;
  severity: string;
  message: string;
  detected_at: string;
  status: string;
};

export type GpsPoint = {
  id: string;
  shipment_id: number;
  latitude: number;
  longitude: number;
  speed: number;
  recorded_at: string;
};

export type TrendPoint = {
  label: string;
  value: number;
  shipment_id: number;
  timestamp: string;
};

export type ProductTemperatureContext = {
  product_id: number;
  name: string;
  min_temp_c: number;
  max_temp_c: number;
  average_temperature: number | null;
  reading_count: number;
  excursion_count: number;
};

export type ActivityRow = {
  shipment_id: number;
  from_status: string | null;
  to_status: string;
  remarks: string | null;
  changed_at: string;
};

export type DashboardData = {
  mysql: {
    totalShipments: number;
    activeShipments: number;
    deliveredShipments: number;
    delayedShipments: number;
    statusBreakdown: { status: string; count: number }[];
    shipments: ShipmentRow[];
    warehouses: { name: string; city: string; latitude: number; longitude: number }[];
    products: { product_id: number; name: string; min_temp_c: number; max_temp_c: number; min_humidity: number; max_humidity: number }[];
    recentActivity: ActivityRow[];
  };
  mongo: {
    criticalAlerts: number;
    openAlerts: number;
    alerts: AlertRow[];
    readings: SensorReading[];
    averageTemperature: number;
    averageHumidity: number;
    temperatureContext: ProductTemperatureContext[];
    temperatureTrend: TrendPoint[];
    humidityTrend: TrendPoint[];
    gps: GpsPoint[];
  };
  errors: string[];
};

function rowsOf(result: unknown): Record<string, any>[] {
  return Array.isArray(result) ? (result as Record<string, any>[]) : [];
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoDate(value: unknown): string {
  if (value == null) return new Date(0).toISOString();
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function getDashboardData(): Promise<DashboardData> {
  const errors: string[] = [];

  const data: DashboardData = {
    mysql: {
      totalShipments: 0,
      activeShipments: 0,
      deliveredShipments: 0,
      delayedShipments: 0,
      statusBreakdown: [],
      shipments: [],
      warehouses: [],
      products: [],
      recentActivity: [],
    },
    mongo: {
      criticalAlerts: 0,
      openAlerts: 0,
      alerts: [],
      readings: [],
      averageTemperature: 0,
      averageHumidity: 0,
      temperatureContext: [],
      temperatureTrend: [],
      humidityTrend: [],
      gps: [],
    },
    errors,
  };

  try {
    const pool = mysql.createPool(MYSQL_CONFIG);

    const [
      [counts],
      [statusRows],
      [shipments],
      [warehouses],
      [products],
      [activity],
    ] = await Promise.all([
      pool.execute(
        "SELECT COUNT(*) AS total, " +
          "SUM(CASE WHEN status NOT IN ('DELIVERED', 'CANCELLED') THEN 1 ELSE 0 END) AS active, " +
          "SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered, " +
          "SUM(CASE WHEN status = 'DELAYED' THEN 1 ELSE 0 END) AS delayed_count FROM SHIPMENT"
      ),
      pool.execute(
        "SELECT status, COUNT(*) AS count FROM SHIPMENT GROUP BY status ORDER BY count DESC"
      ),
      pool.execute(
        "SELECT s.shipment_id, c.name AS customer, s.status, s.risk_status, " +
          "CONCAT(COALESCE(ow.city, 'Unknown'), ' → ', COALESCE(dw.city, 'Unknown')) AS route_name, " +
          "s.expected_delivery FROM SHIPMENT s " +
          "JOIN CUSTOMER c ON s.customer_id = c.customer_id " +
          "LEFT JOIN ROUTE r ON s.route_id = r.route_id " +
          "LEFT JOIN WAREHOUSE ow ON r.origin_warehouse_id = ow.warehouse_id " +
          "LEFT JOIN WAREHOUSE dw ON r.destination_warehouse_id = dw.warehouse_id " +
          "ORDER BY s.shipment_id DESC LIMIT 8"
      ),
      pool.execute(
        "SELECT name, city, latitude, longitude FROM WAREHOUSE ORDER BY warehouse_id"
      ),
      pool.execute(
        "SELECT product_id, name, min_temp_c, max_temp_c, min_humidity, max_humidity " +
          "FROM PRODUCT ORDER BY product_id"
      ),
      pool.execute(
        "SELECT h.shipment_id, h.old_status, h.new_status, h.remarks, h.changed_at " +
          "FROM SHIPMENT_STATUS_HISTORY h ORDER BY h.changed_at DESC LIMIT 6"
      ),
    ]);

    const c = rowsOf(counts)[0] || {};
    data.mysql.totalShipments = Number(c.total || 0);
    data.mysql.activeShipments = Number(c.active || 0);
    data.mysql.deliveredShipments = Number(c.delivered || 0);
    data.mysql.delayedShipments = Number(c.delayed_count || 0);
    data.mysql.statusBreakdown = rowsOf(statusRows).map((r) => ({
      status: String(r.status),
      count: Number(r.count),
    }));
    data.mysql.shipments = rowsOf(shipments).map((r) => ({
      shipment_id: Number(r.shipment_id),
      customer: String(r.customer),
      status: String(r.status),
      risk_status: String(r.risk_status),
      route_name: String(r.route_name),
      expected_delivery: r.expected_delivery ? isoDate(r.expected_delivery) : null,
    }));
    data.mysql.warehouses = rowsOf(warehouses).map((r) => ({
      name: String(r.name),
      city: String(r.city),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
    }));
    data.mysql.products = rowsOf(products).map((r) => ({
      product_id: Number(r.product_id),
      name: String(r.name),
      min_temp_c: Number(r.min_temp_c),
      max_temp_c: Number(r.max_temp_c),
      min_humidity: Number(r.min_humidity),
      max_humidity: Number(r.max_humidity),
    }));
    data.mysql.recentActivity = rowsOf(activity).map((r) => ({
      shipment_id: Number(r.shipment_id),
      from_status: r.old_status ? String(r.old_status) : null,
      to_status: String(r.new_status),
      remarks: r.remarks ? String(r.remarks) : null,
      changed_at: isoDate(r.changed_at),
    }));

    await pool.end();
  } catch (error) {
    errors.push("MySQL: " + (error instanceof Error ? error.message : String(error)));
  }

  try {
    const db = await getMongoDb();

    const [alertDocs, readingDocs, gpsDocs, recentReadingDocs, criticalCount, openCount] =
      await Promise.all([
        db
          .collection("alerts")
          .find({ status: "OPEN" })
          .sort({ detected_at: -1 })
          .limit(6)
          .toArray(),
        db
          .collection("sensor_readings")
          .find()
          .sort({ timestamp: -1 })
          .limit(200)
          .toArray(),
        db
          .collection("gps_telemetry")
          .find()
          .sort({ recorded_at: -1 })
          .limit(12)
          .toArray(),
        db
          .collection("sensor_readings")
          .find()
          .sort({ timestamp: 1 })
          .limit(16)
          .toArray(),
        db.collection("alerts").countDocuments({ severity: "CRITICAL", status: "OPEN" }),
        db.collection("alerts").countDocuments({ status: "OPEN" }),
      ]);

    data.mongo.alerts = alertDocs.map((a: any) => ({
      id: String(a._id),
      shipment_id: Number(a.shipment_id),
      alert_type: String(a.alert_type),
      severity: String(a.severity),
      message: String(a.message),
      detected_at: isoDate(a.detected_at),
      status: String(a.status),
    }));
    data.mongo.readings = readingDocs.map((r: any) => ({
      id: String(r._id),
      sensor_id: String(r.sensor_id || "SENSOR"),
      shipment_id: Number(r.shipment_id),
      product_id: r.product_id == null ? null : Number(r.product_id),
      temperature: Number(r.temperature),
      humidity: Number(r.humidity),
      timestamp: isoDate(r.timestamp),
    }));
    data.mongo.gps = gpsDocs.map((g: any) => ({
      id: String(g._id),
      shipment_id: Number(g.shipment_id),
      latitude: Number(g.latitude),
      longitude: Number(g.longitude),
      speed: Number(g.speed || 0),
      recorded_at: isoDate(g.recorded_at),
    }));
    data.mongo.criticalAlerts = criticalCount;
    data.mongo.openAlerts = openCount;

    const temps = data.mongo.readings
      .map((r) => r.temperature)
      .filter((v) => Number.isFinite(v));
    const humidities = data.mongo.readings
      .map((r) => r.humidity)
      .filter((v) => Number.isFinite(v));
    data.mongo.averageTemperature = temps.length
      ? round(temps.reduce((sum, v) => sum + v, 0) / temps.length)
      : 0;
    data.mongo.averageHumidity = humidities.length
      ? round(humidities.reduce((sum, v) => sum + v, 0) / humidities.length)
      : 0;

    data.mongo.temperatureTrend = recentReadingDocs.map((r: any) => ({
      label: new Date(isoDate(r.timestamp)).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      value: finiteNumber(r.temperature) ?? 0,
      shipment_id: Number(r.shipment_id),
      timestamp: isoDate(r.timestamp),
    }));
    data.mongo.humidityTrend = recentReadingDocs.map((r: any) => ({
      label: new Date(isoDate(r.timestamp)).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      value: finiteNumber(r.humidity) ?? 0,
      shipment_id: Number(r.shipment_id),
      timestamp: isoDate(r.timestamp),
    }));

    data.mongo.temperatureContext = data.mysql.products.map((product) => {
      const productReadings = readingDocs.filter(
        (r: any) => Number(r.product_id) === product.product_id
      );
      const values = productReadings
        .map((r: any) => finiteNumber(r.temperature))
        .filter((v: number | null): v is number => v != null);
      return {
        product_id: product.product_id,
        name: product.name,
        min_temp_c: product.min_temp_c,
        max_temp_c: product.max_temp_c,
        average_temperature: values.length
          ? round(values.reduce((sum, v) => sum + v, 0) / values.length)
          : null,
        reading_count: values.length,
        excursion_count: values.filter(
          (v: number) => v < product.min_temp_c || v > product.max_temp_c
        ).length,
      };
    });
  } catch (error) {
    errors.push("MongoDB: " + (error instanceof Error ? error.message : String(error)));
  }

  return data;
}
