import { defineConfig } from "vite";
import { midenVitePlugin } from "@miden-sdk/vite-plugin";

export default defineConfig({
  plugins: [midenVitePlugin({ crossOriginIsolation: true })],
  server: {
    proxy: {
      // the zero-dep bridge (sessions, zkTLS pipeline, settlement, SSE)
      "/api": "http://localhost:8787",
    },
  },
});
