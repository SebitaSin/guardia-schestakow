// Planillas en blanco de cada servicio (OBJETIVO.md, punto 3): reconocer el servicio y saber qué esperar.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cache = null;
export function boardTemplates() {
  if (!cache) {
    try { cache = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "board-templates.json"), "utf8")).planillas ?? []; }
    catch { cache = []; }
  }
  return cache;
}

function fold(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Planilla cuyo título o alias aparece en el texto. `fromTitle`: el texto es el título leído en la foto. */
export function matchTemplate(text, { fromTitle = false } = {}) {
  const wanted = ` ${fold(text)} `;
  if (wanted.trim().length < 3) return null;
  const candidates = boardTemplates()
    .filter((item) => fromTitle || !item.solo_titulo)
    .flatMap((item) => (item.alias ?? []).map((alias) => ({ item, alias: fold(alias) })))
    .sort((a, b) => b.alias.length - a.alias.length);
  return candidates.find(({ alias }) => wanted.includes(` ${alias} `))?.item ?? null;
}

export const bedKey = (value) => fold(value).replace(/\b0+(\d)/g, "$1");

/** Texto corto para orientar la lectura: títulos, columnas y etiquetas de cama. Nunca datos de pacientes. */
export function templateGuide() {
  return boardTemplates().filter((item) => item.columnas?.length).map((item) => {
    const beds = item.camas?.length && !item.camas_sin_confirmar ? ` Camas: ${item.camas.join(", ")}.` : "";
    return `- "${item.titulo}". Columnas: ${item.columnas.join(" | ")}.${beds}`;
  }).join("\n");
}
