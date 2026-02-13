import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    resolve: {
        preserveSymlinks: true,
        alias: {
            // Фон по умолчанию для всех чатов (из корня проекта)
            "@default-chat-bg": path.resolve(__dirname, "../beautiful-vertical-landscape.jpg"),
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
            "/api": { target: "http://localhost:8000", changeOrigin: true },
            "/ws": { target: "ws://localhost:8000", ws: true },
            "/media": { target: "http://localhost:8000", changeOrigin: true },
        },
    },
});
