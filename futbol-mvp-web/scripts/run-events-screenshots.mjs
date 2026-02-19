import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const REQUIRED_SCREENSHOTS = [
  "001-event-login-admin.png",
  "002-event-admin-tab.png",
  "003-event-open-create-modal.png",
  "004-event-created.png",
  "005-event-court-one-created.png",
  "006-event-court-two-created.png",
  "007-event-court-two-edited.png",
  "008-event-court-two-closed.png",
  "009-event-court-two-opened.png",
  "010-event-app-selected.png",
  "011-event-admin-self-registered.png",
  "012-event-admin-guest-registered.png",
  "013-event-user-two-registered.png",
  "014-event-court-one-reopened-full.png",
  "015-event-user-three-waitlist.png",
  "016-event-admin-waitlist-visible.png",
  "017-event-player-moved.png",
  "018-event-player-cancelled.png",
  "019-event-closed.png",
  "020-event-app-closed-banner.png",
  "021-event-reopened.png",
  "022-event-closed-again.png",
  "023-event-finalized.png",
];

const MIN_EXPECTED_PER_PROJECT = 20;
const REQUIRED_PROJECTS = ["desktop-chrome", "mobile-chrome"];

function timestampNow() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function ensureReachable(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Respuesta no OK (${res.status}) en ${url}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function listPngFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPngFiles(full)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
      files.push(full);
    }
  }
  return files;
}

function runPlaywright(cwd, env) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const child = isWin
      ? spawn(
          "cmd.exe",
          ["/d", "/s", "/c", "npx playwright test e2e/events-flow.spec.ts --config=playwright.config.ts"],
          {
            cwd,
            env,
            stdio: "inherit",
          }
        )
      : spawn(
          "npx",
          ["playwright", "test", "e2e/events-flow.spec.ts", "--config=playwright.config.ts"],
          {
            cwd,
            env,
            stdio: "inherit",
          }
        );

    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  const baseURL = (process.env.E2E_WEB_URL || "http://127.0.0.1:5173").trim();
  const adminPhone = (process.env.E2E_ADMIN_PHONE || "").trim();
  const adminPin = (process.env.E2E_ADMIN_PIN || "").trim();

  if (!adminPhone || !adminPin) {
    throw new Error("Faltan variables requeridas: E2E_ADMIN_PHONE y E2E_ADMIN_PIN.");
  }

  const cwd = process.cwd();
  const captureRoot = path.resolve(process.env.E2E_CAPTURE_ROOT || path.join(cwd, "e2e-artifacts", "events"));
  const runTimestamp = timestampNow();
  const runDir = path.join(captureRoot, runTimestamp);

  await fs.mkdir(runDir, { recursive: true });

  console.log(`[preflight] base URL: ${baseURL}`);
  await ensureReachable(baseURL);
  console.log("[preflight] web reachable");

  const env = {
    ...process.env,
    E2E_WEB_URL: baseURL,
    RUN_CAPTURE_DIR: runDir,
  };

  const exitCode = await runPlaywright(cwd, env);

  const screenshots = [];
  const byProject = {};

  try {
    const files = await listPngFiles(runDir);
    for (const file of files) {
      const rel = path.relative(runDir, file).replace(/\\/g, "/");
      screenshots.push(rel);
      const [project] = rel.split("/");
      byProject[project] = byProject[project] || [];
      byProject[project].push(rel.split("/").slice(1).join("/"));
    }
  } catch {
    // keep manifest generation even when output is empty
  }

  const missingRequiredByProject = {};
  const belowMinimumByProject = {};

  for (const project of REQUIRED_PROJECTS) {
    const projectFiles = new Set(byProject[project] || []);
    const missing = REQUIRED_SCREENSHOTS.filter((name) => !projectFiles.has(name));
    if (missing.length > 0) {
      missingRequiredByProject[project] = missing;
    }

    const count = projectFiles.size;
    if (count < MIN_EXPECTED_PER_PROJECT) {
      belowMinimumByProject[project] = {
        expected_at_least: MIN_EXPECTED_PER_PROJECT,
        actual: count,
      };
    }
  }

  const hasMissingRequired = Object.keys(missingRequiredByProject).length > 0;
  const hasBelowMinimum = Object.keys(belowMinimumByProject).length > 0;

  const manifest = {
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    base_url: baseURL,
    run_timestamp: runTimestamp,
    run_dir: runDir,
    status: exitCode === 0 && !hasMissingRequired && !hasBelowMinimum ? "ok" : "failed",
    playwright_exit_code: exitCode,
    required_projects: REQUIRED_PROJECTS,
    required_screenshots: REQUIRED_SCREENSHOTS,
    screenshot_count_total: screenshots.length,
    screenshots,
    by_project: Object.fromEntries(
      Object.entries(byProject).map(([project, files]) => [project, { count: files.length, files }])
    ),
    missing_required_by_project: missingRequiredByProject,
    below_minimum_by_project: belowMinimumByProject,
  };

  const manifestPath = path.join(runDir, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`\n[artifacts] screenshots run dir: ${runDir}`);
  console.log(`[artifacts] manifest: ${manifestPath}`);

  if (manifest.status !== "ok") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[fatal] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
