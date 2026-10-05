import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { createHospitalServer } from "./app.mjs";
import { loadAuthConfig } from "./auth.mjs";
import { whatsappConfig } from "./whatsapp.mjs";
import { createMailRunner, scheduleMailSync, scheduleWhatsAppDrafts } from "./scheduler.mjs";
import { aiConfig } from "./ai.mjs";
import { mapsConfig } from "./maps.mjs";

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

const mailRunner = createMailRunner({ root, dataDir });
const authConfig = loadAuthConfig();
const server = createHospitalServer({ distDir, dataDir, catalogFile, internacionFile, authConfig, waConfig: whatsappConfig(), ai: aiConfig(), maps: mapsConfig(), mailRunner });
const stopSchedule = scheduleMailSync(mailRunner);
const stopWhatsAppDrafts = scheduleWhatsAppDrafts(dataDir, authConfig.secret);
server.once("close", () => { stopSchedule(); stopWhatsAppDrafts(); });
server.listen(port, host, () => {
  process.stdout.write(`Hospital Schestakow listo en http://${host}:${port}\n`);
});
