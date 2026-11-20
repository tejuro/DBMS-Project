import { NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool, sqlParam, nextId } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface WarehouseRow extends RowDataPacket {
  warehouse_id: number;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
}

interface WarehouseForm {
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
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

// GET all warehouses (any signed-in user). Use ?archived=true to list archived rows.
export async function GET(request: Request) {
  if (!(await getSessionUser())) return unauthorized();
  try {
    const { searchParams } = new URL(request.url);
    const showArchived = searchParams.get("archived") === "true";
    const [rows] = await pool.execute<WarehouseRow[]>(
      showArchived
        ? "SELECT * FROM WAREHOUSE ORDER BY warehouse_id"
        : "SELECT * FROM WAREHOUSE WHERE is_archived = 0 ORDER BY warehouse_id"
    );
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching warehouses:", error);
    return NextResponse.json(
      { error: "Failed to fetch warehouses" },
      { status: 500 }
    );
  }
}

// POST - Create new warehouse
export async function POST(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const { name, address, city, latitude, longitude } =
      (await request.json()) as WarehouseForm;

    if (
      typeof name !== "string" || !name.trim() ||
      typeof address !== "string" || !address.trim() ||
      typeof city !== "string" || !city.trim() ||
      !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))
    ) {
      return NextResponse.json(
        { error: "name, address, city, latitude and longitude are required" },
        { status: 400 }
      );
    }

    const warehouseId = await nextId("WAREHOUSE", "warehouse_id");
    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO WAREHOUSE (warehouse_id, name, address, city, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)",
      [warehouseId, name, address, city, latitude, longitude]
    );

    return NextResponse.json({
      success: true,
      warehouse_id: warehouseId,
      message: "Warehouse created successfully",
    });
  } catch (error) {
    console.error("Error creating warehouse:", error);
    return NextResponse.json(
      { error: "Failed to create warehouse" },
      { status: 500 }
    );
  }
}

// PUT - Update warehouse
export async function PUT(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const warehouse_id = parseId(body.warehouse_id);
    if (warehouse_id === null) {
      return NextResponse.json({ error: "Invalid warehouse id" }, { status: 400 });
    }

    await pool.execute<ResultSetHeader>(
      "UPDATE WAREHOUSE SET name = ?, address = ?, city = ?, latitude = ?, longitude = ? WHERE warehouse_id = ?",
      [
        sqlParam(body.name),
        sqlParam(body.address),
        sqlParam(body.city),
        sqlParam(body.latitude),
        sqlParam(body.longitude),
        warehouse_id,
      ]
    );

    return NextResponse.json({
      success: true,
      message: "Warehouse updated successfully",
    });
  } catch (error) {
    console.error("Error updating warehouse:", error);
    return NextResponse.json(
      { error: "Failed to update warehouse" },
      { status: 500 }
    );
  }
}

// PATCH - Archive or restore a warehouse
export async function PATCH(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const warehouse_id = parseId(body.warehouse_id);
    if (warehouse_id === null) {
      return NextResponse.json({ error: "Invalid warehouse id" }, { status: 400 });
    }

    const isArchived = body.is_archived === true;

    // Check FK usage before archiving a warehouse used in active routes
    if (isArchived) {
      const [routes] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) as count FROM ROUTE WHERE (origin_warehouse_id = ? OR destination_warehouse_id = ?) AND is_archived = 0",
        [warehouse_id, warehouse_id]
      );
      if (Number((routes[0] as { count?: number } | undefined)?.count ?? 0) > 0) {
        return NextResponse.json(
          { error: "Cannot archive warehouse used by active routes" },
          { status: 400 }
        );
      }
    }

    await pool.execute<ResultSetHeader>(
      "UPDATE WAREHOUSE SET is_archived = ? WHERE warehouse_id = ?",
      [isArchived ? 1 : 0, warehouse_id]
    );

    return NextResponse.json({
      success: true,
      message: isArchived ? "Warehouse archived" : "Warehouse restored",
    });
  } catch (error) {
    console.error("Error archiving warehouse:", error);
    return NextResponse.json(
      { error: "Failed to archive warehouse" },
      { status: 500 }
    );
  }
}

// DELETE - Delete warehouse
export async function DELETE(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const warehouse_id = parseId(searchParams.get("id"));
    if (warehouse_id === null) {
      return NextResponse.json({ error: "Invalid warehouse id" }, { status: 400 });
    }

    const [routes] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM ROUTE WHERE origin_warehouse_id = ? OR destination_warehouse_id = ?",
      [warehouse_id, warehouse_id]
    );

    if (Number((routes[0] as { count?: number } | undefined)?.count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete warehouse used in routes" },
        { status: 400 }
      );
    }

    await pool.execute<ResultSetHeader>(
      "DELETE FROM WAREHOUSE WHERE warehouse_id = ?",
      [warehouse_id]
    );

    return NextResponse.json({
      success: true,
      message: "Warehouse deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting warehouse:", error);
    return NextResponse.json(
      { error: "Failed to delete warehouse" },
      { status: 500 }
    );
  }
}
