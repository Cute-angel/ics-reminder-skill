---
name: ics-reminder-skill
description: Use this skill when the user asks to create, schedule, or manage reminder-style notifications such as "remind me tomorrow at 3pm", "set a recurring reminder", or "add a calendar reminder". It extracts reminder fields from natural language, asks follow-up questions only when required data is missing, and sends the reminder to a remote API that backs an ICS subscription feed.
---

# ICS Reminder Skill

Use this skill when the user intent is to create or manage a reminder-like event that should appear in a subscribed calendar feed.

## Runtime inputs

- Read `REMINDER_API_BASE_URL` from the environment.
- Read `REMINDER_API_TOKEN` from the environment.
- Use `node scripts/reminder-client.mjs` from the workspace root to perform reminder operations.
- Do not hardcode the worker URL or token in the skill instructions.
- If either environment variable is missing, stop and ask for the environment to be configured instead of guessing.

## Triggering guidance

Trigger on requests like:
- "提醒我明天下午 3 点交水电费"
- "下周一上午 9 点提醒我站会"
- "给我加一个每周五下午的健身提醒"
- "帮我取消那个提醒"

Do not trigger for:
- generic to-do lists without a time
- project planning tasks that are not user reminders
- alarms/timers that must ring inside the current device session

## Required fields

Before calling the API, gather:
- `title`
- `start_at`
- `timezone`

Optional fields:
- `notes`
- `location`
- `url`
- `all_day`
- `rrule`
- `alarm_offset_minutes`
- `source_text`
- `idempotency_key`

If the reminder time is underspecified, ask a follow-up question instead of guessing.

## Time parsing rules

Read [references/time-parsing-rules.md](references/time-parsing-rules.md) when the user input contains ambiguous natural language dates or recurrence.

## API contract

Read [references/api-contract.md](references/api-contract.md) before calling the helper script.

## Workflow

1. Detect reminder intent.
2. Extract reminder fields from the user's message.
3. If date/time is incomplete, ask a concise follow-up question.
4. For create requests, pass the JSON body through stdin to `node scripts/reminder-client.mjs create --stdin`.
5. Use `node scripts/reminder-client.mjs list`, `node scripts/reminder-client.mjs delete <id>`, and `node scripts/reminder-client.mjs rotate` for the other operations.
6. Keep user-provided text inside the JSON request body only. Do not splice raw user text into shell flags, URLs, or command fragments.
7. Return the created reminder id and tell the user their calendar clients should subscribe to the ICS feed URL separately.

## Follow-up rules

- Missing exact date: ask for the date.
- Missing time for a non-all-day reminder: ask for the time.
- Parsed time is in the past: ask whether to move it to the next valid occurrence.
- Recurring reminder requested: translate to `RRULE`; ask only if cadence is incomplete.

## Output style

After successful creation, summarize:
- reminder title
- scheduled time
- recurrence if any

Do not reveal bearer tokens or raw secret values.
