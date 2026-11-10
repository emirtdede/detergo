import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
    // Playwright specs live in e2e/ and must not be collected by Vitest.
    // Brand writer tests live next to the dependency-free scripts they cover.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/lib/**/*.test.mjs"],
  },
});
