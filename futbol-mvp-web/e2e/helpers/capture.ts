import path from "node:path";
import fs from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";

function safeLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function capture(page: Page, testInfo: TestInfo, step: number, label: string) {
  const root = process.env.RUN_CAPTURE_DIR;
  if (!root) {
    throw new Error("RUN_CAPTURE_DIR no esta definido. Ejecuta via un script e2e:*:screenshots.");
  }

  const projectDir = path.join(root, testInfo.project.name);
  await fs.mkdir(projectDir, { recursive: true });

  const filename = `${String(step).padStart(3, "0")}-${safeLabel(label)}.png`;
  const target = path.join(projectDir, filename);

  await page.screenshot({
    path: target,
    fullPage: true,
    animations: "disabled",
  });

  return target;
}
