import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function globalSetup() {
  const result = spawnSync("node", [path.join(__dirname, "create-e2e-fixtures.mjs")], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Failed to create e2e fixtures");
  }
}
