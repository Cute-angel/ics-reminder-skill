# Repository Guidelines

## Project Structure & Module Organization
This repository has two deliverables:

- `worker/`: Cloudflare Worker code, D1 schema, Wrangler config, and tests.
- `skills/codex-ics-reminder/` and `skills/openclaw-ics-reminder/`: skill definitions and reference docs for Codex and OpenClaw.

Primary code lives in `worker/src/index.ts`. Keep database changes in `worker/schema.sql` and add one-off upgrades under `worker/migrations/` when the schema evolves. Tests live in `worker/test/run-tests.ts`. Utility scripts belong in `scripts/`.

## Build, Test, and Development Commands
Run commands from the repository root:

- `pnpm run dev`: start the Worker locally with `worker/wrangler.local.toml` on `http://127.0.0.1:8787`.
- `pnpm run db:execute:local`: apply `worker/schema.sql` to the local D1 database.
- `pnpm test`: run the lightweight TypeScript test runner in `worker/test/run-tests.ts`.
- `pnpm run check`: run strict type-checking with `tsc --noEmit`.
- `pnpm run deploy`: deploy the Worker using `worker/wrangler.remote.toml`.
- `pnpm run token:generate`: generate an API token for reminder writes.

## Coding Style & Naming Conventions
The codebase uses strict TypeScript, ES modules, and 2-space indentation. Follow the existing style in `worker/src/index.ts`: double quotes, trailing commas where multiline, and small helper functions for validation and formatting logic.

Use `camelCase` for variables and functions, `PascalCase` for types/classes, and `SCREAMING_SNAKE_CASE` for top-level constants such as response header maps. Keep HTTP routes and payload fields aligned with the current API naming, for example `start_at` and `alarm_offset_minutes`.

## Testing Guidelines
Tests use Node’s built-in `assert/strict`; there is no separate test framework. Add new coverage to `worker/test/run-tests.ts` as another entry in the `tests` array with a descriptive name such as `"validateReminderPayload rejects invalid url values"`.

Any change to routing, payload validation, ICS rendering, or D1 persistence should include a test and pass both `pnpm test` and `pnpm run check`.

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit subjects with optional prefixes, for example `docs: fix readme path references`. Prefer one focused change per commit.

Pull requests should explain user-visible behavior, note schema or config changes, and include example `curl` requests or ICS output when API behavior changes. Link the relevant issue when one exists.

## Security & Configuration Tips
Do not commit secrets. Keep local secrets in `worker/.dev.vars`, use `worker/.dev.vars.example` as the template, and treat `worker/wrangler.remote.toml` carefully because it is ignored for local customization and deployment details.
