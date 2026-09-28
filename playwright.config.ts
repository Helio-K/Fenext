import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4311",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/ui-test-server.mjs",
    url: "http://127.0.0.1:4311/api/health",
    reuseExistingServer: false,
    timeout: 20000,
  },
  reporter: "list",
});
