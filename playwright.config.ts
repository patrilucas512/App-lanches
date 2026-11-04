import { defineConfig, devices } from "@playwright/test";

// Core E2E (Phase 97C). Runs against homologação (Vercel Preview + masterapp-dev) or a local server.
// Never against production: the shared setup in tests/e2e-core/env.ts refuses the production address.
// Local runs use the fictitious owner the dev seed writes to .env.test-login.local; CI passes E2E_OWNER_* secrets.
try { process.loadEnvFile(".env.test-login.local"); } catch { /* file only exists after pnpm seed:dev */ }
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "tests/e2e-core",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/e2e-core/artifacts",
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // Traces record typed values (the owner password); keep them local only.
    trace: process.env.CI ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    // Previews ask for a Vercel login; the bypass header (and the cookie it sets) lets the tests through.
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});
