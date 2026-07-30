#!/usr/bin/env node
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.ts");
const hosting = path.join(root, ".openai", "hosting.json");
const migrations = path.join(root, "drizzle");

for (const file of [index, worker, hosting]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

rmSync(path.join(dist, "server"), { recursive: true, force: true });
rmSync(path.join(dist, ".openai", "drizzle"), {
  recursive: true,
  force: true,
});
mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
await build({
  entryPoints: [worker],
  outfile: path.join(dist, "server", "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
});
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));
if (existsSync(migrations)) {
  cpSync(migrations, path.join(dist, ".openai", "drizzle"), {
    recursive: true,
  });
}

console.log("Prepared Sites build: dist/server/index.js and dist/.openai/hosting.json");
