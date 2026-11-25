import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(),
  notification: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: dbMock }));

import {
  countOwnUnreadNotifications,
  isKnownNotificationType,
  listOwnNotifications,
  markAllOwnNotificationsRead,
  markOwnNotificationRead,
  notificationTypeLabel,
} from "../notifications";

const admin = { user: { id: "00000000-0000-4000-8000-000000000001", name: "PRIVATE_NAME", email: "PRIVATE_EMAIL@example.invalid" }, roles: [], permissions: [] };
const foreignUser = "00000000-0000-4000-8000-000000000099";
const id = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const jsonRow = { id: id(2), title: "تنبيه", message: "رسالة", readAt: null, createdAt: "2026-11-10T12:00:00.123456Z" };

beforeEach(() => {
  vi.resetAllMocks();
  dbMock.$queryRaw.mockResolvedValue([{ anchorValid: true, rows: [] }]);
});

function capturedQuery() {
  const [strings, ...values] = dbMock.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return { strings, values, sql: strings.join("?").replace(/\s+/g, " ").trim() };
}

function expectNoWritesOrOrmList() {
  for (const method of Object.values(dbMock.notification)) expect(method).not.toHaveBeenCalled();
  expect(dbMock.$queryRawUnsafe).not.toHaveBeenCalled();
  expect(dbMock.$executeRaw).not.toHaveBeenCalled();
  expect(dbMock.$transaction).not.toHaveBeenCalled();
}

describe("notification SQL shape and bound parameters (not live SQL execution)", () => {
  it("preserves the own unread count scope", async () => {
    dbMock.notification.count.mockResolvedValue(3);
    expect(await countOwnUnreadNotifications(admin)).toBe(3);
    expect(dbMock.notification.count).toHaveBeenCalledWith({ where: { userId: admin.user.id, readAt: null } });
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([false, true])("binds UUIDs, unread=%s and a null type filter without dates or interpolation", async (unread) => {
    await listOwnNotifications(admin, id(42), unread);
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    const { strings, values, sql } = capturedQuery();
    expect(strings.raw).toBeDefined();
    expect(values).toEqual([admin.user.id, id(42), unread, null]);
    expect(values.some(value => value instanceof Date)).toBe(false);
    expect(sql).toContain("SELECT ?::uuid AS user_id, ?::uuid AS cursor, ?::boolean AS unread_only, ?::text AS type_filter");
    expect(sql).not.toContain(admin.user.id);
    expect(sql).not.toContain(id(42));
    expectNoWritesOrOrmList();
  });

  it("binds the requested type and matches it inside the owned scope only", async () => {
    await listOwnNotifications(admin, null, false, "security.role_changed");
    const { values, sql } = capturedQuery();
    expect(values).toEqual([admin.user.id, null, false, "security.role_changed"]);
    expect(sql).toContain("AND (i.type_filter IS NULL OR n.type = i.type_filter)");
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expectNoWritesOrOrmList();
  });

  it.each(["", "all", "SECURITY.ROLE_CHANGED", "security.role_changed' OR TRUE --", "security.unknown"])(
    "rejects unknown type filter %j before SQL",
    async (type) => {
      expect(await listOwnNotifications(admin, null, false, type)).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
      expect(dbMock.$queryRaw).not.toHaveBeenCalled();
      expectNoWritesOrOrmList();
    },
  );

  it("binds null cursor for the genuine first page", async () => {
    expect(await listOwnNotifications(admin, null, false)).toEqual({ rows: [], nextCursor: null, invalidCursor: false });
    expect(capturedQuery().values).toEqual([admin.user.id, null, false, null]);
  });

  it("resolves scoped anchor, exact tuple keyset, ordered probe and validity in one statement", async () => {
    await listOwnNotifications(admin, id(2), true);
    const { sql } = capturedQuery();
    expect(sql).toContain("WITH input AS (");
    expect(sql).toContain("scoped AS ( SELECT n.id, n.title, n.message, n.read_at, n.created_at FROM notifications AS n CROSS JOIN input AS i WHERE n.user_id = i.user_id AND (NOT i.unread_only OR n.read_at IS NULL) AND (i.type_filter IS NULL OR n.type = i.type_filter) )");
    expect(sql).toContain("anchor AS ( SELECT s.id, s.created_at FROM scoped AS s CROSS JOIN input AS i WHERE s.id = i.cursor )");
    expect(sql).toContain("page AS ( SELECT s.id, s.title, s.message, s.read_at, s.created_at FROM scoped AS s CROSS JOIN input AS i WHERE i.cursor IS NULL OR (s.created_at, s.id) < ( SELECT a.created_at, a.id FROM anchor AS a ) ORDER BY s.created_at DESC, s.id DESC LIMIT 21 )");
    expect(sql).toContain('SELECT (i.cursor IS NULL OR EXISTS (SELECT 1 FROM anchor)) AS "anchorValid"');
    expect(sql).toContain("ORDER BY p.created_at DESC, p.id DESC");
    expect(sql).toContain("FROM page AS p ), '[]'::jsonb) AS rows FROM input AS i");
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|FOR UPDATE|OFFSET|date_trunc|SELECT \*)\b|created_at::/i);
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    expectNoWritesOrOrmList();
  });

  it("projects only display JSON fields and formats both dates explicitly as UTC microsecond ISO strings", async () => {
    await listOwnNotifications(admin, null, false);
    const { sql } = capturedQuery();
    expect(sql).toContain("jsonb_build_object( 'id', p.id, 'title', p.title, 'message', p.message, 'readAt', to_char(p.read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'), 'createdAt', to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') )");
    expect(sql).not.toMatch(/\b(?:n|s|p)\.data\b|'(?:data|type|userId)'|row_to_json|to_jsonb/);
  });

  it.each(["", "not-a-uuid", "00000000-0000-4000-8000000000000001", "00000000-0000-4000-8000-000000000002' OR TRUE --", `${id(2)}\n`])("rejects malformed cursor %j before SQL", async (cursor) => {
    expect(await listOwnNotifications(admin, cursor, true)).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();
    expectNoWritesOrOrmList();
  });

  it("accepts canonical uppercase UUIDs as bound UUID values", async () => {
    const cursor = id(42).toUpperCase();
    await listOwnNotifications(admin, cursor, false);
    expect(capturedQuery().values).toEqual([admin.user.id, cursor, false, null]);
  });

  it("converts dates only in returned display rows and strips any unexpected private fields", async () => {
    dbMock.$queryRaw.mockResolvedValue([{ anchorValid: true, rows: [{ ...jsonRow, readAt: "2026-11-11T04:05:06.987654Z", userId: "PRIVATE_OWNER", type: "PRIVATE_TYPE", data: { secret: "PRIVATE_DATA" } }] }]);
    const result = await listOwnNotifications(admin, null, false);
    expect(result.rows).toEqual([{ ...jsonRow, readAt: new Date("2026-11-11T04:05:06.987Z"), createdAt: new Date("2026-11-10T12:00:00.123Z") }]);
    expect(Object.keys(result.rows[0]).sort()).toEqual(["createdAt", "id", "message", "readAt", "title"]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
    expectNoWritesOrOrmList();
  });

  it("ignores rows in an invalid-anchor envelope and does not expose their contents", async () => {
    dbMock.$queryRaw.mockResolvedValue([{ anchorValid: false, rows: [{ ...jsonRow, title: "PRIVATE_FOREIGN" }] }]);
    expect(await listOwnNotifications(admin, id(2), true)).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
  });

  it.each([0, 1, 20, 21])("returns at most 20 display rows with the correct probe cursor for %s rows", async (length) => {
    const rows = Array.from({ length }, (_, index) => ({ ...jsonRow, id: id(index + 2) }));
    dbMock.$queryRaw.mockResolvedValue([{ anchorValid: true, rows }]);
    const result = await listOwnNotifications(admin, null, false);
    expect(result.rows).toHaveLength(Math.min(length, 20));
    expect(result.nextCursor).toBe(length > 20 ? rows[19].id : null);
    expect(result.invalidCursor).toBe(false);
  });

  it("propagates a failed SQL read and treats a missing envelope as unavailable, not empty", async () => {
    dbMock.$queryRaw.mockRejectedValueOnce(new Error("fixture offline"));
    await expect(listOwnNotifications(admin, id(2), false)).rejects.toThrow("fixture offline");
    dbMock.$queryRaw.mockResolvedValueOnce([]);
    await expect(listOwnNotifications(admin, null, false)).rejects.toThrow("Notification page unavailable");
    expectNoWritesOrOrmList();
  });
});

describe("own-inbox read state (ADM-11)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    dbMock.notification.updateMany.mockResolvedValue({ count: 1 });
  });

  it("keeps the type vocabulary closed and labels only known types", () => {
    expect(isKnownNotificationType("security.role_changed")).toBe(true);
    expect(isKnownNotificationType("security.account_locked")).toBe(true);
    expect(isKnownNotificationType("SECURITY.ROLE_CHANGED")).toBe(false);
    expect(isKnownNotificationType("security.anything")).toBe(false);
    expect(notificationTypeLabel("security.role_changed")).toBe("تغيير في صلاحيات الإدارة");
    expect(notificationTypeLabel("unknown.type")).toBe("إشعار من النظام");
  });

  it("marks one owned unread notification and scopes both read and update by userId", async () => {
    dbMock.notification.findFirst.mockResolvedValue({ id: id(2), readAt: null });
    expect(await markOwnNotificationRead(admin, id(2))).toBe("updated");
    expect(dbMock.notification.findFirst).toHaveBeenCalledWith({
      where: { id: id(2), userId: admin.user.id },
      select: { id: true, readAt: true },
    });
    expect(dbMock.notification.updateMany).toHaveBeenCalledWith({
      where: { id: id(2), userId: admin.user.id, readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(dbMock.notification.updateMany.mock.calls[0][0].data.readAt).not.toBeNull();
  });

  it("never updates a foreign or missing notification and says so without leaking which", async () => {
    dbMock.notification.findFirst.mockResolvedValue(null);
    expect(await markOwnNotificationRead(admin, id(9))).toBe("missing");
    expect(dbMock.notification.findFirst).toHaveBeenCalledWith({
      where: { id: id(9), userId: admin.user.id },
      select: { id: true, readAt: true },
    });
    expect(dbMock.notification.updateMany).not.toHaveBeenCalled();
  });

  it("keeps an already-read row idempotent (no second timestamp)", async () => {
    dbMock.notification.findFirst.mockResolvedValue({ id: id(2), readAt: new Date("2026-11-11T00:00:00Z") });
    expect(await markOwnNotificationRead(admin, id(2))).toBe("already-read");
    expect(dbMock.notification.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a malformed id before any query", async () => {
    expect(await markOwnNotificationRead(admin, "not-a-uuid")).toBe("missing");
    expect(dbMock.notification.findFirst).not.toHaveBeenCalled();
    expect(dbMock.notification.updateMany).not.toHaveBeenCalled();
  });

  it("marks all unread rows of the own account only and returns the changed count", async () => {
    dbMock.notification.updateMany.mockResolvedValue({ count: 7 });
    expect(await markAllOwnNotificationsRead(admin)).toBe(7);
    expect(dbMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: admin.user.id, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});

describe("exact-microsecond isolated inbox reference model (not a SQL engine or live SQL proof)", () => {
  type Fixture = Omit<typeof jsonRow, "readAt"> & { userId: string; type: string; data: { secret: string }; readAt: string | null };
  let inbox: Fixture[];
  const fixture = (index: number, createdAt = jsonRow.createdAt): Fixture => ({
    ...jsonRow, id: id(index), title: `إشعار ${index}`, createdAt, userId: admin.user.id,
    type: "PRIVATE_TYPE", data: { secret: "PRIVATE_DATA" },
  });
  const micros = (value: string): bigint => {
    const match = /^(.*T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/.exec(value);
    if (!match) throw new Error("Fixture requires exact six-digit UTC microseconds");
    return BigInt(Date.parse(`${match[1]}Z`)) * BigInt(1000) + BigInt(match[2]);
  };
  const descending = (a: Fixture, b: Fixture) => {
    const aTime = micros(a.createdAt), bTime = micros(b.createdAt);
    return aTime > bTime ? -1 : aTime < bTime ? 1 : a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
  };

  beforeEach(() => {
    inbox = [];
    // This reference model uses bound inputs only. It deliberately does NOT parse or execute SQL.
    // SQL structure is checked above; PostgreSQL/adapter behavior needs separate live verification.
    dbMock.$queryRaw.mockImplementation(async (_strings, userId: string, cursor: string | null, unread: boolean) => {
      const scoped = inbox.filter(item => item.userId === userId && (!unread || item.readAt === null));
      const anchor = cursor === null ? null : scoped.find(item => item.id === cursor.toLowerCase());
      const anchorValid = cursor === null || !!anchor;
      const rows = anchorValid ? scoped.filter(item => !anchor || descending(item, anchor) > 0)
        .sort(descending).slice(0, 21)
        .map(({ id, title, message, readAt, createdAt }) => ({ id, title, message, readAt, createdAt })) : [];
      return [{ anchorValid, rows }];
    });
  });

  it.each([false, true])("traverses 47 adversarial sub-millisecond rows, ties and repeated pages without overlap/skips, unread=%s", async (unread) => {
    // Newer timestamp groups deliberately have LOWER IDs; each group has equal-time UUID ties.
    const groups = Array.from({ length: 16 }, (_, group) => Array.from({ length: group === 15 ? 2 : 3 }, (_, member) =>
      fixture(group * 3 + member + 1, `2026-11-10T12:00:00.${123415 - group}Z`)));
    const own = groups.flat();
    inbox = [...own, { ...fixture(100, "2026-11-10T12:00:01.000001Z"), userId: foreignUser }];
    const before = structuredClone(inbox);
    const expected = groups.flatMap(group => [...group].reverse()).map(item => item.id);
    expect(new Set(own.map(item => new Date(item.createdAt).getTime())).size).toBe(1);
    expect(micros(own[0].createdAt) - micros(own[own.length - 1].createdAt)).toBe(BigInt(15));
    expect(expected.slice(0, 3)).toEqual([id(3), id(2), id(1)]);

    const first = await listOwnNotifications(admin, null, unread);
    expect(first).toEqual(await listOwnNotifications(admin, null, unread));
    expect(first.rows.map(item => item.id)).toEqual(expected.slice(0, 20));
    expect(first.nextCursor).toBe(expected[19]);
    expect(first.nextCursor).not.toBe(expected[20]);
    const second = await listOwnNotifications(admin, first.nextCursor, unread);
    expect(second).toEqual(await listOwnNotifications(admin, first.nextCursor, unread));
    expect(second.rows[0].id).toBe(expected[20]); // The hidden 21st probe is not skipped.
    expect(second.rows.map(item => item.id)).toEqual(expected.slice(20, 40));
    expect(second.nextCursor).toBe(expected[39]);
    const third = await listOwnNotifications(admin, second.nextCursor, unread);
    expect(third).toEqual(await listOwnNotifications(admin, second.nextCursor, unread));
    expect(third.rows.map(item => item.id)).toEqual(expected.slice(40));
    expect(third.nextCursor).toBeNull();
    expect(third.invalidCursor).toBe(false);
    const traversed = [...first.rows, ...second.rows, ...third.rows].map(item => item.id);
    expect(traversed).toEqual(expected);
    expect(new Set(traversed).size).toBe(47);
    expect(JSON.stringify([first, second, third])).not.toMatch(/PRIVATE_|userId|"type"|"data"/);
    expect(inbox).toEqual(before);
    expectNoWritesOrOrmList();
  });

  it("continues more than 20 identical microsecond timestamps by descending UUID", async () => {
    inbox = Array.from({ length: 25 }, (_, index) => fixture(index + 1));
    const first = await listOwnNotifications(admin, null, false);
    expect(first.rows.map(item => item.id)).toEqual(Array.from({ length: 20 }, (_, index) => id(25 - index)));
    expect(first.nextCursor).toBe(id(6));
    const second = await listOwnNotifications(admin, first.nextCursor, false);
    expect(second.rows.map(item => item.id)).toEqual([id(5), id(4), id(3), id(2), id(1)]);
    expect(second.nextCursor).toBeNull();
  });

  it("retains whole-second and microsecond order across a second boundary", async () => {
    inbox = [fixture(1, "2026-11-10T12:00:01.000001Z"), fixture(3, "2026-11-10T12:00:00.999999Z"), fixture(2, "2026-11-10T12:00:01.000000Z")];
    expect((await listOwnNotifications(admin, null, false)).rows.map(item => item.id)).toEqual([id(1), id(2), id(3)]);
    expect((await listOwnNotifications(admin, id(1), false)).rows.map(item => item.id)).toEqual([id(2), id(3)]);
  });

  it.each(["missing", "foreign", "deleted", "read"] as const)("rejects a %s anchor from the same scoped model snapshot", async (state) => {
    const anchor = fixture(2);
    inbox = [fixture(1)];
    if (state === "foreign") inbox.push({ ...anchor, userId: foreignUser, title: "PRIVATE_FOREIGN" });
    if (state === "deleted" || state === "read") {
      inbox.push(anchor);
      expect((await listOwnNotifications(admin, null, true)).rows.some(item => item.id === anchor.id)).toBe(true);
      if (state === "deleted") inbox = inbox.filter(item => item.id !== anchor.id);
      else anchor.readAt = "2026-11-11T10:00:00.000001Z";
    }
    const before = structuredClone(inbox);
    dbMock.$queryRaw.mockClear();
    expect(await listOwnNotifications(admin, anchor.id, true)).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(inbox).toEqual(before);
    expectNoWritesOrOrmList();
  });

  it("excludes read rows in unread scope but allows their anchor in the full own inbox", async () => {
    inbox = [fixture(1), { ...fixture(2), readAt: "2026-11-11T10:00:00.000001Z" }, { ...fixture(3), userId: foreignUser }];
    expect((await listOwnNotifications(admin, null, true)).rows.map(item => item.id)).toEqual([id(1)]);
    expect((await listOwnNotifications(admin, null, false)).rows.map(item => item.id)).toEqual([id(2), id(1)]);
    expect((await listOwnNotifications(admin, id(2), true)).invalidCursor).toBe(true);
    const all = await listOwnNotifications(admin, id(2), false);
    expect(all.invalidCursor).toBe(false);
    expect(all.rows.map(item => item.id)).toEqual([id(1)]);
  });

  it.each([false, true])("distinguishes null-cursor empty inbox, invalid cursor, and valid final empty page, unread=%s", async (unread) => {
    inbox = [{ ...fixture(2), userId: foreignUser }];
    expect(await listOwnNotifications(admin, null, unread)).toEqual({ rows: [], nextCursor: null, invalidCursor: false });
    expect(await listOwnNotifications(admin, id(2), unread)).toEqual({ rows: [], nextCursor: null, invalidCursor: true });
    inbox.push(fixture(1));
    expect(await listOwnNotifications(admin, id(1), unread)).toEqual({ rows: [], nextCursor: null, invalidCursor: false });
  });

  it("resolves uppercase UUID cursor to the stored anchor rather than a text ordering anchor", async () => {
    inbox = [fixture(42), fixture(41)];
    const page = await listOwnNotifications(admin, id(42).toUpperCase(), false);
    expect(page.invalidCursor).toBe(false);
    expect(page.rows.map(item => item.id)).toEqual([id(41)]);
  });
});
