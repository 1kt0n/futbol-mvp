import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ADMIN_PHONE = (process.env.E2E_ADMIN_PHONE || "").trim();
const ADMIN_PIN = (process.env.E2E_ADMIN_PIN || "").trim();

async function expectNoCriticalA11y(page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const critical = (results.violations || []).filter((v) =>
    ["critical", "serious"].includes(String(v.impact || "").toLowerCase())
  );
  expect(critical, `Violaciones a11y criticas: ${critical.map((v) => v.id).join(", ")}`).toEqual([]);
}

test.describe("Accessibility smoke", () => {
  test("login screen has no critical violations", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("auth-login-mode-btn")).toBeVisible();
    await expectNoCriticalA11y(page);
  });

  test("tournaments admin view has no critical violations", async ({ page }) => {
    test.skip(!ADMIN_PHONE || !ADMIN_PIN, "Faltan credenciales admin para smoke a11y en admin.");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByTestId("auth-login-mode-btn").click();
    await page.getByTestId("auth-phone-input").fill(ADMIN_PHONE);
    await page.getByTestId("auth-phone-next-btn").click();
    await page.getByTestId("auth-pin-input").fill(ADMIN_PIN);
    await page.getByTestId("auth-login-submit").click();
    await expect(page.getByTestId("open-admin-panel")).toBeVisible({ timeout: 25_000 });

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.getByTestId("admin-tab-torneos").click();
    await expect(page.getByTestId("tournaments-admin-tab")).toBeVisible({ timeout: 20_000 });

    await expectNoCriticalA11y(page);
  });
});
