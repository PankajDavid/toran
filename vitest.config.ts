import { defineConfig } from "vitest/config";

// Unit and API tests live next to the code in src/. Browser tests in e2e/ run with Playwright.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
