import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };

// In development the Rust server runs on :8080; Vite proxies API + websocket calls to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The version this UI was built as; shown in the dashboard and customer page.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/ws": { target: "ws://127.0.0.1:8080", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
