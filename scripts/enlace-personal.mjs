// Enlace público SÓLO para la ficha del personal (/mis-datos), con la app corriendo en esta PC.
// Levanta un pasamanos local que deja pasar únicamente la ficha (el resto de la app no sale a internet)
// y abre un túnel de Cloudflare hacia ese pasamanos. Lo que carga el personal se guarda en esta PC.
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const allowed = (path) => path === "/mis-datos" || path === "/mis-datos.js" || path.startsWith("/api/autogestion/publico/");

export function createFormProxy({ appPort }) {
  return http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/") { res.writeHead(302, { location: "/mis-datos" }); return res.end(); }
    if (!allowed(path) || !["GET", "POST"].includes(req.method ?? "")) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("No disponible"); }
    if (Number(req.headers["content-length"] ?? 0) > 8_192) { res.writeHead(413); return res.end(); }
    const headers = { host: req.headers.host ?? "", "x-enlace-ip": String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "") };
    for (const name of ["content-type", "content-length", "origin", "user-agent", "accept"]) if (req.headers[name]) headers[name] = req.headers[name];
    const upstream = http.request({ host: "127.0.0.1", port: appPort, path: req.url, method: req.method, headers, timeout: 30_000 }, (answer) => { res.writeHead(answer.statusCode ?? 502, answer.headers); answer.pipe(res); });
    upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); res.end("La app del hospital no responde. Probá en unos minutos."); });
    req.pipe(upstream);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const appPort = Number(process.env.APP_PORT || 8788), proxyPort = Number(process.env.ENLACE_PORT || 8790);
  const exe = process.argv[2] || "cloudflared";
  const alive = await fetch(`http://127.0.0.1:${appPort}/mis-datos`).then((r) => r.status === 200).catch(() => false);
  if (!alive) { console.log("\n  La app no tiene la ficha activa. Hacé doble clic en \"Reiniciar servidor\", esperá un minuto y volvé a abrir esto.\n"); process.exit(1); }
  createFormProxy({ appPort }).listen(proxyPort, "127.0.0.1");
  const tunnel = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${proxyPort}`], { stdio: ["ignore", "pipe", "pipe"] });
  let shown = false;
  const watch = (chunk) => {
    const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk));
    if (!found || shown) return;
    shown = true;
    const link = `${found[0]}/mis-datos`;
    mkdirSync(join(root, "var"), { recursive: true });
    writeFileSync(join(root, "var", "enlace-personal.txt"), `${link}\r\n`, "utf8");
    console.log(`\n  ENLACE PARA EL PERSONAL:\n\n      ${link}\n\n  Quedó copiado en var\\enlace-personal.txt.\n  Funciona mientras esta ventana siga abierta y la PC prendida.\n  Si cerrás esta ventana, el enlace deja de andar y al abrirla de nuevo sale OTRO distinto.\n`);
  };
  tunnel.stdout.on("data", watch); tunnel.stderr.on("data", watch);
  tunnel.on("error", () => { console.log("\n  No se pudo iniciar cloudflared.\n"); process.exit(1); });
  tunnel.on("exit", (code) => { console.log(`\n  El túnel se cerró (código ${code}). El enlace dejó de funcionar.\n`); process.exit(0); });
}
