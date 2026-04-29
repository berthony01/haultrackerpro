import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // PWA service worker is intentionally DISABLED in self-destroying mode.
    // Reason: a previous Workbox precache SW (`/sw.js`) cached the entire
    // build (`index.html` + hashed `/assets/*`) on every visitor's browser.
    // After publishing a new version, returning users continued to see the
    // OLD build because the SW served the stale cached `index.html`.
    // `selfDestroying: true` makes vite-plugin-pwa emit a tiny SW under the
    // same `/sw.js` URL that unregisters itself and clears caches the next
    // time a previously-installed SW checks for an update — freeing every
    // existing user from the stale cache. Once we want PWA back, swap
    // `selfDestroying` for the previous `workbox`/`manifest` config.
    mode === "production" && VitePWA({
      selfDestroying: true,
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      injectRegister: false,
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
