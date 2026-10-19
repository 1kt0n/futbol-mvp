import { defineConfig, devices } from "@playwright/test";

const baseURL = (process.env.E2E_WEB_URL || "http://127.0.0.1:5173").trim();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
  },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "desktop-chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
      },
    },
    {
      // iOS Safari (WebKit). Solo los specs de overlays, a11y y la pantalla del partido: los flujos con
      // capturas (events/tournaments) arman su manifest con los dos de Chromium.
      name: "iphone-14",
      testMatch: /(overlays|accessibility-smoke|match)\.spec\.ts$/,
      use: {
        ...devices["iPhone 14"],
      },
    },
  ],
});
