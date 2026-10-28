import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT) || 8123;
// Locally you can point at an installed Chrome; CI installs Playwright's Chromium.
const executablePath = process.env.CHROME_PATH || undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, launchOptions: { executablePath } },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
    { name: "desktop", use: { viewport: { width: 1366, height: 900 } } },
  ],
  webServer: {
    command: "npx tsx e2e/server.ts",
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(port) },
  },
});
