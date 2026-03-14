import assert from "node:assert/strict";

import workerModule, {
  escapeIcsText,
  normalizeAlarmOffset,
  normalizeStartAt,
  renderIcsCalendar,
  toIcsUtcTimestamp,
  validateReminderPayload,
} from "../src/index.ts";

type StoredReminder = {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  url: string | null;
  start_at_utc: string;
  timezone: string;
  all_day: number;
  rrule: string | null;
  alarm_offset_minutes: number | null;
  source_text: string | null;
  idempotency_key: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type StoredFeed = {
  id: string;
  token_hash: string;
  owner_label: string;
  status: string;
  created_at: string;
  rotated_at: string;
};

class MockPreparedStatement {
  readonly sql: string;
  readonly values: unknown[];
  readonly db: MockD1Database;

  constructor(db: MockD1Database, sql: string, values: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new MockPreparedStatement(this.db, this.sql, values) as unknown as D1PreparedStatement;
  }

  async first<T>(): Promise<T | null> {
    return this.db.executeFirst<T>(this.sql, this.values);
  }

  async all<T>(): Promise<D1Result<T>> {
    return this.db.executeAll<T>(this.sql, this.values);
  }

  async run(): Promise<D1Result<never>> {
    return this.db.executeRun(this.sql, this.values);
  }
}

class MockD1Database {
  private reminders = new Map<string, StoredReminder>();
  private feeds = new Map<string, StoredFeed>();

  prepare(sql: string): D1PreparedStatement {
    return new MockPreparedStatement(this, normalizeSql(sql)) as unknown as D1PreparedStatement;
  }

  async batch(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<unknown>[]> {
    const results: D1Result<unknown>[] = [];
    for (const statement of statements) {
      const prepared = statement as unknown as MockPreparedStatement;
      results.push(await this.executeRun(prepared.sql, prepared.values));
    }
    return results;
  }

  countFeeds(): number {
    return this.feeds.size;
  }

  async executeFirst<T>(sql: string, values: unknown[]): Promise<T | null> {
    if (sql === "SELECT id, created_at FROM reminders WHERE idempotency_key = ?1") {
      const idempotencyKey = values[0] as string;
      const reminder =
        [...this.reminders.values()].find(
          (entry) => entry.idempotency_key === idempotencyKey,
        ) ?? null;
      if (!reminder) {
        return null;
      }

      return {
        id: reminder.id,
        created_at: reminder.created_at,
      } as T;
    }

    if (
      sql ===
      "SELECT id FROM feeds WHERE owner_label = 'default' AND status = 'active'"
    ) {
      const feed =
        [...this.feeds.values()].find(
          (entry) => entry.owner_label === "default" && entry.status === "active",
        ) ?? null;
      return feed ? ({ id: feed.id } as T) : null;
    }

    if (sql === "SELECT id FROM feeds WHERE token_hash = ?1 AND status = 'active'") {
      const tokenHash = values[0] as string;
      const feed =
        [...this.feeds.values()].find(
          (entry) => entry.token_hash === tokenHash && entry.status === "active",
        ) ?? null;
      return feed ? ({ id: feed.id } as T) : null;
    }

    throw new Error(`Unsupported first() SQL: ${sql}`);
  }

  async executeAll<T>(sql: string, _values: unknown[]): Promise<D1Result<T>> {
    if (
      sql ===
      "SELECT id, title, notes, location, url, start_at_utc, timezone, all_day, rrule, alarm_offset_minutes, source_text, status, created_at, updated_at FROM reminders ORDER BY start_at_utc ASC"
    ) {
      return toD1Result(
        [...this.reminders.values()]
          .sort((left, right) => left.start_at_utc.localeCompare(right.start_at_utc))
          .map((entry) => ({ ...entry }) as T),
      );
    }

    if (
      sql ===
      "SELECT id, title, notes, location, url, start_at_utc, timezone, all_day, rrule, alarm_offset_minutes, status, updated_at FROM reminders WHERE status = 'active' ORDER BY start_at_utc ASC"
    ) {
      return toD1Result(
        [...this.reminders.values()]
          .filter((entry) => entry.status === "active")
          .sort((left, right) => left.start_at_utc.localeCompare(right.start_at_utc))
          .map((entry) => ({
            id: entry.id,
            title: entry.title,
            notes: entry.notes,
            location: entry.location,
            url: entry.url,
            start_at_utc: entry.start_at_utc,
            timezone: entry.timezone,
            all_day: entry.all_day,
            rrule: entry.rrule,
            alarm_offset_minutes: entry.alarm_offset_minutes,
            status: entry.status,
            updated_at: entry.updated_at,
          }) as T),
      );
    }

    throw new Error(`Unsupported all() SQL: ${sql}`);
  }

  async executeRun(sql: string, values: unknown[]): Promise<D1Result<never>> {
    if (
      sql ===
      "INSERT INTO reminders ( id, title, notes, location, url, start_at_utc, timezone, all_day, rrule, alarm_offset_minutes, source_text, idempotency_key, status, created_at, updated_at ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?13)"
    ) {
      const reminder: StoredReminder = {
        id: values[0] as string,
        title: values[1] as string,
        notes: (values[2] as string | null) ?? null,
        location: (values[3] as string | null) ?? null,
        url: (values[4] as string | null) ?? null,
        start_at_utc: values[5] as string,
        timezone: values[6] as string,
        all_day: values[7] as number,
        rrule: (values[8] as string | null) ?? null,
        alarm_offset_minutes: (values[9] as number | null) ?? null,
        source_text: (values[10] as string | null) ?? null,
        idempotency_key: (values[11] as string | null) ?? null,
        status: "active",
        created_at: values[12] as string,
        updated_at: values[12] as string,
      };
      this.reminders.set(reminder.id, reminder);
      return toRunResult(1);
    }

    if (
      sql ===
      "UPDATE reminders SET status = 'cancelled', updated_at = ?2 WHERE id = ?1 AND status != 'cancelled'"
    ) {
      const id = values[0] as string;
      const updatedAt = values[1] as string;
      const reminder = this.reminders.get(id);
      if (!reminder || reminder.status === "cancelled") {
        return toRunResult(0);
      }

      reminder.status = "cancelled";
      reminder.updated_at = updatedAt;
      return toRunResult(1);
    }

    if (
      sql ===
      "UPDATE feeds SET token_hash = ?2, status = 'active', rotated_at = ?3 WHERE id = ?1"
    ) {
      const id = values[0] as string;
      const tokenHash = values[1] as string;
      const rotatedAt = values[2] as string;
      const feed = this.feeds.get(id);
      if (!feed) {
        return toRunResult(0);
      }

      feed.token_hash = tokenHash;
      feed.status = "active";
      feed.rotated_at = rotatedAt;
      return toRunResult(1);
    }

    if (
      sql ===
      "INSERT INTO feeds (id, token_hash, owner_label, status, created_at, rotated_at) VALUES (?1, ?2, 'default', 'active', ?3, ?3)"
    ) {
      const feed: StoredFeed = {
        id: values[0] as string,
        token_hash: values[1] as string,
        owner_label: "default",
        status: "active",
        created_at: values[2] as string,
        rotated_at: values[2] as string,
      };
      this.feeds.set(feed.id, feed);
      return toRunResult(1);
    }

    throw new Error(`Unsupported run() SQL: ${sql}`);
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function toD1Result<T>(results: T[]): D1Result<T> {
  return {
    success: true,
    results,
    meta: {
      changes: 0,
      duration: 0,
      last_row_id: 0,
      rows_read: results.length,
      rows_written: 0,
      size_after: 0,
      served_by: "mock",
      changed_db: false,
    },
  } as D1Result<T>;
}

function toRunResult(changes: number): D1Result<never> {
  return {
    success: true,
    results: [],
    meta: {
      changes,
      duration: 0,
      last_row_id: 0,
      rows_read: 0,
      rows_written: changes,
      size_after: 0,
      served_by: "mock",
      changed_db: changes > 0,
    },
  } as D1Result<never>;
}

function createTestEnv(): { DB: D1Database; REMINDER_API_TOKEN: string } {
  return createTestContext().env;
}

function createTestContext(): {
  db: MockD1Database;
  env: { DB: D1Database; REMINDER_API_TOKEN: string };
} {
  const db = new MockD1Database();
  return {
    db,
    env: {
      DB: db as unknown as D1Database,
      REMINDER_API_TOKEN: "local-test-token",
    },
  };
}

function authorizedRequest(
  env: { REMINDER_API_TOKEN: string },
  path: string,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${env.REMINDER_API_TOKEN}`);
  return new Request(`https://example.com${path}`, {
    ...init,
    headers,
  });
}

function authorizedJsonRequest(
  env: { REMINDER_API_TOKEN: string },
  path: string,
  method: string,
  payload?: unknown,
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("authorization", `Bearer ${env.REMINDER_API_TOKEN}`);
  return new Request(`https://example.com${path}`, {
    method,
    headers,
    body: payload == null ? undefined : JSON.stringify(payload),
  });
}

function extractFeedToken(feedUrl: string): string {
  const prefix = "/v1/feeds/";
  const suffix = ".ics";
  assert.ok(feedUrl.startsWith(prefix));
  assert.ok(feedUrl.endsWith(suffix));
  return feedUrl.slice(prefix.length, -suffix.length);
}

const tests: Array<[string, () => void | Promise<void>]> = [
  [
    "validateReminderPayload accepts timed reminders",
    () => {
      const reminder = validateReminderPayload({
        title: "Pay rent",
        location: "Home",
        url: "https://example.com/bills",
        start_at: "2026-03-20T09:30:00+08:00",
        timezone: "Asia/Shanghai",
        alarm_offset_minutes: 15,
      });

      assert.equal(reminder.title, "Pay rent");
      assert.equal(reminder.location, "Home");
      assert.equal(reminder.url, "https://example.com/bills");
      assert.equal(reminder.start_at_utc, "2026-03-20T01:30:00.000Z");
      assert.equal(reminder.alarm_offset_minutes, 15);
    },
  ],
  [
    "validateReminderPayload normalizes all-day reminders",
    () => {
      const reminder = validateReminderPayload({
        title: "Trip",
        start_at: "2026-03-20",
        timezone: "Asia/Shanghai",
        all_day: true,
      });

      assert.equal(reminder.start_at_utc, "2026-03-20T00:00:00.000Z");
    },
  ],
  [
    "normalizeStartAt rejects invalid values",
    () => {
      assert.throws(() => normalizeStartAt("bad-input", false));
    },
  ],
  [
    "normalizeAlarmOffset enforces a safe range",
    () => {
      assert.equal(normalizeAlarmOffset(0), 0);
      assert.throws(() => normalizeAlarmOffset(-1));
      assert.throws(() => normalizeAlarmOffset(50000));
    },
  ],
  [
    "renderIcsCalendar returns a VEVENT with alarm and escaped content",
    () => {
      const calendar = renderIcsCalendar([
        {
          id: "abc123",
          title: "Review, roadmap",
          notes: "Line 1\nLine 2",
          location: "Office",
          url: "https://example.com/meeting",
          start_at_utc: "2026-03-20T01:30:00.000Z",
          timezone: "Asia/Shanghai",
          updated_at: "2026-03-12T00:00:00.000Z",
          all_day: 0,
          rrule: "FREQ=WEEKLY;BYDAY=MO",
          alarm_offset_minutes: 10,
        },
      ]);

      assert.match(calendar, /BEGIN:VCALENDAR/);
      assert.match(calendar, /SUMMARY:Review\\, roadmap/);
      assert.match(calendar, /DESCRIPTION:Line 1\\nLine 2/);
      assert.match(calendar, /LOCATION:Office/);
      assert.match(calendar, /URL:https:\/\/example.com\/meeting/);
      assert.match(calendar, /BEGIN:VALARM/);
      assert.match(calendar, /RRULE:FREQ=WEEKLY;BYDAY=MO/);
    },
  ],
  [
    "validateReminderPayload rejects invalid url values",
    () => {
      assert.throws(() =>
        validateReminderPayload({
          title: "Bad link",
          url: "javascript:alert(1)",
          start_at: "2026-03-20T09:30:00+08:00",
          timezone: "Asia/Shanghai",
        }),
      );
    },
  ],
  [
    "escapeIcsText and toIcsUtcTimestamp follow ICS formatting rules",
    () => {
      assert.equal(escapeIcsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
      assert.equal(toIcsUtcTimestamp("2026-03-20T01:30:00.000Z"), "20260320T013000Z");
    },
  ],
  [
    "fetch returns HTTP auth errors instead of converting them to 500",
    async () => {
      const response = await workerModule.fetch(
        new Request("https://example.com/v1/reminders", {
          method: "GET",
        }),
        {} as never,
      );

      assert.equal(response.status, 401);
      const body = await response.json();
      assert.deepEqual(body, { error: "unauthorized" });
    },
  ],
  [
    "fetch supports local create list and delete reminder flows",
    async () => {
      const env = createTestEnv();
      const createResponse = await workerModule.fetch(
        authorizedJsonRequest(env, "/v1/reminders", "POST", {
          title: "Pay rent",
          notes: "March payment",
          location: "Home",
          url: "https://example.com/bills",
          start_at: "2026-03-20T09:30:00+08:00",
          timezone: "Asia/Shanghai",
          alarm_offset_minutes: 15,
          source_text: "remind me to pay rent",
          idempotency_key: "rent-2026-03",
        }),
        env,
      );

      assert.equal(createResponse.status, 201);
      const created = (await createResponse.json()) as {
        id: string;
        status: string;
        created_at: string;
        subscription_hint: string;
      };
      assert.equal(created.status, "created");
      assert.match(created.id, /^[0-9a-f-]{36}$/i);
      assert.equal(created.subscription_hint, "/v1/feeds/<token>.ics");

      const listResponse = await workerModule.fetch(
        authorizedRequest(env, "/v1/reminders", { method: "GET" }),
        env,
      );

      assert.equal(listResponse.status, 200);
      const listed = (await listResponse.json()) as {
        reminders: Array<{
          id: string;
          title: string;
          status: string;
          alarm_offset_minutes: number | null;
          source_text: string | null;
        }>;
      };
      assert.equal(listed.reminders.length, 1);
      assert.equal(listed.reminders[0]?.id, created.id);
      assert.equal(listed.reminders[0]?.title, "Pay rent");
      assert.equal(listed.reminders[0]?.status, "active");
      assert.equal(listed.reminders[0]?.alarm_offset_minutes, 15);
      assert.equal(listed.reminders[0]?.source_text, "remind me to pay rent");

      const deleteResponse = await workerModule.fetch(
        authorizedRequest(env, `/v1/reminders/${created.id}`, {
          method: "DELETE",
        }),
        env,
      );

      assert.equal(deleteResponse.status, 200);
      const deleted = (await deleteResponse.json()) as {
        id: string;
        deleted: boolean;
      };
      assert.equal(deleted.id, created.id);
      assert.equal(deleted.deleted, true);

      const listAfterDeleteResponse = await workerModule.fetch(
        authorizedRequest(env, "/v1/reminders", { method: "GET" }),
        env,
      );

      assert.equal(listAfterDeleteResponse.status, 200);
      const afterDelete = (await listAfterDeleteResponse.json()) as {
        reminders: Array<{ id: string; status: string }>;
      };
      assert.equal(afterDelete.reminders.length, 1);
      assert.equal(afterDelete.reminders[0]?.id, created.id);
      assert.equal(afterDelete.reminders[0]?.status, "cancelled");
    },
  ],
  [
    "fetch rotates local feed tokens by updating the existing feed row",
    async () => {
      const { db, env } = createTestContext();

      const createResponse = await workerModule.fetch(
        authorizedJsonRequest(env, "/v1/reminders", "POST", {
          title: "Morning standup",
          start_at: "2026-03-21T09:00:00+08:00",
          timezone: "Asia/Shanghai",
        }),
        env,
      );
      assert.equal(createResponse.status, 201);

      const firstRotateResponse = await workerModule.fetch(
        authorizedRequest(env, "/v1/feeds/rotate", { method: "POST" }),
        env,
      );
      assert.equal(firstRotateResponse.status, 201);
      const firstRotate = (await firstRotateResponse.json()) as {
        status: string;
        feed_url: string;
      };
      assert.equal(firstRotate.status, "rotated");
      const firstToken = extractFeedToken(firstRotate.feed_url);
      assert.ok(firstToken.length > 20);
      assert.equal(db.countFeeds(), 1);

      const firstFeedResponse = await workerModule.fetch(
        new Request(`https://example.com${firstRotate.feed_url}`),
        env,
      );
      assert.equal(firstFeedResponse.status, 200);
      const firstCalendar = await firstFeedResponse.text();
      assert.match(firstCalendar, /BEGIN:VCALENDAR/);
      assert.match(firstCalendar, /SUMMARY:Morning standup/);

      const secondRotateResponse = await workerModule.fetch(
        authorizedRequest(env, "/v1/feeds/rotate", { method: "POST" }),
        env,
      );
      assert.equal(secondRotateResponse.status, 201);
      const secondRotate = (await secondRotateResponse.json()) as {
        status: string;
        feed_url: string;
      };
      assert.equal(secondRotate.status, "rotated");
      const secondToken = extractFeedToken(secondRotate.feed_url);
      assert.notEqual(secondToken, firstToken);
      assert.equal(db.countFeeds(), 1);

      const staleFeedResponse = await workerModule.fetch(
        new Request(`https://example.com${firstRotate.feed_url}`),
        env,
      );
      assert.equal(staleFeedResponse.status, 404);
      const staleFeedBody = (await staleFeedResponse.json()) as { error: string };
      assert.deepEqual(staleFeedBody, { error: "feed_not_found" });

      const activeFeedResponse = await workerModule.fetch(
        new Request(`https://example.com${secondRotate.feed_url}`),
        env,
      );
      assert.equal(activeFeedResponse.status, 200);
      const activeCalendar = await activeFeedResponse.text();
      assert.match(activeCalendar, /SUMMARY:Morning standup/);
    },
  ],
];

let failed = 0;

for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(`1..${tests.length}`);
}
