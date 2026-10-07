import { readFileSync } from "node:fs";
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
  return { calls: (usage.calls ?? 0) + 1, inputTokens: (usage.inputTokens ?? 0) + call.inputTokens, outputTokens: (usage.outputTokens ?? 0) + call.outputTokens, estimatedUsd: (usage.estimatedUsd ?? 0) + call.estimatedUsd, dias };
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

async function analyzeBoardImageOnce({ imagePath, sourceHash, dataDir, config, fetchImpl = fetch }) {
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
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: config.model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 6000,
      prompt_cache_key: "schestakow-pizarron-v4",
      input: [{ role: "user", content: [
        { type: "input_text", text: "Transcribí este pizarrón hospitalario con máxima fidelidad, fila por fila. Los nombres pueden estar impresos con tipografía similar a Arial de aproximadamente 14 puntos; es sólo una pista visual. Conservá la ortografía visible, no infieras ni completes nombres, diagnósticos, camas o servicios. Usá null cuando algo no sea legible y bajá la confianza. No tomes decisiones clínicas. La aplicación contrastará luego cada fila con fuentes registradas.\n\nUna fila por cada cama que se ve en la foto, en el orden de la planilla, también las vacías: una cama vacía lleva su etiqueta en bed y null en todo lo demás. Una cama que la foto no muestra (cortada o tapada) no se incluye. Campos: service = título de la planilla tal como figura en la foto (null si no se ve); bed = etiqueta de la cama tal como figura; patient = apellido y nombre; dni = sólo los dígitos que se lean; age = edad; hc = historia clínica; insurance = obra social o mutual; admission = fecha u hora de ingreso; diagnosis = diagnóstico. Si una columna no existe en esa planilla, null.\n\nPlanillas del hospital (sirven sólo para ubicar título, columnas y etiquetas de cama; nunca para completar algo que no se ve en la foto):\n" + templateGuide() },
        { type: "input_image", detail: "high", image_url: `data:${imageMime(imagePath, bytes)};base64,${bytes.toString("base64")}` },
      ] }],
      text: { format: { type: "json_schema", name: "hospital_board_transcription", strict: true, schema: SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const raw = await response.json();
  const parsed = JSON.parse(outputText(raw));
  if (!Array.isArray(parsed.rows)) throw new Error("openai_invalid_output");
  const inputTokens = Number(raw.usage?.input_tokens ?? 0);
  const outputTokens = Number(raw.usage?.output_tokens ?? 0);
  const estimatedUsd = inputTokens * config.inputRate / 1_000_000 + outputTokens * config.outputRate / 1_000_000;
  const result = { sourceHash, promptVersion: PROMPT_VERSION, status: "A_CONFIRMAR", model: config.model, rows: parsed.rows, generalObservations: parsed.general_observations, usage: { inputTokens, outputTokens, estimatedUsd }, createdAt: new Date().toISOString(), cached: false };
  writeJsonAtomic(cachePath, result);
  writeJsonAtomic(usagePath, addUsage(readJson(usagePath, usage), { inputTokens, outputTokens, estimatedUsd }));
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
