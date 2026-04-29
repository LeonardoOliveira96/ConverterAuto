import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/ConverterAuto/" : "/",
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  // mode kept for future use
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          // React core + roteamento (mantido junto para evitar dependência circular com @remix-run/router)
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router") ||
            id.includes("/scheduler/") ||
            id.includes("/@remix-run/")
          ) {
            return "vendor-react";
          }
          // Biblioteca de planilhas — pesada e independente
          if (id.includes("/xlsx/")) {
            return "vendor-xlsx";
          }
          // Animações
          if (id.includes("/framer-motion/")) {
            return "vendor-motion";
          }
          // Gráficos
          if (id.includes("/recharts/") || id.includes("/d3-") || id.includes("/victory-vendor/")) {
            return "vendor-charts";
          }
          // Ícones
          if (id.includes("/lucide-react/")) {
            return "vendor-icons";
          }
          // Fuzzy search
          if (id.includes("/fuse.js/") || id.includes("/fuse/")) {
            return "vendor-fuse";
          }
          // Demais node_modules: deixa o Rollup decidir (evita circular init)
          return undefined;
        },
      },
    },
  },
}));
