import "@testing-library/jest-dom";

// Only shim `matchMedia` when running in a DOM-like environment. Node-env
// tests (e.g. the Phase 1C-2 PGlite runtime harness) opt out via
// `// @vitest-environment node` and have no `window` global.
if (typeof globalThis !== "undefined" && typeof (globalThis as { window?: unknown }).window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
