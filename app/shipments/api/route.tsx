import { NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool, nextId } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface ShipmentFormData {
  customer_id: number;
  created_by: number;
  route_id: number;
  vehicle_id: number | null;
  driver_id: number | null;
  status: string;
  risk_status: string;
  dispatched_at: string | null;
  expected_delivery: string | null;
  delivered_at: string | null;
}

// Helper types
interface ShipmentRow extends RowDataPacket {
  shipment_id: number;
  customer_id: number;
  created_by: number;
  route_id: number;
  vehicle_id: number | null;
  driver_id: number | null;
  status: string;
  risk_status: string;
  dispatched_at: Date | null;
  expected_delivery: Date | null;
  delivered_at: Date | null;
  created_at: Date | string;
  updated_at: Date | string;
  customer_name: string;
  creator_name: string;
  vehicle_reg: string | null;
  driver_name: string | null;
  distance_km: number;
  estimated_duration_minutes: number;
}

interface Shipment {
  shipment_id: number;
  customer_id: number;
  created_by: number;
  route_id: number;
  vehicle_id: number | null;
  driver_id: number | null;
  status: string;
  risk_status: string;
  dispatched_at: string | null;
  expected_delivery: string | null;
  delivered_at: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  customer_name: string;
  creator_name: string;
  vehicle_reg: string | null;
  driver_name: string | null;
  distance_km: number;
  estimated_duration_minutes: number;
  // Additional fields for display
  products?: unknown[];
  history?: unknown[];
}

// GET all shipments with optional filtering. CUSTOMER sessions are always
// restricted to rows owned by their own customer profile.
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (user.role === "CUSTOMER" && user.customer_id == null) {
    return NextResponse.json([]);
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query =
      "SELECT s.*, c.company_name as customer_name, u.username as creator_name, " +
      "v.reg_no as vehicle_reg, d.name as driver_name, " +
      "r.distance_km, r.estimated_duration_minutes " +
      "FROM SHIPMENT s " +
      "JOIN CUSTOMER c ON s.customer_id = c.customer_id " +
      "JOIN USER u ON s.created_by = u.user_id " +
      "LEFT JOIN VEHICLE v ON s.vehicle_id = v.vehicle_id " +
      "LEFT JOIN DRIVER d ON s.driver_id = d.driver_id " +
      "LEFT JOIN ROUTE r ON s.route_id = r.route_id";

    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (status) {
      conditions.push("s.status = ?");
      params.push(status);
    }

    if (user.role === "CUSTOMER") {
      // Ignore any client-supplied customer_id for customers.
      conditions.push("s.customer_id = ?");
      params.push(user.customer_id as number);
    } else {
      const customerId = searchParams.get("customer_id");
      if (customerId && /^\d+$/.test(customerId)) {
        conditions.push("s.customer_id = ?");
        params.push(Number(customerId));
      }
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    const [rows] = await pool.execute<ShipmentRow[]>(query, params);
    return NextResponse.json(rows as Shipment[], {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching shipments:", error);
    return NextResponse.json(
      { error: "Failed to fetch shipments" },
      { status: 500 }
    );
  }
}

// POST - Create new shipment (operational roles only)
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (user.role === "CUSTOMER") {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  try {
    const formData: ShipmentFormData = await request.json();

    const {
      customer_id,
      created_by,
      route_id,
      vehicle_id,
      driver_id,
      status,
      risk_status,
      dispatched_at,
      expected_delivery,
      delivered_at,
    } = formData;

    if (
      !Number.isInteger(Number(customer_id)) ||
      !Number.isInteger(Number(route_id)) ||
      typeof status !== "string" || !status.trim()
    ) {
      return NextResponse.json(
        { error: "customer_id, route_id and status are required" },
        { status: 400 }
      );
    }

    const shipmentId = await nextId("SHIPMENT", "shipment_id");
    await pool.execute<ResultSetHeader>(
      `INSERT INTO SHIPMENT (shipment_id, customer_id, created_by, route_id, vehicle_id, driver_id,
        status, risk_status, dispatched_at, expected_delivery, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shipmentId,
        customer_id,
        created_by ?? user.id,
        route_id,
        vehicle_id ?? null,
        driver_id ?? null,
        status,
        risk_status ?? "LOW",
        dispatched_at ? new Date(dispatched_at) : null,
        expected_delivery ? new Date(expected_delivery) : null,
        delivered_at ? new Date(delivered_at) : null,
      ]
    );

    // Create initial status history record
    await pool.execute<ResultSetHeader>(
      `INSERT INTO SHIPMENT_STATUS_HISTORY (shipment_id, changed_by, old_status, new_status, changed_at, remarks)
       VALUES (?, ?, ?, ?, NOW(), 'Shipment created')`,
      [shipmentId, created_by ?? user.id, null, status]
    );

    return NextResponse.json({
      success: true,
      shipment_id: shipmentId,
      message: "Shipment created successfully",
    });
  } catch (error) {
    console.error("Error creating shipment:", error);
    return NextResponse.json(
      { error: "Failed to create shipment" },
      { status: 500 }
    );
  }
}
