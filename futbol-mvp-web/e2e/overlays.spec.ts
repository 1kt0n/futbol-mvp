// Overlays (rediseño UX §6.2.15, iteración 0b).
//
// Para cada hoja, diálogo y menú: scrollear la pantalla al fondo, abrirlo sin
// scrollear y verificar que el botón principal quede dentro de la pantalla,
// que #root quede inerte y el fondo bloqueado, que axe no encuentre violaciones
// serias y que Esc lo cierre devolviendo el foco al botón que lo abrió.
// Corre en Pixel 7 (Chromium) y en iPhone 14 (WebKit): npm run e2e:overlays.
//
// Necesita el backend con una base local y el admin de scripts/e2e_seed_admin.py:
//   E2E_WEB_URL   (p. ej. http://127.0.0.1:5186)
//   E2E_API_URL   (p. ej. http://127.0.0.1:8778; es el VITE_API_URL del front)
//   E2E_ADMIN_PHONE / E2E_ADMIN_PIN
// Los datos (eventos, cancha, anuncio, aviso, rol, torneo) se crean por API con un
// sufijo único; no se borran.

import AxeBuilder from "@axe-core/playwright";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const ADMIN_PHONE = (process.env.E2E_ADMIN_PHONE || "").trim();
const ADMIN_PIN = (process.env.E2E_ADMIN_PIN || "").trim();
const API_URL = (process.env.E2E_API_URL || "http://127.0.0.1:8000").trim().replace(/\/$/, "");

type Seed = {
  token: string;
  suffix: string;
  eventId: string;
  eventTitle: string;
  courtId: string;
  registrationId: string;
  openEventId: string;
  openCourtId: string;
  announcementTitle: string;
  notificationTitle: string;
  roleName: string;
  tournamentId: string;
  matchId: string;
  draftTournamentId: string;
};

let seed: Seed;

async function loginToken(page: Page): Promise<string> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("auth-login-mode-btn").click();
  await page.getByTestId("auth-phone-input").fill(ADMIN_PHONE);
  await page.getByTestId("auth-phone-next-btn").click();
  await page.getByTestId("auth-pin-input").fill(ADMIN_PIN);
  await page.getByTestId("auth-login-submit").click();
  await expect(page.getByTestId("open-admin-panel")).toBeVisible({ timeout: 25_000 });
  const token = await page.evaluate(() => localStorage.getItem("actorUserId") || "");
  expect(token, "el login no dejó token").not.toBe("");
  return token;
}

async function call(api: APIRequestContext, method: string, path: string, data?: unknown) {
  const res = await api.fetch(`${API_URL}${path}`, { method, data });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return res.json();
}

async function createSeed(token: string, project: string): Promise<Seed> {
  const api = await playwrightRequest.newContext({ extraHTTPHeaders: { "X-Actor-User-Id": token } });
  const suffix = `${project}-${Date.now().toString(36)}`;
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

  // Evento con dos canchas y el admin anotado (tarjeta del jugador, baja, calendario).
  const eventTitle = `Overlays ${suffix}`;
  const ev = await call(api, "POST", "/admin/events", {
    title: eventTitle,
    starts_at: inDays(3),
    location_name: "Cancha E2E",
    visibility: "GLOBAL",
  });
  const court = await call(api, "POST", `/admin/events/${ev.event_id}/courts`, { name: "Cancha 1", capacity: 10, sort_order: 1 });
  await call(api, "POST", `/admin/events/${ev.event_id}/courts`, { name: "Cancha 2", capacity: 10, sort_order: 2 });
  const reg = await call(api, "POST", `/events/${ev.event_id}/register`, { court_id: court.court_id });

  // Otro evento sin anotarse (diálogo "¿Estás seguro de anotarte?").
  const open = await call(api, "POST", "/admin/events", {
    title: `Abierto ${suffix}`,
    starts_at: inDays(4),
    location_name: "Cancha E2E",
  });
  const openCourt = await call(api, "POST", `/admin/events/${open.event_id}/courts`, { name: "Cancha 1", capacity: 10, sort_order: 1 });

  const announcementTitle = `Anuncio ${suffix}`;
  await call(api, "POST", "/admin/calendar/announcements", { title: announcementTitle, starts_at: inDays(5) });

  // El backend limita los avisos a 10 cada 5 min por persona: si se corre seguido,
  // se reusa uno activo (el diálogo se abre y se cancela, no lo desactiva).
  let notificationTitle = `Aviso ${suffix}`;
  try {
    await call(api, "POST", "/admin/notifications", {
      title: notificationTitle,
      message: "Aviso de prueba de overlays.",
      expires_in_days: 1,
    });
  } catch {
    const list = await call(api, "GET", "/admin/notifications");
    notificationTitle = (list.items || []).find((n: { is_active: boolean }) => n.is_active)?.title || "";
  }

  const roleName = `Rol ${suffix}`;
  await call(api, "POST", "/admin/roles", {
    code: `e2e_${suffix.replace(/[^a-z0-9]/gi, "_")}`.slice(0, 40),
    name: roleName.slice(0, 60),
    permissions: [],
  });

  // Torneo en vivo con un partido iniciado (hoja "Cargar resultado").
  const tournament = await call(api, "POST", "/admin/tournaments", {
    title: `Torneo ${suffix}`,
    format: "ROUND_ROBIN",
    teams_count: 2,
    minutes_per_match: 20,
  });
  await call(api, "POST", `/admin/tournaments/${tournament.id}/teams`, { name: "Local E2E" });
  await call(api, "POST", `/admin/tournaments/${tournament.id}/teams`, { name: "Visita E2E" });
  await call(api, "POST", `/admin/tournaments/${tournament.id}/generate-fixture`);
  await call(api, "POST", `/admin/tournaments/${tournament.id}/status`, { status: "LIVE" });
  const detail = await call(api, "GET", `/admin/tournaments/${tournament.id}`);
  const matchId = String(detail.matches[0].id);
  await call(api, "POST", `/admin/tournaments/${tournament.id}/matches/${matchId}/start`);
  // "Eliminar" solo aparece en borrador (o archivado).
  const draft = await call(api, "POST", "/admin/tournaments", { title: `Borrador ${suffix}`, teams_count: 2 });

  await api.dispose();
  return {
    token,
    suffix,
    eventId: ev.event_id,
    eventTitle,
    courtId: court.court_id,
    registrationId: reg.registration_id,
    openEventId: open.event_id,
    openCourtId: openCourt.court_id,
    announcementTitle,
    notificationTitle,
    roleName,
    tournamentId: tournament.id,
    matchId,
    draftTournamentId: draft.id,
  };
}

// Espera a que terminen las animaciones de entrada de los overlays (las de la
// pantalla de fondo, como un pulse infinito, no cuentan).
async function waitForAnimations(page: Page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("overlay-root");
    return document.getAnimations().every((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      return a.playState !== "running" || !target || !root?.contains(target);
    });
  });
}

// Abre el overlay como lo haría alguien que scrolleó hasta el fondo: sin que
// Playwright mueva la pantalla para alcanzar el botón.
async function openFromBottom(page: Page, trigger: Locator) {
  await expect(trigger).toBeAttached({ timeout: 25_000 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await trigger.evaluate((el: HTMLElement) => {
    el.focus({ preventScroll: true });
    el.click();
  });
}

async function expectInViewport(page: Page, target: Locator, name: string) {
  const vp = page.viewportSize()!;
  const box = await target.boundingBox();
  const dom = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const panel = el.closest(".ov-panel")?.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, innerHeight, scrollY, body: document.body.style.cssText, panel: panel && [panel.top, panel.bottom] };
  });
  test.info().annotations.push({ type: "geom", description: `${name}: ${JSON.stringify({ box, dom })}` });
  expect(box, `${name}: el botón principal no tiene caja`).not.toBeNull();
  expect(box!.y, `${name}: el botón principal queda arriba de la pantalla`).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, `${name}: el botón principal queda abajo de la pantalla`).toBeLessThanOrEqual(vp.height + 0.5);
  expect(box!.x, `${name}: el botón principal se corta a la izquierda`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${name}: el botón principal se corta a la derecha`).toBeLessThanOrEqual(vp.width + 0.5);
}

async function expectNoSeriousA11y(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).include("#overlay-root").withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => ["critical", "serious"].includes(String(v.impact)));
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    `${name}: violaciones de accesibilidad`
  ).toEqual([]);
}

type Case = {
  name: string;
  trigger: (page: Page) => Locator;
  cta: (page: Page) => Locator;
};

// Abre, verifica y cierra con Esc (el foco vuelve al disparador).
async function checkOverlay(page: Page, c: Case) {
  const trigger = c.trigger(page);
  await openFromBottom(page, trigger);
  const panel = page.locator('#overlay-root [aria-modal="true"]').last();
  await expect(panel, `${c.name}: no se abrió`).toBeVisible();
  await waitForAnimations(page);

  await expectInViewport(page, c.cta(page), c.name);
  const state = await page.evaluate(() => ({
    rootInert: Boolean(document.getElementById("root")?.inert),
    bodyFixed: document.body.style.position === "fixed",
  }));
  expect(state, `${c.name}: #root inerte y fondo bloqueado`).toEqual({ rootInert: true, bodyFixed: true });
  await expectNoSeriousA11y(page, c.name);

  await page.keyboard.press("Escape");
  await expect(page.locator('#overlay-root [aria-modal="true"]'), `${c.name}: Esc no lo cerró`).toHaveCount(0);
  expect(await trigger.evaluate((el) => el === document.activeElement), `${c.name}: el foco no volvió`).toBe(true);
  expect(await page.evaluate(() => document.body.style.position), `${c.name}: el fondo quedó bloqueado`).toBe("");
}

async function useSession(page: Page) {
  await page.addInitScript((token) => {
    localStorage.setItem("actorUserId", token);
    localStorage.setItem("actor_id", token);
  }, seed.token);
}

async function openAdminTab(page: Page, tab: string) {
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await page.getByTestId(`admin-tab-${tab}`).click();
}

test.describe("Overlays", () => {
  test.skip(!ADMIN_PHONE || !ADMIN_PIN, "Faltan E2E_ADMIN_PHONE / E2E_ADMIN_PIN (ver scripts/e2e_seed_admin.py).");

  test.beforeAll(async ({ browser }, testInfo) => {
    const page = await browser.newPage();
    const token = await loginToken(page);
    await page.close();
    seed = await createSeed(token, testInfo.project.name);
  });

  test.beforeEach(async ({ page }) => {
    await useSession(page);
  });

  test(".page-enter no deja transform", async ({ page }) => {
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.locator(".page-enter").first().waitFor();
    await page.waitForTimeout(300);
    const transform = await page.locator(".page-enter").first().evaluate((el) => getComputedStyle(el).transform);
    expect(transform).toBe("none");
  });

  test("Gestión › Eventos", async ({ page }) => {
    await page.goto(`/admin?event_id=${seed.eventId}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId(`admin-event-select-${seed.eventId}`).click();
    await expect(page.getByTestId("admin-event-active-title")).toContainText(seed.eventTitle, { timeout: 25_000 });

    const cases: Case[] = [
      { name: "Crear evento", trigger: (p) => p.getByTestId("admin-event-create-btn"), cta: (p) => p.getByTestId("admin-create-event-submit-btn") },
      { name: "Repetir", trigger: (p) => p.getByTestId("admin-event-repeat-btn"), cta: (p) => p.getByTestId("quick-repeat-submit-btn") },
      { name: "Editar evento", trigger: (p) => p.getByTestId("admin-event-edit-btn"), cta: (p) => p.getByTestId("admin-edit-event-submit-btn") },
      { name: "Crear cancha", trigger: (p) => p.getByTestId("admin-event-create-court-btn"), cta: (p) => p.getByTestId("create-court-submit-btn") },
      { name: "Editar cancha", trigger: (p) => p.getByTestId(`admin-court-edit-${seed.courtId}`), cta: (p) => p.getByTestId("edit-court-submit-btn") },
      { name: "Cerrar cancha", trigger: (p) => p.getByTestId(`admin-court-close-${seed.courtId}`), cta: (p) => p.getByTestId("admin-confirm-modal-confirm-btn") },
      { name: "Cerrar evento", trigger: (p) => p.getByTestId("admin-event-close-btn"), cta: (p) => p.getByTestId("admin-confirm-modal-confirm-btn") },
    ];
    for (const c of cases) await checkOverlay(page, c);
  });

  test("Gestión › Usuarios, Solicitudes, Notificaciones, Calendario y Roles", async ({ page }) => {
    await openAdminTab(page, "usuarios");
    const visibleButton = (p: Page, name: string) => p.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
    for (const c of [
      { name: "Crear usuario", trigger: (p: Page) => visibleButton(p, "+ Crear Usuario"), cta: (p: Page) => p.getByTestId("create-user-submit-btn") },
      { name: "Reset PIN", trigger: (p: Page) => visibleButton(p, "Reset PIN"), cta: (p: Page) => p.getByTestId("reset-pin-submit-btn") },
      { name: "Roles de usuario", trigger: (p: Page) => visibleButton(p, "Roles"), cta: (p: Page) => p.getByTestId("edit-roles-submit-btn") },
    ]) await checkOverlay(page, c);

    await openAdminTab(page, "solicitudes");
    await checkOverlay(page, {
      name: "Rechazar solicitud",
      trigger: (p) => p.getByTestId("account-reject-btn").first(),
      cta: (p) => p.getByTestId("account-reject-confirm-btn"),
    });

    await openAdminTab(page, "notificaciones");
    if (seed.notificationTitle) await checkOverlay(page, {
      name: "Desactivar aviso",
      trigger: (p) => p.locator("div", { hasText: seed.notificationTitle }).getByRole("button", { name: "Desactivar" }).last(),
      cta: (p) => p.getByTestId("notification-deactivate-confirm-btn"),
    });

    await openAdminTab(page, "calendario");
    await checkOverlay(page, {
      name: "Nuevo anuncio",
      trigger: (p) => p.getByRole("button", { name: "+ Nuevo anuncio" }),
      cta: (p) => p.getByTestId("announcement-submit-btn"),
    });
    await checkOverlay(page, {
      name: "Eliminar anuncio",
      trigger: (p) => p.getByTestId("announcement-delete-btn").first(),
      cta: (p) => p.getByTestId("announcement-delete-confirm-btn"),
    });

    await openAdminTab(page, "roles");
    await checkOverlay(page, {
      name: "Eliminar rol",
      trigger: (p) => p.locator("div", { hasText: seed.roleName }).getByTestId("role-delete-btn").last(),
      cta: (p) => p.getByTestId("role-delete-confirm-btn"),
    });
  });

  test("Gestión › Torneos", async ({ page }) => {
    await openAdminTab(page, "torneos");
    await checkOverlay(page, {
      name: "Crear torneo",
      trigger: (p) => p.getByTestId("tournament-create-btn"),
      cta: (p) => p.getByTestId("create-tournament-submit-btn"),
    });
    await page.getByTestId(`tournament-list-item-${seed.draftTournamentId}`).click();
    await expect(page.getByTestId("tournament-hero-title")).toHaveText(`Borrador ${seed.suffix}`, { timeout: 25_000 });
    await checkOverlay(page, {
      name: "Eliminar torneo",
      trigger: (p) => p.getByTestId("tournament-delete-btn"),
      cta: (p) => p.getByTestId("tournament-confirm-delete-btn"),
    });
    await page.getByTestId(`tournament-list-item-${seed.tournamentId}`).click();
    await expect(page.getByTestId("tournament-hero-title")).toHaveText(`Torneo ${seed.suffix}`, { timeout: 25_000 });
    await page.getByTestId("tournament-tab-fixture").click();
    await checkOverlay(page, {
      name: "Cargar resultado",
      trigger: (p) => p.getByTestId(`match-open-result-${seed.matchId}`),
      cta: (p) => p.getByTestId("result-save-btn"),
    });
  });

  test("Calendario: menú, anuncio, ítem y baja apilada", async ({ page }) => {
    await page.goto("/calendar", { waitUntil: "domcontentloaded" });
    await checkOverlay(page, {
      name: "Menú Agregar",
      trigger: (p) => p.getByTestId("calendar-fab"),
      cta: (p) => p.getByRole("menuitem").last(),
    });

    // Menú → Anuncio: el menú se cierra antes de abrir la hoja.
    await openFromBottom(page, page.getByTestId("calendar-fab"));
    await page.getByTestId("calendar-create-announcement").click();
    await expect(page.getByTestId("announcement-sheet")).toBeVisible();
    await waitForAnimations(page);
    await expectInViewport(page, page.getByTestId("announcement-submit-btn"), "Anuncio desde el menú");
    await page.keyboard.press("Escape");
    await expect(page.locator('#overlay-root [aria-modal="true"]')).toHaveCount(0);

    // Ítem → "¿Liberás tu lugar?" encima: Esc cierra solo el de arriba.
    const item = page.getByRole("button", { name: new RegExp(seed.eventTitle) }).first();
    await checkOverlay(page, {
      name: "Ítem del calendario",
      trigger: () => item,
      cta: (p) => p.getByTestId("calendar-item-unregister-btn"),
    });
    await openFromBottom(page, item);
    await page.getByTestId("calendar-item-unregister-btn").click();
    await waitForAnimations(page);
    await expect(page.locator('#overlay-root [aria-modal="true"]')).toHaveCount(2);
    await expectInViewport(page, page.getByTestId("confirm-sheet-confirm"), "Liberar (apilado)");
    const sheetInert = await page.getByTestId("calendar-item-sheet").evaluate((el) => Boolean(el.closest(".ov-layer")?.inert));
    expect(sheetInert, "la hoja de abajo tiene que quedar inerte").toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator('#overlay-root [aria-modal="true"]')).toHaveCount(1);
    await expect(page.getByTestId("calendar-item-unregister-btn")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator('#overlay-root [aria-modal="true"]')).toHaveCount(0);
  });

  test("Partido y Perfil", async ({ page }) => {
    await page.goto(`/?event_id=${seed.eventId}`, { waitUntil: "domcontentloaded" });
    await checkOverlay(page, {
      name: "Baja propia",
      trigger: (p) => p.getByTestId(`player-cancel-${seed.registrationId}`),
      cta: (p) => p.getByTestId("confirm-sheet-confirm"),
    });
    await checkOverlay(page, {
      name: "Tarjeta del jugador",
      trigger: (p) => p.getByTestId(`court-card-${seed.courtId}`).locator('button[title="Admin E2E"]').first(),
      cta: (p) => p.getByRole("button", { name: "Cerrar", exact: true }),
    });

    await page.goto(`/?event_id=${seed.openEventId}`, { waitUntil: "domcontentloaded" });
    await checkOverlay(page, {
      name: "¿Estás seguro de anotarte?",
      trigger: (p) => p.getByTestId(`court-register-cta-${seed.openCourtId}`),
      cta: (p) => p.getByTestId("register-confirm-btn"),
    });

    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await checkOverlay(page, {
      name: "Cerrar sesión",
      trigger: (p) => p.getByTestId("profile-logout-btn"),
      cta: (p) => p.getByTestId("confirm-sheet-confirm"),
    });
  });

  test("Formulario con cambios: el fondo no cierra y Esc pregunta", async ({ page }) => {
    await page.goto(`/admin?event_id=${seed.eventId}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId(`admin-event-select-${seed.eventId}`).click();
    await openFromBottom(page, page.getByTestId("admin-event-create-court-btn"));
    await waitForAnimations(page);
    await page.getByTestId("create-court-name-input").fill("Cancha con cambios");

    await page.mouse.click(5, 5);
    await expect(page.getByTestId("create-court-name-input")).toHaveValue("Cancha con cambios");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sheet-keep-editing-btn")).toBeFocused();
    await expectInViewport(page, page.getByTestId("sheet-discard-btn"), "Descartar");
    await page.getByTestId("sheet-keep-editing-btn").click();
    await expect(page.getByTestId("sheet-keep-editing-btn")).toHaveCount(0);
    await expect(page.getByTestId("create-court-name-input")).toHaveValue("Cancha con cambios");

    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.getByTestId("sheet-discard-btn").click();
    await expect(page.locator('#overlay-root [aria-modal="true"]')).toHaveCount(0);
  });

  // Va al final: libera el lugar del admin en el evento sembrado.
  test("Cerrar la hoja y su diálogo juntos devuelve el foco al ítem", async ({ page }) => {
    await page.goto("/calendar", { waitUntil: "domcontentloaded" });
    const item = page.getByRole("button", { name: new RegExp(seed.eventTitle) }).first();
    await openFromBottom(page, item);
    await page.getByTestId("calendar-item-unregister-btn").click();
    await expect(page.locator('#overlay-root [aria-modal="true"]')).toHaveCount(2);
    await page.getByTestId("confirm-sheet-confirm").click();
    await expect(page.locator('#overlay-root [aria-modal="true"]')).toHaveCount(0);
    await expect(item).toBeFocused();
    expect(await page.evaluate(() => document.body.style.position)).toBe("");
  });

  test("Toast: encima de la barra, y arriba con una hoja abierta", async ({ page }) => {
    await page.goto(`/admin?event_id=${seed.eventId}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId(`admin-event-select-${seed.eventId}`).click();
    await openFromBottom(page, page.getByTestId("admin-event-create-court-btn"));
    await page.getByTestId("create-court-name-input").fill(`Cancha toast ${seed.suffix}`.slice(0, 60));
    await page.getByTestId("create-court-submit-btn").click();

    const toastBox = page.getByTestId("toast").first();
    await expect(toastBox).toBeVisible();
    await waitForAnimations(page);
    const t = (await toastBox.boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "Navegación principal" }).boundingBox())!;
    expect(t.y + t.height, "el toast tapa la barra").toBeLessThanOrEqual(nav.y + 0.5);

    // Con una hoja abierta el toast pasa arriba, así no tapa el footer.
    await openFromBottom(page, page.getByTestId("admin-event-create-btn"));
    await waitForAnimations(page);
    const toasterTop = await page.getByTestId("toaster").evaluate((el) => el.getBoundingClientRect().top);
    expect(toasterTop).toBeLessThan(100);
    await page.keyboard.press("Escape");
  });
});
