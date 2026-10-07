import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { appendAudit, readJson, writeJsonAtomic } from "./store.mjs";
import { verifyOpenAi } from "./ai.mjs";
import { createWaLink } from "./wa-link/supervisor.mjs";
import { createLabLookup } from "./lab-lookup.mjs";
import { createHospitalServer } from "./app.mjs";
import { loadAuthConfig } from "./auth.mjs";
import { whatsappConfig } from "./whatsapp.mjs";
import { createMailRunner, scheduleMailSync, scheduleWhatsAppDrafts } from "./scheduler.mjs";
import { aiConfig } from "./ai.mjs";
import { createWeatherWatch } from "./weather-watch.mjs";
import { spawn } from "node:child_process";
import { mapsConfig } from "./maps.mjs";
import { createPhotoIntake } from "./photo-intake.mjs";

const root = resolve(process.env.APP_ROOT || process.cwd());
const dataDir = resolve(process.env.APP_DATA_DIR || resolve(root, "var"));
const distDir = resolve(process.env.APP_DIST_DIR || resolve(root, "dist"));
const catalogFile = resolve(process.env.APP_CATALOG_FILE || resolve(root, "src", "data", "catalog.json"));
const internacionFile = resolve(process.env.APP_INTERNACION_FILE || resolve(root, "src", "data", "internacion.json"));
// Replit injects PORT and only exposes services bound to 0.0.0.0.
// Local secure launches can still pin APP_HOST/APP_PORT explicitly.
const host = process.env.APP_HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.APP_PORT || process.env.PORT || 8788);
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
// Parámetros no secretos de la lectura de pizarras por IA (la clave nunca va en este archivo).
for (const [key, value] of Object.entries(readJson(resolve(root, "server", "ai-config.json"), {}))) { if (/^(AI_|OPENAI_MODEL$)/.test(key)) process.env[key] ??= String(value); }

const mailRunner = createMailRunner({ root, dataDir });
const authConfig = loadAuthConfig();
const waLink = createWaLink({ root, dataDir });
const photoIntake = createPhotoIntake({ root, dataDir, ai: aiConfig(), waLink, internacionFile, lab: createLabLookup({ root }) });
// Clima: se actualiza cada 10 minutos aunque nadie tenga la pantalla abierta, para detectar los cambios de nivel.
// Cuando el nivel cambia, se intenta el aviso por correo (apagado hasta configurar server/avisos-config.json).
const weatherWatch = createWeatherWatch({ dataDir, onLevelChange(change) {
  const child = spawn(process.env.PYTHON_COMMAND || (process.platform === "win32" ? "python" : "python3"), [resolve(root, "scripts", "aviso_nivel.py")], { cwd: root, env: { ...process.env, APP_ROOT: root }, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  child.once("error", () => undefined);
  child.stdin.end(JSON.stringify(change));
} });
const weatherTimer = setInterval(() => { weatherWatch.refresh().catch(() => undefined); }, 10 * 60_000);
weatherTimer.unref();
setTimeout(() => { weatherWatch.refresh().catch(() => undefined); }, 15_000).unref();
const server = createHospitalServer({ distDir, dataDir, catalogFile, internacionFile, authConfig, waConfig: whatsappConfig(), ai: aiConfig(), maps: mapsConfig(), mailRunner, photoIntake, weatherWatch });
photoIntake.start();
// Prueba de modelos de IA, sólo si se pidió en ai-config.json: corre una vez, en segundo plano, y no cambia lo publicado.
if (String(process.env.AI_COMPARE ?? "").toLowerCase() === "true") setTimeout(() => { import("./ai-compare.mjs").then((mod) => mod.runComparison({ dataDir, config: aiConfig(), internacionFile })).then((result) => appendAudit(dataDir, { actor: "system", action: "ai_model_comparison", kind: "system", ok: result.ok, repetida: Boolean(result.repetida), motivo: result.motivo ?? null })).catch((error) => appendAudit(dataDir, { actor: "system", action: "ai_model_comparison_failed", kind: "system", error: String(error?.message ?? "error").slice(0, 80) })); }, 45_000).unref();
waLink.start();
if (aiConfig().enabled) verifyOpenAi(aiConfig()).then((result) => writeJsonAtomic(resolve(dataDir, "ai", "status.json"), { ...result, at: new Date().toISOString() })).catch(() => undefined);
const stopSchedule = scheduleMailSync(mailRunner);
const stopWhatsAppDrafts = scheduleWhatsAppDrafts(dataDir, authConfig.secret);
server.once("close", () => { stopSchedule(); stopWhatsAppDrafts(); photoIntake.stop(); waLink.stop(); });
server.listen(port, host, () => {
  process.stdout.write(`Hospital Schestakow listo en http://${host}:${port}\n`);
});
