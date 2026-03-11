# ICS Reminder Skill + Worker

This project contains two parts:

- a Codex skill in `skills/ics-reminder-skill`
- a Cloudflare Worker in `worker/` that stores reminders in D1 and exposes an ICS feed

## What It Does

- Accepts reminder creation requests over HTTP
- Stores reminders in Cloudflare D1
- Exposes a private ICS subscription URL
- Supports reminder fields:
  - `title`
  - `notes`
  - `location`
  - `url`
  - `start_at`
  - `timezone`
  - `all_day`
  - `rrule`
  - `alarm_offset_minutes`

## Project Layout

```text
.
├── skills/
│   └── ics-reminder-skill/
├── worker/
│   ├── migrations/
│   ├── schema.sql
│   ├── src/index.ts
│   └── wrangler.toml
├── package.json
└── tsconfig.json
```

## Local Development

Install dependencies:

```bash
pnpm install
```

Initialize the local D1 schema:

```bash
pnpm run db:execute:local
```

If you already created a local database before `location` and `url` support was added, also run:

```bash
pnpm exec wrangler d1 execute ics-reminders --local --file worker/migrations/0001_add_location_and_url.sql --config worker/wrangler.toml
```

Start the worker:

```bash
pnpm run dev
```

The local dev server is configured to listen on `0.0.0.0:8787`, so devices on the same LAN can access it through your machine's local IP.

Local API token is read from:

[`worker/.dev.vars`](/E:/project/worker/.dev.vars)

Current local test token:

```text
local-test-token
```

## Local API Example

Create a reminder:

```bash
curl -X POST http://127.0.0.1:8787/v1/reminders \
  -H "Authorization: Bearer local-test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pay utilities",
    "notes": "Electricity and water bill",
    "location": "Home office",
    "url": "https://example.com/bills",
    "start_at": "2026-03-20T15:00:00+08:00",
    "timezone": "Asia/Shanghai",
    "alarm_offset_minutes": 15,
    "idempotency_key": "demo-001"
  }'
```

Rotate the ICS feed token:

```bash
curl -X POST http://127.0.0.1:8787/v1/feeds/rotate \
  -H "Authorization: Bearer local-test-token"
```

Fetch the ICS feed:

```bash
curl http://127.0.0.1:8787/v1/feeds/<token>.ics
```

## TypeScript Checks

Run the lightweight test suite:

```bash
pnpm test
```

Run type checking:

```bash
pnpm run check
```

## Cloudflare Deployment

Important: this project uses Cloudflare `D1`, not `D2`.

1. Create a remote D1 database:

```bash
pnpm exec wrangler d1 create ics-reminders
```

2. Copy the returned database ID into:

[`worker/wrangler.toml`](/E:/project/worker/wrangler.toml)

3. Set the production API token:

```bash
pnpm exec wrangler secret put REMINDER_API_TOKEN
```

4. Apply the base schema remotely:

```bash
pnpm run db:execute:remote
```

5. If the remote database already existed before `location` and `url` support, also run:

```bash
pnpm exec wrangler d1 execute ics-reminders --remote --file worker/migrations/0001_add_location_and_url.sql --config worker/wrangler.toml
```

6. Deploy:

```bash
pnpm run deploy
```

## Skill Installation

The skill source lives in:

[`skills/ics-reminder-skill/SKILL.md`](/E:/project/skills/ics-reminder-skill/SKILL.md)

Installed Codex copy:

[`C:\Users\xgg\.codex\skills\ics-reminder-skill`](/C:/Users/xgg/.codex/skills/ics-reminder-skill)

After updating the installed skill, restart Codex to pick it up.

## API Summary

- `POST /v1/reminders`
- `GET /v1/reminders`
- `DELETE /v1/reminders/:id`
- `POST /v1/feeds/rotate`
- `GET /v1/feeds/:token.ics`

Bearer auth is required for write and list operations.

ICS feed access is authorized by the per-feed token in the URL.
