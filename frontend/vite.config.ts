import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
    alias: {
      // Default chat background (frontend/public/assets/)
      "@default-chat-bg": path.resolve(__dirname, "public/assets/default-chat-bg.jpg"),
      // Force CJS version — ESM entry has broken relative import to ./libsodium-sumo.mjs
      "libsodium-wrappers-sumo": path.resolve(
        __dirname,
        "node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js"
      ),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-zustand": ["zustand"],
          "vendor-crypto": ["libsodium-wrappers-sumo"],
          "vendor-markdown": ["react-markdown", "remark-gfm"],
          "vendor-lottie": ["lottie-web"],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ["localhost", "127.0.0.1", "host.docker.internal", ".local"],
    fs: {
      strict: false,
      allow: [path.resolve(__dirname, "..")],
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/media": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
});
