# ICS Reminder Skill + Worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Cute-angel/ics-reminder-skill/tree/master/worker)

For LLM-oriented deployment and skill installation guidance, see [llm.md](llm.md).

This project contains two parts:

- a skills folder in `skills`
  - the Codex skill in `skills/codex-ics-reminder`
  - the OpenClaw skill in `skills/openclaw-ics-reminder`
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
│   ├── codex-ics-reminder/
│   └── openclaw-ics-reminder/
├── worker/
│   ├── migrations/
│   ├── package.json
│   ├── schema.sql
│   ├── src/index.ts
│   ├── wrangler.toml
│   ├── wrangler.local.toml
│   └── wrangler.remote.toml
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

Start the worker:

```bash
pnpm run dev
```

The local dev server is configured to listen on `0.0.0.0:8787`, so devices on the same LAN can access it through your machine's local IP.

Local API token is read from:

`worker/.dev.vars`

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

Use the button above to start a one-click Cloudflare deployment from the `worker/` subdirectory template. The subdirectory now includes its own standard `wrangler.toml` and `package.json`, which is the structure the Cloudflare deploy button expects.

1. Create a remote D1 database:

```bash
pnpm run db:create:remote
```

2. Copy the returned database ID into:

`worker/wrangler.remote.toml`

3. Set the production API token:

```bash
pnpm run secret:put
```

4. Apply the base schema remotely:

```bash
pnpm run db:execute:remote
```

5. Deploy:

```bash
pnpm run deploy
```

Local development uses `worker/wrangler.local.toml`.
Remote deploys and remote D1 commands use `worker/wrangler.remote.toml`.

## Skill Installation

The skill source lives in:

`skills/codex-ics-reminder/SKILL.md`

Installed Codex copy:

`C:\Users\xgg\.codex\skills\codex-ics-reminder`

After updating the installed skill, restart Codex to pick it up.

## API Summary

- `POST /v1/reminders`
- `GET /v1/reminders`
- `DELETE /v1/reminders/:id`
- `POST /v1/feeds/rotate`
- `GET /v1/feeds/:token.ics`

Bearer auth is required for write and list operations.

ICS feed access is authorized by the per-feed token in the URL.
