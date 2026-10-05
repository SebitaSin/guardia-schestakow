// Escribe deploy/private/produccion.env con todo lo que el servidor de internet necesita.
// Lo llama PREPARAR-PUBLICACION.cmd después de abrir las credenciales protegidas de esta PC.
// No muestra ningún valor: sólo qué quedó cargado y qué falta.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_KEYS = ["APP_SESSION_SECRET", "HOSPITAL_IMAP_ACCOUNT", "HOSPITAL_IMAP_PASSWORD", "GOOGLE_MAPS_API_KEY", "GOOGLE_ROUTES_API_KEY", "OPENAI_API_KEY", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_GRAPH_VERSION", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_PUBLIC_NUMBER"];
const REQUIRED = ["APP_SESSION_SECRET", "APP_USERS_B64", "HOSPITAL_IMAP_ACCOUNT", "HOSPITAL_IMAP_PASSWORD"];

export function productionEnv(env, usersJson) {
  const values = {
    APP_HOST: "0.0.0.0",
    APP_DATA_DIR: "/data",
    APP_COOKIE_SECURE: "true",
    APP_TRUST_PROXY: "true",
    GMAIL_SYNC_ENABLED: env.HOSPITAL_IMAP_PASSWORD ? "true" : "false",
    APP_USERS_B64: usersJson ? Buffer.from(JSON.stringify(JSON.parse(usersJson)), "utf8").toString("base64") : "",
  };
  for (const key of SECRET_KEYS) values[key] = String(env[key] ?? "").trim();
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error(`valor_invalido_${key}`);
  }
  const loaded = Object.keys(values).filter((key) => values[key]);
  const missing = [...REQUIRED, "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_PHONE_NUMBER_ID"].filter((key) => !values[key]);
  // Sin comillas: así lo entienden igual Docker, Compose y los paneles de los proveedores.
  const text = loaded.map((key) => `${key}=${values[key]}`).join("\n") + "\n";
  const odd = loaded.filter((key) => /['"$#`\\]/.test(values[key]));
  return { text, loaded, missing, odd, blocking: REQUIRED.filter((key) => !values[key]) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.env.APP_ROOT || join(dirname(fileURLToPath(import.meta.url)), ".."));
  const usersFile = process.env.APP_USERS_FILE || join(root, "server", "users.local.json");
  const result = productionEnv(process.env, readFileSync(usersFile, "utf8"));
  const target = join(root, "deploy", "private", "produccion.env");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, result.text, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`Listo: ${target}\nCargado: ${result.loaded.length} valores.\n`);
  if (result.missing.length) process.stdout.write(`Falta (se completa despues): ${result.missing.join(", ")}\n`);
  if (result.odd.length) process.stdout.write(`Cargar a mano en el proveedor (tienen simbolos especiales): ${result.odd.join(", ")}\n`);
  process.stdout.write("Este archivo tiene las claves: no lo subas a GitHub ni lo mandes por chat.\nJunto con el, al servidor va la carpeta var completa (se monta en /data).\n");
  if (result.blocking.length) process.exitCode = 1;
}
