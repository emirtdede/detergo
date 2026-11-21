import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "zustand",
      "zustand/react/shallow",
      "clsx",
      "lucide-react",
      "@tanstack/react-virtual",
    ],
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1425,
    strictPort: true,
    watch: {
      // Dev only needs to track the frontend sources. Native build output and
      // release artefacts must be ignored: a release build keeps
      // `release_output\Detergo-*.exe` locked, and the watcher used to die
      // with "EBUSY: resource busy or locked, watch" the moment those appeared,
      // which took the whole `tauri dev` session down with it.
      ignored: ["**/src-tauri/**", "**/release_output/**", "**/dist/**", "**/.git/**"],
    },
  },
  build: {
    target: "es2022",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Locale dictionaries must stay as individual dynamic imports.
          // Grouping them here forced Vite to emit one `locales-bundle` chunk
          // that every language switch had to download in full.
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("zustand") || id.includes("clsx")) {
              return "vendor-core";
            }
            if (id.includes("@tanstack") || id.includes("lucide-react")) {
              return "vendor-ui";
            }
            return "vendor";
          }
        },
      },
    },
  },
});
