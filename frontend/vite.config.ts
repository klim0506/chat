import path from "path";
import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const mediaRoot = path.resolve(__dirname, "../backend/media");

export default defineConfig({
  plugins: [
    react(),
    {
      name: "serve-media",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/media/")) return next();
          // Strip query params (?w=96&preview=1) before resolving on disk
          const urlPath = req.url.split("?")[0];
          const filePath = path.join(mediaRoot, urlPath.slice("/media/".length));
          if (!filePath.startsWith(mediaRoot) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          const mimes: Record<string, string> = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
          };
          res.setHeader("Content-Type", mimes[ext] || "application/octet-stream");
          res.setHeader("Cache-Control", "private, max-age=3600");
          fs.createReadStream(filePath).pipe(res);
        });
      },
    },
  ],
  resolve: {
    preserveSymlinks: true,
    alias: {
      // Фон по умолчанию для всех чатов (из корня проекта)
      "@default-chat-bg": path.resolve(__dirname, "../beautiful-vertical-landscape.jpg"),
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
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: false,
      // Доступ к файлу фона по умолчанию в корне проекта (../beautiful-vertical-landscape.jpg)
      allow: [path.resolve(__dirname, "..")],
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
});
