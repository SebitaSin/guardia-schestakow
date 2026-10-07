import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLabLookup } from "./lab-lookup.mjs";

test("camas del laboratorio: sólo órdenes de hoy y ayer de servicios conocidos, una consulta por paciente, guardada", async () => {
  const root = mkdtempSync(join(tmpdir(), "sch-lab-"));
  mkdirSync(join(root, "server"));
  writeFileSync(join(root, "server", "lab-services.json"), JSON.stringify({ dias: 3, equivalencias: { PEDIATRIA: ["pediatria"] }, ingreso: ["GUARDIA"] }));
  const tr = (orden, fecha, dni, nombre, servicio) => `<tr class="trresult"><td>${orden}</td><td>${fecha}</td><td>DNI ${dni}</td><td>${nombre}</td><td>INTERNACION</td><td>${servicio}</td><td>Completo</td><td><a href="labResultado.asp?nro_ord=${orden}&amp;x=1"><img></a></td></tr>`;
  const list = `<input name="cantidadPag" value="1"><table>${tr(900002, "06/10/2026", "30000001", "PRUEBA , ANA", "PEDIATRIA")}${tr(900001, "06/10/2026", "30000001", "PRUEBA , ANA", "PEDIATRIA")}${tr(900000, "04/10/2026", "50000000", "VIEJO , PEDIDO", "PEDIATRIA")}${tr(900004, "07/10/2026", "40000000", "OTRO , SERVICIO", "AMBULATORIO")}</table>`;
  const asked = [];
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace("http://lab.test", "");
    if (init.method !== "POST") asked.push(path);
    const body = init.method === "POST" ? list : `<b>Orden</b> 900002 <td>Paciente</td><td>PRUEBA, ANA</td><td>Servicio</td><td>PEDIATRIA</td><td>Sala</td><td>119</td><td>Piso</td><td></td><td>Cama</td><td>3</td>`;
    return { ok: true, status: 200, headers: { getSetCookie: () => [] }, arrayBuffer: async () => Buffer.from(body, "latin1") };
  };
  try {
    const lab = createLabLookup({ root, env: { LAB_BASE_URL: "http://lab.test", LAB_LOGIN: "u", LAB_PASSWORD: "p" }, fetchImpl, now: () => new Date(2026, 9, 7, 3, 40) });
    const beds = await lab.beds();
    assert.deepEqual(beds, [{ fecha: "06/10/2026", dni: "30000001", nombre: "PRUEBA, ANA", servicio: "PEDIATRIA", sala: "119", cama: "3" }]);
    assert.deepEqual(asked, ["/areas/servicio/labResultado.asp?nro_ord=900002&x=1"]); // la orden más nueva de la paciente; ni la vieja ni la de otro servicio
    await lab.beds();
    assert.equal(asked.length, 1);
    const info = JSON.parse(readFileSync(join(root, "var", "lab", "detalle.json"), "utf8"));
    assert.deepEqual([info.ordenes, info.con_cama, info.sin_enlace], [1, 1, 0]);
    assert.equal(JSON.stringify(info).includes("PRUEBA"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
