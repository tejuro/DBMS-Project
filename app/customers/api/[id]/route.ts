import { NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import bcrypt from "bcryptjs";
import { pool, sqlParam } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

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
const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });
const notFound = () => NextResponse.json({ error: "Customer not found" }, { status: 404 });

async function requireOperational(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (user.role === "CUSTOMER") return forbidden();
  return null;
}

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
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

async function findCustomer(customerId: number): Promise<CustomerRow | null> {
  const [rows] = await pool.execute<CustomerRow[]>(
    "SELECT c.customer_id, c.user_id, c.name, c.company_name, c.address, c.phone, " +
      "u.username, u.email FROM CUSTOMER c " +
      "LEFT JOIN USER u ON u.user_id = c.user_id WHERE c.customer_id = ?",
    [customerId]
  );
  return rows[0] ?? null;
}

export async function GET(_request: Request, { params }: Context) {
  const denied = await requireOperational();
  if (denied) return denied;

  const id = parseId((await params).id);
  if (id === null) return badRequest("Invalid customer id");

  try {
    const customer = await findCustomer(id);
    if (!customer) return notFound();
    return NextResponse.json(customer, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching customer:", error);
    return NextResponse.json({ error: "Failed to fetch customer" }, { status: 500 });
  }
}

/** Updates the profile and the linked login. A blank password keeps the current hash. */
export async function PUT(request: Request, { params }: Context) {
  const denied = await requireOperational();
  if (denied) return denied;

  const id = parseId((await params).id);
  if (id === null) return badRequest("Invalid customer id");

  try {
    const existing = await findCustomer(id);
    if (!existing) return notFound();

    const body = (await request.json()) as CustomerForm;
    const name = cleanText(body.name);
    const username = cleanText(body.username);
    const email = cleanText(body.email);
    if (!name || !username || !email) {
      return badRequest("Name, username and email are required");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return badRequest("Invalid email address");
    }
    const newPassword = cleanText(body.password);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute<ResultSetHeader>(
        "UPDATE CUSTOMER SET name = ?, company_name = ?, address = ?, phone = ? WHERE customer_id = ?",
        [
          name,
          sqlParam(cleanText(body.company_name)),
          sqlParam(cleanText(body.address)),
          sqlParam(cleanText(body.phone)),
          id,
        ]
      );

      if (existing.user_id != null) {
        if (newPassword) {
          const hash = await bcrypt.hash(newPassword, 10);
          await connection.execute<ResultSetHeader>(
            "UPDATE USER SET username = ?, email = ?, password_hash = ? WHERE user_id = ?",
            [username, email, hash, existing.user_id]
          );
        } else {
          await connection.execute<ResultSetHeader>(
            "UPDATE USER SET username = ?, email = ? WHERE user_id = ?",
            [username, email, existing.user_id]
          );
        }
      }

      await connection.commit();
      return NextResponse.json({
        success: true,
        message: "Customer updated successfully",
      });
    } catch (error) {
      await connection.rollback();
      if (isDuplicate(error)) {
        return badRequest("Username or email is already in use");
      }
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error updating customer:", error);
    return NextResponse.json({ error: "Failed to update customer" }, { status: 500 });
  }
}

/**
 * Deletes the customer profile and its login together. Refuses when the account
 * is referenced by shipments/history so MySQL never raises a foreign-key error
 * and no data is silently orphaned.
 */
export async function DELETE(_request: Request, { params }: Context) {
  const denied = await requireOperational();
  if (denied) return denied;

  const id = parseId((await params).id);
  if (id === null) return badRequest("Invalid customer id");

  try {
    const existing = await findCustomer(id);
    if (!existing) return notFound();

    const [shipmentRows] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM SHIPMENT WHERE customer_id = ? OR created_by = ?",
      [id, existing.user_id ?? -1]
    );
    const shipmentCount = Number(shipmentRows[0]?.n ?? 0);

    let historyCount = 0;
    if (existing.user_id != null) {
      const [historyRows] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM SHIPMENT_STATUS_HISTORY WHERE changed_by = ?",
        [existing.user_id]
      );
      historyCount = Number(historyRows[0]?.n ?? 0);
    }

    if (shipmentCount > 0 || historyCount > 0) {
      return badRequest(
        `Cannot delete: this customer is linked to ${shipmentCount} shipment(s) and ` +
          `${historyCount} status history record(s). Remove or reassign those first.`
      );
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      // CUSTOMER.user_id references USER.user_id, so delete the profile first.
      await connection.execute<ResultSetHeader>(
        "DELETE FROM CUSTOMER WHERE customer_id = ?",
        [id]
      );
      if (existing.user_id != null) {
        await connection.execute<ResultSetHeader>(
          "DELETE FROM USER WHERE user_id = ?",
          [existing.user_id]
        );
      }
      await connection.commit();
      return NextResponse.json({
        success: true,
        message: "Customer deleted successfully",
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error deleting customer:", error);
    return NextResponse.json({ error: "Failed to delete customer" }, { status: 500 });
  }
}
