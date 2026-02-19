import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const REQUIRED_SCREENSHOTS = [
  "001-login.png",
  "002-admin-torneos-tab.png",
  "003-rr-created.png",
  "004-rr-config-saved.png",
  "005-rr-teams-added.png",
  "006-rr-team-delete-readd.png",
  "007-rr-member-user.png",
  "008-rr-member-guest.png",
  "009-rr-fixture.png",
  "010-rr-live.png",
  "011-rr-match-start.png",
  "012-rr-score-saved.png",
  "013-rr-match-finished.png",
  "014-rr-tournament-finished.png",
  "015-rr-public.png",
  "016-rr-public-standings-fixture.png",
  "017-rr-public-tv.png",
  "018-rr-archived.png",
  "101-ko-created.png",
  "102-ko-teams-added.png",
  "103-ko-fixture.png",
  "104-ko-live.png",
  "105-ko-semi1-finished.png",
  "106-ko-final-slot-updated.png",
  "107-ko-semi2-finished.png",
  "108-ko-final-finished.png",
  "109-ko-tournament-finished.png",
  "110-ko-public-bracket.png",
  "111-ko-public-tv.png",
  "112-ko-archived.png",
];

const MIN_EXPECTED_PER_PROJECT = 25;
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
          ["/d", "/s", "/c", "npx playwright test e2e/tournaments-flow.spec.ts --config=playwright.config.ts"],
          {
            cwd,
            env,
            stdio: "inherit",
          }
        )
      : spawn(
          "npx",
          ["playwright", "test", "e2e/tournaments-flow.spec.ts", "--config=playwright.config.ts"],
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
  const captureRoot = path.resolve(process.env.E2E_CAPTURE_ROOT || path.join(cwd, "e2e-artifacts", "tournaments"));
  const runTimestamp = timestampNow();
  const runDir = path.join(captureRoot, runTimestamp);

  await fs.mkdir(runDir, { recursive: true });

  console.log(`[preflight] base URL: ${baseURL}`);
  await ensureReachable(baseURL);
  console.log(`[preflight] web reachable`);

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
    // Keep empty manifest details if output does not exist.
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
