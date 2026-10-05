import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./store.mjs";

function fold(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-ZÑ ]/g, " ").replace(/\s+/g, " ").trim();
}
function parts(text) { return String(text).split(/\s*[·|/]\s*/).map((part) => part.trim()).filter(Boolean); }
function nameHit(token, who) {
  const left = fold(token); const right = fold(who);
  return Boolean(left && right && left !== "SIN" && (left === right || left.startsWith(right) || right.startsWith(left)));
}
function taken(text, who) { return parts(text).find((part) => nameHit(part, who)) ?? null; }
function replaceName(text, who, next) {
  const all = parts(text); const index = all.findIndex((part) => nameHit(part, who));
  if (index < 0) return null;
  all[index] = next;
  return all.join(" · ");
}

function paths(dataDir) {
  return { overrides: join(dataDir, "catalog", "overrides.json"), changes: join(dataDir, "catalog", "changes.json") };
}

export function catalogState(dataDir) {
  const file = paths(dataDir);
  return { overrides: readJson(file.overrides, { docs: {} }), changes: readJson(file.changes, []).slice(0, 200) };
}

export function applyCatalogSwap({ dataDir, catalogFile, actor, role, input }) {
  if (!catalogFile) throw new Error("catalog_not_configured");
  const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
  const state = catalogState(dataDir);
  const docId = String(input.docId ?? "");
  const dateA = String(input.dateA ?? ""); const dateB = String(input.dateB ?? "");
  const a = String(input.a ?? "").trim().slice(0, 120); const b = String(input.b ?? "").trim().slice(0, 120);
  if (!/^[a-f0-9]{8,64}$/i.test(docId) || !/^\d{4}-\d{2}-\d{2}$/.test(dateA) || !/^\d{4}-\d{2}-\d{2}$/.test(dateB) || dateA === dateB || !a || !b) throw new Error("invalid_catalog_change");
  const base = catalog.documents?.find((item) => item.id === docId);
  if (!base) throw new Error("catalog_document_not_found");
  const shifts = structuredClone(state.overrides.docs?.[docId]?.shifts ?? base.shifts ?? []);
  const beforeA = shifts.find((shift) => shift.date === dateA)?.text ?? "";
  const beforeB = shifts.find((shift) => shift.date === dateB)?.text ?? "";
  if (beforeA !== String(input.beforeA ?? "") || beforeB !== String(input.beforeB ?? "")) throw new Error("catalog_conflict");
  const nameA = taken(beforeA, a); const nameB = taken(beforeB, b);
  if (!nameA || !nameB) throw new Error("catalog_names_not_found");
  const afterA = replaceName(beforeA, a, nameB); const afterB = replaceName(beforeB, b, nameA);
  if (!afterA || !afterB || afterA !== String(input.afterA ?? "") || afterB !== String(input.afterB ?? "")) throw new Error("catalog_invalid_swap");
  const nextShifts = shifts.map((shift) => shift.date === dateA ? { ...shift, text: afterA } : shift.date === dateB ? { ...shift, text: afterB } : shift);
  const override = { ...(state.overrides.docs?.[docId] ?? {}), shifts: nextShifts };
  const overrides = { ...state.overrides, docs: { ...(state.overrides.docs ?? {}), [docId]: override } };
  const change = {
    id: `${docId}-${dateA}-${dateB}-${Date.now()}`, at: new Date().toISOString(), fuente: "interfaz_autenticada",
    docId, servicio: base.departments?.[0] ?? "", a: nameA, b: nameB, dateA, dateB,
    beforeA, beforeB, afterA, afterB, actor, role,
  };
  writeJsonAtomic(paths(dataDir).overrides, overrides);
  writeJsonAtomic(paths(dataDir).changes, [change, ...state.changes].slice(0, 200));
  return { change, override };
}
