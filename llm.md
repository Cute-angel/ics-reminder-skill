# LLM Deployment Notes

This file is written for another LLM. Its job is to help a user deploy the reminder worker first, then install the skill into their agent environment.

## Do This First

Do not copy the skill first. The skill depends on a real worker URL and API token, so the user must deploy the Cloudflare Worker before installing the skill.

## Step 1: Deploy the Cloudflare Worker

Tell the user to run these steps from the repository root:

1. Install dependencies:
   `pnpm install`
2. Generate an API token:
   `pnpm run token:generate`
3. Create the remote D1 database:
   `pnpm run db:create:remote`
4. Write the returned `database_id` into `worker/wrangler.remote.toml`
5. Store the generated token as a Cloudflare secret:
   `pnpm run secret:put`
6. Initialize the remote database:
   `pnpm run db:execute:remote`
7. Deploy the worker:
   `pnpm run deploy`

After deployment, record the public worker URL, for example:

`https://your-worker.example.workers.dev`

This value will later be used as `REMINDER_API_BASE_URL`.

## Step 2: Tell the User to Configure Environment Variables

Before installing or using any skill, the user must configure these two environment variables in their own environment:

- `REMINDER_API_BASE_URL`
- `REMINDER_API_TOKEN`

Requirements:

- `REMINDER_API_BASE_URL` must point to the user's own deployed worker URL
- `REMINDER_API_TOKEN` must match the bearer token configured in the Cloudflare Worker
- Never hardcode either value inside the skill files

## Step 3: Copy the Skill Files

Only after the user has configured those environment variables should you copy the skill files into the target agent's skill directory.

This repository contains two skill variants:

- `skills/codex-ics-reminder/`: Codex-style skill
- `skills/openclaw-ics-reminder/`: OpenClaw-style skill

Copy the version that matches the target agent.

## Step 4: Copy the Helper Script

No matter which skill variant is used, also copy this script to a location the target agent can access:

`scripts/reminder-client.mjs`

Why:

- The skill should call the API through this script
- Do not maintain long-term raw `curl` calls inside the skill
- The script consistently reads `REMINDER_API_BASE_URL` and `REMINDER_API_TOKEN`

If the target agent supports scripts inside the skill directory, place `reminder-client.mjs` there.
If the target agent references workspace scripts instead, make sure the skill calls the actual copied path.

## Step 5: Integrate According to the Target Agent

Each agent has its own skill format and loading rules. The LLM only needs to do the following:

1. Copy the correct skill directory
2. Copy `scripts/reminder-client.mjs`
3. Confirm that the script can read:
   - `REMINDER_API_BASE_URL`
   - `REMINDER_API_TOKEN`
4. Do not hardcode the worker URL or token in the skill text

## Core Rules

- Deploy the worker before installing the skill
- Configure environment variables before using the skill
- The worker URL is different for different users, so it must come from environment variables
- The token is a secret and must not be committed or embedded in skill text
