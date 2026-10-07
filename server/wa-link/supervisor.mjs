// Mantiene vivo el receptor de WhatsApp (listener.mjs) como proceso aparte:
// si se cae, se vuelve a levantar; si el servidor se cierra, el receptor se cierra con él.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readJson } from "../store.mjs";

export function createWaLink({ root, dataDir, env = process.env, spawnImpl = spawn }) {
  const here = dirname(fileURLToPath(import.meta.url));
  const installed = existsSync(join(here, "node_modules", "baileys", "package.json"));
  const stateDir = join(dataDir, "whatsapp-link");
  let child = null; let timer = null; let stopped = false; let delay = 15_000;

  function linked() {
    try { return Boolean(JSON.parse(readFileSync(join(stateDir, "auth", "creds.json"), "utf8"))?.me?.id); } catch { return false; }
  }
  function schedule(ms) { if (stopped) return; clearTimeout(timer); timer = setTimeout(launch, ms); timer.unref?.(); }
  function launch() {
    if (stopped || child) return;
    if (!linked()) return schedule(20_000); // espera a que se vincule con VINCULAR-WHATSAPP
    const started = Date.now();
    try {
      child = spawnImpl(process.execPath, [join(here, "listener.mjs")], { cwd: root, env: { ...env, APP_ROOT: root, APP_DATA_DIR: dataDir }, stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    } catch { child = null; return schedule(60_000); }
    child.once("error", () => { child = null; schedule(60_000); });
    child.once("exit", () => {
      child = null;
      delay = Date.now() - started > 120_000 ? 15_000 : Math.min(delay * 2, 300_000);
      schedule(delay);
    });
  }

  return {
    status() {
      if (!installed) return { estado: "NO_INSTALADO" };
      const saved = readJson(join(stateDir, "status.json"), null);
      if (!linked()) return { estado: "SIN_VINCULAR", error: saved?.error ?? null };
      const fresh = saved?.actualizado && Date.now() - Date.parse(saved.actualizado) < 90_000;
      if (!child || !saved || !fresh) return { estado: "RECONECTANDO", numero: saved?.numero ?? null, ultimaFoto: saved?.ultimaFoto ?? null, error: saved?.error ?? null };
      return { estado: saved.estado, numero: saved.numero ?? null, ultimaFoto: saved.ultimaFoto ?? null, error: saved.error ?? null };
    },
    start() { if (installed) launch(); },
    stop() { stopped = true; clearTimeout(timer); try { child?.stdin?.end(); child?.kill(); } catch { /* ya terminó */ } child = null; },
  };
}
