import { NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool, sqlParam, nextId } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface RouteRow extends RowDataPacket {
  route_id: number;
  origin_warehouse_id: number;
  destination_warehouse_id: number;
  distance_km: number;
  estimated_duration_minutes: number;
  origin_name?: string;
  destination_name?: string;
}

interface RouteForm {
  origin_warehouse_id: number;
  destination_warehouse_id: number;
  distance_km: number;
  estimated_duration_minutes: number;
}

function unauthorized() {
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function parseId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function requireOperational(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role === "CUSTOMER") return forbidden();
  return null;
}

// GET all routes with warehouse names (any signed-in user)
export async function GET() {
  if (!(await getSessionUser())) return unauthorized();
  try {
    const [rows] = await pool.execute<RouteRow[]>(
      "SELECT r.*, w1.name as origin_name, w2.name as destination_name " +
        "FROM ROUTE r " +
        "LEFT JOIN WAREHOUSE w1 ON r.origin_warehouse_id = w1.warehouse_id " +
        "LEFT JOIN WAREHOUSE w2 ON r.destination_warehouse_id = w2.warehouse_id"
    );
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching routes:", error);
    return NextResponse.json(
      { error: "Failed to fetch routes" },
      { status: 500 }
    );
  }
}

// POST - Create new route
export async function POST(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const {
      origin_warehouse_id,
      destination_warehouse_id,
      distance_km,
      estimated_duration_minutes,
    } = (await request.json()) as RouteForm;

    const values = [origin_warehouse_id, destination_warehouse_id, distance_km, estimated_duration_minutes].map(Number);
    if (values.some((v) => !Number.isInteger(v) || v <= 0)) {
      return NextResponse.json(
        { error: "Valid origin, destination, distance and duration are required" },
        { status: 400 }
      );
    }

    const routeId = await nextId("ROUTE", "route_id");
    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO ROUTE (route_id, origin_warehouse_id, destination_warehouse_id, distance_km, estimated_duration_minutes) VALUES (?, ?, ?, ?, ?)",
      [routeId, ...values]
    );

    return NextResponse.json({
      success: true,
      route_id: routeId,
      message: "Route created successfully",
    });
  } catch (error) {
    console.error("Error creating route:", error);
    return NextResponse.json(
      { error: "Failed to create route" },
      { status: 500 }
    );
  }
}

// PUT - Update route
export async function PUT(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const route_id = parseId(body.route_id);
    if (route_id === null) {
      return NextResponse.json({ error: "Invalid route id" }, { status: 400 });
    }

    await pool.execute<ResultSetHeader>(
      "UPDATE ROUTE SET origin_warehouse_id = ?, destination_warehouse_id = ?, distance_km = ?, estimated_duration_minutes = ? WHERE route_id = ?",
      [
        sqlParam(body.origin_warehouse_id),
        sqlParam(body.destination_warehouse_id),
        sqlParam(body.distance_km),
        sqlParam(body.estimated_duration_minutes),
        route_id,
      ]
    );

    return NextResponse.json({
      success: true,
      message: "Route updated successfully",
    });
  } catch (error) {
    console.error("Error updating route:", error);
    return NextResponse.json(
      { error: "Failed to update route" },
      { status: 500 }
    );
  }
}

// DELETE - Delete route
export async function DELETE(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const route_id = parseId(searchParams.get("id"));
    if (route_id === null) {
      return NextResponse.json({ error: "Invalid route id" }, { status: 400 });
    }

    const [shipments] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM SHIPMENT WHERE route_id = ?",
      [route_id]
    );

    if (Number((shipments[0] as { count?: number } | undefined)?.count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete route referenced by shipments" },
        { status: 400 }
      );
    }

    await pool.execute<ResultSetHeader>(
      "DELETE FROM ROUTE WHERE route_id = ?",
      [route_id]
    );

    return NextResponse.json({
      success: true,
      message: "Route deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting route:", error);
    return NextResponse.json(
      { error: "Failed to delete route" },
      { status: 500 }
    );
  }
}
