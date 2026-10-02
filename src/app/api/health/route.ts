// Liveness + DB-readiness probe (BA-A closure; infrastructure-level).
// Public, no auth, no secrets, no business writes: a single `SELECT 1`
// through the app's Prisma client. Healthy → 200 canonical envelope;
// DB unreachable → sanitized 500 (no driver text, no connection details).
// Never migrates, seeds, cleans, or mutates. Not a scheduler target.
import { NextResponse } from "next/server";
import { fail, ok } from "@/lib/api/respond";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const r = ok({ status: "ok", database: "ok" });
    return NextResponse.json(r.body, { status: r.status });
  } catch (error) {
    const r = fail(error);
    return NextResponse.json(r.body, { status: r.status });
  }
}
