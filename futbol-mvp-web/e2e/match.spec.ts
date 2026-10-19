// Pantalla del partido /p/:id (rediseño UX, iteración 1a).
//
// Flujos del jugador: "Me anoto" en un toque con Deshacer, elegir cancha, el 409
// por cancha llena, "No puedo ir" con quién entra, "Liberar y avisar al grupo",
// el atrás con ?sheet=, deslizar para cerrar, el Menu de escritorio y el login
// que vuelve al partido. Corre en Pixel 7 (Chromium) y en iPhone 14 (WebKit).
//
// Necesita el backend con una base local, MATCH_SCREEN_ENABLED=all y
// ONE_TAP_REGISTER_ENABLED=true, y los usuarios de scripts/e2e_seed_admin.py:
//   E2E_WEB_URL, E2E_API_URL
//   E2E_ADMIN_PHONE / E2E_ADMIN_PIN   (crea los partidos por API)
//   E2E_PLAYER_PHONE / E2E_PLAYER_PIN (juega)
// Cada test arma su propio partido con un sufijo único. Al terminar se finalizan,
// así no quedan como "el próximo partido" de la base (lo usan otros tests).

import AxeBuilder from "@axe-core/playwright";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";

const ADMIN_PHONE = (process.env.E2E_ADMIN_PHONE || "").trim();
const ADMIN_PIN = (process.env.E2E_ADMIN_PIN || "").trim();
const PLAYER_PHONE = (process.env.E2E_PLAYER_PHONE || "").trim();
const PLAYER_PIN = (process.env.E2E_PLAYER_PIN || "").trim();
const API_URL = (process.env.E2E_API_URL || "http://127.0.0.1:8000").trim().replace(/\/$/, "");

let adminToken = "";
let playerToken = "";
let flagsOn = false;
const created: string[] = [];

async function login(page: Page, phone: string, pin: string): Promise<string> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("auth-login-mode-btn").click();
  await page.getByTestId("auth-phone-input").fill(phone);
  await page.getByTestId("auth-phone-next-btn").click();
  await page.getByTestId("auth-pin-input").fill(pin);
  await page.getByTestId("auth-login-submit").click();
  await expect(page.getByTestId("nav-partido")).toBeVisible({ timeout: 25_000 });
  return page.evaluate(() => localStorage.getItem("actorUserId") || "");
}

async function api(token: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ extraHTTPHeaders: { "X-Actor-User-Id": token } });
}

async function call(ctx: APIRequestContext, method: string, path: string, data?: unknown) {
  const res = await ctx.fetch(`${API_URL}${path}`, { method, data });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return res.json();
}

type Match = { id: string; courts: Record<string, string> };

/** Partido con canchas [nombre, cupo] que empieza en `hours` horas. */
async function createMatch(name: string, courts: [string, number][], hours = 72): Promise<Match> {
  const ctx = await api(adminToken);
  const ev = await call(ctx, "POST", "/admin/events", {
    title: `${name} ${test.info().project.name}-${Date.now().toString(36)}`,
    starts_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
    location_name: "Club E2E",
  });
  const ids: Record<string, string> = {};
  for (const [i, [court, capacity]] of courts.entries()) {
    const c = await call(ctx, "POST", `/admin/events/${ev.event_id}/courts`, { name: court, capacity, sort_order: i + 1 });
    ids[court] = c.court_id;
  }
  await ctx.dispose();
  created.push(ev.event_id);
  return { id: ev.event_id, courts: ids };
}

async function asPlayer(page: Page) {
  await page.addInitScript((token) => {
    localStorage.setItem("actorUserId", token);
    localStorage.setItem("actor_id", token);
  }, playerToken);
}

async function waitForAnimations(page: Page) {
  await page.waitForFunction(() => {
    const root = document.getElementById("overlay-root");
    return document.getAnimations().every((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      return a.playState !== "running" || !target || !root?.contains(target);
    });
  });
}

const toastWith = (page: Page, text: string | RegExp) => page.getByTestId("toast").filter({ hasText: text });

test.describe("Pantalla del partido", () => {
  test.skip(
    !ADMIN_PHONE || !ADMIN_PIN || !PLAYER_PHONE || !PLAYER_PIN,
    "Faltan E2E_ADMIN_* / E2E_PLAYER_* (ver scripts/e2e_seed_admin.py)."
  );

  test.beforeAll(async ({ browser }) => {
    const config = await (await fetch(`${API_URL}/config`)).json();
    flagsOn = config.matchScreen === "all" && config.oneTapRegisterEnabled === true;
    if (!flagsOn) return;
    const page = await browser.newPage();
    adminToken = await login(page, ADMIN_PHONE, ADMIN_PIN);
    playerToken = await login(page, PLAYER_PHONE, PLAYER_PIN);
    await page.close();
  });

  test.afterAll(async () => {
    if (!adminToken || !created.length) return;
    const ctx = await api(adminToken);
    for (const id of created.splice(0)) await ctx.fetch(`${API_URL}/admin/events/${id}/finalize`, { method: "POST" });
    await ctx.dispose();
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!flagsOn, "La API tiene que correr con MATCH_SCREEN_ENABLED=all y ONE_TAP_REGISTER_ENABLED=true.");
    await asPlayer(page);
  });

  test("Me anoto en un toque, Deshacer y el toast arriba de la barra", async ({ page }) => {
    const m = await createMatch("Un toque", [["Cancha 1", 2], ["Cancha 2", 2], ["Suplentes", 3]]);
    await page.goto(`/p/${m.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("match-hero-count")).toHaveText("0/4 · Quedan 4 lugares");
    await expect(page.getByTestId(`match-slot-${m.courts["Cancha 1"]}`)).toHaveText("Libre · Anotarme acá");
    await expect(page.getByTestId("nav-partido")).toHaveAttribute("aria-current", "page");

    await page.getByTestId("match-register-btn").click();
    const toast = toastWith(page, "¡Adentro! Estás en la Cancha 1.");
    await expect(toast).toBeVisible();
    await expect(page.getByTestId("match-my-status")).toHaveText("Estás en la Cancha 1");
    await waitForAnimations(page);
    const t = (await toast.boundingBox())!;
    const bar = (await page.getByTestId("match-action-bar").boundingBox())!;
    expect(t.y + t.height, "el toast tapa la barra de acción").toBeLessThanOrEqual(bar.y + 0.5);

    await toast.getByRole("button", { name: "Deshacer" }).click();
    await expect(toastWith(page, "Listo: no quedaste anotado.")).toBeVisible();
    await expect(page.getByTestId("match-register-btn")).toBeVisible();
    await expect(page.getByTestId("match-hero-count")).toHaveText("0/4 · Quedan 4 lugares");

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => ["critical", "serious"].includes(String(v.impact)));
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });

  test("Libre · Anotarme acá, la cancha llena (409) y la espera", async ({ page }) => {
    const m = await createMatch("Elegir", [["Cancha 1", 1], ["Cancha 2", 1]]);
    await page.goto(`/p/${m.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId(`match-slot-${m.courts["Cancha 1"]}`)).toBeVisible();

    // Mientras la pantalla mira, alguien llena la Cancha 1.
    const admin = await api(adminToken);
    await call(admin, "POST", `/events/${m.id}/guests`, { guest_name: "Rápido", court_id: m.courts["Cancha 1"] });

    await page.getByTestId(`match-slot-${m.courts["Cancha 1"]}`).click();
    const dialog = page.getByTestId("court-full-dialog");
    await expect(dialog).toContainText("Justo se llenó la Cancha 1");
    await expect(dialog).toContainText("¿Te sumamos a la Cancha 2, que tiene 1 lugar?");
    await page.getByTestId("court-full-accept-btn").click();
    await expect(page.getByTestId("match-my-status")).toHaveText("Estás en la Cancha 2");

    // Ahora el partido está lleno: la próxima persona va a la espera con su puesto.
    await call(admin, "POST", `/events/${m.id}/register`, {});
    await page.reload();
    await expect(page.getByTestId("match-waitlist")).toContainText("1.Admin");
    await admin.dispose();
  });

  test("No puedo ir dice quién entra desde la espera", async ({ page }) => {
    const m = await createMatch("Baja", [["Cancha 1", 1]]);
    const player = await api(playerToken);
    await call(player, "POST", `/events/${m.id}/register`, {});
    const admin = await api(adminToken);
    const waiting = await call(admin, "POST", `/events/${m.id}/register`, {});
    expect(waiting.status).toBe("WAITLIST");

    await page.goto(`/p/${m.id}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("match-leave-btn").click();
    await expect(page).toHaveURL(/sheet=baja/);
    const dialog = page.getByTestId("leave-dialog");
    await expect(dialog).toContainText("¿Liberás tu lugar?");
    await expect(dialog).toContainText("Lo toma Admin, que está primero en la espera.");
    await expect(page.getByTestId("leave-cancel-btn")).toBeFocused();

    // El atrás cierra el diálogo sin salir de la pantalla.
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/p/${m.id}$`));

    await page.getByTestId("match-leave-btn").click();
    await page.getByTestId("leave-confirm-btn").click();
    await expect(toastWith(page, "Liberaste tu lugar. Lo toma Admin.")).toBeVisible();
    await expect(page.getByTestId("match-waitlist-btn")).toBeVisible();
    await player.dispose();
    await admin.dispose();
  });

  test("A menos de 24 h: Liberar y avisar al grupo abre WhatsApp", async ({ page }) => {
    const m = await createMatch("Tarde", [["Cancha 1", 2]], 2);
    const player = await api(playerToken);
    await call(player, "POST", `/events/${m.id}/register`, {});
    await player.dispose();
    // WhatsApp no se abre de verdad: se registra la URL. La primera vez el
    // navegador "frena" la ventana (como iOS después de un await).
    await page.addInitScript(() => {
      const w = window as unknown as { __opened: string[]; open: (u: string) => unknown };
      w.__opened = [];
      w.open = (u: string) => {
        w.__opened.push(u);
        return w.__opened.length === 1 ? null : {};
      };
    });

    await page.goto(`/p/${m.id}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("match-leave-btn").click();
    const dialog = page.getByTestId("leave-dialog");
    await expect(dialog).toContainText("Falta poco para el partido. Avisale al grupo así no quedan cortos.");
    await page.getByTestId("leave-confirm-btn").click();
    await expect(page.getByTestId("leave-confirm-btn")).toHaveText("Abrir WhatsApp");
    await page.getByTestId("leave-confirm-btn").click();
    await expect(dialog).toHaveCount(0);

    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.map(decodeURIComponent));
    expect(opened).toHaveLength(2);
    expect(opened[0]).toMatch(/^https:\/\/wa\.me\/\?text=Me bajo del \*.+\*\. Se liberó un lugar: http.+\/p\//);
    await expect(page.getByTestId("match-register-btn")).toBeVisible();
  });

  test("?sheet=invitar: el atrás con un nombre escrito pregunta antes de descartar", async ({ page }) => {
    const m = await createMatch("Invitar", [["Cancha 1", 4]]);
    const player = await api(playerToken);
    await call(player, "POST", `/events/${m.id}/register`, {});
    await player.dispose();

    await page.goto(`/p/${m.id}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("match-guest-btn").click();
    await expect(page).toHaveURL(/sheet=invitar/);
    const input = page.getByTestId("guest-name-input");
    await input.fill("Gabi");
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");

    await page.goBack();
    await expect(page.getByTestId("sheet-discard-btn")).toBeVisible();
    await expect(page).toHaveURL(/sheet=invitar/);
    await expect(input).toHaveValue("Gabi");

    await page.getByTestId("sheet-keep-editing-btn").click();
    await page.getByTestId("guest-submit-btn").click();
    await expect(toastWith(page, "Sumaste a Gabi en la Cancha 1.")).toBeVisible();
    await expect(page.getByTestId("guest-sheet")).toContainText("Gabi · Cancha 1");
    await expect(page.getByTestId("guest-sheet")).toContainText("Te quedan 4 de 5.");

    // Sin cambios, el atrás cierra.
    await page.goBack();
    await expect(page.getByTestId("guest-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/p/${m.id}$`));

    // Con cambios, "Descartar" cierra y saca el param.
    await page.getByTestId("match-guest-btn").click();
    await input.fill("Otro");
    await page.goBack();
    await page.getByTestId("sheet-discard-btn").click();
    await expect(page.getByTestId("guest-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/p/${m.id}$`));
  });

  test("Compartir: deep link, mensaje con los lugares y deslizar para cerrar", async ({ page }) => {
    const m = await createMatch("Compartir", [["Cancha 1", 3], ["Cancha 2", 2], ["Suplentes", 5]]);
    await page.goto(`/p/${m.id}?sheet=compartir`, { waitUntil: "domcontentloaded" });
    const sheet = page.getByTestId("share-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("share-message")).toContainText("Cancha 1: quedan 3 · Cancha 2: quedan 2");
    await expect(page.getByTestId("share-message")).not.toContainText("Suplentes");
    await expect(page.getByTestId("share-message")).toContainText(`/p/${m.id}`);
    await expect(page.getByTestId("share-whatsapp-btn")).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);

    // Deep link: cerrar reemplaza la entrada (no sale de la pantalla).
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/p/${m.id}$`));

    // Deslizar el header hacia abajo (solo en el celular).
    test.skip((page.viewportSize()?.width || 0) >= 640, "Deslizar es solo para hojas de abajo (<640 px).");
    await page.getByTestId("match-menu-btn").click();
    await page.getByTestId("menu-share").click();
    await expect(sheet).toBeVisible();
    await waitForAnimations(page);
    const header = (await sheet.locator(".ov-header").boundingBox())!;
    const x = header.x + header.width / 3;
    const y = header.y + header.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + i * 50);
    await page.mouse.up();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/p/${m.id}$`));
  });

  test("Menu: popover anclado en escritorio", async ({ page }) => {
    const m = await createMatch("Menu", [["Cancha 1", 2]]);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(`/p/${m.id}`, { waitUntil: "domcontentloaded" });
    const trigger = page.getByTestId("match-menu-btn");
    await trigger.click();
    const popover = page.locator('#overlay-root [data-overlay="popover"] .ov-popover');
    await expect(popover).toBeVisible();
    const box = (await popover.boundingBox())!;
    const btn = (await trigger.boundingBox())!;
    expect(box.y, "el menú va debajo del botón").toBeGreaterThanOrEqual(btn.y + btn.height - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(1024 - 7);
    await expect(page.getByRole("menuitem", { name: "Compartir" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("Sin sesión, el link del partido vuelve al partido después de entrar", async ({ browser }) => {
    const m = await createMatch("Link", [["Cancha 1", 2]]);
    const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
    const context = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
    const page = await context.newPage();
    await page.goto(`/p/${m.id}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\?next=%2Fp%2F/);
    await page.getByTestId("auth-login-mode-btn").click();
    await page.getByTestId("auth-phone-input").fill(PLAYER_PHONE);
    await page.getByTestId("auth-phone-next-btn").click();
    await page.getByTestId("auth-pin-input").fill(PLAYER_PIN);
    await page.getByTestId("auth-login-submit").click();
    await expect(page).toHaveURL(new RegExp(`/p/${m.id}$`), { timeout: 25_000 });
    await expect(page.getByTestId("match-register-btn")).toBeVisible();
    await context.close();
  });
});
