import { NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool, sqlParam, nextId } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface DriverRow extends RowDataPacket {
  driver_id: number;
  user_id: number | null;
  name: string;
  license_no: string;
  phone: string;
  status: string;
}

interface DriverForm {
  name: string;
  license_no: string;
  phone: string;
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

// GET all drivers (any signed-in user)
export async function GET() {
  if (!(await getSessionUser())) return unauthorized();
  try {
    const [rows] = await pool.execute<DriverRow[]>("SELECT * FROM DRIVER");
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching drivers:", error);
    return NextResponse.json(
      { error: "Failed to fetch drivers" },
      { status: 500 }
    );
  }
}

// POST - Create new driver profile. Drivers are MySQL profiles with NO login.
export async function POST(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const { name, license_no, phone, status } = (await request.json()) as DriverForm;

    if (
      typeof name !== "string" || !name.trim() ||
      typeof license_no !== "string" || !license_no.trim() ||
      typeof phone !== "string" || !phone.trim()
    ) {
      return NextResponse.json(
        { error: "name, license_no and phone are required" },
        { status: 400 }
      );
    }

    const driverId = await nextId("DRIVER", "driver_id");
    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO DRIVER (driver_id, name, license_no, phone, status) VALUES (?, ?, ?, ?, ?)",
      [driverId, name, license_no, phone, status || "AVAILABLE"]
    );

    return NextResponse.json({
      success: true,
      driver_id: driverId,
      message: "Driver created successfully",
    });
  } catch (error) {
    console.error("Error creating driver:", error);
    return NextResponse.json(
      { error: "Failed to create driver" },
      { status: 500 }
    );
  }
}

// PUT - Update driver
export async function PUT(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const driver_id = parseId(body.driver_id);
    if (driver_id === null) {
      return NextResponse.json({ error: "Invalid driver id" }, { status: 400 });
    }

    await pool.execute<ResultSetHeader>(
      "UPDATE DRIVER SET name = ?, license_no = ?, phone = ?, status = ? WHERE driver_id = ?",
      [sqlParam(body.name), sqlParam(body.license_no), sqlParam(body.phone), sqlParam(body.status), driver_id]
    );

    return NextResponse.json({
      success: true,
      message: "Driver updated successfully",
    });
  } catch (error) {
    console.error("Error updating driver:", error);
    return NextResponse.json(
      { error: "Failed to update driver" },
      { status: 500 }
    );
  }
}

// DELETE - Delete driver
export async function DELETE(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const driver_id = parseId(searchParams.get("id"));
    if (driver_id === null) {
      return NextResponse.json({ error: "Invalid driver id" }, { status: 400 });
    }

    // Check if driver is assigned to any shipments before deleting
    const [shipments] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM SHIPMENT WHERE driver_id = ?",
      [driver_id]
    );

    if (Number((shipments[0] as { count?: number } | undefined)?.count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete driver assigned to shipments" },
        { status: 400 }
      );
    }

    await pool.execute<ResultSetHeader>(
      "DELETE FROM DRIVER WHERE driver_id = ?",
      [driver_id]
    );

    return NextResponse.json({
      success: true,
      message: "Driver deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting driver:", error);
    return NextResponse.json(
      { error: "Failed to delete driver" },
      { status: 500 }
    );
  }
}
