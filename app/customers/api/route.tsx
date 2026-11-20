import { NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import bcrypt from "bcryptjs";
import { pool, sqlParam, nextId } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface CustomerRow extends RowDataPacket {
  customer_id: number;
  user_id: number | null;
  name: string;
  company_name: string | null;
  address: string | null;
  phone: string | null;
  username: string | null;
  email: string | null;
}

interface CustomerForm {
  name?: unknown;
  company_name?: unknown;
  address?: unknown;
  phone?: unknown;
  username?: unknown;
  email?: unknown;
  password?: unknown;
}

const unauthorized = () =>
  NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

async function requireOperational(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role === "CUSTOMER") return forbidden();
  return null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function isDuplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  );
}

/**
 * GET customer profiles. Operational roles see all customers; CUSTOMER sessions
 * only ever see their own profile (used by the shipment form / tracking panel).
 * Login fields are included so the Customer Management screen can prefill edits.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();

  try {
    const ownOnly = user.role === "CUSTOMER";
    const [rows] = await pool.execute<CustomerRow[]>(
      "SELECT c.customer_id, c.user_id, c.name, c.company_name, c.address, c.phone, " +
        "u.username, u.email FROM CUSTOMER c " +
        "LEFT JOIN USER u ON u.user_id = c.user_id " +
        (ownOnly ? "WHERE c.customer_id = ? " : "") +
        "ORDER BY c.name",
      ownOnly ? [user.customer_id] : []
    );
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    return NextResponse.json(
      { error: "Failed to fetch customers" },
      { status: 500 }
    );
  }
}

/**
 * POST creates the two linked rows a customer needs: a CUSTOMER login (role 3)
 * in USER and the customer profile in CUSTOMER. Both writes are transactional so
 * a failure never leaves an orphaned account or profile.
 */
export async function POST(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const body = (await request.json()) as CustomerForm;
    const name = cleanText(body.name);
    const username = cleanText(body.username);
    const email = cleanText(body.email);
    const companyName = cleanText(body.company_name);
    const address = cleanText(body.address);
    const phone = cleanText(body.phone);
    // Blank password falls back to the project's demo default so admins can
    // create an account quickly; the response surfaces the effective password.
    const password = cleanText(body.password) ?? "123456";

    if (!name || !username || !email) {
      return NextResponse.json(
        { error: "Name, username and email are required" },
        { status: 400 }
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const userId = await nextId("USER", "user_id");
      const customerId = await nextId("CUSTOMER", "customer_id");

      await connection.execute<ResultSetHeader>(
        "INSERT INTO USER (user_id, role_id, username, email, password_hash, is_active) " +
          "VALUES (?, 3, ?, ?, ?, TRUE)",
        [userId, username, email, passwordHash]
      );
      await connection.execute<ResultSetHeader>(
        "INSERT INTO CUSTOMER (customer_id, user_id, name, company_name, address, phone) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
        [
          customerId,
          userId,
          name,
          sqlParam(companyName),
          sqlParam(address),
          sqlParam(phone),
        ]
      );

      await connection.commit();
      return NextResponse.json({
        success: true,
        customer_id: customerId,
        user_id: userId,
        message: `Customer created. Login: ${username} / ${password}`,
      });
    } catch (error) {
      await connection.rollback();
      if (isDuplicate(error)) {
        return NextResponse.json(
          { error: "Username or email is already in use" },
          { status: 400 }
        );
      }
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error creating customer:", error);
    return NextResponse.json(
      { error: "Failed to create customer" },
      { status: 500 }
    );
  }
}
