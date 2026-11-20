import { NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool, sqlParam, nextId } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface VehicleRow extends RowDataPacket {
  vehicle_id: number;
  reg_no: string;
  vehicle_type: string;
  capacity_kg: number;
  status: string;
}

interface VehicleForm {
  reg_no: string;
  vehicle_type: string;
  capacity_kg: number;
  status: string;
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

// GET all vehicles (any signed-in user)
export async function GET() {
  if (!(await getSessionUser())) return unauthorized();
  try {
    const [rows] = await pool.execute<VehicleRow[]>("SELECT * FROM VEHICLE");
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching vehicles:", error);
    return NextResponse.json(
      { error: "Failed to fetch vehicles" },
      { status: 500 }
    );
  }
}

// POST - Create new vehicle
export async function POST(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const { reg_no, vehicle_type, capacity_kg, status } =
      (await request.json()) as VehicleForm;

    if (
      typeof reg_no !== "string" || !reg_no.trim() ||
      typeof vehicle_type !== "string" || !vehicle_type.trim() ||
      !Number.isFinite(Number(capacity_kg))
    ) {
      return NextResponse.json(
        { error: "reg_no, vehicle_type and capacity_kg are required" },
        { status: 400 }
      );
    }

    const vehicleId = await nextId("VEHICLE", "vehicle_id");
    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO VEHICLE (vehicle_id, reg_no, vehicle_type, capacity_kg, status) VALUES (?, ?, ?, ?, ?)",
      [vehicleId, reg_no, vehicle_type, capacity_kg, status || "AVAILABLE"]
    );

    return NextResponse.json({
      success: true,
      vehicle_id: vehicleId,
      message: "Vehicle created successfully",
    });
  } catch (error) {
    console.error("Error creating vehicle:", error);
    return NextResponse.json(
      { error: "Failed to create vehicle" },
      { status: 500 }
    );
  }
}

// PUT - Update vehicle
export async function PUT(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const vehicle_id = parseId(body.vehicle_id);
    if (vehicle_id === null) {
      return NextResponse.json({ error: "Invalid vehicle id" }, { status: 400 });
    }

    await pool.execute<ResultSetHeader>(
      "UPDATE VEHICLE SET reg_no = ?, vehicle_type = ?, capacity_kg = ?, status = ? WHERE vehicle_id = ?",
      [
        sqlParam(body.reg_no),
        sqlParam(body.vehicle_type),
        sqlParam(body.capacity_kg),
        sqlParam(body.status),
        vehicle_id,
      ]
    );

    return NextResponse.json({
      success: true,
      message: "Vehicle updated successfully",
    });
  } catch (error) {
    console.error("Error updating vehicle:", error);
    return NextResponse.json(
      { error: "Failed to update vehicle" },
      { status: 500 }
    );
  }
}

// DELETE - Delete vehicle
export async function DELETE(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const vehicle_id = parseId(searchParams.get("id"));
    if (vehicle_id === null) {
      return NextResponse.json({ error: "Invalid vehicle id" }, { status: 400 });
    }

    const [shipments] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM SHIPMENT WHERE vehicle_id = ?",
      [vehicle_id]
    );

    if (Number((shipments[0] as { count?: number } | undefined)?.count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete vehicle assigned to shipments" },
        { status: 400 }
      );
    }

    await pool.execute<ResultSetHeader>(
      "DELETE FROM VEHICLE WHERE vehicle_id = ?",
      [vehicle_id]
    );

    return NextResponse.json({
      success: true,
      message: "Vehicle deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting vehicle:", error);
    return NextResponse.json(
      { error: "Failed to delete vehicle" },
      { status: 500 }
    );
  }
}
