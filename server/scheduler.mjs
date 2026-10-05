import { spawn } from "node:child_process";
import { join } from "node:path";
import { processDueSchedules } from "./whatsapp-schedules.mjs";

export function createMailRunner({ root, dataDir, env = process.env, spawnImpl = spawn, timeoutMs = 10 * 60_000 }) {
  let running = false;
  const python = env.PYTHON_COMMAND || (process.platform === "win32" ? "python" : "python3");
  return {
    get running() { return running; },
    run() {
      if (running) return Promise.resolve({ started: false, reason: "already_running" });
      running = true;
      return new Promise((resolve) => {
        let child;
        try {
          child = spawnImpl(python, [join(root, "scripts", "imap_sync.py")], {
            cwd: root,
            env: { ...env, APP_ROOT: root, APP_DATA_DIR: dataDir },
            stdio: "ignore",
            windowsHide: true,
          });
        } catch {
          // spawn puede fallar de inmediato (EPERM, ENOENT): no debe tirar el servidor.
          running = false;
          resolve({ started: true, ok: false });
          return;
        }
        // Si el correo no responde, se corta a los 10 minutos para que la próxima revisión pueda correr.
        const watchdog = setTimeout(() => { try { child.kill(); } catch { /* ya terminó */ } }, timeoutMs);
        watchdog.unref?.();
        child.once("error", () => { clearTimeout(watchdog); running = false; resolve({ started: true, ok: false }); });
        child.once("exit", (code) => { clearTimeout(watchdog); running = false; resolve({ started: true, ok: code === 0, code }); });
      });
    },
  };
}

export function mailSyncMinutes(env = process.env) {
  return Math.max(2, Math.min(1_440, Number(env.GMAIL_SYNC_MINUTES ?? 10) || 10));
}

export function scheduleMailSync(runner, env = process.env) {
  if (String(env.GMAIL_SYNC_ENABLED ?? "false").toLowerCase() !== "true") return () => undefined;
  // El correo se revisa seguido para que una planilla nueva se refleje sola a los pocos minutos.
  const minutes = mailSyncMinutes(env);
  const safeRun = () => { Promise.resolve().then(() => runner.run()).catch(() => undefined); };
  const first = setTimeout(safeRun, 5_000);
  const interval = setInterval(safeRun, minutes * 60_000);
  first.unref(); interval.unref();
  return () => { clearTimeout(first); clearInterval(interval); };
}

export function scheduleWhatsAppDrafts(dataDir, secret) {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    try { processDueSchedules(dataDir, secret); }
    catch { /* A corrupt/unavailable store must not stop the application server. */ }
    finally { running = false; }
  };
  const first = setTimeout(tick, 5_000);
  const interval = setInterval(tick, 60_000);
  first.unref(); interval.unref();
  return () => { clearTimeout(first); clearInterval(interval); };
}
