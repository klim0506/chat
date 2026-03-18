#!/usr/bin/env node
/**
 * Собирает папку лендинга для деплоя на корень домена (pingychat.com).
 * Копирует public/landing/ и добавляет assets + иконку, на которые ссылается HTML.
 * Результат: dist/landing/ — положить в root Nginx для pingychat.com.
 */
import { cpSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "landing");

mkdirSync(out, { recursive: true });

cpSync(join(root, "public", "landing"), out, { recursive: true });
if (existsSync(join(root, "public", "assets"))) {
  mkdirSync(join(out, "assets"), { recursive: true });
  cpSync(join(root, "public", "assets"), join(out, "assets"), { recursive: true });
}
if (existsSync(join(root, "public", "icons"))) {
  mkdirSync(join(out, "icons"), { recursive: true });
  cpSync(join(root, "public", "icons"), join(out, "icons"), { recursive: true });
}

console.log("Landing built to dist/landing — deploy as Nginx root for pingychat.com");
