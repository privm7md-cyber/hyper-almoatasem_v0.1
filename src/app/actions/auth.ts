"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateAdmin, GENERIC_LOGIN_ERROR } from "@/lib/auth/login";
import {
  clearSessionCookie,
  revokeSession,
  readSessionCookie,
  setSessionCookie,
} from "@/lib/auth/session";
import { writeAuthAudit } from "@/lib/auth/audit";

const LoginSchema = z.object({
  email: z.string().min(1).max(160),
  password: z.string().min(1).max(128),
});

export interface LoginActionState {
  error?: string;
}

/** Explicit same-origin check on top of Next's built-in action protections. */
async function assertSameOrigin(): Promise<boolean> {
  const h = await headers();
  const host = h.get("host");
  const origin = h.get("origin");
  if (!origin) return true; // non-browser callers send no Origin; auth still enforced
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : null;
  return { ip, userAgent: h.get("user-agent") };
}

export async function loginAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  if (!(await assertSameOrigin())) {
    return { error: GENERIC_LOGIN_ERROR };
  }
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_LOGIN_ERROR };
  const ctx = await requestContext();
  const result = await authenticateAdmin(parsed.data.email, parsed.data.password, ctx);
  if (result.ok === false) return { error: result.error };
  await setSessionCookie(result.token);
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const ctx = await requestContext();
  const rawToken = await readSessionCookie();
  if (rawToken) {
    const { hashToken } = await import("@/lib/auth/tokens");
    const { prisma } = await import("@/lib/db");
    const row = (await prisma.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM admin_sessions
       WHERE token_hash = ${hashToken(rawToken)}::text AND revoked_at IS NULL
    `) as unknown as { user_id: string }[];
    await revokeSession(rawToken);
    await clearSessionCookie();
    await writeAuthAudit({
      action: "auth.logout",
      userId: row[0]?.user_id ?? null,
      entityType: "users",
      entityId: row[0]?.user_id ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    }).catch(() => {});
  } else {
    await clearSessionCookie();
  }
  redirect("/admin/login");
}
