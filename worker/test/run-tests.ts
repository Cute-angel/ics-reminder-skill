import assert from "node:assert/strict";

import workerModule, {
  escapeIcsText,
  normalizeAlarmOffset,
  normalizeStartAt,
  renderIcsCalendar,
  toIcsUtcTimestamp,
  validateReminderPayload,
} from "../src/index.ts";

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
