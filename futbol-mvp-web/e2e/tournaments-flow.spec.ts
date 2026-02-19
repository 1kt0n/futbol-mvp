import { expect, test, type Page } from "@playwright/test";
import { capture } from "./helpers/capture";

const ADMIN_PHONE = (process.env.E2E_ADMIN_PHONE || "").trim();
const ADMIN_PIN = (process.env.E2E_ADMIN_PIN || "").trim();

function uniqueSuffix(projectName: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 7);
  return `${stamp}-${projectName}-${random}`;
}

async function resetSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("actorUserId");
    localStorage.removeItem("actor_id");
    localStorage.removeItem("actor_me");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

async function loginAsAdmin(page: Page) {
  await expect(page.getByTestId("auth-login-mode-btn")).toBeVisible();
  await page.getByTestId("auth-login-mode-btn").click();
  await expect(page.getByTestId("auth-phone-input")).toBeVisible();
  await page.getByTestId("auth-phone-input").fill(ADMIN_PHONE);
  await page.getByTestId("auth-phone-next-btn").click();
  await expect(page.getByTestId("auth-pin-input")).toBeVisible();
  await page.getByTestId("auth-pin-input").fill(ADMIN_PIN);
  await page.getByTestId("auth-login-submit").click();
  await expect(page.getByTestId("open-admin-panel")).toBeVisible({ timeout: 25_000 });
}

async function openTournamentsTab(page: Page) {
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-tab-torneos")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("admin-tab-torneos").click();
  await expect(page.getByTestId("tournaments-admin-tab")).toBeVisible({ timeout: 25_000 });
}

async function createTournament(page: Page, opts: {
  title: string;
  location: string;
  format: "ROUND_ROBIN" | "KNOCKOUT";
  teamsCount: number;
  minutes: number;
}) {
  await page.getByTestId("create-tournament-title-input").fill(opts.title);
  await page.getByTestId("create-tournament-location-input").fill(opts.location);
  await page.getByTestId("create-tournament-starts-at-input").fill("2026-03-13T20:00:00Z");
  await page.getByTestId("create-tournament-format-select").selectOption(opts.format);
  await page.getByTestId("create-tournament-teams-count-input").fill(String(opts.teamsCount));
  await page.getByTestId("create-tournament-minutes-input").fill(String(opts.minutes));
  await page.getByTestId("create-tournament-submit-btn").click();
  await page.getByTestId("tournament-tab-overview").click();

  await expect(page.getByTestId("tournament-config-title-input")).toHaveValue(opts.title, {
    timeout: 25_000,
  });
}

async function openTournamentTab(page: Page, tab: "overview" | "teams" | "fixture" | "standings" | "share") {
  await page.getByTestId(`tournament-tab-${tab}`).click();
}

async function addTeam(page: Page, name: string, emoji: string) {
  await page.getByTestId("team-name-input").fill(name);
  await page.getByTestId("team-emoji-input").fill(emoji);
  await page.getByTestId("team-add-btn").click();
  await expect(page.locator('[data-testid^="team-select-"]', { hasText: name }).first()).toBeVisible({
    timeout: 15_000,
  });
}

async function startNextPendingMatch(page: Page) {
  const nextStart = page.locator('[data-testid^="match-start-"]:not([disabled])').first();
  await expect(nextStart).toBeVisible({ timeout: 20_000 });

  const testId = await nextStart.getAttribute("data-testid");
  if (!testId) throw new Error("No se pudo resolver match id para iniciar partido.");

  const matchId = testId.replace("match-start-", "");
  await nextStart.click();
  await expect(page.getByTestId(`match-open-result-${matchId}`)).toBeEnabled({ timeout: 20_000 });
  return matchId;
}

async function saveMatchResult(page: Page, matchId: string, homeGoals: number, awayGoals: number) {
  await page.getByTestId(`match-open-result-${matchId}`).click();
  await expect(page.getByTestId("result-modal")).toBeVisible();
  await page.getByTestId("result-home-goals-input").fill(String(homeGoals));
  await page.getByTestId("result-away-goals-input").fill(String(awayGoals));
  await page.getByTestId("result-save-btn").click();
  await expect(page.getByTestId("result-modal")).toBeHidden({ timeout: 15_000 });
}

async function finishMatch(page: Page, matchId: string, homeGoals: number, awayGoals: number) {
  await page.getByTestId(`match-open-result-${matchId}`).click();
  await expect(page.getByTestId("result-modal")).toBeVisible();
  await page.getByTestId("result-home-goals-input").fill(String(homeGoals));
  await page.getByTestId("result-away-goals-input").fill(String(awayGoals));
  await page.getByTestId("result-finish-btn").click();
  await expect(page.getByTestId("result-modal")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId(`match-card-${matchId}`).getByText("FINISHED")).toBeVisible({ timeout: 20_000 });
}

async function openShareLinkInNewPage(page: Page, testId: string) {
  const href = await page.getByTestId(testId).getAttribute("href");
  if (!href || href === "#") {
    throw new Error(`Link invalido en ${testId}`);
  }

  const target = await page.context().newPage();
  await target.goto(href, { waitUntil: "domcontentloaded" });
  await target.waitForLoadState("networkidle");
  return target;
}

test.describe("Tournament E2E screenshots", () => {
  test("captures full RR + KO flows", async ({ page }, testInfo) => {
    test.skip(!ADMIN_PHONE || !ADMIN_PIN, "Faltan E2E_ADMIN_PHONE y/o E2E_ADMIN_PIN");

    const suffix = uniqueSuffix(testInfo.project.name);

    await resetSession(page);
    await loginAsAdmin(page);
    await capture(page, testInfo, 1, "login");

    await openTournamentsTab(page);
    await capture(page, testInfo, 2, "admin-torneos-tab");

    // ROUND ROBIN
    const rrTitle = `E2E RR ${suffix}`;
    await createTournament(page, {
      title: rrTitle,
      location: "Sede E2E RR",
      format: "ROUND_ROBIN",
      teamsCount: 4,
      minutes: 20,
    });
    await capture(page, testInfo, 3, "rr-created");

    await page.getByTestId("tournament-config-location-input").fill("Sede E2E RR Editada");
    await page.getByTestId("tournament-config-minutes-input").fill("22");
    await page.getByTestId("tournament-save-config-btn").click();
    await expect(page.getByText("Configuracion guardada.").last()).toBeVisible({ timeout: 15_000 });
    await capture(page, testInfo, 4, "rr-config-saved");

    await openTournamentTab(page, "teams");
    await addTeam(page, `RR Tigres ${suffix}`, "🐯");
    await addTeam(page, `RR Halcones ${suffix}`, "🦅");
    await addTeam(page, `RR Lobos ${suffix}`, "🐺");
    await addTeam(page, `RR Osos ${suffix}`, "🐻");
    await expect(page.getByText("4/4 creados")).toBeVisible({ timeout: 20_000 });
    await capture(page, testInfo, 5, "rr-teams-added");

    await page.locator('[data-testid^="team-delete-"]').first().click();
    await expect(page.getByText("Equipo eliminado.").last()).toBeVisible({ timeout: 15_000 });
    await addTeam(page, `RR Fenix ${suffix}`, "🔥");
    await expect(page.getByText("4/4 creados")).toBeVisible({ timeout: 20_000 });
    await capture(page, testInfo, 6, "rr-team-delete-readd");

    await page.locator('[data-testid^="team-select-"]').first().click();
    await page.getByTestId("member-type-select").selectOption("USER");
    await page.getByTestId("member-user-query-input").fill(ADMIN_PHONE.replace(/\D/g, "").slice(-6));
    const suggestion = page.locator('[data-testid^="member-suggestion-"]').first();
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await suggestion.click();
    await page.getByTestId("member-add-btn").click();
    await expect(page.getByText("Miembro agregado correctamente.").last()).toBeVisible({ timeout: 15_000 });
    await capture(page, testInfo, 7, "rr-member-user");

    await page.getByTestId("member-type-select").selectOption("GUEST");
    await page.getByTestId("member-guest-name-input").fill(`Invitado RR ${suffix}`);
    await page.getByTestId("member-add-btn").click();
    await expect(page.getByText("Miembro agregado correctamente.").last()).toBeVisible({ timeout: 15_000 });
    await capture(page, testInfo, 8, "rr-member-guest");

    await openTournamentTab(page, "fixture");
    await page.getByTestId("tournament-generate-fixture-btn").click();
    await expect(page.getByText("Fixture generado correctamente.").last()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Ronda 1")).toBeVisible({ timeout: 20_000 });
    await capture(page, testInfo, 9, "rr-fixture");

    await page.getByTestId("tournament-status-live-btn").click();
    await expect(page.getByText("Torneo pasado a LIVE.").last()).toBeVisible({ timeout: 15_000 });
    await capture(page, testInfo, 10, "rr-live");

    const rrMatchId = await startNextPendingMatch(page);
    await capture(page, testInfo, 11, "rr-match-start");

    await saveMatchResult(page, rrMatchId, 2, 1);
    await capture(page, testInfo, 12, "rr-score-saved");

    await finishMatch(page, rrMatchId, 2, 1);
    await capture(page, testInfo, 13, "rr-match-finished");

    await page.getByTestId("tournament-status-finished-btn").click();
    await expect(page.getByText("Torneo finalizado.").last()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tournament-status-archived-btn")).toBeEnabled({ timeout: 10_000 });
    await capture(page, testInfo, 14, "rr-tournament-finished");

    await openTournamentTab(page, "share");
    const rrPublicPage = await openShareLinkInNewPage(page, "share-open-public-link");
    await expect(rrPublicPage.getByText("Ahora / Proximo")).toBeVisible({ timeout: 20_000 });
    await capture(rrPublicPage, testInfo, 15, "rr-public");
    await expect(rrPublicPage.getByRole("heading", { name: "Tabla de posiciones" })).toBeVisible({ timeout: 20_000 });
    await capture(rrPublicPage, testInfo, 16, "rr-public-standings-fixture");
    await rrPublicPage.close();

    const rrTvPage = await openShareLinkInNewPage(page, "share-open-tv-link");
    await expect(rrTvPage.getByTestId("tournament-tv-page")).toBeVisible({ timeout: 20_000 });
    await capture(rrTvPage, testInfo, 17, "rr-public-tv");
    await rrTvPage.close();

    await page.getByTestId("tournament-status-archived-btn").click();
    await expect(page.getByText("Torneo archivado.").last()).toBeVisible({ timeout: 15_000 });
    await capture(page, testInfo, 18, "rr-archived");

    // KNOCKOUT
    const koTitle = `E2E KO ${suffix}`;
    await createTournament(page, {
      title: koTitle,
      location: "Sede E2E KO",
      format: "KNOCKOUT",
      teamsCount: 4,
      minutes: 18,
    });
    await capture(page, testInfo, 101, "ko-created");

    await openTournamentTab(page, "teams");
    await addTeam(page, `KO Pumas ${suffix}`, "🐾");
    await addTeam(page, `KO Zorros ${suffix}`, "🦊");
    await addTeam(page, `KO Leones ${suffix}`, "🦁");
    await addTeam(page, `KO Toros ${suffix}`, "🐂");
    await expect(page.getByText("4/4 creados")).toBeVisible({ timeout: 20_000 });
    await capture(page, testInfo, 102, "ko-teams-added");

    await openTournamentTab(page, "fixture");
    await page.getByTestId("tournament-generate-fixture-btn").click();
    await expect(page.getByText("Fixture generado correctamente.").last()).toBeVisible({ timeout: 15_000 });
    await capture(page, testInfo, 103, "ko-fixture");

    await page.getByTestId("tournament-status-live-btn").click();
    await expect(page.getByText("Torneo pasado a LIVE.").last()).toBeVisible({ timeout: 15_000 });
    await capture(page, testInfo, 104, "ko-live");

    const semi1 = await startNextPendingMatch(page);
    await finishMatch(page, semi1, 1, 0);
    await capture(page, testInfo, 105, "ko-semi1-finished");

    const lastCardTextAfterSemi1 = await page.locator('[data-testid^="match-card-"]').last().innerText();
    expect(lastCardTextAfterSemi1).not.toContain("TBD vs TBD");
    await capture(page, testInfo, 106, "ko-final-slot-updated");

    const semi2 = await startNextPendingMatch(page);
    await finishMatch(page, semi2, 2, 1);
    await capture(page, testInfo, 107, "ko-semi2-finished");

    const finalMatch = await startNextPendingMatch(page);
    await finishMatch(page, finalMatch, 3, 2);
    await capture(page, testInfo, 108, "ko-final-finished");

    await page.getByTestId("tournament-status-finished-btn").click();
    await expect(page.getByText("Torneo finalizado.").last()).toBeVisible({ timeout: 15_000 });
    await capture(page, testInfo, 109, "ko-tournament-finished");

    await openTournamentTab(page, "share");
    const koPublicPage = await openShareLinkInNewPage(page, "share-open-public-link");
    await expect(koPublicPage.getByText("Llaves")).toBeVisible({ timeout: 20_000 });
    await capture(koPublicPage, testInfo, 110, "ko-public-bracket");
    await koPublicPage.close();

    const koTvPage = await openShareLinkInNewPage(page, "share-open-tv-link");
    await expect(koTvPage.getByTestId("tournament-tv-page")).toBeVisible({ timeout: 20_000 });
    await capture(koTvPage, testInfo, 111, "ko-public-tv");
    await koTvPage.close();

    await page.getByTestId("tournament-status-archived-btn").click();
    await expect(page.getByText("Torneo archivado.").last()).toBeVisible({ timeout: 15_000 });
    await capture(page, testInfo, 112, "ko-archived");
  });
});
