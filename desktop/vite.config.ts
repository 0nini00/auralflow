import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  clearScreen: false,

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react-router") || id.includes("react-dom") || /[\\/]react[\\/]/.test(id)) {
              return "react-vendor";
            }
            if (id.includes("@tauri-apps")) {
              return "tauri-vendor";
            }
            if (id.includes("crypto-js") || id.includes("node-forge")) {
              return "crypto-vendor";
            }
            if (id.includes("lucide-react") || id.includes("zustand")) {
              return "ui-vendor";
            }
          }
          return undefined;
        },
      },
    },
  },

  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
