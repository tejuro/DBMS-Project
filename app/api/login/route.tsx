import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { RowDataPacket } from "mysql2";
import { pool } from "@/lib/db";
import { createSessionCookie, type Role, type SessionUser } from "@/lib/auth";

type UserRow = RowDataPacket & {
  user_id: number;
  username: string;
  email: string | null;
  password_hash: string;
  is_active: number | boolean;
  role_name: string;
  customer_id: number | null;
  company_name: string | null;
  customer_name: string | null;
};

function normalizeRole(value: unknown): Role | null {
  return value === "ADMIN" || value === "DISPATCHER" || value === "CUSTOMER"
    ? value
    : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: unknown;
      password?: unknown;
    };
    const username =
      typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    // Drivers are operational profiles, not login accounts. Demo driver
    // accounts are deactivated in the seed; reject them explicitly as well.
    if (/^driver\d+$/i.test(username)) {
      return NextResponse.json(
        { error: "Driver profiles cannot be used to sign in" },
        { status: 401 }
      );
    }

    const [rows] = await pool.execute<UserRow[]>(
      "SELECT u.user_id, u.username, u.email, u.password_hash, u.is_active, " +
        "r.role_name, c.customer_id, c.company_name, c.name AS customer_name " +
        "FROM USER u " +
        "JOIN ROLE r ON r.role_id = u.role_id " +
        "LEFT JOIN CUSTOMER c ON c.user_id = u.user_id " +
        "WHERE u.username = ? AND r.is_active = TRUE",
      [username]
    );

    const row = rows[0];
    const role = normalizeRole(row?.role_name);
    if (!row || !role || Number(row.is_active) !== 1) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const passwordMatch = await bcrypt.compare(password, row.password_hash);
    if (!passwordMatch) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const isCustomer = role === "CUSTOMER";
    const user: SessionUser = {
      id: Number(row.user_id),
      username: row.username,
      role,
      customer_id: isCustomer && row.customer_id != null ? Number(row.customer_id) : null,
      name: isCustomer
        ? String(row.company_name ?? row.customer_name ?? row.username)
        : row.username,
      email: row.email ?? null,
    };

    await createSessionCookie(user);

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          name: user.name,
          customer_id: user.customer_id,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
