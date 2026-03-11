const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type ReminderPayload = {
  title?: JsonValue;
  notes?: JsonValue;
  location?: JsonValue;
  url?: JsonValue;
  start_at?: JsonValue;
  timezone?: JsonValue;
  all_day?: JsonValue;
  rrule?: JsonValue;
  alarm_offset_minutes?: JsonValue;
  source_text?: JsonValue;
  idempotency_key?: JsonValue;
};

type ValidReminder = {
  title: string;
  notes: string | null;
  location: string | null;
  url: string | null;
  start_at_utc: string;
  timezone: string;
  all_day: boolean;
  rrule: string | null;
  alarm_offset_minutes: number | null;
  source_text: string | null;
  idempotency_key: string | null;
};

type ReminderRow = {
  id: string;
  title: string;
  notes: string | null;
  location?: string | null;
  url?: string | null;
  start_at_utc: string;
  timezone: string;
  all_day: number | boolean;
  rrule: string | null;
  alarm_offset_minutes: number | null;
  source_text?: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
};

type FeedRow = {
  id: string;
};

type WorkerEnv = {
  DB: D1Database;
  REMINDER_API_TOKEN?: string;
};

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.code }, error.status);
      }

      return json(
        {
          error: "internal_error",
          message: error instanceof Error ? error.message : "Unexpected error",
        },
        500,
      );
    }
  },
};

export default worker;

export async function routeRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const pathname = trimTrailingSlash(url.pathname);

  if (request.method === "POST" && pathname === "/v1/reminders") {
    await requireBearerAuth(request, env);
    const payload = await parseJson(request);
    const reminder = validateReminderPayload(payload);
    const created = await createReminder(env, reminder);
    return json(created, 201);
  }

  if (request.method === "GET" && pathname === "/v1/reminders") {
    await requireBearerAuth(request, env);
    const reminders = await listReminders(env);
    return json({ reminders });
  }

  if (request.method === "DELETE" && pathname.startsWith("/v1/reminders/")) {
    await requireBearerAuth(request, env);
    const id = decodeURIComponent(pathname.slice("/v1/reminders/".length));
    const deleted = await cancelReminder(env, id);
    return json(deleted, deleted.deleted ? 200 : 404);
  }

  if (request.method === "POST" && pathname === "/v1/feeds/rotate") {
    await requireBearerAuth(request, env);
    const feed = await rotateFeedToken(env);
    return json(feed, 201);
  }

  if (request.method === "GET" && pathname.startsWith("/v1/feeds/") && pathname.endsWith(".ics")) {
    const token = decodeURIComponent(
      pathname.slice("/v1/feeds/".length, pathname.length - ".ics".length),
    );
    const ics = await buildIcsFeed(env, token);
    return new Response(ics, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "cache-control": "private, max-age=60",
      },
    });
  }

  return json({ error: "not_found" }, 404);
}

export async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  return worker.fetch(request, env);
}

async function createReminder(
  env: WorkerEnv,
  reminder: ValidReminder,
): Promise<{
  id: string;
  status: "created" | "duplicate";
  created_at: string;
  subscription_hint: string;
}> {
  const existing = reminder.idempotency_key
    ? await env.DB.prepare(
        `SELECT id, created_at
         FROM reminders
         WHERE idempotency_key = ?1`,
      )
        .bind(reminder.idempotency_key)
        .first<{ id: string; created_at: string }>()
    : null;

  if (existing) {
    return {
      id: existing.id,
      status: "duplicate",
      created_at: existing.created_at,
      subscription_hint: "/v1/feeds/<token>.ics",
    };
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO reminders (
      id, title, notes, location, url, start_at_utc, timezone, all_day, rrule,
      alarm_offset_minutes, source_text, idempotency_key, status, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', ?13, ?13)`,
  )
    .bind(
      id,
      reminder.title,
      reminder.notes,
      reminder.location,
      reminder.url,
      reminder.start_at_utc,
      reminder.timezone,
      reminder.all_day ? 1 : 0,
      reminder.rrule,
      reminder.alarm_offset_minutes,
      reminder.source_text,
      reminder.idempotency_key,
      now,
    )
    .run();

  return {
    id,
    status: "created",
    created_at: now,
    subscription_hint: "/v1/feeds/<token>.ics",
  };
}

async function listReminders(env: WorkerEnv): Promise<ReminderRow[]> {
  const result = await env.DB.prepare(
    `SELECT id, title, notes, location, url, start_at_utc, timezone, all_day, rrule,
            alarm_offset_minutes, source_text, status, created_at, updated_at
     FROM reminders
     ORDER BY start_at_utc ASC`,
  ).all<ReminderRow>();

  return result.results ?? [];
}

async function cancelReminder(
  env: WorkerEnv,
  id: string,
): Promise<{ id: string; deleted: boolean; updated_at: string }> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE reminders
     SET status = 'cancelled', updated_at = ?2
     WHERE id = ?1 AND status != 'cancelled'`,
  )
    .bind(id, now)
    .run();

  return {
    id,
    deleted: Boolean(result.meta.changes),
    updated_at: now,
  };
}

async function rotateFeedToken(
  env: WorkerEnv,
): Promise<{ status: "rotated"; feed_url: string; issued_at: string }> {
  const now = new Date().toISOString();
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const activeFeed = await env.DB.prepare(
    `SELECT id FROM feeds WHERE owner_label = 'default' AND status = 'active'`,
  ).first<FeedRow>();

  if (activeFeed) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE feeds SET status = 'rotated', rotated_at = ?2 WHERE id = ?1`).bind(
        activeFeed.id,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO feeds (id, token_hash, owner_label, status, created_at, rotated_at)
         VALUES (?1, ?2, 'default', 'active', ?3, ?3)`,
      ).bind(crypto.randomUUID(), tokenHash, now),
    ]);
  } else {
    await env.DB.prepare(
      `INSERT INTO feeds (id, token_hash, owner_label, status, created_at, rotated_at)
       VALUES (?1, ?2, 'default', 'active', ?3, ?3)`,
    )
      .bind(crypto.randomUUID(), tokenHash, now)
      .run();
  }

  return {
    status: "rotated",
    feed_url: `/v1/feeds/${token}.ics`,
    issued_at: now,
  };
}

async function buildIcsFeed(env: WorkerEnv, token: string): Promise<string> {
  const tokenHash = await sha256Hex(token);
  const feed = await env.DB.prepare(
    `SELECT id FROM feeds WHERE token_hash = ?1 AND status = 'active'`,
  )
    .bind(tokenHash)
    .first<FeedRow>();

  if (!feed) {
    throw httpError(404, "feed_not_found");
  }

  const rows = await env.DB.prepare(
    `SELECT id, title, notes, location, url, start_at_utc, timezone, all_day, rrule,
            alarm_offset_minutes, status, updated_at
     FROM reminders
     WHERE status = 'active'
     ORDER BY start_at_utc ASC`,
  ).all<ReminderRow>();

  return renderIcsCalendar(rows.results ?? []);
}

function renderIcsCalendar(reminders: ReminderRow[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Codex//ICS Reminder Skill//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Codex Reminders",
    "X-WR-TIMEZONE:UTC",
  ];

  for (const reminder of reminders) {
    lines.push(...renderReminderEvent(reminder));
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function renderReminderEvent(reminder: ReminderRow): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(`${reminder.id}@codex-reminders`)}`,
    `DTSTAMP:${toIcsUtcTimestamp(reminder.updated_at ?? reminder.start_at_utc)}`,
    `SUMMARY:${escapeIcsText(reminder.title)}`,
  ];

  if (reminder.notes) {
    lines.push(`DESCRIPTION:${escapeIcsText(reminder.notes)}`);
  }

  if (reminder.location) {
    lines.push(`LOCATION:${escapeIcsText(reminder.location)}`);
  }

  if (reminder.url) {
    lines.push(`URL:${escapeIcsText(reminder.url)}`);
  }

  if (Number(reminder.all_day)) {
    const dateOnly = reminder.start_at_utc.slice(0, 10).replaceAll("-", "");
    lines.push(`DTSTART;VALUE=DATE:${dateOnly}`);
  } else {
    lines.push(`DTSTART:${toIcsUtcTimestamp(reminder.start_at_utc)}`);
  }

  if (reminder.rrule) {
    lines.push(`RRULE:${reminder.rrule}`);
  }

  const alarmOffsetMinutes = reminder.alarm_offset_minutes;
  if (alarmOffsetMinutes != null && Number.isInteger(alarmOffsetMinutes)) {
    lines.push(
      "BEGIN:VALARM",
      `TRIGGER:-PT${Math.abs(alarmOffsetMinutes)}M`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(reminder.title)}`,
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT");
  return lines;
}

function validateReminderPayload(payload: JsonValue): ValidReminder {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw httpError(400, "invalid_json");
  }

  const body = payload as ReminderPayload;
  const title = String(body.title ?? "").trim();
  if (!title) {
    throw httpError(400, "title_required");
  }

  const timezone = String(body.timezone ?? "").trim();
  if (!isValidTimeZone(timezone)) {
    throw httpError(400, "invalid_timezone");
  }

  const allDay = Boolean(body.all_day);
  const startAt = String(body.start_at ?? "").trim();
  const normalizedStart = normalizeStartAt(startAt, allDay);
  const rrule = body.rrule == null ? null : String(body.rrule).trim();
  if (rrule && !isLikelyRrule(rrule)) {
    throw httpError(400, "invalid_rrule");
  }

  const url = body.url == null ? null : String(body.url).trim();
  if (url && !isValidUrl(url)) {
    throw httpError(400, "invalid_url");
  }

  const alarm = body.alarm_offset_minutes;
  const alarmOffsetMinutes = alarm == null || alarm === "" ? null : normalizeAlarmOffset(alarm);

  return {
    title,
    notes: body.notes == null ? null : String(body.notes),
    location: body.location == null ? null : String(body.location),
    url,
    start_at_utc: normalizedStart,
    timezone,
    all_day: allDay,
    rrule,
    alarm_offset_minutes: alarmOffsetMinutes,
    source_text: body.source_text == null ? null : String(body.source_text),
    idempotency_key: body.idempotency_key == null ? null : String(body.idempotency_key).trim(),
  };
}

function normalizeStartAt(startAt: string, allDay: boolean): string {
  if (!startAt) {
    throw httpError(400, "start_at_required");
  }

  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startAt)) {
      throw httpError(400, "invalid_all_day_date");
    }
    return `${startAt}T00:00:00.000Z`;
  }

  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) {
    throw httpError(400, "invalid_start_at");
  }

  return date.toISOString();
}

function normalizeAlarmOffset(value: JsonValue): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 40320) {
    throw httpError(400, "invalid_alarm_offset_minutes");
  }

  return numeric;
}

function isLikelyRrule(value: string): boolean {
  return /^FREQ=/.test(value);
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

async function requireBearerAuth(request: Request, env: WorkerEnv): Promise<void> {
  const auth = request.headers.get("authorization");
  const prefix = "Bearer ";
  if (!auth || !auth.startsWith(prefix)) {
    throw httpError(401, "unauthorized");
  }

  const providedToken = auth.slice(prefix.length).trim();
  const expectedToken = env.REMINDER_API_TOKEN;
  if (!expectedToken || !providedToken || providedToken !== expectedToken) {
    throw httpError(401, "unauthorized");
  }
}

async function parseJson(request: Request): Promise<JsonValue> {
  try {
    return (await request.json()) as JsonValue;
  } catch {
    throw httpError(400, "invalid_json");
  }
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function escapeIcsText(value: string): string {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function foldIcsLine(line: string): string {
  const chunkSize = 74;
  if (line.length <= chunkSize) {
    return line;
  }

  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += chunkSize) {
    const chunk = line.slice(index, index + chunkSize);
    chunks.push(index === 0 ? chunk : ` ${chunk}`);
  }
  return chunks.join("\r\n");
}

function toIcsUtcTimestamp(value: string): string {
  const date = new Date(value);
  return date.toISOString().replaceAll("-", "").replaceAll(":", "").replace(".000", "");
}

function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function json(payload: JsonValue | Record<string, JsonValue>, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function httpError(status: number, code: string): HttpError {
  return new HttpError(status, code);
}

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export {
  HttpError,
  escapeIcsText,
  foldIcsLine,
  normalizeAlarmOffset,
  normalizeStartAt,
  renderIcsCalendar,
  renderReminderEvent,
  toIcsUtcTimestamp,
  validateReminderPayload,
};
