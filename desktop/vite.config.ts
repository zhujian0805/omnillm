import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { resolve } from "node:path"
import { defineConfig } from "vite"

// Desktop Vite config: reuses the shared frontend at ../frontend/src by
// alias. The browser build (../frontend/vite.config.ts) is unaffected.
//
// Important: outDir is the desktop-only `dist/` directory inside this
// package. The browser build still emits to ../pages/admin/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: import.meta.dirname,
  // Tauri loads file:// URLs at the root by default; using base: "./" keeps
  // asset paths relative so the WebView can resolve them in production.
  base: "./",
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "../frontend/src"),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  // The Tauri preload injects window.__OMNILLM_DESKTOP__, so we don't bake
  // a server port at compile time here. Provide an empty default for
  // __SERVER_PORT__/__API_KEY__ so the shared frontend's `declare const`
  // references typecheck and exist as defined globals at runtime.
  define: {
    __SERVER_PORT__: JSON.stringify(0),
    __API_KEY__: JSON.stringify(""),
  },
  envPrefix: ["VITE_", "TAURI_"],
})
