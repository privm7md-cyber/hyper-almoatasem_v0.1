// @vitest-environment node
// Source-only regression tests: all Prisma/session/password/audit effects are mocks.
// Snapshot checks are not proof of concurrent grant/mapping serialization.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as writes from "@/lib/admin/writes";
import { checkPermission } from "@/lib/auth/rbac";
import { PATCH as patchUserRoute } from "@/app/api/admin/users/[id]/route";
import { POST as passwordRoute } from "@/app/api/admin/users/[id]/password/route";
import { POST as assignRoleRoute } from "@/app/api/admin/users/[id]/roles/route";
import { DELETE as removeRoleRoute } from "@/app/api/admin/users/[id]/roles/[roleId]/route";
import { PATCH as patchRoleRoute } from "@/app/api/admin/roles/[id]/route";

const mocks = vi.hoisted(() => ({
  userRead: vi.fn(), txUserRead: vi.fn(), roleRead: vi.fn(), mappingRead: vi.fn(), grantRead: vi.fn(),
  userUpdate: vi.fn(), roleUpdate: vi.fn(), roleDelete: vi.fn(), mappingCreate: vi.fn(), mappingDelete: vi.fn(),
  grantDelete: vi.fn(), query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), audit: vi.fn(),
  policy: vi.fn(), hash: vi.fn(), session: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findUnique: mocks.userRead }, role: { findUnique: mocks.roleRead },
  userRole: { findFirst: mocks.mappingRead }, rolePermission: { findFirst: mocks.grantRead },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/api/audit", () => ({ auditInTx: mocks.audit }));
vi.mock("@/lib/auth/password", () => ({ checkPasswordPolicy: mocks.policy, hashPassword: mocks.hash }));
vi.mock("@/lib/auth/session", () => ({
  readSessionCookie: async () => "synthetic-token-not-a-session", validateSessionToken: mocks.session,
}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), forbidden: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/api/log-events", () => ({ logOperationalEvent: vi.fn() }));
vi.mock("@/lib/admin/queries", () => ({ getUser: vi.fn(), getRole: async () => targetRole }));

const ACTOR = "00000000-0000-4000-8000-000000000001";
const TARGET = "00000000-0000-4000-8000-000000000002";
const ROLE = "00000000-0000-4000-8000-000000000003";
const OWNER = "SUPER_ADMIN";
const MANAGE = ["users.manage", "roles.manage"];
const NOW = new Date("2026-11-12T00:00:00Z");
const PASSWORD = "synthetic-policy-input";
type GraphRole = ReturnType<typeof graphRole>;

function graphRole(name: string, isActive = true, grants: Array<[string, boolean]> = []) {
  return { name, isActive, deletedAt: null, rolePermissions: grants.map(([key, active]) => ({
    permission: { key, isActive: active },
  })) };
}
function user(id: string, isActive = true, roles: GraphRole[] = []) {
  return { id, name: "Synthetic", email: "synthetic@example.invalid", phone: null, isActive,
    deletedAt: null, createdAt: NOW, updatedAt: NOW, lastLoginAt: null,
    userRoles: roles.map((role) => ({ role })) };
}
let actor: ReturnType<typeof user>;
let target: ReturnType<typeof user>;
let targetRole: { id: string; name: string; isActive: boolean; description: string | null; createdAt: Date; updatedAt: Date };
let lockedRole: { name: string; is_active: boolean };
let effectiveGrants: Array<{ key: string }>;
let holders: string[];

const tx = {
  user: { findUnique: mocks.txUserRead, update: mocks.userUpdate },
  role: { update: mocks.roleUpdate, delete: mocks.roleDelete },
  userRole: { create: mocks.mappingCreate, delete: mocks.mappingDelete },
  rolePermission: { delete: mocks.grantDelete },
  $queryRaw: mocks.query, $executeRaw: mocks.execute,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  actor = user(ACTOR, true, [graphRole("manager", true, MANAGE.map((key) => [key, true]))]);
  target = user(TARGET);
  targetRole = { id: ROLE, name: "custom", isActive: true, description: null, createdAt: NOW, updatedAt: NOW };
  lockedRole = { name: "custom", is_active: true };
  effectiveGrants = [];
  holders = [TARGET, ACTOR];
  mocks.userRead.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === ACTOR ? actor : target);
  mocks.txUserRead.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === ACTOR ? actor : target);
  mocks.roleRead.mockImplementation(async () => targetRole);
  mocks.mappingRead.mockImplementation(async () => ({ id: "synthetic-mapping", role: targetRole, user: target }));
  mocks.userUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({
    ...(where.id === ACTOR ? actor : target), ...data,
  }));
  mocks.roleUpdate.mockImplementation(async ({ data }: { data: object }) => ({ ...targetRole, ...data }));
  mocks.mappingCreate.mockResolvedValue({ id: "synthetic-new-mapping" });
  mocks.query.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("FROM roles WHERE")) return [lockedRole];
    if (sql.includes("SELECT count(*)")) return [{ n: String(holders.length) }];
    if (sql.includes("FOR UPDATE OF u, ur")) return holders.map((uid) => ({ uid }));
    if (sql.includes("JOIN permissions")) {
      expect(sql).toContain("p.is_active");
      if (sql.includes("user_roles")) {
        expect(sql).toContain("r.is_active");
        return target.userRoles.flatMap(({ role }) => role.isActive ? role.rolePermissions
          .filter(({ permission }) => permission.isActive).map(({ permission }) => ({ key: permission.key })) : []);
      }
      return effectiveGrants;
    }
    throw new Error(`Unexpected mocked SQL: ${sql}`);
  });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.policy.mockReturnValue(null);
  mocks.hash.mockResolvedValue("synthetic-hash-not-a-credential");
  mocks.session.mockResolvedValue({ userId: ACTOR, sessionId: "synthetic-session" });
});

function expectNoEffects() {
  for (const effect of [mocks.userUpdate, mocks.roleUpdate, mocks.roleDelete, mocks.mappingCreate,
    mocks.mappingDelete, mocks.grantDelete, mocks.execute, mocks.audit, mocks.hash]) {
    expect(effect).not.toHaveBeenCalled();
  }
}
async function denied(operation: Promise<unknown>, code = "FORBIDDEN") {
  await expect(operation).rejects.toMatchObject({ code });
  expectNoEffects();
}
function setOwnerTarget(active: boolean, roleActive: boolean) {
  target = user(TARGET, active, [graphRole(OWNER, roleActive)]);
}

describe("owner account boundary (mapping ownership, not email or role activity)", () => {
  for (const active of [true, false]) for (const roleActive of [true, false]) {
    it.each([{ name: "changed" }, { email: "changed@example.invalid" }, { phone: "12345678" }, { isActive: !active }])(
      `rejects non-owner patch %j with user active=${active}, owner role active=${roleActive}`, async (patch) => {
        setOwnerTarget(active, roleActive);
        await denied(writes.patchUser(TARGET, patch, ACTOR, MANAGE, ["manager"]));
      });
    it(`rejects non-owner password before policy/hash, active=${active}, role active=${roleActive}`, async () => {
      setOwnerTarget(active, roleActive);
      await denied(writes.setUserPassword(TARGET, PASSWORD, ACTOR, MANAGE, ["manager"]));
      expect(mocks.policy).not.toHaveBeenCalled();
    });
    it(`rejects ordinary role assignment/removal on owner account, active=${active}, role active=${roleActive}`, async () => {
      setOwnerTarget(active, roleActive);
      await denied(writes.assignRole(TARGET, ROLE, ACTOR, MANAGE, ["manager"]));
      await denied(writes.removeRole(TARGET, ROLE, ACTOR, MANAGE, ["manager"]));
    });
  }
  it("does not trust self id, name or owner-like email without the owner role snapshot", async () => {
    actor = user(ACTOR, true, [graphRole(OWNER)]);
    await denied(writes.patchUser(ACTOR, { email: "new@example.invalid" }, ACTOR, MANAGE, ["manager"]));
    await denied(writes.setUserPassword(ACTOR, PASSWORD, ACTOR, MANAGE, ["manager"]));
  });
  it("allows normal authorized owner self identity/credential changes, only in mocks", async () => {
    actor = user(ACTOR, true, [graphRole(OWNER)]);
    await writes.patchUser(ACTOR, { name: "Changed", email: "changed@example.invalid" }, ACTOR, MANAGE, [OWNER]);
    await writes.setUserPassword(ACTOR, PASSWORD, ACTOR, MANAGE, [OWNER]);
    expect(mocks.hash).toHaveBeenCalledTimes(1);
    expect(mocks.userUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.audit.mock.calls[1][1].newValues).toEqual({ credential: "set" });
  });
  it("keeps ordinary user edits/password provisioning available to users.manage", async () => {
    await writes.patchUser(TARGET, { name: "Changed" }, ACTOR, MANAGE, ["manager"]);
    await writes.setUserPassword(TARGET, PASSWORD, ACTOR, MANAGE, ["manager"]);
    expect(mocks.userUpdate).toHaveBeenCalledTimes(2);
  });
  it.each(["patchUser", "assignRole", "removeRole"] as const)(
    "%s rejects owner mappings newly visible at the transaction re-read", async (name) => {
      mocks.txUserRead.mockResolvedValue(user(TARGET, false, [graphRole(OWNER, false)]));
      const operation = name === "patchUser" ? writes.patchUser(TARGET, { name: "Changed" }, ACTOR, MANAGE, ["manager"]) :
        writes[name](TARGET, ROLE, ACTOR, MANAGE, ["manager"]);
      await denied(operation);
    });
  it("password re-read rejects a newly visible owner mapping before update/session revocation/audit", async () => {
    mocks.txUserRead.mockResolvedValue(user(TARGET, false, [graphRole(OWNER, false)]));
    await expect(writes.setUserPassword(TARGET, PASSWORD, ACTOR, MANAGE, ["manager"]))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    // Hashing follows the initial ownership snapshot; the later re-read
    // protects writes, not concurrent changes during that hashing window.
    expect(mocks.hash).toHaveBeenCalledTimes(1);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("recognizes only the exact reserved role name, never aliases", async () => {
    setOwnerTarget(true, true);
    await denied(writes.patchUser(TARGET, { name: "Changed" }, ACTOR, MANAGE, ["super_admin", "SUPER_ADMIN:all"]));
  });
});

describe("reactivation effective-permission ceilings", () => {
  it("rejects user activation when an active role grants outside the actor set", async () => {
    target = user(TARGET, false, [graphRole("elevated", true, [["prices.view", true]])]);
    await denied(writes.patchUser(TARGET, { isActive: true }, ACTOR, MANAGE, ["manager"]));
  });
  it("allows only active-role + active-permission grants and ignores inactive graph edges", async () => {
    target = user(TARGET, false, [
      graphRole("allowed", true, [["users.manage", true], ["prices.view", false]]),
      graphRole("disabled", false, [["prices.view", true]]),
    ]);
    await writes.patchUser(TARGET, { isActive: true }, ACTOR, MANAGE, ["manager"]);
    expect(mocks.userUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
  it("allows zero-grant user activation without inventing permission grants", async () => {
    target.isActive = false;
    await writes.patchUser(TARGET, { isActive: true }, ACTOR, MANAGE, ["manager"]);
    expect(mocks.userUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.mappingCreate).not.toHaveBeenCalled();
  });
  it("does not ceiling-check an ordinary identity edit or already-active user", async () => {
    target = user(TARGET, true, [graphRole("elevated", true, [["prices.view", true]])]);
    await writes.patchUser(TARGET, { name: "Changed", isActive: true }, ACTOR, MANAGE, ["manager"]);
    expect(mocks.userUpdate).toHaveBeenCalledTimes(1);
  });
  it("re-reads the user activation graph in the transaction rather than trusting the initial read", async () => {
    target.isActive = false;
    mocks.txUserRead.mockResolvedValue(user(TARGET, false, [graphRole("elevated")]));
    mocks.query.mockResolvedValue([{ key: "prices.view" }]);
    await denied(writes.patchUser(TARGET, { isActive: true }, ACTOR, MANAGE, ["manager"]));
    expect(mocks.txUserRead).toHaveBeenCalled();
  });
  it("locks the role first, then rejects reactivation outside the effective set", async () => {
    targetRole.isActive = false;
    lockedRole.is_active = false;
    effectiveGrants = [{ key: "prices.view" }];
    await denied(writes.patchRole(ROLE, { isActive: true }, ACTOR, MANAGE, ["manager"]));
    expect(mocks.query.mock.calls[0][0].join("?")).toContain("FOR UPDATE");
    expect(mocks.query.mock.calls[1][0].join("?")).toContain("JOIN permissions");
  });
  it("checks post-lock state even when the initial role read was active", async () => {
    lockedRole.is_active = false;
    effectiveGrants = [{ key: "prices.view" }];
    await denied(writes.patchRole(ROLE, { isActive: true }, ACTOR, MANAGE, ["manager"]));
  });
  it.each([{ grants: [] }, { grants: [{ key: "roles.manage" }] }])(
    "allows in-ceiling/zero-grant role reactivation ($grants)", async ({ grants }) => {
      targetRole.isActive = false;
      lockedRole.is_active = false;
      effectiveGrants = grants;
      await writes.patchRole(ROLE, { isActive: true }, ACTOR, MANAGE, ["manager"]);
      expect(mocks.roleUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.audit).toHaveBeenCalledTimes(1);
    });
  it("does not treat SUPER_ADMIN as a permission wildcard for reactivation", async () => {
    targetRole.isActive = false;
    lockedRole.is_active = false;
    effectiveGrants = [{ key: "prices.view" }];
    await denied(writes.patchRole(ROLE, { isActive: true }, ACTOR, MANAGE, [OWNER]));
    target = user(TARGET, false, [graphRole(OWNER, true, [["prices.view", true]])]);
    await denied(writes.patchUser(TARGET, { isActive: true }, ACTOR, MANAGE, [OWNER]));
  });
});

describe("reserved role and mapping boundaries", () => {
  it.each([{ description: "changed" }, { isActive: false }, { isActive: true }])(
    "forbids non-owner SUPER_ADMIN role edit %j regardless of last-holder state", async (patch) => {
      targetRole.name = OWNER;
      lockedRole.name = OWNER;
      holders = [];
      await denied(writes.patchRole(ROLE, patch, ACTOR, MANAGE, ["manager"]));
    });
  it("forbids non-owner promotion of a custom role to the exact reserved name", async () => {
    await denied(writes.patchRole(ROLE, { name: OWNER }, ACTOR, MANAGE, ["manager"]));
  });
  it("rechecks reserved ownership and rename protection after the role lock", async () => {
    lockedRole.name = OWNER;
    await denied(writes.patchRole(ROLE, { description: "changed" }, ACTOR, MANAGE, ["manager"]));
    await denied(writes.patchRole(ROLE, { name: "renamed" }, ACTOR, MANAGE, [OWNER]));
  });
  it("allows authorized owner role metadata edits without bypassing rename protection", async () => {
    targetRole.name = OWNER;
    lockedRole.name = OWNER;
    await writes.patchRole(ROLE, { description: "changed" }, ACTOR, MANAGE, [OWNER]);
    expect(mocks.roleUpdate).toHaveBeenCalledTimes(1);
  });
  it("blocks non-owner SUPER_ADMIN assignment even with an empty/in-ceiling role", async () => {
    lockedRole.name = OWNER;
    await denied(writes.assignRole(TARGET, ROLE, ACTOR, MANAGE, ["manager"]));
  });
  it("blocks removal of an inactive SUPER_ADMIN mapping even without a holder census", async () => {
    targetRole.name = OWNER;
    target.isActive = false;
    await denied(writes.removeRole(TARGET, ROLE, ACTOR, MANAGE, ["manager"]));
  });
  it("allows owner mapping management on the normal authorized path", async () => {
    targetRole.name = OWNER;
    lockedRole.name = OWNER;
    setOwnerTarget(true, true);
    await writes.assignRole(TARGET, ROLE, ACTOR, MANAGE, [OWNER]);
    await writes.removeRole(TARGET, ROLE, ACTOR, MANAGE, [OWNER]);
    expect(mocks.mappingCreate).toHaveBeenCalledTimes(1);
    expect(mocks.mappingDelete).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledTimes(2);
  });
  it("retains ordinary assignment ceiling and removal reachability", async () => {
    effectiveGrants = [{ key: "prices.view" }];
    await denied(writes.assignRole(TARGET, ROLE, ACTOR, MANAGE, ["manager"]));
    effectiveGrants = [{ key: "roles.manage" }];
    await writes.assignRole(TARGET, ROLE, ACTOR, MANAGE, ["manager"]);
    await writes.removeRole(TARGET, ROLE, ACTOR, MANAGE, ["manager"]);
    expect(mocks.mappingDelete).toHaveBeenCalledTimes(1);
  });
});

describe("fail-closed snapshots and frozen protections", () => {
  it.each([
    () => writes.patchUser(TARGET, { name: "changed" }, ACTOR),
    () => writes.setUserPassword(TARGET, PASSWORD, ACTOR),
    () => writes.patchRole(ROLE, { description: "changed" }, ACTOR),
    () => writes.assignRole(TARGET, ROLE, ACTOR),
    () => writes.removeRole(TARGET, ROLE, ACTOR),
  ])("rejects omitted effective authorization context (%#)", async (operation) => { await denied(operation()); });
  it.each([
    () => writes.patchUser(TARGET, { name: "changed" }, ACTOR, [], [OWNER]),
    () => writes.setUserPassword(TARGET, PASSWORD, ACTOR, [], [OWNER]),
    () => writes.patchRole(ROLE, { description: "changed" }, ACTOR, [], [OWNER]),
    () => writes.assignRole(TARGET, ROLE, ACTOR, [], [OWNER]),
    () => writes.removeRole(TARGET, ROLE, ACTOR, [], [OWNER]),
  ])("owner membership never substitutes for the required manage permission (%#)", async (operation) => { await denied(operation()); });
  it("rejects omitted owner role context despite manage permissions", async () => {
    setOwnerTarget(true, true);
    await denied(writes.patchUser(TARGET, { name: "changed" }, ACTOR, MANAGE));
    await denied(writes.setUserPassword(TARGET, PASSWORD, ACTOR, MANAGE));
    await denied(writes.assignRole(TARGET, ROLE, ACTOR, MANAGE));
    await denied(writes.removeRole(TARGET, ROLE, ACTOR, MANAGE));
    targetRole.name = OWNER;
    lockedRole.name = OWNER;
    await denied(writes.patchRole(ROLE, { description: "changed" }, ACTOR, MANAGE));
  });
  it("still rejects owner self-deactivation before any transaction", async () => {
    actor = user(ACTOR, true, [graphRole(OWNER)]);
    await denied(writes.patchUser(ACTOR, { isActive: false }, ACTOR, MANAGE, [OWNER]));
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("still protects the last active owner on user deactivation", async () => {
    setOwnerTarget(true, true);
    holders = [TARGET];
    await denied(writes.patchUser(TARGET, { isActive: false }, ACTOR, MANAGE, [OWNER]), "CONFLICT");
    expect(mocks.query.mock.calls[0][0].join("?")).toMatch(/ORDER BY u.id ASC\s+FOR UPDATE OF u, ur/);
  });
  it("still protects the last active owner on mapping removal", async () => {
    targetRole.name = OWNER;
    setOwnerTarget(true, true);
    holders = [TARGET];
    await denied(writes.removeRole(TARGET, ROLE, ACTOR, MANAGE, [OWNER]), "CONFLICT");
  });
  it("still prevents reserved role deactivation while active holders exist", async () => {
    targetRole.name = OWNER;
    lockedRole.name = OWNER;
    await denied(writes.patchRole(ROLE, { isActive: false }, ACTOR, MANAGE, [OWNER]), "CONFLICT");
  });
  it("rejects a non-owner deleting a reserved-named role before any write", async () => {
    targetRole.name = OWNER;
    await denied(writes.deleteRole(ROLE, ACTOR, ["manager"]));
  });
  it("rejects revoking a permission outside the actor's effective set", async () => {
    mocks.grantRead.mockResolvedValue({ id: "synthetic-grant", role: { name: "custom" }, permission: { key: "prices.view" } });
    await denied(writes.removeGrant(ROLE, ROLE, ACTOR, ["roles.manage"]));
  });
  it("preserves reserved role rename/delete/grant-revoke prohibitions even for owner", async () => {
    targetRole.name = OWNER;
    lockedRole.name = OWNER;
    mocks.grantRead.mockResolvedValue({ id: "synthetic-grant", role: { name: OWNER }, permission: { key: "prices.view" } });
    await denied(writes.patchRole(ROLE, { name: "renamed" }, ACTOR, MANAGE, [OWNER]));
    await denied(writes.deleteRole(ROLE, ACTOR));
    await denied(writes.removeGrant(ROLE, ROLE, ACTOR));
  });
});

function request(method: string, body?: object) {
  return new Request("http://localhost/api/admin/synthetic", {
    method, headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const context = () => ({ params: Promise.resolve({ id: TARGET, roleId: ROLE }) });

describe("direct API calls use real checkPermission effective permissions/active roles", () => {
  const cases = [
    { name: "patchUser", permission: "users.manage", invoke: () => patchUserRoute(request("PATCH", { name: "Changed" }), context()) },
    { name: "setUserPassword", permission: "users.manage", invoke: () => passwordRoute(request("POST", { password: PASSWORD }), context()) },
    { name: "assignRole", permission: "roles.manage", invoke: () => assignRoleRoute(request("POST", { roleId: ROLE }), context()) },
    { name: "removeRole", permission: "roles.manage", invoke: () => removeRoleRoute(request("DELETE"), context()) },
    { name: "patchRole", permission: "roles.manage", invoke: () => patchRoleRoute(request("PATCH", { description: "Changed" }), context()) },
  ] as const;
  it.each(cases)("$name forwards the actual active context, without prices.view implication", async ({ name, invoke }) => {
    actor.userRoles.push({ role: graphRole(OWNER, false, [["prices.view", true]]) });
    actor.userRoles[0].role.rolePermissions.push({ permission: { key: "prices.view", isActive: false } });
    const auth = await checkPermission("users.manage");
    expect(auth).toMatchObject({ ok: true, admin: { roles: ["manager"], permissions: MANAGE } });
    const spy = vi.spyOn(writes, name);
    const response = await invoke();
    expect(response.status).toBeLessThan(300);
    expect(spy.mock.calls[0].slice(2)).toEqual([ACTOR, MANAGE, ["manager"]]);
    expect(spy.mock.calls[0][3]).not.toContain("prices.view");
  });
  it.each(cases)("$name rejects direct non-owner mutations of the protected account/role", async ({ name, invoke }) => {
    setOwnerTarget(false, false);
    if (name === "patchRole") { targetRole.name = OWNER; lockedRole.name = OWNER; }
    const response = await invoke();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expectNoEffects();
  });
  it.each(cases)("$name accepts normal explicitly granted owner context in isolated mocks", async ({ name, invoke }) => {
    actor = user(ACTOR, true, [graphRole(OWNER, true, MANAGE.map((key) => [key, true]))]);
    setOwnerTarget(true, true);
    if (name === "patchRole") { targetRole.name = OWNER; lockedRole.name = OWNER; }
    const spy = vi.spyOn(writes, name);
    expect((await invoke()).status).toBeLessThan(300);
    expect(spy.mock.calls[0].slice(2)).toEqual([ACTOR, MANAGE, [OWNER]]);
  });
  it.each(cases)("$name refuses an owner role without $permission before domain effects", async ({ invoke }) => {
    actor = user(ACTOR, true, [graphRole(OWNER)]);
    expect((await invoke()).status).toBe(403);
    expectNoEffects();
  });
  it("inactive users/roles and owner-like email cannot authorize mutations", async () => {
    actor.isActive = false;
    expect((await passwordRoute(request("POST", { password: PASSWORD }), context())).status).toBe(401);
    actor.isActive = true;
    actor.userRoles[0].role.isActive = false;
    actor.email = "owner@example.invalid";
    actor.name = OWNER;
    expect((await passwordRoute(request("POST", { password: PASSWORD }), context())).status).toBe(403);
    expectNoEffects();
  });
});
