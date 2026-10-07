import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { readJson, writeJsonAtomic } from "./store.mjs";
import { templateGuide } from "./board-templates.mjs";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows", "general_observations"],
  properties: {
    rows: {
      type: "array", maxItems: 100, items: {
        type: "object", additionalProperties: false,
        required: ["service", "room", "bed", "patient", "dni", "age", "hc", "insurance", "admission", "diagnosis", "arm", "post_surgical", "observations", "confidence"],
        properties: {
          service: { type: ["string", "null"] }, room: { type: ["string", "null"] }, bed: { type: ["string", "null"] },
          patient: { type: ["string", "null"] }, dni: { type: ["string", "null"] }, age: { type: ["string", "null"] }, hc: { type: ["string", "null"] },
          insurance: { type: ["string", "null"] }, admission: { type: ["string", "null"] },
          diagnosis: { type: ["string", "null"] }, arm: { type: ["boolean", "null"] },
          post_surgical: { type: ["boolean", "null"] }, observations: { type: ["string", "null"] },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    general_observations: { type: ["string", "null"] },
  },
};

export function aiConfig(env = process.env) {
  return {
    enabled: String(env.AI_ENABLED ?? "false").toLowerCase() === "true",
    allowClinicalData: String(env.AI_ALLOW_CLINICAL_DATA ?? "false").toLowerCase() === "true",
    apiKey: String(env.OPENAI_API_KEY ?? ""),
    model: String(env.OPENAI_MODEL ?? ""),
    budgetUsd: Number(env.AI_MONTHLY_BUDGET_USD ?? 0),
    callLimit: Number(env.AI_MONTHLY_CALL_LIMIT ?? 0),
    dailyUsd: Number(env.AI_DAILY_BUDGET_USD ?? 0), // tope de gasto por día; 0 = sin tope diario
    boardEffort: String(env.AI_BOARD_EFFORT ?? "low"), // esfuerzo de razonamiento al leer pizarras
    boardSchema: String(env.AI_BOARD_SCHEMA ?? "largo"), // "largo" (el de siempre) o "compacto"
    inputRate: Number(env.AI_INPUT_USD_PER_MILLION ?? 0),
    outputRate: Number(env.AI_OUTPUT_USD_PER_MILLION ?? 0),
  };
}

export function aiReady(config) {
  return Boolean(config.enabled && config.allowClinicalData && config.apiKey && config.model && config.budgetUsd > 0 && config.callLimit > 0 && config.inputRate > 0 && config.outputRate > 0);
}

/** Verify the server-side OpenAI credential without sending clinical data or consuming a generation. */
export async function verifyOpenAi(config, fetchImpl = fetch) {
  if (!config.apiKey) return { ok: false, reason: "key_missing", model: config.model || null };
  if (!config.model) return { ok: false, reason: "model_missing", model: null };
  try {
    const response = await fetchImpl("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { ok: false, reason: response.status === 401 ? "invalid_key" : `openai_http_${response.status}`, model: config.model };
    const body = await response.json().catch(() => ({}));
    const available = Array.isArray(body?.data) ? body.data.some((item) => item?.id === config.model) : true;
    const models = Array.isArray(body?.data) ? body.data.map((item) => String(item?.id ?? "")).filter((id) => /^gpt-/.test(id)).sort().slice(0, 80) : [];
    return { ok: available, reason: available ? "verified" : "model_not_found", model: config.model, ...(available ? {} : { models }) };
  } catch (error) {
    return { ok: false, reason: String(error?.name ?? "openai_unreachable"), model: config.model };
  }
}

const PROMPT_VERSION = 4;
export function cachedReading(dataDir, sourceHash) {
  const cached = readJson(join(dataDir, "ai", "cache", `${sourceHash}.json`), null);
  return cached?.promptVersion === PROMPT_VERSION ? cached : null;
}
function monthKey(date = new Date()) { return date.toISOString().slice(0, 7); }
/** Día de Mendoza (UTC-3) al que se imputa un gasto. */
export const aiDay = (date = new Date()) => new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
/** Suma una llamada al registro del mes, guardando también cuánto se gastó cada día. */
export function addUsage(usage, call, date = new Date()) {
  const day = aiDay(date);
  const dias = { ...(usage.dias ?? {}) };
  dias[day] = (dias[day] ?? 0) + call.estimatedUsd;
  // Desglose por tarea y por modelo, para saber en qué se va la plata.
  const bump = (group, key) => { if (!key) return group; const next = { ...(group ?? {}) }; const item = next[key] ?? { calls: 0, estimatedUsd: 0 }; next[key] = { calls: item.calls + 1, estimatedUsd: item.estimatedUsd + call.estimatedUsd }; return next; };
  const tareas = bump(usage.tareas, call.tarea), modelos = bump(usage.modelos, call.modelo);
  return { calls: (usage.calls ?? 0) + 1, inputTokens: (usage.inputTokens ?? 0) + call.inputTokens, outputTokens: (usage.outputTokens ?? 0) + call.outputTokens, reasoningTokens: (usage.reasoningTokens ?? 0) + (call.reasoningTokens ?? 0), estimatedUsd: (usage.estimatedUsd ?? 0) + call.estimatedUsd, dias, ...(tareas ? { tareas } : {}), ...(modelos ? { modelos } : {}) };
}
/**
 * ¿Entra una llamada más en el tope de hoy? Se cuenta lo gastado hoy más lo que cuesta una llamada promedio del mes
 * (1,2 centavos si todavía no hay historia), para no pasarse del tope con la última.
 */
export function dailyBudgetAllows(usage, dailyUsd, date = new Date()) {
  if (!(dailyUsd > 0)) return true;
  const typical = usage.calls > 0 ? usage.estimatedUsd / usage.calls : 0.012;
  return (usage.dias?.[aiDay(date)] ?? 0) + typical <= dailyUsd;
}
export function aiBudgetAllows(dataDir, config, date = new Date()) {
  const usage = readJson(join(dataDir, "ai", `usage-${monthKey(date)}.json`), { calls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 });
  return usage.calls < config.callLimit && usage.estimatedUsd < config.budgetUsd && dailyBudgetAllows(usage, config.dailyUsd, date);
}
let aiQueue = Promise.resolve();
function outputText(response) {
  return (response.output ?? []).flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text ?? "";
}
function imageMime(path, bytes) {
  const ext = extname(path).toLowerCase();
  if (ext === ".png" || bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (ext === ".webp" || bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg";
}

/** Texto del pedido. Se arma en cada llamada porque incluye las planillas vigentes del hospital. */
const boardPrompt = () => "Transcribí este pizarrón hospitalario con máxima fidelidad, fila por fila. Los nombres pueden estar impresos con tipografía similar a Arial de aproximadamente 14 puntos; es sólo una pista visual. Conservá la ortografía visible, no infieras ni completes nombres, diagnósticos, camas o servicios. Usá null cuando algo no sea legible y bajá la confianza. No tomes decisiones clínicas. La aplicación contrastará luego cada fila con fuentes registradas.\n\nUna fila por cada cama que se ve en la foto, en el orden de la planilla, también las vacías: una cama vacía lleva su etiqueta en bed y null en todo lo demás. Una cama que la foto no muestra (cortada o tapada) no se incluye. Campos: service = título de la planilla tal como figura en la foto (null si no se ve); bed = etiqueta de la cama tal como figura; patient = apellido y nombre; dni = sólo los dígitos que se lean; age = edad; hc = historia clínica; insurance = obra social o mutual; admission = fecha u hora de ingreso; diagnosis = diagnóstico. Si una columna no existe en esa planilla, null.\n\nPlanillas del hospital (sirven sólo para ubicar título, columnas y etiquetas de cama; nunca para completar algo que no se ve en la foto):\n" + templateGuide();

/**
 * Precios por millón de tokens [entrada, salida, entrada en caché], tomados de la documentación de OpenAI el 7/10/2026.
 * Un modelo que no está acá se estima con AI_INPUT_USD_PER_MILLION / AI_OUTPUT_USD_PER_MILLION de la configuración.
 */
export const MODEL_PRICES = { "gpt-6-luna": [0.10, 0.50, 0.01], "gpt-5.4-mini": [0.75, 4.50, 0.075] };

/** Tokens y costo estimado de una respuesta, separando razonamiento y entrada en caché. */
export function usageOf(raw, model, config = {}) {
  const inputTokens = Number(raw?.usage?.input_tokens ?? 0), outputTokens = Number(raw?.usage?.output_tokens ?? 0);
  const cachedTokens = Number(raw?.usage?.input_tokens_details?.cached_tokens ?? 0), reasoningTokens = Number(raw?.usage?.output_tokens_details?.reasoning_tokens ?? 0);
  const [inRate, outRate, cachedRate] = MODEL_PRICES[model] ?? [Number(config.inputRate || 0), Number(config.outputRate || 0), Number(config.inputRate || 0)];
  const estimatedUsd = ((inputTokens - cachedTokens) * inRate + cachedTokens * cachedRate + outputTokens * outRate) / 1_000_000;
  return { inputTokens, cachedTokens, outputTokens, reasoningTokens, estimatedUsd };
}

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
/**
 * Una llamada a la API Responses. Reintenta sólo fallas pasajeras (429, 5xx, corte de red o de tiempo): hasta 3 veces,
 * esperando 1, 2 y 4 segundos más un margen al azar. Cualquier otro error sale tal cual.
 */
export async function openAiResponses({ apiKey, body, fetchImpl = fetch, timeoutMs = 60_000, sleep = (ms) => new Promise((done) => setTimeout(done, ms)), maxRetries = 3 }) {
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    let status = 0;
    try {
      const response = await fetchImpl("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(body) });
      status = response.status ?? (response.ok ? 200 : 500);
      if (response.ok) return { raw: await response.json(), retries: attempt, latencyMs: Date.now() - started };
      if (!TRANSIENT.has(status) || attempt >= maxRetries) throw new Error(`openai_http_${status}`);
    } catch (error) {
      const http = /^openai_http_/.test(String(error?.message));
      if (http || attempt >= maxRetries) throw http ? error : new Error(`openai_${error?.name === "TimeoutError" ? "timeout" : "unreachable"}`);
    }
    await sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 400));
  }
}

/** Registro de cada llamada (sin datos de pacientes): sirve para ver qué modelo, cuánto tardó y cuánto costó. */
function logCall(dataDir, entry) {
  try { mkdirSync(join(dataDir, "ai"), { recursive: true }); appendFileSync(join(dataDir, "ai", `llamadas-${monthKey()}.jsonl`), `${JSON.stringify({ en: new Date().toISOString(), ...entry })}\n`, "utf8"); } catch { /* el registro no frena la lectura */ }
}

/**
 * Formato compacto de respuesta: cada cama es una lista en orden fijo, sin nombres de campo, y los vacíos del final
 * se omiten. Pide la misma información que el formato largo; sólo cambia cómo viaja. La app lo vuelve a armar igual.
 */
const COMPACT_ORDER = ["confidence", "bed", "patient", "dni", "age", "hc", "insurance", "admission", "diagnosis", "observations", "arm", "post_surgical", "room", "service"];
const COMPACT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["s", "r", "o"],
  properties: {
    s: { type: ["string", "null"] },
    r: { type: "array", maxItems: 100, items: { type: "array", maxItems: 14, items: { type: ["string", "integer", "boolean", "null"] } } },
    o: { type: ["string", "null"] },
  },
};
const COMPACT_PROMPT = "\n\nFORMATO DE RESPUESTA (compacto). \"s\" = servicio que figura en el título de la planilla, o null. \"o\" = observaciones generales, o null. \"r\" = una lista por cama, con los datos SIEMPRE en este orden: [confianza 0-100, cama, paciente, dni, edad, historia clínica, obra social, ingreso, diagnóstico, observaciones, ARM (true/false/null), postquirúrgico (true/false/null), sala, servicio de esa fila sólo si es distinto de \"s\"]. Los null del final de cada lista se omiten; los del medio no, porque cambian las posiciones. Una cama vacía es [confianza, cama].";
const TEXT_FIELDS = new Set(["bed", "patient", "dni", "age", "hc", "insurance", "admission", "diagnosis", "observations", "room", "service"]);
export function inflateCompact(parsed) {
  if (!Array.isArray(parsed?.r)) throw new Error("openai_invalid_output");
  const rows = parsed.r.map((list) => {
    if (!Array.isArray(list) || !list.length || !Number.isInteger(list[0]) || list[0] < 0 || list[0] > 100) throw new Error("openai_invalid_output"); // nunca se convierte una fila rota en cama vacía
    const row = {};
    COMPACT_ORDER.forEach((field, index) => {
      const value = list[index] ?? null;
      if (field === "confidence") row[field] = value;
      else if (TEXT_FIELDS.has(field)) row[field] = value == null || value === "" ? null : String(value);
      else row[field] = typeof value === "boolean" ? value : null;
    });
    if (row.service == null) row.service = parsed.s == null || parsed.s === "" ? null : String(parsed.s);
    return Object.fromEntries(["service", "room", "bed", "patient", "dni", "age", "hc", "insurance", "admission", "diagnosis", "arm", "post_surgical", "observations", "confidence"].map((field) => [field, row[field]]));
  });
  return { rows, general_observations: parsed.o ?? null };
}

/**
 * Lee una pizarra con una variante dada (modelo, esfuerzo de razonamiento, formato de respuesta) y devuelve las filas
 * en el formato de siempre. No guarda ni descuenta nada: eso lo hace quien la llama.
 * Respuesta cortada o que no respeta el formato: se reintenta una sola vez.
 */
export async function readBoard({ bytes, mime, config, variant = {}, fetchImpl = fetch, sleep }) {
  const model = variant.model || config.model, effort = variant.effort || config.boardEffort || "low", compact = (variant.schema || config.boardSchema) === "compacto";
  const body = {
    model, store: false, reasoning: { effort }, max_output_tokens: 6000, prompt_cache_key: `schestakow-pizarron-v4${compact ? "c" : ""}`,
    input: [{ role: "user", content: [
      { type: "input_text", text: boardPrompt() + (compact ? COMPACT_PROMPT : "") },
      { type: "input_image", detail: "high", image_url: `data:${mime};base64,${bytes.toString("base64")}` },
    ] }],
    text: { format: compact ? { type: "json_schema", name: "pizarra_compacta", strict: true, schema: COMPACT_SCHEMA } : { type: "json_schema", name: "hospital_board_transcription", strict: true, schema: SCHEMA } },
  };
  const total = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, estimatedUsd: 0 };
  let retries = 0, latencyMs = 0;
  for (let attempt = 0; ; attempt += 1) {
    const answer = await openAiResponses({ apiKey: config.apiKey, body, fetchImpl, ...(sleep ? { sleep } : {}) });
    const used = usageOf(answer.raw, model, config);
    for (const key of Object.keys(total)) total[key] += used[key]; // una respuesta inútil también se paga
    retries += answer.retries + (attempt ? 1 : 0); latencyMs += answer.latencyMs;
    try {
      if (answer.raw.status === "incomplete") throw new Error("openai_truncated_output");
      const parsed = JSON.parse(outputText(answer.raw));
      const result = compact ? inflateCompact(parsed) : parsed;
      if (!Array.isArray(result.rows)) throw new Error("openai_invalid_output");
      return { rows: result.rows, generalObservations: result.general_observations ?? null, usage: total, telemetry: { modelo: model, effort, esquema: compact ? "compacto" : "largo", ms: latencyMs, reintentos: retries } };
    } catch (error) {
      if (attempt >= 1) throw Object.assign(new Error(/^openai_/.test(String(error?.message)) ? error.message : "openai_invalid_output"), { usage: total });
    }
  }
}

async function analyzeBoardImageOnce({ imagePath, sourceHash, dataDir, config, fetchImpl = fetch, sleep }) {
  if (!aiReady(config)) throw new Error("ai_not_configured_or_not_authorized_for_clinical_data");
  const cachePath = join(dataDir, "ai", "cache", `${sourceHash}.json`);
  const cached = cachedReading(dataDir, sourceHash);
  if (cached) return { ...cached, cached: true };
  const usagePath = join(dataDir, "ai", `usage-${monthKey()}.json`);
  const usage = readJson(usagePath, { calls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 });
  if (usage.calls >= config.callLimit || usage.estimatedUsd >= config.budgetUsd) throw new Error("ai_monthly_budget_reached");
  if (!dailyBudgetAllows(usage, config.dailyUsd)) throw new Error("ai_daily_budget_reached");
  const bytes = readFileSync(imagePath);
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error("image_size_invalid");
  let read;
  try { read = await readBoard({ bytes, mime: imageMime(imagePath, bytes), config, fetchImpl, sleep }); }
  catch (error) {
    if (error?.usage?.estimatedUsd) writeJsonAtomic(usagePath, addUsage(readJson(usagePath, usage), { ...error.usage, tarea: "pizarra", modelo: config.model }));
    logCall(dataDir, { tarea: "pizarra", hash: sourceHash, ok: false, error: String(error?.message ?? "error").slice(0, 60), ...(error?.usage ?? {}) });
    throw error;
  }
  const result = { sourceHash, promptVersion: PROMPT_VERSION, status: "A_CONFIRMAR", model: read.telemetry.modelo, variant: { effort: read.telemetry.effort, schema: read.telemetry.esquema }, rows: read.rows, generalObservations: read.generalObservations, usage: read.usage, createdAt: new Date().toISOString(), cached: false };
  writeJsonAtomic(cachePath, result);
  writeJsonAtomic(usagePath, addUsage(readJson(usagePath, usage), { ...read.usage, tarea: "pizarra", modelo: read.telemetry.modelo }));
  logCall(dataDir, { tarea: "pizarra", hash: sourceHash, ok: true, ...read.telemetry, ...read.usage, filas: read.rows.length });
  return result;
}

export function analyzeBoardImage(args) {
  const run = aiQueue.then(() => analyzeBoardImageOnce(args));
  aiQueue = run.catch(() => undefined);
  return run;
}

export function aiUsageStatus(dataDir, config, date = new Date()) {
  const usage = readJson(join(dataDir, "ai", `usage-${monthKey(date)}.json`), { calls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 });
  return { month: monthKey(date), ...usage, callLimit: Number(config.callLimit || 0), budgetUsd: Number(config.budgetUsd || 0), dayUsd: usage.dias?.[aiDay(date)] ?? 0, dailyBudgetUsd: Number(config.dailyUsd || 0) };
}
