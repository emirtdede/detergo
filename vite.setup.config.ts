import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist-setup",
    emptyOutDir: true,
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(__dirname, "setup.html"),
    },
  },
});
