import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { getMongoDb } from "@/lib/mongo";
import { getSessionUser, type SessionUser } from "@/lib/auth";

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  database: "cold_chain",
  waitForConnections: true,
  connectionLimit: 10,
});

export const dynamic = "force-dynamic";

type Rows = Record<string, any>[];

function rowsOf(result: unknown): Rows {
  return Array.isArray(result) ? (result as Rows) : [];
}

function countOf(row: Record<string, any> | undefined, key: string): number {
  const value = Number(row?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * All analytics handlers require a server-side session. Customers are scoped
 * to their own MySQL customer_id before any query runs.
 */
async function authorize(): Promise<
  { user: SessionUser; customerClause: string; customerParams: (number | string)[] } | NextResponse
> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role === "CUSTOMER") {
    if (user.customer_id == null) {
      return NextResponse.json({ shipments: [], error: "No customer profile" });
    }
    return {
      user,
      customerClause: " AND s.customer_id = ?",
      customerParams: [user.customer_id],
    };
  }

  return { user, customerClause: "", customerParams: [] };
}

async function customerShipmentIds(user: SessionUser): Promise<number[]> {
  if (user.role !== "CUSTOMER" || user.customer_id == null) return [];
  const [result] = await pool.execute(
    "SELECT shipment_id FROM SHIPMENT WHERE customer_id = ?",
    [user.customer_id]
  );
  return rowsOf(result).map((row) => Number(row.shipment_id));
}

/** GET - KPI metrics from MySQL and MongoDB */
export async function GET() {
  try {
    const auth = await authorize();
    if (auth instanceof NextResponse) return auth;
    const { user, customerClause, customerParams } = auth;

    const idList =
      user.role === "CUSTOMER" ? await customerShipmentIds(user) : [];
    const mongoMatch =
      user.role === "CUSTOMER"
        ? { shipment_id: { $in: idList } }
        : {};

    const [[shipmentResult], [productResult], criticalAlerts, openAlerts, readings] =
      await Promise.all([
        pool.execute(
          "SELECT COUNT(*) AS total, " +
            "SUM(CASE WHEN s.status NOT IN ('DELIVERED', 'CANCELLED') THEN 1 ELSE 0 END) AS active, " +
            "SUM(CASE WHEN s.status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered, " +
            "SUM(CASE WHEN s.status = 'DELAYED' THEN 1 ELSE 0 END) AS delayed_count " +
            "FROM SHIPMENT s WHERE 1=1" + customerClause,
          customerParams
        ),
        pool.execute(
          "SELECT p.product_id, p.name, p.min_temp_c, p.max_temp_c, p.min_humidity, p.max_humidity " +
            "FROM PRODUCT p ORDER BY p.product_id"
        ),
        (async () => {
          const db = await getMongoDb();
          return db.collection("alerts").countDocuments({
            ...mongoMatch,
            severity: "CRITICAL",
            status: "OPEN",
          });
        })(),
        (async () => {
          const db = await getMongoDb();
          return db.collection("alerts").countDocuments({
            ...mongoMatch,
            status: "OPEN",
          });
        })(),
        (async () => {
          const db = await getMongoDb();
          return db
            .collection("sensor_readings")
            .find(mongoMatch, { projection: { shipment_id: 1, product_id: 1, temperature: 1, humidity: 1 } })
            .limit(1000)
            .toArray();
        })(),
      ]);

    const productsList = rowsOf(productResult);
    const productById = new Map<number, Rows[number]>();
    for (const product of productsList) {
      productById.set(Number(product.product_id), product);
    }

    const tempValues = readings
      .map((r: any) => Number(r.temperature))
      .filter((v: number) => Number.isFinite(v));
    const humidityValues = readings
      .map((r: any) => Number(r.humidity))
      .filter((v: number) => Number.isFinite(v));
    const average = (values: number[]) =>
      values.length ? round(values.reduce((sum, v) => sum + v, 0) / values.length) : 0;

    const temperatureByProduct = productsList.map((product: any) => {
      const id = Number(product.product_id);
      const values = readings
        .filter((r: any) => Number(r.product_id) === id)
        .map((r: any) => Number(r.temperature))
        .filter((v: number) => Number.isFinite(v));
      const min = Number(product.min_temp_c);
      const max = Number(product.max_temp_c);
      return {
        product_id: id,
        name: String(product.name),
        min_temp_c: min,
        max_temp_c: max,
        average_temperature: values.length ? average(values) : null,
        reading_count: values.length,
        excursion_count: values.filter((v: number) => v < min || v > max).length,
      };
    });

    const counts = rowsOf(shipmentResult)[0] || {};

    return NextResponse.json({
      kpis: {
        total_shipments: countOf(counts, "total"),
        active_shipments: countOf(counts, "active"),
        delivered_shipments: countOf(counts, "delivered"),
        delayed_shipments: countOf(counts, "delayed_count"),
        critical_alerts: criticalAlerts,
        open_alerts: openAlerts,
        average_temperature: average(tempValues),
        average_humidity: average(humidityValues),
        reading_count: readings.length,
      },
      temperature_context: {
        note: "Products have different permitted ranges. Compare each product average with its own range rather than the unweighted overall average.",
        products: temperatureByProduct,
      },
    });
  } catch (error) {
    console.error("Error fetching KPIs:", error);
    return NextResponse.json(
      { error: "Failed to fetch KPI metrics" },
      { status: 500 }
    );
  }
}

/** GET - Shipments grouped by status */
export async function GET_shipmentsByStatus() {
  try {
    const auth = await authorize();
    if (auth instanceof NextResponse) return auth;
    const { customerClause, customerParams } = auth;
    const [result] = await pool.execute(
      "SELECT s.status, COUNT(*) AS count FROM SHIPMENT s WHERE 1=1" +
        customerClause +
        " GROUP BY s.status ORDER BY count DESC",
      customerParams
    );
    return NextResponse.json(
      rowsOf(result).map((row) => ({
        status: String(row.status),
        count: countOf(row, "count"),
      }))
    );
  } catch (error) {
    console.error("Error fetching status distribution:", error);
    return NextResponse.json(
      { error: "Failed to fetch status distribution" },
      { status: 500 }
    );
  }
}

/** GET - Environmental alerts (MongoDB) joined with MySQL product names */
export async function GET_violationReports() {
  try {
    const auth = await authorize();
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const db = await getMongoDb();
    const idList =
      user.role === "CUSTOMER" ? await customerShipmentIds(user) : null;
    if (idList && idList.length === 0) return NextResponse.json([]);

    const alertQuery: Record<string, unknown> = idList
      ? { shipment_id: { $in: idList } }
      : {};

    const [alertDocs, itemRows, readingDocs] = await Promise.all([
      db
        .collection("alerts")
        .find(alertQuery)
        .sort({ detected_at: -1 })
        .limit(50)
        .toArray(),
      (async () => {
        const [result] = await pool.execute(
          "SELECT si.shipment_id, GROUP_CONCAT(p.name ORDER BY p.name SEPARATOR ', ') AS product_names " +
            "FROM SHIPMENT_ITEM si JOIN PRODUCT p ON si.product_id = p.product_id " +
            "GROUP BY si.shipment_id"
        );
        return rowsOf(result);
      })(),
      db
        .collection("sensor_readings")
        .find(idList ? { shipment_id: { $in: idList } } : {})
        .sort({ timestamp: -1 })
        .limit(300)
        .toArray(),
    ]);

    const productByShipment = new Map<number, string>();
    for (const item of itemRows) {
      productByShipment.set(Number(item.shipment_id), String(item.product_names));
    }

    const latestByShipment = new Map<number, any>();
    for (const reading of readingDocs) {
      const id = Number(reading.shipment_id);
      if (!latestByShipment.has(id)) latestByShipment.set(id, reading);
    }

    const reports = alertDocs
      .filter((alert: any) => alert?._id != null)
      .map((alert: any) => {
        const id = Number(alert.shipment_id);
        const reading = latestByShipment.get(id);
        const detected = new Date(alert.detected_at);
        return {
          alert_id: String(alert._id),
          shipment_id: id,
          product_name: productByShipment.get(id) || "Not assigned",
          alert_type: String(alert.alert_type || "UNKNOWN"),
          severity: String(alert.severity || "UNKNOWN"),
          status: String(alert.status || "OPEN"),
          temperature: reading && Number.isFinite(Number(reading.temperature))
            ? Number(reading.temperature)
            : null,
          humidity: reading && Number.isFinite(Number(reading.humidity))
            ? Number(reading.humidity)
            : null,
          detected_at: Number.isNaN(detected.getTime())
            ? new Date(0).toISOString()
            : detected.toISOString(),
        };
      });

    return NextResponse.json(reports);
  } catch (error) {
    console.error("Error fetching violation reports:", error);
    return NextResponse.json(
      { error: "Failed to fetch violation reports" },
      { status: 500 }
    );
  }
}

/** GET - Route performance derived from real shipment history */
export async function GET_routePerformance() {
  try {
    const auth = await authorize();
    if (auth instanceof NextResponse) return auth;
    const { customerClause, customerParams } = auth;
    const [result] = await pool.execute(
      "SELECT r.route_id, ow.name AS origin, dw.name AS destination, " +
        "r.distance_km, r.estimated_duration_minutes, " +
        "COUNT(s.shipment_id) AS shipment_count, " +
        "SUM(CASE WHEN s.delivered_at IS NOT NULL THEN 1 ELSE 0 END) AS delivered, " +
        "SUM(CASE WHEN s.delivered_at IS NOT NULL AND s.expected_delivery IS NOT NULL " +
        "AND s.delivered_at <= s.expected_delivery THEN 1 ELSE 0 END) AS on_time, " +
        "AVG(CASE WHEN s.delivered_at IS NOT NULL AND s.dispatched_at IS NOT NULL " +
        "THEN TIMESTAMPDIFF(MINUTE, s.dispatched_at, s.delivered_at) END) AS actual_avg_minutes " +
        "FROM ROUTE r " +
        "LEFT JOIN WAREHOUSE ow ON r.origin_warehouse_id = ow.warehouse_id " +
        "LEFT JOIN WAREHOUSE dw ON r.destination_warehouse_id = dw.warehouse_id " +
        "LEFT JOIN SHIPMENT s ON s.route_id = r.route_id AND 1=1" +
        customerClause +
        " GROUP BY r.route_id ORDER BY r.route_id",
      customerParams
    );

    return NextResponse.json(
      rowsOf(result).map((row) => {
        const delivered = countOf(row, "delivered");
        const estimated = countOf(row, "estimated_duration_minutes");
        const actual = row.actual_avg_minutes == null ? null : round(Number(row.actual_avg_minutes));
        return {
          route_id: Number(row.route_id),
          origin: String(row.origin || "Unknown"),
          destination: String(row.destination || "Unknown"),
          distance_km: countOf(row, "distance_km"),
          shipment_count: countOf(row, "shipment_count"),
          delivered,
          on_time: countOf(row, "on_time"),
          average_duration: actual ?? estimated,
          duration_source: actual != null ? "actual (dispatched → delivered)" : "estimated (no delivery recorded)",
          on_time_rate: delivered > 0
            ? round((countOf(row, "on_time") / delivered) * 100, 0)
            : null,
        };
      })
    );
  } catch (error) {
    console.error("Error fetching route performance:", error);
    return NextResponse.json(
      { error: "Failed to fetch route performance" },
      { status: 500 }
    );
  }
}

/**
 * GET - Supporting breakdowns: customer, route, driver, vehicle, severity,
 * delivery performance, excursions and real average duration.
 */
export async function GET_overview() {
  try {
    const auth = await authorize();
    if (auth instanceof NextResponse) return auth;
    const { customerClause, customerParams } = auth;

    const [byCustomer, byRoute, byDriver, byVehicle, deliveryRows, alertRows] =
      await Promise.all([
        groupQuery(
          "SELECT COALESCE(c.company_name, c.name, 'Unknown') AS label, COUNT(*) AS count " +
            "FROM SHIPMENT s LEFT JOIN CUSTOMER c ON s.customer_id = c.customer_id " +
            "WHERE 1=1" + customerClause + " GROUP BY label ORDER BY count DESC",
          customerParams
        ),
        groupQuery(
          "SELECT CONCAT(COALESCE(ow.city, 'Unknown'), ' → ', COALESCE(dw.city, 'Unknown')) AS label, COUNT(*) AS count " +
            "FROM SHIPMENT s LEFT JOIN ROUTE r ON s.route_id = r.route_id " +
            "LEFT JOIN WAREHOUSE ow ON r.origin_warehouse_id = ow.warehouse_id " +
            "LEFT JOIN WAREHOUSE dw ON r.destination_warehouse_id = dw.warehouse_id " +
            "WHERE 1=1" + customerClause + " GROUP BY label ORDER BY count DESC",
          customerParams
        ),
        groupQuery(
          "SELECT COALESCE(d.name, 'Unassigned') AS label, COUNT(*) AS count " +
            "FROM SHIPMENT s LEFT JOIN DRIVER d ON s.driver_id = d.driver_id " +
            "WHERE 1=1" + customerClause + " GROUP BY label ORDER BY count DESC",
          customerParams
        ),
        groupQuery(
          "SELECT COALESCE(v.reg_no, 'Unassigned') AS label, COUNT(*) AS count " +
            "FROM SHIPMENT s LEFT JOIN VEHICLE v ON s.vehicle_id = v.vehicle_id " +
            "WHERE 1=1" + customerClause + " GROUP BY label ORDER BY count DESC",
          customerParams
        ),
        (async () => {
          const [result] = await pool.execute(
            "SELECT COUNT(*) AS total, " +
              "SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered, " +
              "SUM(CASE WHEN status = 'DELAYED' THEN 1 ELSE 0 END) AS delayed_count, " +
              "SUM(CASE WHEN delivered_at IS NOT NULL AND expected_delivery IS NOT NULL AND delivered_at <= expected_delivery THEN 1 ELSE 0 END) AS on_time, " +
              "AVG(CASE WHEN delivered_at IS NOT NULL AND dispatched_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, dispatched_at, delivered_at) END) AS avg_minutes " +
              "FROM SHIPMENT s WHERE 1=1" + customerClause,
            customerParams
          );
          return rowsOf(result)[0] || {};
        })(),
        (async () => {
          const db = await getMongoDb();
          const user = auth.user;
          const query =
            user.role === "CUSTOMER"
              ? { shipment_id: { $in: await customerShipmentIds(user) } }
              : {};
          const docs = await db
            .collection("alerts")
            .find(query, { projection: { severity: 1, alert_type: 1, status: 1 } })
            .toArray();
          return docs;
        })(),
      ]);

    const severityMap = new Map<string, number>();
    const typeMap = new Map<string, number>();
    for (const alert of alertRows as any[]) {
      const severity = String(alert.severity || "UNKNOWN");
      const type = String(alert.alert_type || "UNKNOWN");
      severityMap.set(severity, (severityMap.get(severity) || 0) + 1);
      typeMap.set(type, (typeMap.get(type) || 0) + 1);
    }

    const asPairs = (map: Map<string, number>) =>
      Array.from(map, ([label, count]) => ({ label, count })).sort(
        (a, b) => b.count - a.count
      );

    const total = countOf(deliveryRows, "total");
    const delivered = countOf(deliveryRows, "delivered");

    return NextResponse.json({
      by_customer: byCustomer,
      by_route: byRoute,
      by_driver: byDriver,
      by_vehicle: byVehicle,
      severity_distribution: asPairs(severityMap),
      alert_type_distribution: asPairs(typeMap),
      delivery_performance: {
        total,
        delivered,
        delayed: countOf(deliveryRows, "delayed_count"),
        on_time: countOf(deliveryRows, "on_time"),
        on_time_rate: delivered > 0
          ? round((countOf(deliveryRows, "on_time") / delivered) * 100, 0)
          : null,
        average_duration_minutes:
          deliveryRows.avg_minutes == null
            ? null
            : round(Number(deliveryRows.avg_minutes)),
      },
    });
  } catch (error) {
    console.error("Error fetching analytics overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics overview" },
      { status: 500 }
    );
  }
}

async function groupQuery(sql: string, params: (number | string)[]) {
  const [result] = await pool.execute(sql, params);
  return rowsOf(result).map((row) => ({
    label: String(row.label ?? "Unknown"),
    count: countOf(row, "count"),
  }));
}
