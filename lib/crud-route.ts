import { NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool } from "@/lib/db";
import {
  canAccessShipment,
  getSessionUser,
  type SessionUser,
} from "@/lib/auth";

type Context = { params: Promise<{ id: string }> };

type TableConfig = {
  primaryKey: string;
  /** The only column names permitted in dynamic UPDATE statements. */
  columns: readonly string[];
};

/**
 * Explicit allowlist: table names and column names are never taken from the
 * request. Any key outside these lists is rejected before SQL is built.
 */
const TABLE_CONFIG = {
  SHIPMENT: {
    primaryKey: "shipment_id",
    columns: [
      "customer_id",
      "created_by",
      "route_id",
      "vehicle_id",
      "driver_id",
      "status",
      "risk_status",
      "dispatched_at",
      "expected_delivery",
      "delivered_at",
    ],
  },
  PRODUCT: {
    primaryKey: "product_id",
    columns: [
      "name",
      "category",
      "min_temp_c",
      "max_temp_c",
      "min_humidity",
      "max_humidity",
    ],
  },
  DRIVER: {
    primaryKey: "driver_id",
    columns: ["name", "license_no", "phone", "status"],
  },
  VEHICLE: {
    primaryKey: "vehicle_id",
    columns: ["reg_no", "vehicle_type", "capacity_kg", "status"],
  },
  WAREHOUSE: {
    primaryKey: "warehouse_id",
    columns: ["name", "address", "city", "latitude", "longitude"],
  },
  ROUTE: {
    primaryKey: "route_id",
    columns: [
      "origin_warehouse_id",
      "destination_warehouse_id",
      "distance_km",
      "estimated_duration_minutes",
    ],
  },
} as const satisfies Record<string, TableConfig>;

export type AllowedTable = keyof typeof TABLE_CONFIG;

/**
 * Child rows that must be removed before deleting a parent row. These are
 * hard-coded SQL fragments — never derived from the request.
 */
const DELETE_DEPENDENTS: Partial<Record<AllowedTable, readonly string[]>> = {
  SHIPMENT: [
    "DELETE FROM SHIPMENT_STATUS_HISTORY WHERE shipment_id = ?",
    "DELETE FROM SHIPMENT_ITEM WHERE shipment_id = ?",
  ],
};

const unauthorized = () =>
  NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );

const forbidden = () =>
  NextResponse.json(
    { error: "Forbidden" },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );

const badRequest = (error: string) =>
  NextResponse.json({ error }, { status: 400 });

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

type Authorization = { user: SessionUser } | NextResponse;

/**
 * CUSTOMER sessions may only read their own shipments and cannot mutate any
 * resource. Operational roles have full access.
 */
async function authorize(
  table: AllowedTable,
  method: "GET" | "PUT" | "DELETE"
): Promise<Authorization> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role === "CUSTOMER" && (method !== "GET" || table !== "SHIPMENT")) {
    return forbidden();
  }
  return { user };
}

function isResponse(value: Authorization): value is NextResponse {
  return value instanceof NextResponse;
}

function serverError(action: string, error: unknown) {
  console.error(`[crud] ${action} failed:`, error);
  return NextResponse.json(
    { error: `${action} failed` },
    { status: 500 }
  );
}

/** Builds GET/PUT/DELETE handlers for a single allowlisted table row. */
export function createDetailRoute(table: AllowedTable) {
  const config = TABLE_CONFIG[table];
  const { primaryKey, columns } = config;
  const allowedColumns = new Set<string>(columns);

  async function GET(_request: Request, { params }: Context) {
    try {
      const auth = await authorize(table, "GET");
      if (isResponse(auth)) return auth;

      const { id: rawId } = await params;
      const id = parseId(rawId);
      if (id === null) return badRequest("Invalid id");

      if (auth.user.role === "CUSTOMER") {
        if (!(await canAccessShipment(auth.user, id))) return forbidden();
      }

      const [rows] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM ${table} WHERE ${primaryKey} = ?`,
        [id]
      );
      const row = rows[0];
      if (!row) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(row);
    } catch (error) {
      return serverError("Fetch", error);
    }
  }

  async function PUT(request: Request, { params }: Context) {
    try {
      const auth = await authorize(table, "PUT");
      if (isResponse(auth)) return auth;

      const { id: rawId } = await params;
      const id = parseId(rawId);
      if (id === null) return badRequest("Invalid id");

      const body = (await request.json()) as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return badRequest("Invalid request body");
      }

      const entries: [string, string | number | boolean | null][] = [];
      for (const [key, value] of Object.entries(body)) {
        if (key === primaryKey) continue;
        if (!allowedColumns.has(key)) {
          return badRequest(`Unknown field: ${key}`);
        }
        if (
          value !== null &&
          typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean"
        ) {
          return badRequest(`Invalid value for field: ${key}`);
        }
        entries.push([key, value ?? null]);
      }

      if (entries.length === 0) {
        return badRequest("No fields to update");
      }

      // Column names come exclusively from the allowlist above; values are
      // always bound as prepared-statement parameters.
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
      const values = entries.map(([, value]) => value);

      await pool.execute<ResultSetHeader>(
        `UPDATE ${table} SET ${assignments} WHERE ${primaryKey} = ?`,
        [...values, id]
      );

      return NextResponse.json({ success: true });
    } catch (error) {
      return serverError("Update", error);
    }
  }

  async function DELETE(_request: Request, { params }: Context) {
    try {
      const auth = await authorize(table, "DELETE");
      if (isResponse(auth)) return auth;

      const { id: rawId } = await params;
      const id = parseId(rawId);
      if (id === null) return badRequest("Invalid id");

      for (const sql of DELETE_DEPENDENTS[table] ?? []) {
        await pool.execute<ResultSetHeader>(sql, [id]);
      }
      await pool.execute<ResultSetHeader>(
        `DELETE FROM ${table} WHERE ${primaryKey} = ?`,
        [id]
      );
      return NextResponse.json({ success: true });
    } catch (error) {
      return serverError("Delete", error);
    }
  }

  return { GET, PUT, DELETE };
}
