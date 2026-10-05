import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = pathToFileURL(join(fileURLToPath(new URL("..", import.meta.url)), "src") + "/");

function withExt(fileUrl) {
  const href = String(fileUrl);
  const path = fileURLToPath(href);
  if (extname(path) && existsSync(path)) return href;
  for (const ext of [".ts", ".tsx", ".js", ".mjs", ".json"]) {
    if (existsSync(path + ext)) return pathToFileURL(path + ext).href;
  }
  for (const idx of ["/index.ts", "/index.tsx", "/index.js"]) {
    if (existsSync(path + idx)) return pathToFileURL(path + idx).href;
  }
  return href;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return { shortCircuit: true, url: withExt(new URL(specifier.slice(2), SRC).href) };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier.split("?")[0]) && context.parentURL) {
    return { shortCircuit: true, url: withExt(new URL(specifier, context.parentURL).href) };
  }
  if (specifier.endsWith(".json") && context.parentURL && specifier.startsWith(".")) {
    return { shortCircuit: true, url: new URL(specifier, context.parentURL).href };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const source = await readFile(new URL(url), "utf8");
    return {
      format: "json",
      shortCircuit: true,
      source,
    };
  }
  return nextLoad(url, context);
}
