import mysql from "mysql2/promise";

/**
 * Shared MySQL connection pool for server-side route handlers.
 *
 * Route handlers must never call `pool.end()` — the pool is process-wide and is
 * reused across requests (Next.js may keep the module loaded indefinitely).
 */
export const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "cold_chain",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * The legacy `cold_chain` schema has no AUTO_INCREMENT on domain tables.
 * Allocate the next primary key explicitly. Table/column names must come from
 * trusted call-site constants only — they are interpolated into SQL.
 */
export async function nextId(table: string, column: string): Promise<number> {
  const [rows] = await pool.execute(
    `SELECT COALESCE(MAX(${column}), 0) + 1 AS next_id FROM ${table}`
  );
  const row = Array.isArray(rows) ? (rows as Record<string, any>)[0] : null;
  const id = Number(row?.next_id ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Could not allocate id for ${table}.${column}`);
  }
  return id;
}

export type SqlParam = string | number | boolean | null;

/** Coerces untrusted JSON values into safe bound parameters (never SQL text). */
export function sqlParam(value: unknown): SqlParam {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}
