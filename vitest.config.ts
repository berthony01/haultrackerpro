import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Run test files serially: concurrent files would otherwise boot multiple
    // in-process PGlite/Postgres-WASM instances at once during the unrestricted
    // suite, causing startup contention and intermittent beforeAll timeouts.
    fileParallelism: false,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
