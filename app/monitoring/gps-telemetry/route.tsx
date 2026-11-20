import { NextResponse } from "next/server";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { getMongoDb } from "@/lib/mongo";
import { getSessionUser, canAccessShipment } from "@/lib/auth";
import { getGeoRoute, pointAtProgress, type GeoRoute } from "@/lib/gps-route";

export const dynamic = "force-dynamic";

// Shared pool for this handler only — never call pool.end() on it.
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  database: "cold_chain",
  waitForConnections: true,
  connectionLimit: 10,
});

type SessionStatus = "RUNNING" | "PAUSED" | "STOPPED";

type TelemetryInput = Omit<TelemetryDoc, "_id">;

type TelemetryDoc = {
  _id?: unknown;
  shipment_id?: number;
  route_id?: number;
  latitude?: number;
  longitude?: number;
  speed?: number;
  heading?: number;
  progress?: number;
  source?: string;
  recorded_at?: Date | string;
  timestamp?: Date | string;
};

type SessionDoc = {
  _id?: unknown;
  shipment_id: number;
  status: SessionStatus;
  progress: number;
  last_latitude: number;
  last_longitude: number;
  last_speed: number;
  updated_at: Date;
};

const ACTIONS = ["start", "pause", "resume", "stop", "step", "manual"] as const;
type Action = (typeof ACTIONS)[number];

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampProgress(value: unknown): number {
  return Math.min(1, Math.max(0, finite(value) ?? 0));
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parseShipmentId(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function serializeTelemetry(doc: TelemetryDoc) {
  return {
    id: doc._id !== undefined ? String(doc._id) : undefined,
    shipment_id: finite(doc.shipment_id),
    timestamp: parseDate(doc.recorded_at ?? doc.timestamp)?.toISOString() ?? null,
    latitude: finite(doc.latitude),
    longitude: finite(doc.longitude),
    speed: finite(doc.speed),
    heading: finite(doc.heading),
    route_id: finite(doc.route_id),
    progress: finite(doc.progress),
    source: typeof doc.source === "string" ? doc.source : "simulator",
  };
}

function serializeSession(doc: SessionDoc | null) {
  if (!doc) return null;
  return {
    id: doc._id !== undefined ? String(doc._id) : undefined,
    shipment_id: doc.shipment_id,
    status: doc.status,
    progress: clampProgress(doc.progress),
    last_latitude: finite(doc.last_latitude),
    last_longitude: finite(doc.last_longitude),
    last_speed: finite(doc.last_speed),
    updated_at: parseDate(doc.updated_at)?.toISOString() ?? null,
  };
}

function routePayload(routeId: number | null) {
  if (routeId === null) return null;
  const route = getGeoRoute(routeId);
  if (!route) return null;
  return {
    route_id: route.id,
    origin: route.origin,
    destination: route.destination,
    points: route.points,
    distance_km: route.distance_km,
  };
}

async function findShipmentRouteId(shipmentId: number): Promise<number | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT route_id FROM SHIPMENT WHERE shipment_id = ? LIMIT 1",
    [shipmentId]
  );
  const row = rows[0];
  if (!row) return null;
  const value = finite(row.route_id);
  return value !== null && Number.isInteger(value) ? value : null;
}

/**
 * Compressed clock: simulated minutes per real second. At least 3 (the
 * documented 1 s ~ 3 min scale), longer for long corridors so a full trip is
 * observable in roughly a minute while the derived speed stays realistic.
 */
function simulationScaleFor(route: GeoRoute): number {
  const nominalSpeedKmh = 55;
  const targetRealSeconds = 50;
  const scaleToFinish = route.distance_km / ((nominalSpeedKmh / 60) * targetRealSeconds);
  return Math.min(30, Math.max(3, scaleToFinish));
}

function defaultSession(shipmentId: number): SessionDoc {
  return {
    shipment_id: shipmentId,
    status: "STOPPED",
    progress: 0,
    last_latitude: 0,
    last_longitude: 0,
    last_speed: 0,
    updated_at: new Date(),
  };
}

// GET /api/monitoring/gps-telemetry?shipment_id=N
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { searchParams } = new URL(request.url);
    const shipmentId = parseShipmentId(searchParams.get("shipment_id"));
    if (user.role === "CUSTOMER" && shipmentId !== null) {
      const allowed = await canAccessShipment(user, shipmentId);
      if (!allowed) return json({ error: "Forbidden" }, 403);
    }

    const db = await getMongoDb();
    const telemetryCollection = db.collection("gps_telemetry");
    const query: Record<string, unknown> =
      shipmentId !== null ? { shipment_id: shipmentId } : {};
    const docs = (await telemetryCollection
      .find(query)
      .sort({ recorded_at: -1 })
      .limit(200)
      .toArray()) as unknown as TelemetryDoc[];

    let allowedShipments: Set<number> | null = null;
    if (user.role === "CUSTOMER" && shipmentId === null) {
      allowedShipments = new Set<number>();
      const distinctIds = new Set<number>();
      for (const doc of docs) {
        const id = finite(doc.shipment_id);
        if (id !== null) distinctIds.add(id);
      }
      await Promise.all(
        [...distinctIds].map(async (id) => {
          if (await canAccessShipment(user, id)) allowedShipments!.add(id);
        })
      );
    }

    const telemetry = docs
      .filter(
        (doc) =>
          allowedShipments === null ||
          (finite(doc.shipment_id) !== null &&
            allowedShipments.has(finite(doc.shipment_id)!))
      )
      .map(serializeTelemetry);

    let session: SessionDoc | null = null;
    let route = null;
    if (shipmentId !== null) {
      session = (await db
        .collection("gps_sessions")
        .findOne({ shipment_id: shipmentId })) as unknown as SessionDoc | null;
      const routeId = await findShipmentRouteId(shipmentId);
      route = routePayload(routeId);
    }

    return json({
      telemetry,
      session: serializeSession(session),
      route,
    });
  } catch (error) {
    console.error("Error fetching GPS telemetry:", error);
    return json({ error: "Failed to fetch GPS telemetry" }, 500);
  }
}

// POST /api/monitoring/gps-telemetry
export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== "object" || body === null) {
      return json({ error: "Invalid request body" }, 400);
    }
    const payload = body as Record<string, unknown>;
    const rawShipmentId = payload.shipment_id;
    const shipmentId =
      typeof rawShipmentId === "number" ? rawShipmentId : Number(rawShipmentId);
    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      return json({ error: "A valid shipment_id is required" }, 400);
    }
    if (!ACTIONS.includes(payload.action as Action)) {
      return json({ error: "Invalid GPS simulator action" }, 400);
    }
    const action = payload.action as Action;

    if (user.role === "CUSTOMER") {
      const allowed = await canAccessShipment(user, shipmentId);
      if (!allowed) return json({ error: "Forbidden" }, 403);
    }

    const shipmentRouteId = await findShipmentRouteId(shipmentId);
    if (shipmentRouteId === null) {
      return json({ error: `Shipment ${shipmentId} not found` }, 404);
    }

    const db = await getMongoDb();
    const sessions = db.collection("gps_sessions");
    const telemetryCollection = db.collection("gps_telemetry");

    const existing = (await sessions.findOne({ shipment_id: shipmentId })) as unknown as
      | SessionDoc
      | null;
    const current: SessionDoc = existing ?? defaultSession(shipmentId);

    const writeSession = async (patch: Partial<SessionDoc>): Promise<SessionDoc> => {
      const next: SessionDoc = {
        ...current,
        ...patch,
        shipment_id: shipmentId,
        updated_at: new Date(),
      };
      await sessions.updateOne(
        { shipment_id: shipmentId },
        {
          $set: {
            shipment_id: next.shipment_id,
            status: next.status,
            progress: next.progress,
            last_latitude: next.last_latitude,
            last_longitude: next.last_longitude,
            last_speed: next.last_speed,
            updated_at: next.updated_at,
          },
        },
        { upsert: true }
      );
      return next;
    };

    const lastTelemetry = async (): Promise<TelemetryDoc | null> =>
      (await telemetryCollection.findOne(
        { shipment_id: shipmentId },
        { sort: { recorded_at: -1 } }
      )) as unknown as TelemetryDoc | null;

    // Status-only controls never insert telemetry.
    if (action === "pause" || action === "resume" || action === "stop") {
      const status: SessionStatus =
        action === "pause" ? "PAUSED" : action === "resume" ? "RUNNING" : "STOPPED";
      const session = await writeSession({ status });
      return json({
        success: true,
        session: serializeSession(session),
        latest: null,
      });
    }

    const route = getGeoRoute(shipmentRouteId);
    if (!route) {
      return json({ error: `Route ${shipmentRouteId} has no GPS geometry` }, 400);
    }

    if (action === "start") {
      const previous = await lastTelemetry();
      const previousProgress = finite(previous?.progress) ?? finite(current.progress) ?? 0;
      // A stopped run restarts where it left off; a fresh/normal start resets to 0.
      const resume =
        current.status === "STOPPED" &&
        previousProgress > 0 &&
        previousProgress < 1;
      const progress = resume ? clampProgress(previousProgress) : 0;
      const point = pointAtProgress(shipmentRouteId, progress);
      const recordedAt = new Date();
      const doc: TelemetryInput = {
        shipment_id: shipmentId,
        route_id: shipmentRouteId,
        recorded_at: recordedAt,
        latitude: point.latitude,
        longitude: point.longitude,
        speed: 0,
        heading: point.heading,
        progress,
        source: "simulator",
      };
      const inserted = await telemetryCollection.insertOne(doc);
      const session = await writeSession({
        status: "RUNNING",
        progress,
        last_latitude: point.latitude,
        last_longitude: point.longitude,
        last_speed: 0,
      });
      return json({
        success: true,
        session: serializeSession(session),
        latest: serializeTelemetry({ ...doc, _id: inserted.insertedId }),
      });
    }

    // step / manual advance along the stored route from the last stored point.
    if (action === "step" && current.status !== "RUNNING") {
      return json({ error: "Simulation is not running" }, 409);
    }

    const previous = await lastTelemetry();
    const previousProgress =
      finite(previous?.progress) ?? finite(current.progress) ?? 0;
    const progress = clampProgress(previousProgress);
    const lastAt =
      parseDate(previous?.recorded_at ?? previous?.timestamp ?? current.updated_at) ??
      new Date(Date.now() - 3000);
    // Bound very long gaps so an inactive tab cannot produce a large jump.
    const elapsedSeconds = Math.min(
      10,
      Math.max(0.25, (Date.now() - lastAt.getTime()) / 1000)
    );
    const simulatedHours = (elapsedSeconds * simulationScaleFor(route)) / 60;
    const plannedSpeedKmh = 54 + 8 * Math.sin(progress * Math.PI * 2 + shipmentRouteId);
    const nextProgress = clampProgress(
      progress + (plannedSpeedKmh * simulatedHours) / route.distance_km
    );
    const point = pointAtProgress(shipmentRouteId, nextProgress);
    const travelledKm = Math.max(0, nextProgress - progress) * route.distance_km;
    const derivedSpeed = travelledKm / simulatedHours;
    const speed = Math.min(65, Math.max(45, derivedSpeed));

    const doc: TelemetryInput = {
      shipment_id: shipmentId,
      route_id: shipmentRouteId,
      recorded_at: new Date(),
      latitude: point.latitude,
      longitude: point.longitude,
      speed,
      heading: point.heading,
      progress: nextProgress,
      source: action === "manual" ? "manual" : "simulator",
    };
    const inserted = await telemetryCollection.insertOne(doc);
    const status: SessionStatus =
      action === "step" && nextProgress >= 1 ? "STOPPED" : current.status;
    const session = await writeSession({
      status,
      progress: nextProgress,
      last_latitude: point.latitude,
      last_longitude: point.longitude,
      last_speed: speed,
    });

    return json({
      success: true,
      session: serializeSession(session),
      latest: serializeTelemetry({ ...doc, _id: inserted.insertedId }),
    });
  } catch (error) {
    console.error("Error updating GPS telemetry:", error);
    return json({ error: "Failed to update GPS telemetry" }, 500);
  }
}
