import { defineConfig } from "vite";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
};

export default defineConfig({
  root: "web",
  base: "/",
  appType: "mpa",
  build: {
    outDir: "../dist",
    emptyOutDir: true
  },
  server: {
    port: 3000,
    headers: isolationHeaders
  },
  preview: {
    port: 3000,
    headers: isolationHeaders
  }
});
