import { defineConfig } from "vitest/config";

// Unit and API tests live next to the code in src/. Browser tests in e2e/ run with Playwright.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // server.ts only wires the app to a port; fake.ts is a test helper.
      exclude: ["src/**/*.test.ts", "src/server.ts", "src/ai/fake.ts"],
      reporter: ["text-summary", "text", "html"],
      // CI fails if coverage drops below these.
      thresholds: { statements: 95, branches: 85, functions: 95, lines: 95 },
    },
  },
});
