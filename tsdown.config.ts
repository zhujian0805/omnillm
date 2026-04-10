import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/main.ts"],

  format: ["esm"],
  target: "es2022",
  platform: "node",

  sourcemap: true,
  clean: true,
  removeNodeProtocol: false,
  external: ["bun:sqlite"],

  env: {
    NODE_ENV: "production",
  },

  rolldown: {
    external: ["@opentui/core", "@opentui/react", "bun:sqlite"],
    logLevel: "silent",
  },
  esbuild: {
    logLevel: "silent",
  },
})
