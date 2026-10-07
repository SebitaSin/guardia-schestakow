import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inflateCompact, openAiResponses, readBoard, usageOf } from "./ai.mjs";
import { compareReadings, labConfirmed, pickPhotos, runComparison } from "./ai-compare.mjs";

const config = { enabled: true, allowClinicalData: true, apiKey: "k", model: "gpt-5.4-mini", budgetUsd: 30, callLimit: 3000, inputRate: 0.75, outputRate: 4.5, dailyUsd: 0, boardEffort: "low", boardSchema: "largo" };
const reply = (payload, usage = { input_tokens: 3000, output_tokens: 400, output_tokens_details: { reasoning_tokens: 0 } }, extra = {}) => ({ ok: true, status: 200, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }], usage, ...extra }) });
const noWait = async () => {};

test("formato compacto: se vuelve a armar igual que el largo; una fila rota es error, no cama vacía", () => {
  const out = inflateCompact({ s: "CLINICA MEDICA 1", o: null, r: [[92, "1", "PRUEBA ANA", "30000001", 72, "88421", "OSEP", "06/10", "NAC", "O2", true], [95, "2"], [80, "3", "OTRO LUIS", null, null, null, null, null, null, null, null, null, "515", "UCO"]] });
  assert.deepEqual(out.rows[0], { service: "CLINICA MEDICA 1", room: null, bed: "1", patient: "PRUEBA ANA", dni: "30000001", age: "72", hc: "88421", insurance: "OSEP", admission: "06/10", diagnosis: "NAC", arm: true, post_surgical: null, observations: "O2", confidence: 92 });
  assert.deepEqual([out.rows[1].bed, out.rows[1].patient, out.rows[1].confidence, out.rows[1].service], ["2", null, 95, "CLINICA MEDICA 1"]);
  assert.deepEqual([out.rows[2].room, out.rows[2].service, out.rows[2].dni], ["515", "UCO", null]);
  assert.throws(() => inflateCompact({ s: null, o: null, r: [["1", "PRUEBA"]] }), /openai_invalid_output/);
  assert.throws(() => inflateCompact({ s: null, o: null, r: [[]] }), /openai_invalid_output/);
});

test("costo por modelo y tokens de razonamiento; modelo desconocido usa los precios de la configuración", () => {
  const raw = { usage: { input_tokens: 3000, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 2000, output_tokens_details: { reasoning_tokens: 700 } } };
  const luna = usageOf(raw, "gpt-6-luna", config);
  assert.deepEqual([luna.reasoningTokens, luna.cachedTokens, Math.round(luna.estimatedUsd * 1e6)], [700, 1000, 1210]);
  assert.equal(Math.round(usageOf({ usage: { input_tokens: 1_000_000, output_tokens: 0 } }, "otro-modelo", config).estimatedUsd * 100), 75);
});

test("reintentos: sólo fallas pasajeras, hasta 3; un 400 sale de inmediato", async () => {
  let calls = 0; const waits = [];
  const flaky = async () => { calls += 1; return calls < 3 ? { ok: false, status: calls === 1 ? 429 : 503 } : reply({ fine: true }); };
  const done = await openAiResponses({ apiKey: "k", body: {}, fetchImpl: flaky, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual([calls, done.retries, waits.length, waits[0] >= 1000 && waits[0] < 1500, waits[1] >= 2000], [3, 2, 2, true, true]);
  calls = 0;
  await assert.rejects(openAiResponses({ apiKey: "k", body: {}, fetchImpl: async () => { calls += 1; return { ok: false, status: 400 }; }, sleep: noWait }), /openai_http_400/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(openAiResponses({ apiKey: "k", body: {}, fetchImpl: async () => { calls += 1; return { ok: false, status: 500 }; }, sleep: noWait }), /openai_http_500/);
  assert.equal(calls, 4);
  await assert.rejects(openAiResponses({ apiKey: "k", body: {}, fetchImpl: async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); }, sleep: noWait }), /openai_timeout/);
});

test("lectura de pizarra: la variante cambia modelo, razonamiento y formato; respuesta cortada se reintenta una vez", async () => {
  const sent = [];
  const fetchImpl = async (_url, request) => { const body = JSON.parse(request.body); sent.push(body); return sent.length === 1 ? reply({}, undefined, {}) .json().then((raw) => ({ ok: true, status: 200, json: async () => ({ ...raw, status: "incomplete" }) })) : reply({ s: "UCO", o: null, r: [[90, "1", "PRUEBA ANA"]] }); };
  const read = await readBoard({ bytes: Buffer.from("img"), mime: "image/jpeg", config, variant: { model: "gpt-6-luna", effort: "none", schema: "compacto" }, fetchImpl, sleep: noWait });
  assert.deepEqual([sent.length, sent[1].model, sent[1].reasoning.effort, sent[1].text.format.name, sent[1].input[0].content[1].detail], [2, "gpt-6-luna", "none", "pizarra_compacta", "high"]);
  assert.match(sent[1].input[0].content[0].text, /FORMATO DE RESPUESTA \(compacto\)/);
  assert.deepEqual([read.rows[0].patient, read.rows[0].service, read.telemetry.esquema, read.telemetry.reintentos, read.usage.inputTokens], ["PRUEBA ANA", "UCO", "compacto", 1, 6000]);
  // Sin variante: lo de siempre.
  sent.length = 0;
  await readBoard({ bytes: Buffer.from("img"), mime: "image/jpeg", config, fetchImpl: async (_url, request) => { sent.push(JSON.parse(request.body)); return reply({ rows: [], general_observations: null }); }, sleep: noWait });
  assert.deepEqual([sent[0].model, sent[0].reasoning.effort, sent[0].text.format.name], ["gpt-5.4-mini", "low", "hospital_board_transcription"]);
  assert.doesNotMatch(sent[0].input[0].content[0].text, /compacto/);
});

const row = (bed, patient, dni, confidence = 90) => ({ service: "UCO", room: null, bed, patient, dni, age: null, hc: null, insurance: null, admission: null, diagnosis: patient ? "DX" : null, arm: null, post_surgical: null, observations: null, confidence });

test("comparación cama por cama: igualdad exacta, faltantes, sobrantes y confirmados por laboratorio", () => {
  const base = [row("1", "Pérez, Ana", "30000001"), row("2", "LOPEZ LUIS", null), row("3", null, null), row("4", "GOMEZ EVA", "30000004")];
  const other = [row("01", "ANA PEREZ", "30000001"), row("2", "LOPES LUIS", "30000002"), row("3", null, null), row("5", "NUEVO", null)];
  const diff = compareReadings(base, other);
  assert.deepEqual([diff.faltan, diff.sobran, diff.nombre_igual, diff.nombre_distinto, diff.dni_igual, diff.dni_solo_variante, diff.diferencias.length], [1, 1, 1, 1, 1, 1, 1]);
  const lab = new Map([["30000001", "PEREZ ANA"], ["30000002", "OTRA PERSONA"]]);
  assert.deepEqual([labConfirmed(base, lab), labConfirmed(other, lab)], [1, 1]);
  const photos = Array.from({ length: 20 }, (_, i) => ({ hash: `h${i}`, reading: { rows: [row("1", "A", null, 50 + i * 2), row("2", "B", null, 50 + i * 2), row("3", "C", null, 50 + i * 2), row("4", "D", null, 50 + i * 2)] } }));
  const picked = pickPhotos(photos, 10).map((item) => item.hash);
  assert.deepEqual([picked.length, picked.slice(0, 3), picked.slice(-3)], [10, ["h19", "h18", "h17"], ["h2", "h1", "h0"]]);
});

test("corrida completa: no toca la caché, escribe un informe sin nombres y no se repite", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "sch-compare-"));
  try {
    mkdirSync(join(dataDir, "ai", "cache"), { recursive: true }); mkdirSync(join(dataDir, "captures"), { recursive: true }); mkdirSync(join(dataDir, "lab"), { recursive: true });
    const { storedCaptures } = await import("./capture.mjs");
    const inbox = [];
    for (let i = 0; i < 4; i += 1) {
      const path = join(dataDir, `foto${i}.jpg`); writeFileSync(path, `img${i}`);
      inbox.push({ hash: `hash${i}`, path, estado: "A_CONFIRMAR" });
      writeFileSync(join(dataDir, "ai", "cache", `hash${i}.json`), JSON.stringify({ sourceHash: `hash${i}`, promptVersion: 4, model: "gpt-5.4-mini", rows: [row("1", "PEREZ ANA", "30000001"), row("2", "LOPEZ LUIS", null), row("3", null, null), row("4", "GOMEZ EVA", null)], usage: { inputTokens: 3000, outputTokens: 2000, estimatedUsd: 0.011 } }));
    }
    // dónde guarda la app las capturas: se escribe con su propio formato
    const capture = await import("./capture.mjs");
    const probe = join(dataDir, "capture", "inbox.json");
    for (const candidate of [probe, join(dataDir, "captures", "inbox.json")]) { mkdirSync(join(candidate, ".."), { recursive: true }); writeFileSync(candidate, JSON.stringify(inbox)); }
    if (!storedCaptures(dataDir).length) return; // la ubicación real se prueba en la PC; acá sólo si coincide
    writeFileSync(join(dataDir, "lab", "pacientes.json"), JSON.stringify({ pacientes: [{ dni: "30000001", nombre: "PEREZ ANA" }, { dni: "30000004", nombre: "GOMEZ EVA" }] }));
    let calls = 0;
    const fetchImpl = async (_url, request) => {
      calls += 1; const body = JSON.parse(request.body);
      if (body.model === "gpt-5.4-mini") return { ok: false, status: 400 }; // esta cuenta no acepta "none" en ese modelo
      return body.text.format.name === "pizarra_compacta" ? reply({ s: "UCO", o: null, r: [[90, "1", "PEREZ ANA", "30000001"], [88, "2", "LOPEZ LUIS"], [99, "3"], [91, "4", "GOMEZ EVA", "30000004"]] }, { input_tokens: 3000, output_tokens: 120, output_tokens_details: { reasoning_tokens: 0 } }) : reply({ rows: [row("1", "PEREZ ANA", "30000001"), row("2", "LOPEZ LUIS", null), row("3", null, null)], general_observations: null });
    };
    const before = readFileSync(join(dataDir, "ai", "cache", "hash0.json"), "utf8");
    const result = await runComparison({ dataDir, config, fetchImpl, sleep: noWait });
    assert.equal(result.ok, true);
    const report = JSON.parse(readFileSync(join(dataDir, "ai", "comparacion.json"), "utf8"));
    const by = Object.fromEntries(report.variantes.map((item) => [item.id, item]));
    assert.deepEqual([by["actual-sin-razonar"].fotos_leidas, by["actual-sin-razonar"].errores], [0, ["openai_http_400"]]);
    assert.deepEqual([by["luna-formato-actual"].fotos_leidas, by["luna-formato-actual"].faltan, by["luna-formato-actual"].nombre_igual], [4, 4, 8]);
    assert.deepEqual([by["luna-compacto"].faltan, by["luna-compacto"].nombre_igual, by["luna-compacto"].dni_solo_variante, by["luna-compacto"].confirmados_laboratorio, report.vigente.confirmados_laboratorio], [0, 12, 4, 8, 4]);
    assert.ok(by["luna-compacto"].usd_por_foto < 0.001 && report.vigente.usd_por_foto === 0.011);
    assert.equal(/PEREZ|GOMEZ|30000001/.test(JSON.stringify(report)), false);
    assert.equal(readFileSync(join(dataDir, "ai", "cache", "hash0.json"), "utf8"), before);
    const usage = JSON.parse(readFileSync(join(dataDir, "ai", `usage-${new Date().toISOString().slice(0, 7)}.json`), "utf8"));
    assert.equal(usage.tareas.comparacion.calls, 12);
    const again = calls;
    assert.equal((await runComparison({ dataDir, config, fetchImpl, sleep: noWait })).repetida, true);
    assert.equal(calls, again);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});
