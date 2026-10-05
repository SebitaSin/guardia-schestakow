import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./store.mjs";

function pathFor(dataDir) { return join(dataDir, "identity", "marks.json"); }
export function identityMarks(dataDir) { return readJson(pathFor(dataDir), []); }

export function confirmIdentity({ dataDir, internacionFile, actor, role, input }) {
  if (!internacionFile) throw new Error("internacion_not_configured");
  const slug = String(input.slug ?? "").slice(0, 100);
  const cama = String(input.cama ?? "").slice(0, 80);
  const patient = String(input.patient ?? "").trim().slice(0, 180);
  const dni = input.dni ? String(input.dni).replace(/\D/g, "").slice(0, 12) : null;
  if (!/^[a-z0-9-]{2,100}$/i.test(slug) || !cama || !patient) throw new Error("invalid_identity_confirmation");
  const source = JSON.parse(readFileSync(internacionFile, "utf8"));
  const bed = source.beds?.find((item) => item.slug === slug && String(item.cama) === cama);
  if (!bed || bed.estado !== "OCUPADA") throw new Error("bed_not_found_or_not_occupied");
  const mark = { slug, cama, identidad: "CONFIRMADA", paciente_oficial: patient, lab_dni: dni, confirmedBy: actor, confirmedRole: role, confirmedAt: new Date().toISOString(), source: "HUMAN_CONFIRMED" };
  const marks = identityMarks(dataDir).filter((item) => !(item.slug === slug && item.cama === cama));
  marks.unshift(mark);
  writeJsonAtomic(pathFor(dataDir), marks.slice(0, 800));
  return { mark, marks };
}
