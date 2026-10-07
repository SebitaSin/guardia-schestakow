// Consulta en vivo al sistema del laboratorio (Nextlab) para comprobar la identidad de un paciente leído en una pizarra.
// Procedimiento indicado por Sebastián: fecha desde 4 años atrás, todos los servicios, y recién ahí buscar.
// Sólo consulta: no modifica nada en el laboratorio. La credencial vive únicamente en esta PC.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fold = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

export function labConfig({ root, env = process.env }) {
  let url = String(env.LAB_BASE_URL ?? ""); let login = String(env.LAB_LOGIN ?? ""); let password = String(env.LAB_PASSWORD ?? "");
  if (!url || !login || !password) {
    try {
      for (const line of readFileSync(join(root, "server", "lab-credential.local.txt"), "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
        const at = line.indexOf("="); if (at < 0) continue;
        const key = fold(line.slice(0, at)).replace(/[^A-Z]/g, ""); const value = line.slice(at + 1).trim();
        if (key === "URL") url = value; else if (key.startsWith("USUARIO") || key === "LOGIN") login = value; else if (key.startsWith("CONTRASE") || key === "PASSWORD" || key === "CLAVE") password = value;
      }
    } catch { /* sin archivo: laboratorio en vivo apagado */ }
  }
  try { url = new URL(url).origin; } catch { url = ""; }
  return { url, login, password, ready: Boolean(url && login && password) };
}

// El sistema del laboratorio trabaja en latin-1.
function encode(data) {
  return Object.entries(data).map(([key, value]) => `${key}=${[...Buffer.from(String(value), "latin1")].map((byte) => (/[A-Za-z0-9_.~-]/.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : byte === 32 ? "+" : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)).join("")}`).join("&");
}
function parseRows(html) {
  const rows = [];
  for (const block of html.matchAll(/class="trresult">([\s\S]*?)<\/tr>/gi)) {
    const cells = [...block[1].matchAll(/<td[^>]*>\s*([\s\S]*?)\s*<\/td>/gi)].map((cell) => cell[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
    if (cells.length < 6) continue;
    const orden = cells[0].replace(/\D/g, "");
    // Enlace a "Resultados" de esa orden (ahí figuran sala y cama): el primer atributo de la fila que nombra la orden.
    const detalle = orden ? [...block[1].matchAll(/(?:href|onclick)\s*=\s*(["'])([\s\S]*?)\1/gi)].map((m) => m[2].replace(/&amp;/g, "&")).find((value) => value.includes(orden)) ?? null : null;
    rows.push({ orden: cells[0], fecha: cells[1], dni: cells[2].replace(/\D/g, "") || null, nombre: cells[3].replace(" ,", ",").trim(), origen: cells[4], servicio: cells[5], detalle });
  }
  return rows;
}

const LABELS = ["Paciente", "Edad", "Fecha de Nac", "Sexo", "Fecha", "Médico", "Medico", "Origen", "Servicio", "Sala", "Piso", "Cama"];
/**
 * Pantalla "Resultados" de una orden: de la cabecera se toman sala y cama (más servicio y paciente para controlar).
 * Cada dato es el texto que sigue a su rótulo hasta el rótulo siguiente; un rótulo sin dato (Piso) queda vacío.
 */
export function parseOrderDetail(html) {
  const text = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const start = text.search(/\bOrden\s+\d{3,}/);
  const head = start >= 0 ? text.slice(start, start + 700) : text.slice(0, 1500);
  const next = LABELS.map((label) => label.replace(/ /g, "\\s+")).join("|");
  const field = (label) => new RegExp(`(?:^|\\s)${label}\\s*:?\\s+(.*?)\\s*(?=(?:${next})(?:\\s|:|$)|$)`, "i").exec(head)?.[1]?.trim() ?? "";
  const short = (value) => (/^[\w.\-/]{1,10}$/.test(value) ? value : "");
  return { paciente: field("Paciente"), servicio: field("Servicio"), sala: short(field("Sala")), cama: short(field("Cama").split(" ")[0] ?? "") };
}

export function createLabLookup({ root, env = process.env, fetchImpl = fetch, now = () => new Date() }) {
  const config = labConfig({ root, env });
  const state = { ready: config.ready, lastOkAt: null, lastError: null, queries: 0 };
  const cache = new Map();
  let cookies = "";

  async function post(path, data) {
    const response = await fetchImpl(`${config.url}${path}`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(25_000), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (compatible; GuardiaSchestakow/1.0)", ...(cookies ? { cookie: cookies } : {}) }, body: encode(data) });
    const fresh = response.headers.getSetCookie?.() ?? [];
    if (fresh.length) { const jar = new Map(cookies.split("; ").filter(Boolean).map((pair) => pair.split(/=(.*)/s).slice(0, 2))); for (const item of fresh) { const [name, value] = item.split(";")[0].split(/=(.*)/s); jar.set(name, value); } cookies = [...jar].map(([name, value]) => `${name}=${value}`).join("; "); }
    return new TextDecoder("latin1").decode(await response.arrayBuffer());
  }
  async function get(path) {
    const response = await fetchImpl(`${config.url}${path}`, { redirect: "manual", signal: AbortSignal.timeout(25_000), headers: { "user-agent": "Mozilla/5.0 (compatible; GuardiaSchestakow/1.0)", ...(cookies ? { cookie: cookies } : {}) } });
    if (response.status >= 300) throw new Error(`lab_detalle_${response.status}`);
    return new TextDecoder("latin1").decode(await response.arrayBuffer());
  }
  const login = () => post("/default.asp?Action=Login", { login: config.login, password: config.password });

  async function search(filter, { sinceDays = null, maxPages = 6 } = {}) {
    const today = now();
    const format = (date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
    const since = new Date(today);
    if (sinceDays == null) since.setFullYear(since.getFullYear() - 4); else since.setDate(since.getDate() - sinceDays);
    const payload = { sts: "search", nro_ord: "", apellido: "", tipodoc: "DNI", nrodoc: "", fdesde: format(since), fhasta: format(today), sServicios: "Todos", estado: "Todos", servicioSel: "Todos", cod_ser: "A", DatosInt: "N", Filtro: "0", ...filter };
    let html = await post("/areas/servicio/labListapac.asp?Action=search&pag=1", payload);
    if (!/trresult|labListapac/i.test(html) || /name="password"/i.test(html)) { await login(); html = await post("/areas/servicio/labListapac.asp?Action=search&pag=1", payload); }
    if (/name="password"/i.test(html)) throw new Error("lab_login_rejected");
    state.queries += 1;
    const parse = parseRows;
    const rows = parse(html);
    // Apellidos frecuentes ocupan varias páginas: se leen hasta 6.
    const last = Math.min(maxPages, Number(/cantidadPag" value="(\d+)"/.exec(html)?.[1] ?? 1));
    for (let page = 2; page <= last; page += 1) rows.push(...parse(await post(`/areas/servicio/labListapac.asp?Action=search&pag=${page}`, payload)));
    return rows;
  }

  /** Personas del laboratorio que pueden corresponder a un paciente leído: por DNI y, si no alcanza, por apellido. */
  async function candidates({ dni, patient }) {
    if (!config.ready) return [];
    const number = String(dni ?? "").replace(/\D/g, "");
    const surname = fold(patient).replace(/[^A-ZÑ ]/g, " ").split(/\s+/).filter((token) => token.length >= 4)[0] ?? "";
    const key = `${number}|${surname}`;
    if (cache.has(key)) return cache.get(key);
    const found = [];
    try {
      if (number.length >= 7) found.push(...await search({ nrodoc: number }));
      if (!found.length && surname) found.push(...await search({ apellido: surname }));
      state.lastOkAt = now().toISOString(); state.lastError = null;
    } catch (error) { state.lastError = String(error?.message ?? error).slice(0, 80); return []; }
    const unique = [...new Map(found.map((row) => [`${row.dni}|${row.nombre}`, { nombre: row.nombre, dni: row.dni, servicio: row.servicio, fecha: row.fecha }])).values()];
    if (cache.size > 2_000) cache.clear();
    cache.set(key, unique);
    return unique;
  }

  /**
   * Segundo método: todos los pedidos de laboratorio de los últimos días, con el servicio que figura en cada uno.
   * Sirve para comprobar una cama dudosa contra los pacientes de su mismo servicio, que son pocos, en vez de contra todo el hospital.
   */
  let recentCache = null;
  async function recent() {
    if (!config.ready) return [];
    if (recentCache && now().getTime() - recentCache.at < 10 * 60_000) return recentCache.rows;
    try {
      const rows = await search({}, { sinceDays: serviceMap().dias, maxPages: 60 });
      state.lastOkAt = now().toISOString(); state.lastError = null;
      recentCache = { at: now().getTime(), rows: rows.map((row) => ({ nombre: row.nombre, dni: row.dni, servicio: row.servicio, origen: row.origen, fecha: row.fecha, orden: row.orden, detalle: row.detalle })) };
      return recentCache.rows;
    } catch (error) { state.lastError = String(error?.message ?? error).slice(0, 80); return recentCache?.rows ?? []; }
  }
  /**
   * Tercer método: sala y cama de cada paciente, tomadas de la pantalla "Resultados" de sus órdenes de HOY y de AYER
   * (nada más viejo) en los servicios que la app conoce. Una consulta por paciente (su orden más nueva), que se guarda:
   * no se vuelve a pedir. Deja en var/lab/detalle.json cómo le fue (sin datos de pacientes).
   */
  const detailCache = new Map(); // orden -> { sala, cama } | null
  async function beds() {
    if (!config.ready) return [];
    const map = serviceMap();
    const wanted = new Set(Object.keys(map.equivalencias).map((name) => fold(name).trim()));
    const today = now(), yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const dayText = (date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
    const days = [dayText(today), dayText(yesterday)];
    const orders = (await recent()).filter((row) => wanted.has(fold(row.servicio).trim()) && days.some((day) => String(row.fecha).startsWith(day)));
    // La orden más nueva de cada paciente: es la que dice dónde está ahora.
    const latest = new Map();
    for (const row of orders) { const key = row.dni || fold(row.nombre); const number = Number(String(row.orden).replace(/\D/g, "")); if (!latest.has(key) || number > latest.get(key).number) latest.set(key, { row, number }); }
    const info = { en: now().toISOString(), ordenes: latest.size, sin_enlace: 0, consultadas: 0, con_cama: 0, sin_cama: 0, fallidas: 0, forma_del_enlace: null };
    let budget = 60; // por ciclo: el resto queda para el próximo
    const out = [];
    for (const { row } of latest.values()) {
      const id = String(row.orden);
      if (!detailCache.has(id)) {
        const link = /([\w./-]*\.asp[^'"\s)]*)/i.exec(String(row.detalle ?? ""))?.[1] ?? null;
        if (!info.forma_del_enlace && row.detalle) info.forma_del_enlace = String(row.detalle).replace(/\d/g, "9").slice(0, 160);
        if (!link) { info.sin_enlace += 1; continue; }
        if (budget <= 0) continue;
        budget -= 1; info.consultadas += 1;
        try {
          const path = link.startsWith("/") ? link : `/areas/servicio/${link.replace(/^\.\//, "")}`;
          const detail = parseOrderDetail(await get(path));
          detailCache.set(id, detail.cama ? { sala: detail.sala, cama: detail.cama } : null);
        } catch { info.fallidas += 1; continue; }
      }
      const place = detailCache.get(id);
      if (!place) { info.sin_cama += 1; continue; }
      info.con_cama += 1;
      out.push({ fecha: row.fecha, dni: row.dni, nombre: row.nombre, servicio: row.servicio, sala: place.sala, cama: place.cama });
    }
    if (detailCache.size > 5_000) detailCache.clear();
    state.camas = info;
    try { mkdirSync(join(root, "var", "lab"), { recursive: true }); writeFileSync(join(root, "var", "lab", "detalle.json"), JSON.stringify(info, null, 2), "utf8"); } catch { /* sólo diagnóstico */ }
    return out;
  }
  function serviceMap() {
    try {
      const file = JSON.parse(readFileSync(join(root, "server", "lab-services.json"), "utf8"));
      return { dias: Math.max(1, Math.min(7, Number(file.dias) || 3)), equivalencias: file.equivalencias ?? {}, ingreso: file.ingreso ?? [] };
    } catch { return { dias: 3, equivalencias: {}, ingreso: [] }; }
  }

  return { recent, beds, serviceMap, status: () => ({ ...state }), candidates, async forRows(rows) { const all = []; for (const row of rows ?? []) if (row?.patient || row?.dni) all.push(...await candidates({ dni: row.dni, patient: row.patient })); return all; } };
}
