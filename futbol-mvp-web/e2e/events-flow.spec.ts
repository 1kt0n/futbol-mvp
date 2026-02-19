import { expect, test, type Locator, type Page } from "@playwright/test";
import { capture } from "./helpers/capture";

const ADMIN_PHONE = (process.env.E2E_ADMIN_PHONE || "").trim();
const ADMIN_PIN = (process.env.E2E_ADMIN_PIN || "").trim();
const USER_PIN = "1234";

function uniqueSuffix(projectName: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 7);
  return `${stamp}-${projectName}-${random}`;
}

function randomPhone() {
  const n = Math.floor(10_000_000 + Math.random() * 89_999_999);
  return `54911${n}`;
}

async function clearSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("actorUserId");
    localStorage.removeItem("actor_id");
    localStorage.removeItem("actor_me");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

async function loginWithPin(page: Page, phone: string, pin: string, expectAdmin: boolean) {
  await clearSession(page);
  await expect(page.getByTestId("auth-login-mode-btn")).toBeVisible();
  await page.getByTestId("auth-login-mode-btn").click();
  await expect(page.getByTestId("auth-phone-input")).toBeVisible();
  await page.getByTestId("auth-phone-input").fill(phone);
  await page.getByTestId("auth-phone-next-btn").click();
  await expect(page.getByTestId("auth-pin-input")).toBeVisible();
  await page.getByTestId("auth-pin-input").fill(pin);
  await page.getByTestId("auth-login-submit").click();

  if (expectAdmin) {
    await expect(page.getByTestId("open-admin-panel")).toBeVisible({ timeout: 25_000 });
  } else {
    await expect(page.getByTestId("app-refresh-btn")).toBeVisible({ timeout: 25_000 });
  }
}

async function registerUser(page: Page, fullName: string, phone: string, pin: string) {
  await clearSession(page);
  await expect(page.getByTestId("auth-register-mode-btn")).toBeVisible();
  await page.getByTestId("auth-register-mode-btn").click();
  await expect(page.getByTestId("auth-phone-input")).toBeVisible();
  await page.getByTestId("auth-phone-input").fill(phone);
  await page.getByTestId("auth-phone-next-btn").click();
  await expect(page.getByTestId("auth-pin-input")).toBeVisible();
  await page.getByTestId("auth-pin-input").fill(pin);
  await page.getByTestId("auth-register-next-btn").click();
  await expect(page.getByTestId("auth-full-name-input")).toBeVisible();
  await page.getByTestId("auth-full-name-input").fill(fullName);
  await page.getByTestId("auth-register-submit").click();
  await expect(page.getByTestId("app-refresh-btn")).toBeVisible({ timeout: 25_000 });
}

async function openAdminEventsTab(page: Page, eventId?: string) {
  const target = eventId ? `/admin?event_id=${encodeURIComponent(eventId)}` : "/admin";
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("admin-tab-eventos")).toBeVisible({ timeout: 25_000 });
  await page.getByTestId("admin-tab-eventos").click();
  await expect(page.getByTestId("admin-events-tab")).toBeVisible({ timeout: 25_000 });
}

async function selectAdminEventByTitle(page: Page, eventTitle: string, eventId?: string) {
  const item = eventId
    ? page.getByTestId(`admin-event-select-${eventId}`)
    : page.locator('[data-testid^="admin-event-select-"]', { hasText: eventTitle }).first();
  if (await item.count()) {
    await item.click();
  }
  await expect(page.getByTestId("admin-event-active-title")).toContainText(eventTitle, { timeout: 25_000 });
}

async function createEvent(page: Page, opts: { title: string; startsAt: string; location: string; openModal?: boolean }) {
  if (opts.openModal !== false) {
    await page.getByTestId("admin-event-create-btn").click();
  }
  await expect(page.getByTestId("admin-create-event-title-input")).toBeVisible();

  await page.getByTestId("admin-create-event-title-input").fill(opts.title);
  await page.getByTestId("admin-create-event-starts-at-input").fill(opts.startsAt);
  await page.getByTestId("admin-create-event-location-input").fill(opts.location);
  await page.getByTestId("admin-create-event-submit-btn").click();

  const createdItem = page.locator('[data-testid^="admin-event-select-"]', { hasText: opts.title }).first();
  await expect(createdItem).toBeVisible({ timeout: 25_000 });
  await createdItem.click();
  await expect(page.getByTestId("admin-event-active-title")).toContainText(opts.title, { timeout: 25_000 });

  const createdTestId = await createdItem.getAttribute("data-testid");
  if (!createdTestId) throw new Error("No se pudo resolver el id del evento creado.");
  return createdTestId.replace("admin-event-select-", "");
}

async function createCourt(page: Page, name: string, capacity: number, sortOrder: number) {
  await page.getByTestId("admin-event-create-court-btn").click();
  await expect(page.getByTestId("create-court-name-input")).toBeVisible();

  await page.getByTestId("create-court-name-input").fill(name);
  await page.getByTestId("create-court-capacity-input").fill(String(capacity));
  await page.getByTestId("create-court-sort-order-input").fill(String(sortOrder));
  await page.getByTestId("create-court-submit-btn").click();

  await expect(page.locator('[data-testid^="admin-court-card-"]', { hasText: name }).first()).toBeVisible({
    timeout: 25_000,
  });
}

async function editCourtCapacity(page: Page, courtName: string, capacity: number, sortOrder: number) {
  const card = page.locator('[data-testid^="admin-court-card-"]', { hasText: courtName }).first();
  await expect(card).toBeVisible({ timeout: 25_000 });
  await card.locator('[data-testid^="admin-court-edit-"]').first().click();

  await expect(page.getByTestId("edit-court-name-input")).toBeVisible();
  await page.getByTestId("edit-court-capacity-input").fill(String(capacity));
  await page.getByTestId("edit-court-sort-order-input").fill(String(sortOrder));
  await page.getByTestId("edit-court-submit-btn").click();

  const modalClose = page.getByTestId("admin-modal-close-btn");
  if (await modalClose.count()) {
    const visible = await modalClose.first().isVisible().catch(() => false);
    if (visible) {
      await modalClose.first().click();
    }
  }
}

async function closeCourtByName(page: Page, courtName: string) {
  const card = page.locator('[data-testid^="admin-court-card-"]', { hasText: courtName }).first();
  await card.locator('[data-testid^="admin-court-close-"]').first().click();
  await page.getByTestId("admin-confirm-modal-confirm-btn").click();
}

async function openCourtByName(page: Page, courtName: string) {
  const card = page.locator('[data-testid^="admin-court-card-"]', { hasText: courtName }).first();
  const openBtn = card.locator('[data-testid^="admin-court-open-"]').first();
  await openBtn.scrollIntoViewIfNeeded();
  await openBtn.click({ force: true });
}

async function selectAppEventByTitle(page: Page, eventTitle: string, eventId?: string) {
  if (eventId) {
    await page.goto(`/?event_id=${encodeURIComponent(eventId)}`, { waitUntil: "domcontentloaded" });
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const selectorButtons = page.locator('[data-testid^="app-event-select-"]');
    const count = await selectorButtons.count();
    if (count > 0) {
      const target = selectorButtons.filter({ hasText: eventTitle }).first();
      if (await target.count()) {
        await target.click();
        break;
      }
    }
    await page.getByTestId("app-refresh-btn").click();
    await page.waitForTimeout(500);
  }

  await expect(page.getByTestId("event-active-title")).toContainText(eventTitle, { timeout: 25_000 });
}

async function appCourtCard(page: Page, courtName: string) {
  const card = page.locator('[data-testid^="court-card-"]', { hasText: courtName }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  return card;
}

async function waitForAppIdle(page: Page) {
  const refreshBtn = page.getByTestId("app-refresh-btn");
  if ((await refreshBtn.count()) > 0) {
    await expect(refreshBtn).toBeVisible({ timeout: 30_000 });
    await expect(refreshBtn).toBeEnabled({ timeout: 30_000 });
  }
}

async function registerSelfInCourt(page: Page, courtName: string) {
  const card = await appCourtCard(page, courtName);
  await card.locator('[data-testid^="court-register-"]').click();
  await expect(page.getByText("Anotado")).toBeVisible({ timeout: 20_000 });
}

async function registerGuestInCourt(page: Page, guestName: string, courtName: string) {
  await waitForAppIdle(page);
  await page.getByTestId("guest-name-input").fill(guestName);
  await page.getByTestId("guest-court-select").selectOption({ label: courtName });
  const submit = page.getByTestId("guest-submit-btn");
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click({ force: true });
  await expect(page.getByText("Invitado confirmado")).toBeVisible({ timeout: 20_000 });
}

function registrationIdFromRow(row: Locator) {
  return row.getAttribute("data-testid").then((v) => {
    if (!v) throw new Error("No se pudo obtener registration id desde data-testid.");
    return v.replace("player-row-", "");
  });
}

async function moveFirstPlayer(page: Page, fromCourt: string, toCourt: string) {
  await waitForAppIdle(page);
  const sourceCard = await appCourtCard(page, fromCourt);
  const row = sourceCard.locator('[data-testid^="player-row-"]').first();
  await expect(row).toBeVisible({ timeout: 20_000 });

  const regId = await registrationIdFromRow(row);
  const moveSelect = row.locator(`[data-testid="player-move-select-${regId}"]`);
  await expect(moveSelect).toBeVisible({ timeout: 30_000 });
  await expect(moveSelect).toBeEnabled({ timeout: 30_000 });
  await moveSelect.selectOption({ label: toCourt });
  await expect(page.getByText("Movido")).toBeVisible({ timeout: 20_000 });
}

async function cancelFirstPlayer(page: Page, courtName: string) {
  await waitForAppIdle(page);
  const card = await appCourtCard(page, courtName);
  const row = card.locator('[data-testid^="player-row-"]').first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const cancelBtn = row.locator('[data-testid^="player-cancel-"]').first();
  await expect(cancelBtn).toBeVisible({ timeout: 30_000 });
  await expect(cancelBtn).toBeEnabled({ timeout: 30_000 });
  await cancelBtn.scrollIntoViewIfNeeded();
  await cancelBtn.click({ force: true });
  await Promise.race([
    page.getByText("Listo").first().waitFor({ state: "visible", timeout: 6000 }).catch(() => null),
    waitForAppIdle(page),
  ]);
}

async function closeEvent(page: Page) {
  await page.getByTestId("admin-event-close-btn").click();
  await page.getByTestId("admin-confirm-modal-confirm-btn").click();
}

async function reopenEvent(page: Page) {
  await page.getByTestId("admin-event-reopen-btn").click();
  await page.getByTestId("admin-confirm-modal-confirm-btn").click();
}

async function finalizeEvent(page: Page) {
  await page.getByTestId("admin-event-finalize-btn").click();
  await page.getByTestId("admin-confirm-modal-confirm-btn").click();
}

test.describe("Events create flow screenshots", () => {
  test("captures full create/match event flow", async ({ page }, testInfo) => {
    test.skip(!ADMIN_PHONE || !ADMIN_PIN, "Faltan E2E_ADMIN_PHONE y/o E2E_ADMIN_PIN");

    const suffix = uniqueSuffix(testInfo.project.name);
    const eventTitle = `E2E Evento ${suffix}`;
    const courtOne = `Cancha Norte ${suffix}`;
    const courtTwo = `Cancha Sur ${suffix}`;

    const userTwo = {
      fullName: `Jugador Dos ${suffix}`,
      phone: randomPhone(),
      pin: USER_PIN,
    };

    const userThree = {
      fullName: `Jugador Tres ${suffix}`,
      phone: randomPhone(),
      pin: USER_PIN,
    };

    await loginWithPin(page, ADMIN_PHONE, ADMIN_PIN, true);
    await capture(page, testInfo, 1, "event-login-admin");

    await openAdminEventsTab(page);
    await capture(page, testInfo, 2, "event-admin-tab");

    await page.getByTestId("admin-event-create-btn").click();
    await expect(page.getByTestId("admin-create-event-title-input")).toBeVisible();
    await capture(page, testInfo, 3, "event-open-create-modal");

    const eventId = await createEvent(page, {
      title: eventTitle,
      startsAt: "2026-03-13T20:00",
      location: "Sede E2E Eventos",
      openModal: false,
    });
    await capture(page, testInfo, 4, "event-created");

    await createCourt(page, courtOne, 2, 1);
    await capture(page, testInfo, 5, "event-court-one-created");

    await createCourt(page, courtTwo, 2, 2);
    await capture(page, testInfo, 6, "event-court-two-created");

    await editCourtCapacity(page, courtTwo, 3, 2);
    await capture(page, testInfo, 7, "event-court-two-edited");

    await closeCourtByName(page, courtTwo);
    await capture(page, testInfo, 8, "event-court-two-closed");

    await openCourtByName(page, courtTwo);
    await capture(page, testInfo, 9, "event-court-two-opened");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await selectAppEventByTitle(page, eventTitle, eventId);
    await capture(page, testInfo, 10, "event-app-selected");

    await registerSelfInCourt(page, courtOne);
    await capture(page, testInfo, 11, "event-admin-self-registered");

    await registerGuestInCourt(page, `Invitado ${suffix}`, courtTwo);
    await capture(page, testInfo, 12, "event-admin-guest-registered");

    await registerUser(page, userTwo.fullName, userTwo.phone, userTwo.pin);
    await selectAppEventByTitle(page, eventTitle, eventId);
    await registerSelfInCourt(page, courtOne);
    await capture(page, testInfo, 13, "event-user-two-registered");

    await loginWithPin(page, ADMIN_PHONE, ADMIN_PIN, true);
    await openAdminEventsTab(page, eventId);
    await selectAdminEventByTitle(page, eventTitle, eventId);
    await openCourtByName(page, courtOne);
    await capture(page, testInfo, 14, "event-court-one-reopened-full");

    await registerUser(page, userThree.fullName, userThree.phone, userThree.pin);
    await selectAppEventByTitle(page, eventTitle, eventId);
    await registerSelfInCourt(page, courtOne);
    await capture(page, testInfo, 15, "event-user-three-waitlist");

    await loginWithPin(page, ADMIN_PHONE, ADMIN_PIN, true);
    await openAdminEventsTab(page, eventId);
    await selectAdminEventByTitle(page, eventTitle, eventId);
    await expect(page.getByTestId("admin-waitlist-section")).toContainText(userThree.fullName, { timeout: 25_000 });
    await capture(page, testInfo, 16, "event-admin-waitlist-visible");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await selectAppEventByTitle(page, eventTitle, eventId);
    await moveFirstPlayer(page, courtOne, courtTwo);
    await capture(page, testInfo, 17, "event-player-moved");

    await cancelFirstPlayer(page, courtTwo);
    await capture(page, testInfo, 18, "event-player-cancelled");

    await openAdminEventsTab(page, eventId);
    await selectAdminEventByTitle(page, eventTitle, eventId);
    await closeEvent(page);
    await capture(page, testInfo, 19, "event-closed");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await selectAppEventByTitle(page, eventTitle, eventId);
    await expect(page.getByTestId("event-closed-banner")).toBeVisible({ timeout: 20_000 });
    await capture(page, testInfo, 20, "event-app-closed-banner");

    await openAdminEventsTab(page, eventId);
    await selectAdminEventByTitle(page, eventTitle, eventId);
    await reopenEvent(page);
    await capture(page, testInfo, 21, "event-reopened");

    await closeEvent(page);
    await capture(page, testInfo, 22, "event-closed-again");

    await finalizeEvent(page);
    await capture(page, testInfo, 23, "event-finalized");
  });
});
