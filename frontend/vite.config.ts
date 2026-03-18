import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appUrl = env.VITE_APP_URL || "https://pingychat.com";

  const isTauri = !!process.env.TAURI_ENV_PLATFORM;
  return {
  plugins: [
    react(),
    {
      name: "html-app-url",
      transformIndexHtml(html) {
        return html.replace(/%VITE_APP_URL%/g, appUrl);
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
    target: isTauri
      ? (process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13")
      : undefined,
    minify: isTauri && process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
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
    strictPort: isTauri,
    host: process.env.TAURI_DEV_HOST || true,
    allowedHosts: ["localhost", "127.0.0.1", "host.docker.internal", ".local", "web.pingychat.com"],
    fs: {
      strict: false,
      allow: [path.resolve(__dirname, "..")],
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/media": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/t": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
  };
});
