import { NextResponse } from "next/server";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { pool, sqlParam, nextId } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface ProductRow extends RowDataPacket {
  product_id: number;
  name: string;
  category: string;
  min_temp_c: number;
  max_temp_c: number;
  min_humidity: number;
  max_humidity: number;
}

interface ProductForm {
  name: string;
  category: string;
  min_temp_c: number;
  max_temp_c: number;
  min_humidity: number;
  max_humidity: number;
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

// GET all products (any signed-in user)
export async function GET() {
  if (!(await getSessionUser())) return unauthorized();
  try {
    const [rows] = await pool.execute<ProductRow[]>("SELECT * FROM PRODUCT");
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}

// POST - Create new product
export async function POST(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const { name, category, min_temp_c, max_temp_c, min_humidity, max_humidity } =
      (await request.json()) as ProductForm;

    const limits = [min_temp_c, max_temp_c, min_humidity, max_humidity].map(Number);
    if (
      typeof name !== "string" || !name.trim() ||
      typeof category !== "string" || !category.trim() ||
      limits.some((v) => !Number.isFinite(v))
    ) {
      return NextResponse.json(
        { error: "name, category and all four limits are required" },
        { status: 400 }
      );
    }

    const productId = await nextId("PRODUCT", "product_id");
    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO PRODUCT (product_id, name, category, min_temp_c, max_temp_c, min_humidity, max_humidity) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [productId, name, category, ...limits]
    );

    return NextResponse.json({
      success: true,
      product_id: productId,
      message: "Product created successfully",
    });
  } catch (error) {
    console.error("Error creating product:", error);
    return NextResponse.json(
      { error: "Failed to create product" },
      { status: 500 }
    );
  }
}

// PUT - Update product
export async function PUT(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const product_id = parseId(body.product_id);
    if (product_id === null) {
      return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
    }

    await pool.execute<ResultSetHeader>(
      "UPDATE PRODUCT SET name = ?, category = ?, min_temp_c = ?, max_temp_c = ?, min_humidity = ?, max_humidity = ? WHERE product_id = ?",
      [
        sqlParam(body.name),
        sqlParam(body.category),
        sqlParam(body.min_temp_c),
        sqlParam(body.max_temp_c),
        sqlParam(body.min_humidity),
        sqlParam(body.max_humidity),
        product_id,
      ]
    );

    return NextResponse.json({
      success: true,
      message: "Product updated successfully",
    });
  } catch (error) {
    console.error("Error updating product:", error);
    return NextResponse.json(
      { error: "Failed to update product" },
      { status: 500 }
    );
  }
}

// DELETE - Delete product
export async function DELETE(request: Request) {
  const denied = await requireOperational();
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const product_id = parseId(searchParams.get("id"));
    if (product_id === null) {
      return NextResponse.json({ error: "Invalid product id" }, { status: 400 });
    }

    await pool.execute<ResultSetHeader>(
      "DELETE FROM PRODUCT WHERE product_id = ?",
      [product_id]
    );

    return NextResponse.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting product:", error);
    return NextResponse.json(
      { error: "Failed to delete product" },
      { status: 500 }
    );
  }
}
