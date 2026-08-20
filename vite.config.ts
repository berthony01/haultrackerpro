import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import { htpBuildShaPlugin } from "./vite/htpBuildShaPlugin";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";


// CRITICAL: Production-build resilience for Supabase env injection.
//
// Symptom we hit on launch: GitHub-triggered prod builds occasionally shipped
// with empty `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`, which made
// `createClient("", "")` throw `supabaseUrl is required.` at app boot. The
// ErrorBoundary then rendered "Something went wrong" on every page — so every
// publish "looked the same" in browsers and Google indexed only the static
// SEO fallback.
//
// These two values are PUBLIC (the publishable/anon key + the project URL are
// already shipped in every Supabase web app), so it is safe to bake them in
// as a fallback. They are only used when the real env vars are missing.
// `src/integrations/supabase/client.ts` is auto-managed and cannot be edited,
// so we patch the values at the Vite level via `define`, which substitutes
// `import.meta.env.VITE_SUPABASE_*` references at build time.
const FALLBACK_SUPABASE_URL = "https://pngptztxwbtozwxrtbwo.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuZ3B0enR4d2J0b3p3eHJ0YndvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NzYwOTAsImV4cCI6MjA4NzU1MjA5MH0.Y4X4nJdsAVEOuhyWPF9hSYv0RXyH_3D-SjXWxpJdn0s";
const FALLBACK_SUPABASE_PROJECT_ID = "pngptztxwbtozwxrtbwo";

const resolvedSupabaseUrl =
  process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_URL.length > 0
    ? process.env.VITE_SUPABASE_URL
    : FALLBACK_SUPABASE_URL;
const resolvedSupabaseKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY &&
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY.length > 0
    ? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    : FALLBACK_SUPABASE_PUBLISHABLE_KEY;
const resolvedSupabaseProjectId =
  process.env.VITE_SUPABASE_PROJECT_ID &&
  process.env.VITE_SUPABASE_PROJECT_ID.length > 0
    ? process.env.VITE_SUPABASE_PROJECT_ID
    : FALLBACK_SUPABASE_PROJECT_ID;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    // Replace empty/missing env references with the verified fallbacks so the
    // production bundle always boots, even when the build runner forgot to
    // inject the env vars. Stringified per Vite's `define` contract.
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(resolvedSupabaseUrl),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(resolvedSupabaseKey),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(resolvedSupabaseProjectId),
  },
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
    htpBuildShaPlugin(),
    mcpPlugin(),
  ].filter(Boolean),

  build: {
    rollupOptions: {
      output: {
        // Conservative vendor split — keeps heavy third-party code out of the
        // main app/Index chunk so first dashboard paint stays fast.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (/[\\/]node_modules[\\/](@supabase|@tanstack)[\\/]/.test(id)) return 'vendor-data';
          if (/[\\/]node_modules[\\/](@radix-ui|lucide-react|sonner|vaul|cmdk)[\\/]/.test(id)) return 'vendor-ui';
          // NOTE: do NOT split recharts / d3-* / victory-vendor into a separate
          // chunk. Doing so created a Rollup TDZ cycle (`Cannot access 'P' before
          // initialization` in vendor-charts) that crashed app boot on every
          // route. Let Rollup handle Recharts' transitive graph naturally.
          if (/[\\/]node_modules[\\/](jspdf|jspdf-autotable|html2canvas|dompurify)[\\/]/.test(id)) return 'vendor-pdf';
          if (/[\\/]node_modules[\\/]tesseract\.js/.test(id)) return 'vendor-ocr';
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
