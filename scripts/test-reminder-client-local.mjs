import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const workerDir = path.join(repoRoot, "worker");
const clientScript = path.join(repoRoot, "scripts", "reminder-client.mjs");

const baseUrl = process.env.REMINDER_API_BASE_URL?.trim() || "http://127.0.0.1:8787";
const token =
  process.env.REMINDER_API_TOKEN?.trim() || (await readTokenFromDevVars());

let devServerProcess = null;
let devServerStartedByScript = false;
let devServerStopping = false;

try {
  if (!(await isServerReady(baseUrl))) {
    await runCommand("pnpm", ["run", "db:execute:local"], { cwd: repoRoot });
    devServerProcess = startDevServer();
    devServerStartedByScript = true;
    await waitForServer(baseUrl);
  }

  const createPayload = {
    title: `Local client test ${Date.now()}`,
    notes: "created by scripts/test-reminder-client-local.mjs",
    location: "Local",
    url: "https://example.com/local-test",
    start_at: "2026-03-20T09:30:00+08:00",
    timezone: "Asia/Shanghai",
    alarm_offset_minutes: 15,
    source_text: "local reminder client e2e",
    idempotency_key: `local-client-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };

  const created = await runClientJson([
    "create",
    "--data",
    JSON.stringify(createPayload),
  ]);
  assert.equal(created.status, "created");
  assert.match(created.id, /^[0-9a-f-]{36}$/i);

  const listed = await runClientJson(["list"]);
  assert.ok(Array.isArray(listed.reminders));
  const createdReminder = listed.reminders.find((entry) => entry.id === created.id);
  assert.ok(createdReminder, "created reminder should appear in list output");
  assert.equal(createdReminder.status, "active");
  assert.equal(createdReminder.title, createPayload.title);

  const firstRotate = await runClientJson(["rotate"]);
  assert.equal(firstRotate.status, "rotated");
  assert.match(firstRotate.feed_url, /^\/v1\/feeds\/[^/]+\.ics$/);

  const firstFeedResponse = await fetch(new URL(firstRotate.feed_url, `${baseUrl}/`));
  assert.equal(firstFeedResponse.status, 200);
  const firstFeedBody = await firstFeedResponse.text();
  assert.match(firstFeedBody, /BEGIN:VCALENDAR/);
  assert.match(firstFeedBody, new RegExp(escapeRegExp(createPayload.title)));

  const secondRotate = await runClientJson(["rotate"]);
  assert.equal(secondRotate.status, "rotated");
  assert.notEqual(secondRotate.feed_url, firstRotate.feed_url);

  const staleFeedResponse = await fetch(new URL(firstRotate.feed_url, `${baseUrl}/`));
  assert.equal(staleFeedResponse.status, 404);

  const activeFeedResponse = await fetch(new URL(secondRotate.feed_url, `${baseUrl}/`));
  assert.equal(activeFeedResponse.status, 200);
  const activeFeedBody = await activeFeedResponse.text();
  assert.match(activeFeedBody, new RegExp(escapeRegExp(createPayload.title)));

  const deleted = await runClientJson(["delete", created.id]);
  assert.equal(deleted.id, created.id);
  assert.equal(deleted.deleted, true);

  const listedAfterDelete = await runClientJson(["list"]);
  const cancelledReminder = listedAfterDelete.reminders.find(
    (entry) => entry.id === created.id,
  );
  assert.ok(cancelledReminder, "deleted reminder should still appear in list output");
  assert.equal(cancelledReminder.status, "cancelled");

  console.log("ok - reminder-client local e2e");
} finally {
  if (devServerStartedByScript && devServerProcess) {
    devServerStopping = true;
    await stopProcessTree(devServerProcess);
  }
}

async function readTokenFromDevVars() {
  const devVarsPath = path.join(workerDir, ".dev.vars");
  const content = await readFile(devVarsPath, "utf8");
  const match = content.match(/^\s*REMINDER_API_TOKEN\s*=\s*(.+)\s*$/m);
  if (!match?.[1]) {
    throw new Error(`REMINDER_API_TOKEN not found in ${devVarsPath}`);
  }
  return match[1].trim();
}

function startDevServer() {
  const child = spawnCommand("pnpm", ["run", "dev"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(String(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(String(chunk));
  });

  child.on("exit", (code) => {
    if (devServerStartedByScript && !devServerStopping && code !== null && code !== 0) {
      process.stderr.write(`Local dev server exited unexpectedly with code ${code}\n`);
    }
  });

  return child;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await isServerReady(url)) {
      return;
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for local server at ${url}`);
}

async function isServerReady(url) {
  try {
    const response = await fetch(new URL("/", `${url}/`));
    return response.status > 0;
  } catch {
    return false;
  }
}

async function runClientJson(args) {
  const result = await runCommand(process.execPath, [clientScript, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REMINDER_API_BASE_URL: baseUrl,
      REMINDER_API_TOKEN: token,
    },
  });
  return JSON.parse(result.stdout.trim());
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code}\n${stderr || stdout}`,
        ),
      );
    });
  });
}

async function stopProcessTree(child) {
  if (process.platform === "win32") {
    await runCommand("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    return;
  }

  child.kill("SIGTERM");
}

function spawnCommand(command, args, options) {
  if (process.platform === "win32" && command === "pnpm") {
    const comspec = process.env.ComSpec || "cmd.exe";
    return spawn(
      comspec,
      ["/d", "/s", "/c", buildWindowsCommand(command, args)],
      options,
    );
  }

  return spawn(command, args, options);
}

function buildWindowsCommand(command, args) {
  return [command, ...args].map(quoteWindowsArg).join(" ");
}

function quoteWindowsArg(value) {
  if (value === "") {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
