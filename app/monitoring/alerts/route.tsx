import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import mongoose from "mongoose";
import { getMongoDb } from "@/lib/mongo";
import { getSessionUser, canAccessShipment } from "@/lib/auth";

export const dynamic = "force-dynamic";

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

const SEVERITY_RANK: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/** Documented alert lifecycle: OPEN -> ACKNOWLEDGED -> RESOLVED. */
const ALLOWED_TRANSITIONS: Record<string, string> = {
  OPEN: "ACKNOWLEDGED",
  ACKNOWLEDGED: "RESOLVED",
};

function toNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function serializeAlert(doc: JsonDoc | null | undefined) {
  const alert = doc ?? {};
  return {
    id: alert._id?.toString?.() ?? (typeof alert.id === "string" ? alert.id : null),
    shipment_id: toNumber(alert.shipment_id),
    alert_type: typeof alert.alert_type === "string" ? alert.alert_type : "UNKNOWN",
    severity: typeof alert.severity === "string" ? alert.severity : "LOW",
    message: typeof alert.message === "string" ? alert.message : "",
    status: typeof alert.status === "string" ? alert.status : "OPEN",
    detected_at: toIso(alert.detected_at) ?? toIso(alert.created_at) ?? "",
    acknowledged_at: toIso(alert.acknowledged_at),
    last_detected_at: toIso(alert.last_detected_at),
    resolved_at: toIso(alert.resolved_at),
    product_id: alert.product_id == null ? null : toNumber(alert.product_id),
    product_name: typeof alert.product_name === "string" ? alert.product_name : null,
    source: typeof alert.source === "string" ? alert.source : "seed",
  };
}

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

async function recomputeRisk(
  db: MongoDb,
  shipmentId: number
): Promise<string> {
  const docs = await db
    .collection("alerts")
    .find({ shipment_id: shipmentId, status: "OPEN" })
    .toArray();

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

  // SHIPMENT has risk_status but no updated_at column in this schema.
  await pool.execute(
    "UPDATE SHIPMENT SET risk_status = ? WHERE shipment_id = ?",
    [riskStatus, shipmentId]
  );
  return riskStatus;
}

/** GET - list alerts with all statuses, optionally filtered by shipment. */
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
    const status = searchParams.get("status");
    if (status && !["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(status)) {
      return NextResponse.json(
        { error: "status must be OPEN, ACKNOWLEDGED or RESOLVED" },
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
    const query: JsonDoc = {};
    if (shipmentId != null) {
      query.shipment_id = shipmentId;
    } else {
      query.shipment_id = { $in: visibleIds };
    }
    if (status) query.status = status;

    const docs = await db
      .collection("alerts")
      .find(query)
      .sort({ detected_at: -1 })
      .limit(100)
      .toArray();

    const visibleSet = new Set(visibleIds);
    const alerts = (docs as JsonDoc[])
      .map(serializeAlert)
      .filter((alert) =>
        shipmentId != null
          ? alert.shipment_id === shipmentId
          : visibleSet.has(alert.shipment_id)
      );

    return NextResponse.json({ alerts });
  } catch (error) {
    console.error("Error listing alerts:", error);
    return NextResponse.json(
      { error: "Failed to list alerts" },
      { status: 500 }
    );
  }
}

/** PATCH - advance an alert through OPEN -> ACKNOWLEDGED -> RESOLVED. */
export async function PATCH(request: Request) {
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

    const alertId = typeof body?.alert_id === "string" ? body.alert_id : "";
    const nextStatus =
      typeof body?.status === "string" ? body.status.toUpperCase() : "";
    if (!alertId || !mongoose.Types.ObjectId.isValid(alertId)) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }
    if (nextStatus !== "ACKNOWLEDGED" && nextStatus !== "RESOLVED") {
      return NextResponse.json(
        {
          error:
            "status must be ACKNOWLEDGED or RESOLVED (OPEN -> ACKNOWLEDGED -> RESOLVED only)",
        },
        { status: 400 }
      );
    }

    const db = await getMongoDb();
    const objectId = new mongoose.Types.ObjectId(alertId);
    const alertCollection = db.collection("alerts");
    const existing = (await alertCollection.findOne({
      _id: objectId as any,
    })) as JsonDoc | null;

    if (!existing) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    const shipmentId = toNumber(existing.shipment_id);
    if (
      isCustomer(user) &&
      !(await canAccessShipment(user, shipmentId))
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const currentStatus = String(existing.status ?? "").toUpperCase();
    if (ALLOWED_TRANSITIONS[currentStatus] !== nextStatus) {
      return NextResponse.json(
        {
          error: `Invalid transition ${currentStatus || "UNKNOWN"} -> ${nextStatus}. Allowed chain: OPEN -> ACKNOWLEDGED -> RESOLVED.`,
        },
        { status: 400 }
      );
    }

    const timestamp = new Date();
    const changes: JsonDoc = {
      status: nextStatus,
      updated_at: timestamp,
    };
    if (nextStatus === "ACKNOWLEDGED") {
      changes.acknowledged_at = timestamp;
      changes.last_detected_at = existing.last_detected_at ?? timestamp;
    } else {
      changes.resolved_at = timestamp;
    }

    // Filter on the expected status too, so two simultaneous actions cannot
    // both win and skip a step in the lifecycle.
    const updated = (await alertCollection.findOneAndUpdate(
      { _id: objectId as any, status: currentStatus },
      { $set: changes },
      { returnDocument: "after" }
    )) as JsonDoc | null;

    if (!updated) {
      return NextResponse.json(
        { error: "Alert status changed; refresh and retry" },
        { status: 400 }
      );
    }

    await db.collection("monitoring_logs").insertOne({
      event_type:
        nextStatus === "ACKNOWLEDGED" ? "ALERT_ACKNOWLEDGED" : "ALERT_RESOLVED",
      shipment_id: shipmentId,
      alert_id: alertId,
      alert_type: updated.alert_type,
      severity: updated.severity,
      message: `Alert ${String(updated.alert_type ?? "")} ${nextStatus.toLowerCase()}`,
      metadata: {
        previous_status: currentStatus,
        status: nextStatus,
        source: "monitoring-ui",
      },
      created_at: timestamp,
    });

    const riskStatus = await recomputeRisk(db, shipmentId);

    return NextResponse.json({
      success: true,
      alert: serializeAlert(updated),
      riskStatus,
    });
  } catch (error) {
    console.error("Error updating alert:", error);
    return NextResponse.json(
      { error: "Failed to update alert" },
      { status: 500 }
    );
  }
}
