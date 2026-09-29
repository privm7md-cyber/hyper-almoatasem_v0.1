// Admin catalog: single code GET / PATCH / DELETE.
// Reads: products.view. Type/primary changes: products.update.
// Removal: products.delete (hard row delete — codes carry no soft state;
// variants/products are never hard-deleted: frozen RESTRICT graph).
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { fail, ok } from "@/lib/api/respond";
import { adminOrDeny, denyUnless } from "@/lib/api/route-auth";
import { uuidSchema } from "@/lib/api/validation";
import { codePatchSchema } from "@/lib/catalog/validation";
import { deleteCode, patchCode } from "@/lib/catalog/writes";
import { prisma } from "@/lib/db";

async function validId(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) return null;
  return id;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await denyUnless("products.view");
  if (denied) return denied;
  const id = await validId(context);
  if (!id) {
    const r = fail(new ApiError("VALIDATION", "Invalid code id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const row = await prisma.productCode.findUnique({ where: { id } });
  if (!row) {
    const r = fail(new ApiError("NOT_FOUND", "Product code not found."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const r = ok({ id: row.id, code: row.code, type: row.type, isPrimary: row.isPrimary });
  return NextResponse.json(r.body, { status: r.status });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.update");
  if ("denied" in gate) return gate.denied;
  const id = await validId(context);
  if (!id) {
    const r = fail(new ApiError("VALIDATION", "Invalid code id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const r = fail(new ApiError("VALIDATION", "Invalid request body."));
    return NextResponse.json(r.body, { status: r.status });
  }
  const parsed = codePatchSchema.safeParse(body);
  if (!parsed.success) {
    const r = fail(new ApiError("VALIDATION", "Invalid product code."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const row = await patchCode(id, parsed.data, gate.admin.user.id);
    if (!row) {
      const r = fail(new ApiError("NOT_FOUND", "Product code not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ id: row.id, code: row.code, type: row.type, isPrimary: row.isPrimary });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await adminOrDeny("products.delete");
  if ("denied" in gate) return gate.denied;
  const id = await validId(context);
  if (!id) {
    const r = fail(new ApiError("VALIDATION", "Invalid code id."));
    return NextResponse.json(r.body, { status: r.status });
  }
  try {
    const removed = await deleteCode(id, gate.admin.user.id);
    if (!removed) {
      const r = fail(new ApiError("NOT_FOUND", "Product code not found."));
      return NextResponse.json(r.body, { status: r.status });
    }
    const r = ok({ id });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
