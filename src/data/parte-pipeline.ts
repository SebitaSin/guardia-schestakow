import { clasificarCama, servicioPorNumero } from "@/data/cama-map";
import type { BedEstado, InternacionBed } from "@/data/internacion";

export type IdentidadEstado = "CONFIRMADA" | "PROBABLE" | "NO_VERIFICADA" | "CONFLICTO" | "REVISAR";
export type DeltaTipo = "SIN_CAMBIO" | "INGRESO" | "EGRESO" | "CAMBIO_DATO";
export type CapturaEstado = "capturada" | "duplicada" | "interpretada" | "revisar";

export type CapturaWhatsApp = {
  mensaje_id: string;
  grupo: string;
  remitente: string;
  fecha: string;
  hora: string;
  imagen_original: string;
  hash: string;
  estado: CapturaEstado;
};

export type LecturaCama = {
  cama: string;
  sala: string | null;
  estado: BedEstado;
  paciente_original: string | null;
  edad: string | null;
  diagnostico_original: string | null;
  arm: boolean;
  aislamiento: boolean;
  confianza: "Alta" | "Media" | "Baja";
};

export type Interpretacion = {
  captura_hash: string;
  slug: string | null;
  servicio: string | null;
  encabezado: string | null;
  motivo: string;
  filas: LecturaCama[];
  estado: "OK" | "REVISAR";
};

export type DeltaCama = {
  cama: string;
  tipo: DeltaTipo;
  anterior: string;
  nuevo: string;
};

export type AuditoriaCambio = {
  bed_id: string;
  valor_anterior: string;
  valor_nuevo: string;
  fuente: string;
  imagen_hash: string;
  fecha: string;
  hora: string;
  confianza: string;
  motivo_del_cambio: string;
};

function fold(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function numerosDeCama(filas: { cama: string }[]) {
  const out: number[] = [];
  for (const f of filas) {
    const m = f.cama.match(/(\d{3})/);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

/** Numeración física manda sobre el título del pizarrón. */
export function identificarServicio(filas: LecturaCama[], encabezado?: string | null) {
  const nums = numerosDeCama(filas);
  const votes = new Map<string, { n: number; name: string }>();
  for (const n of nums) {
    const svc = servicioPorNumero(n);
    if (!svc) continue;
    const cur = votes.get(svc.slug) ?? { n: 0, name: svc.name };
    cur.n += 1;
    votes.set(svc.slug, cur);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1].n - a[1].n);
  if (ranked.length === 1 || (ranked[0] && ranked[0][1].n >= 4 && (!ranked[1] || ranked[0][1].n >= ranked[1][1].n * 2))) {
    const [slug, v] = ranked[0];
    const titulo = fold(encabezado ?? "");
    const contradice =
      /clinica\s*i\b|clinica 1/.test(titulo) && slug === "clinica-2"
        ? "El encabezado dice Clínica I; las camas 515–528 son Clínica 2. Manda la numeración."
        : "Servicio por numeración de camas.";
    return { slug, servicio: v.name, motivo: contradice };
  }
  if (!ranked.length) {
    const one = filas.map((f) => clasificarCama(f.cama)).find(Boolean);
    if (one) return { slug: one.slug, servicio: one.name, motivo: "Una cama con número de edificio." };
    return { slug: null, servicio: null, motivo: "No se determina el servicio. ESTADO = REVISAR. No se modifica Internados." };
  }
  return { slug: null, servicio: null, motivo: "Camas de más de un servicio en la misma foto. ESTADO = REVISAR." };
}

export function compararDelta(prev: InternacionBed[], next: LecturaCama[]): DeltaCama[] {
  const byCama = new Map(prev.map((b) => [b.cama, b]));
  const out: DeltaCama[] = [];
  for (const fila of next) {
    const old = byCama.get(fila.cama);
    const nuevoNom = fila.paciente_original ?? "";
    const nuevoEst = fila.estado;
    if (!old) {
      out.push({
        cama: fila.cama,
        tipo: nuevoEst === "LIBRE" ? "SIN_CAMBIO" : "INGRESO",
        anterior: "—",
        nuevo: `${nuevoEst} ${nuevoNom}`.trim(),
      });
      continue;
    }
    const oldNom = old.paciente_original ?? old.paciente ?? "";
    const samePerson = fold(oldNom) === fold(nuevoNom);
    const sameEstado = old.estado === nuevoEst;
    if (old.estado !== "LIBRE" && nuevoEst === "LIBRE") {
      out.push({ cama: fila.cama, tipo: "EGRESO", anterior: `${old.estado} ${oldNom}`.trim(), nuevo: "LIBRE" });
    } else if ((old.estado === "LIBRE" || !oldNom) && nuevoEst === "OCUPADA" && nuevoNom) {
      out.push({ cama: fila.cama, tipo: "INGRESO", anterior: old.estado, nuevo: nuevoNom });
    } else if (samePerson && sameEstado) {
      out.push({ cama: fila.cama, tipo: "SIN_CAMBIO", anterior: oldNom || old.estado, nuevo: nuevoNom || nuevoEst });
    } else {
      out.push({
        cama: fila.cama,
        tipo: "CAMBIO_DATO",
        anterior: `${old.estado} ${oldNom}`.trim(),
        nuevo: `${nuevoEst} ${nuevoNom}`.trim(),
      });
    }
  }
  return out;
}

function parseIngreso(text: string | null, hoy: string): string | null {
  if (!text) return null;
  const m = text.match(/\b(?:FI|F\.I\.|ingreso|ing)\b[:\s]*(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/i);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : Number(hoy.slice(0, 4));
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function samePerson(a: string | null | undefined, b: string | null | undefined) {
  const x = fold(a || "");
  const y = fold(b || "");
  if (!x || !y || x === "revisar") return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function aplicarDelta(
  prev: InternacionBed[],
  next: LecturaCama[],
  meta: { slug: string; servicio: string; imagen_hash: string; fecha?: string },
): InternacionBed[] {
  const hoy = meta.fecha || new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Mendoza" });
  const byCama = new Map(prev.map((b) => [b.cama, b]));
  for (const fila of next) {
    const old = byCama.get(fila.cama);
    const mismo = samePerson(old?.paciente_original || old?.paciente, fila.paciente_original);
    const fi = parseIngreso([fila.diagnostico_original, fila.paciente_original].filter(Boolean).join(" "), hoy);
    const ingreso = fi || (mismo ? old?.ingreso ?? null : null);
    const primera = mismo && old?.primera_vista ? old.primera_vista : hoy;
    const partes = mismo ? (old?.partes_visto ?? 1) + (old?.primera_vista === hoy ? 0 : 1) : fila.estado === "OCUPADA" ? 1 : 0;
    byCama.set(fila.cama, {
      servicio: meta.servicio,
      slug: meta.slug,
      sala: fila.sala,
      cama: fila.cama,
      estado: fila.estado,
      paciente: fila.paciente_original,
      paciente_original: fila.paciente_original,
      paciente_oficial: mismo ? old?.paciente_oficial ?? null : null,
      lab_dni: mismo ? old?.lab_dni ?? null : null,
      edad: fila.edad,
      diagnostico: fila.diagnostico_original,
      observaciones: old?.observaciones ?? null,
      arm: fila.arm,
      aislamiento: fila.aislamiento,
      confianza: fila.confianza,
      revisar: fila.confianza !== "Alta" || (!fila.paciente_original && fila.estado === "OCUPADA"),
      piso: old?.piso ?? null,
      identidad: mismo && old?.paciente_oficial ? old.identidad : fila.estado === "OCUPADA" ? "A_CONFIRMAR" : old?.identidad,
      person_id: mismo ? old?.person_id ?? null : null,
      encounter_id: mismo ? old?.encounter_id ?? null : null,
      bed_id: old?.bed_id ?? `${meta.slug}:${fila.cama}`,
      imagen_id: meta.imagen_hash,
      ingreso,
      primera_vista: primera,
      partes_visto: partes,
    });
  }
  return [...byCama.values()];
}

export async function hashBytes(data: ArrayBuffer | string) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 0;
  for (const b of buf) h = (Math.imul(h, 31) + b) | 0;
  return `h${(h >>> 0).toString(16)}`;
}
