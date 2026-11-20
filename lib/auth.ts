import { cookies } from "next/headers";
import { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  isRole,
  signToken,
  verifyToken,
} from "@/lib/session-token";

// Re-exported so existing callers of `@/lib/auth` keep working unchanged.
export { SESSION_COOKIE_NAME } from "@/lib/session-token";

export type Role = "ADMIN" | "DISPATCHER" | "CUSTOMER";

export type SessionUser = {
  id: number;
  username: string;
  role: Role;
  customer_id: number | null;
  name: string;
  email: string | null;
};

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours

/** Sets the signed, httpOnly session cookie. Call from a Route Handler. */
export async function createSessionCookie(user: SessionUser): Promise<void> {
  const token = signToken({
    id: user.id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  });

  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Removes the session cookie. Call from a Route Handler. */
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}

type AuthUserRow = RowDataPacket & {
  user_id: number;
  username: string;
  email: string | null;
  role_name: string;
  customer_id: number | null;
  company_name: string | null;
  customer_name: string | null;
};

/**
 * Reads and verifies the session cookie, then re-reads the account from MySQL
 * so deactivated users (e.g. driver accounts) and role changes take effect
 * immediately rather than after the cookie expires.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const payload = verifyToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!payload) return null;

  try {
    const [rows] = await pool.execute<AuthUserRow[]>(
      "SELECT u.user_id, u.username, u.email, r.role_name, " +
        "c.customer_id, c.company_name, c.name AS customer_name " +
        "FROM USER u " +
        "JOIN ROLE r ON r.role_id = u.role_id " +
        "LEFT JOIN CUSTOMER c ON c.user_id = u.user_id " +
        "WHERE u.user_id = ? AND u.is_active = TRUE AND r.is_active = TRUE",
      [payload.id]
    );

    const row = rows[0];
    if (!row || !isRole(row.role_name) || row.role_name !== payload.role) {
      return null;
    }

    const isCustomer = row.role_name === "CUSTOMER";
    return {
      id: Number(row.user_id),
      username: row.username,
      role: row.role_name,
      customer_id: isCustomer && row.customer_id != null ? Number(row.customer_id) : null,
      name: isCustomer
        ? String(row.company_name ?? row.customer_name ?? row.username)
        : row.username,
      email: row.email ?? null,
    };
  } catch (error) {
    console.error("[auth] Failed to load session user:", error);
    return null;
  }
}

/** ADMIN and DISPATCHER are operational roles with full read/write access. */
export function isOperationalRole(user: SessionUser): boolean {
  return user.role === "ADMIN" || user.role === "DISPATCHER";
}

/**
 * CUSTOMER sessions may only access shipments owned by their customer profile.
 * Operational roles may access every shipment.
 */
export async function canAccessShipment(
  user: SessionUser,
  shipmentId: number | string
): Promise<boolean> {
  if (isOperationalRole(user)) return true;
  if (user.role !== "CUSTOMER" || user.customer_id == null) return false;

  const id = typeof shipmentId === "number" ? shipmentId : Number(shipmentId);
  if (!Number.isInteger(id) || id <= 0) return false;

  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT customer_id FROM SHIPMENT WHERE shipment_id = ?",
      [id]
    );
    const row = rows[0] as { customer_id?: number } | undefined;
    if (!row) return false;
    return Number(row.customer_id) === user.customer_id;
  } catch (error) {
    console.error("[auth] Failed to check shipment access:", error);
    return false;
  }
}
