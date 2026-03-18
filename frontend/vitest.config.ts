import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Keep junction/symlink paths as-is (avoids resolving to a Cyrillic real path
    // which breaks Vite's /@fs/ module resolution on Windows).
    preserveSymlinks: true,
    alias: {
      // Force libsodium to CJS entry — the ESM entry uses a relative import
      // that breaks on Windows paths with non-ASCII characters.
      "libsodium-wrappers-sumo": path.resolve(
        __dirname,
        "node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js"
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/__tests__/**/*.test.ts", "src/**/__tests__/**/*.test.tsx"],
    exclude: ["node_modules", "tests/e2e/**"],
    setupFiles: [],
  },
});
