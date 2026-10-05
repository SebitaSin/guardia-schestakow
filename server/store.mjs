import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(fallback);
    throw error;
  }
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function appendAudit(dataDir, event) {
  const path = join(dataDir, "audit.json");
  const rows = readJson(path, []);
  rows.unshift({ ...event, at: new Date().toISOString() });
  writeJsonAtomic(path, rows.slice(0, 2_000));
}
