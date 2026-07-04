import { defineConfig } from "vite";
import { midenVitePlugin } from "@miden-sdk/vite-plugin";

export default defineConfig({
  plugins: [midenVitePlugin({ crossOriginIsolation: true })],
  // Force ONE @miden-sdk WASM instance across the app + the linked Guardian
  // packages (two instances = mismatched Felt classes → "wrong type").
  resolve: {
    dedupe: ["@miden-sdk/miden-sdk"],
    // Absolute alias so the app AND the linked Guardian packages resolve the
    // SDK to ONE module file = one WASM instance (file: links escape dedupe).
    alias: { "@miden-sdk/miden-sdk": "/Users/gaylordwarner/Code/bartok/ux-prototype/node_modules/@miden-sdk/miden-sdk" },
  },
  server: {
    proxy: {
      // the zero-dep bridge (sessions, zkTLS pipeline, settlement, SSE)
      "/api": "http://localhost:8787",
      "/guardian": { target: "http://localhost:3300", rewrite: (p) => p.replace(/^\/guardian/, "") },
    },
  },
});
