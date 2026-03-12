---
name: openclaw-ics-reminder
description: Create, list, cancel, and rotate ICS-backed reminders through the reminder worker API. Use when the user asks for reminder-style actions such as "remind me tomorrow at 3pm", "set a recurring reminder", "list my reminders", "cancel this reminder", or "rotate my calendar feed token".
metadata: {"openclaw":{"skillKey":"ics-reminder","primaryEnv":"REMINDER_API_TOKEN","requires":{"env":["REMINDER_API_TOKEN","REMINDER_API_BASE_URL"]}}}
---

# ICS Reminder Skill

Use this skill to turn natural-language reminder requests into executions of the JS helper script that talks to the reminder worker.

## Runtime inputs

- Read `REMINDER_API_TOKEN` from the environment.
- Read `REMINDER_API_BASE_URL` from the environment.
- Do not hardcode a worker URL in the skill instructions, shell snippets, or tool calls.
- If `REMINDER_API_BASE_URL` is missing, stop and ask for the environment to be configured instead of guessing a local or remote endpoint.

## Read references only when needed

- Read [references/time-parsing-rules.md](references/time-parsing-rules.md) for ambiguous dates, recurrence, all-day reminders, or past times.
- Read [references/api-contract.md](references/api-contract.md) before calling the helper script.
- Read [references/openclaw-config.md](references/openclaw-config.md) when the user needs help wiring the skill into `~/.openclaw/openclaw.json`.

## Workflow

1. Detect reminder intent and choose one operation: create, list, delete, or rotate feed token.
2. Extract `title`, `start_at`, and `timezone` for create requests. Collect optional `notes`, `location`, `url`, `all_day`, `rrule`, `alarm_offset_minutes`, `source_text`, and `idempotency_key`.
3. Ask a concise follow-up only when the date, time, timezone, or recurrence is missing or ambiguous.
4. Always use `node scripts/reminder-client.mjs` from the workspace root instead of embedding raw HTTP calls in the skill.
5. For create requests, pass JSON via stdin: `node scripts/reminder-client.mjs create --stdin`.
6. Use `node scripts/reminder-client.mjs list`, `node scripts/reminder-client.mjs delete <id>`, and `node scripts/reminder-client.mjs rotate` for the other operations.
7. Keep user-provided text inside the JSON request body only. Do not splice raw user text into shell flags, URLs, or command fragments.
8. Summarize the result in plain language and include the reminder ID or feed path when the API returns one.

## Follow-up rules

- Missing exact date: ask for the date.
- Missing time for a non-all-day reminder: ask for the time.
- Parsed time is in the past: ask whether to move it to the next valid occurrence.
- Recurring reminder requested but cadence is incomplete: ask for the missing cadence details.

## Output rules

- Confirm the normalized scheduled time and recurrence.
- Do not reveal bearer tokens or raw secret values.
- For delete requests, state whether the reminder was found and cancelled.
- For feed rotation, return the new `.ics` path but not the raw authorization token.
