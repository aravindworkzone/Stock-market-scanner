import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    // Obviously fake placeholder values so modules that import src/config/config.ts
    // can load in tests. Tests never reach the broker or the real database.
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "error",
      MCP_AUTH_TOKEN: "test-only-token-not-a-secret-000000000000",
      ANGELONE_API_KEY: "test-api-key-placeholder",
      ANGELONE_CLIENT_CODE: "TESTCLIENT",
      ANGELONE_PIN: "0000",
      ANGELONE_TOTP_SECRET: "TESTTOTPSECRETPLACEHOLDER",
      DATABASE_URL_UNPOOLED: "postgresql://test:test@127.0.0.1:9/test_database",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:9/test_database",
      NEON_BRANCH: "test-branch",
      NEON_BRANCH_ID: "test-branch-id",
      NEON_FUNCTION_HOST_SUFFIX: "test.invalid",
      SMARTAPI_LOG_DIR: "logs/test",
    },
  },
});
