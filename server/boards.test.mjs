import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmBed, identifyService, processedCaptures, publishReading, readBoards } from "./boards.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sch-boards-"));
  const internacionFile = join(root, "internacion.json");
  const bed = (servicio, slug, cama) => ({ servicio, slug, cama, estado: "LIBRE", paciente: null });
  writeFileSync(internacionFile, JSON.stringify({ beds: [
    ...["1", "2", "3", "4"].map((cama) => ({ ...bed("UTI adultos", "terapia-intensiva", cama), ...(cama === "3" ? { estado: "OCUPADA", paciente: "PACIENTE DE SEPTIEMBRE" } : {}) })),
    ...["1", "2", "3"].map((cama) => bed("UTI pediátrica", "tip", cama)),
    ...["201-1", "201-2", "202-1"].map((cama) => bed("Maternidad", "obstetricia", cama)),
  ] }));
  writeFileSync(join(root, "lab-pacientes.json"), JSON.stringify({ pacientes: [{ nombre: "PRUEBA UNO, ANA", dni: "11222333" }] }));
  return { root, internacionFile, done: () => rmSync(root, { recursive: true, force: true }) };
}
const row = (bed, patient = null, extra = {}) => ({ service: "PLANILLA DE PACIENTES INTERNADOS UTI A 05/10/2026", room: null, bed, patient, dni: null, age: null, hc: null, insurance: null, admission: null, diagnosis: null, arm: null, post_surgical: null, observations: null, confidence: 95, ...extra });
const capture = (hash, when, extra = {}) => ({ captura_id: `c-${hash}`, hash, foto_fecha: when, recibido_en: when, texto: null, ...extra });

test("la lectura se publica sola en su servicio: verificado, amarillo, libre y no visto", () => {
  const ctx = fixture();
  try {
    const out = publishReading({ dataDir: ctx.root, internacionFile: ctx.internacionFile, capture: capture("h1", "2026-10-05T12:00:00Z"), reading: { model: "m", rows: [
      row("01"), row("2", "Prueba Uno Ana", { dni: "11.222.333", arm: true }), row("3", "Sin Cruce Pedro"),
    ] } });
    assert.equal(out.estado, "PUBLICADA");
    const board = readBoards(ctx.root).services["terapia-intensiva"];
    assert.equal(board.servicio, "UTI adultos");
    assert.deepEqual(board.beds.map((bed) => [bed.cama, bed.estado, bed.revision, bed.visto]), [
      ["1", "LIBRE", "VERIFICADA", true], ["2", "OCUPADA", "VERIFICADA", true], ["3", "OCUPADA", "REVISAR", true], ["4", "DESCONOCIDA", null, false],
    ]);
    assert.equal(board.beds[1].arm, true);
    assert.equal(board.beds[2].revision, "REVISAR"); // paciente nuevo sin cruce: amarillo, nunca conflicto por un parte viejo
    assert.ok(board.beds[2].motivos.length > 0);
    assert.equal(processedCaptures(ctx.root).h1.a_revisar, 1);
  } finally { ctx.done(); }
});

test("confirmar vale para ese paciente; otra persona en la cama vuelve a amarillo; una foto vieja no pisa", () => {
  const ctx = fixture();
  try {
    const publish = (hash, when, rows) => publishReading({ dataDir: ctx.root, internacionFile: ctx.internacionFile, capture: capture(hash, when), reading: { rows } });
    publish("h1", "2026-10-05T12:00:00Z", [row("3", "Sin Cruze Pedro"), row("4", "Otro Paciente Luis")]);
    const fixed = confirmBed({ dataDir: ctx.root, slug: "terapia-intensiva", cama: "3", values: { paciente: "Sin Cruce Pedro", dni: "30.111.222" }, actor: "direccion" });
    assert.deepEqual([fixed.revision, fixed.paciente, fixed.dni], ["CONFIRMADA", "Sin Cruce Pedro", "30111222"]);
    publish("h2", "2026-10-05T18:00:00Z", [row("3", "Sin Cruce Pedro")]); // foto cortada: la cama 4 no se ve
    let beds = readBoards(ctx.root).services["terapia-intensiva"].beds;
    assert.equal(beds[2].revision, "CONFIRMADA");
    assert.deepEqual([beds[3].paciente, beds[3].visto], ["Otro Paciente Luis", false]);
    assert.equal(publish("h0", "2026-10-04T08:00:00Z", [row("3", "Paciente De Ayer")]).estado, "NO_PUBLICADA");
    publish("h3", "2026-10-06T08:00:00Z", [row("3", "Persona Nueva Marta")]);
    beds = readBoards(ctx.root).services["terapia-intensiva"].beds;
    assert.deepEqual([beds[2].paciente, beds[2].revision], ["Persona Nueva Marta", "REVISAR"]);
    assert.equal(readBoards(ctx.root).services["terapia-intensiva"].antecedentes.length, 2);
  } finally { ctx.done(); }
});

test("el servicio sale del título, del texto o de las camas; si se contradicen no se publica", () => {
  const ctx = fixture();
  try {
    const catalog = [["terapia-intensiva", "UTI adultos", "1"], ["tip", "UTI pediátrica", "1"], ["obstetricia", "Maternidad", "201-1"], ["obstetricia", "Maternidad", "201-2"]].map(([slug, servicio, cama]) => ({ slug, servicio, cama }));
    assert.equal(identifyService({ rows: [row("1")], texto: null, catalog }).slug, "terapia-intensiva");
    assert.equal(identifyService({ rows: [row("1")], texto: "Uti ped", catalog }).slug, null);
    assert.equal(identifyService({ rows: [row("1", null, { service: null })], texto: "Uti ped", catalog }).slug, "tip");
    assert.equal(identifyService({ rows: [row("201/1", null, { service: null }), row("201/2", null, { service: null })], texto: null, catalog }).slug, "obstetricia");
    assert.equal(identifyService({ rows: [row("1", null, { service: null })], texto: null, catalog }).slug, null);
    assert.equal(identifyService({ rows: [row("6/1", null, { service: "S.I.A.P.S." })], texto: null, catalog }).slug, null);
    const out = publishReading({ dataDir: ctx.root, internacionFile: ctx.internacionFile, capture: capture("hx", "2026-10-05T12:00:00Z", { texto: "Uti ped" }), reading: { rows: [row("1", "Alguien Juan")] } });
    assert.equal(out.estado, "NO_PUBLICADA");
    assert.deepEqual(readBoards(ctx.root).services, {});
  } finally { ctx.done(); }
});

test("sin título ni texto, el servicio sale de los pacientes ya conocidos, de camas parciales o del remitente", () => {
  const catalog = [..."123456"].map((n) => ({ slug: "clinica-1", servicio: "Clínica Médica 1", cama: `10${n}` })).concat([..."12"].map((n) => ({ slug: "uco", servicio: "UCO", cama: n })), [..."12"].map((n) => ({ slug: "tip", servicio: "TIP", cama: n })));
  const person = (bed, patient, dni = null) => ({ service: null, bed, patient, dni });
  const boards = { services: { "salud-mental": { beds: [{ cama: "1", paciente: "GOMEZ JUAN", dni: "30111222" }, { cama: "2", paciente: "PEREZ ANA", dni: "28999111" }, { cama: "3", paciente: "RUIZ LUIS", dni: null }] }, uco: { beds: [{ cama: "1", paciente: "OTRO PACIENTE", dni: null }] } } };
  // camas 1 y 2 empatan entre UCO y TIP: deciden los pacientes
  const byPatients = identifyService({ rows: [person("1", "GOMEZ JUAN"), person("2", "Perez Ana"), person("1", "NUEVO INGRESO")], texto: null, catalog, boards });
  assert.deepEqual([byPatients.slug, byPatients.origen], ["salud-mental", "PACIENTES"]);
  // un solo paciente en común no alcanza
  assert.equal(identifyService({ rows: [person("9", "GOMEZ JUAN"), person("8", "X"), person("7", "Y")], texto: null, catalog, boards }).slug, null);
  // camas mal leídas en su mayoría, pero las que coinciden son todas de un servicio
  const partial = identifyService({ rows: ["101", "102", "103", "999", "998", "997", "996", "995"].map((bed) => person(bed, null)), texto: null, catalog, boards });
  assert.deepEqual([partial.slug, partial.origen], ["clinica-1", "CAMAS"]);
  // remitente que siempre manda del mismo servicio
  const bySender = identifyService({ rows: [person("77", "A B")], texto: null, catalog, boards, sender: new Map([["uco", 4]]) });
  assert.deepEqual([bySender.slug, bySender.origen], ["uco", "REMITENTE"]);
  // remitente que manda de varios servicios: no decide
  assert.equal(identifyService({ rows: [person("77", "A B")], texto: null, catalog, boards, sender: new Map([["uco", 3], ["tip", 2]]) }).slug, null);
});

test("laboratorio por servicio: confirma con un único paciente parecido y no elige entre dos", async () => {
  const { labForService, verifyBoardRows } = await import("./board-verification.mjs");
  const map = { equivalencias: { "CLINICA MEDICA 1": ["clinica-1"], "UTI ADULTOS": ["terapia-intensiva"] }, ingreso: ["GUARDIA"] };
  const recent = [
    { nombre: "PEREZ, JUAN CARLOS", dni: "20111222", servicio: "CLINICA MEDICA 1" },
    { nombre: "PEREZ, JUAN CARLOS", dni: "20111222", servicio: "CLINICA MEDICA 1" },
    { nombre: "GOMEZ, MARIA", dni: "30111222", servicio: "CLINICA MEDICA 1" },
    { nombre: "GOMEZ, MARTA", dni: "31111222", servicio: "CLINICA MEDICA 1" },
    { nombre: "LOPEZ, ANA BEATRIZ", dni: "25111222", servicio: "GUARDIA" },
    { nombre: "PEREZ, JUAN CARLOS", dni: "40111222", servicio: "UTI ADULTOS" },
  ];
  const serviceLab = labForService(recent, "clinica-1", map);
  assert.deepEqual([serviceLab.own.length, serviceLab.entry.length], [3, 1]);
  const check = (patient, dni = null) => verifyBoardRows({ rows: [{ service: "Clínica Médica 1", bed: "101", patient, dni, confidence: 95 }], dataDir: "/no-existe", internacionFile: "/no-existe", usePart: false, serviceLab }).rows[0].verification;
  const juan = check("PERES JUAN CARLO");
  assert.ok(juan.sources.includes("LABORATORIO_SERVICIO"), JSON.stringify(juan));
  assert.deepEqual([juan.patientSuggestion, juan.labDni], ["PEREZ, JUAN CARLOS", "20111222"]);
  const gomez = check("GOMEZ MAR");
  assert.ok(!gomez.sources.length && gomez.reasons.includes("dos pacientes parecidos en el laboratorio del servicio"), JSON.stringify(gomez));
  assert.ok(check("LOPEZ ANA BEATRIZ").sources.includes("LABORATORIO_GUARDIA"));
  assert.deepEqual(check("RODRIGUEZ PEDRO").sources, []);
  const otherDni = check("PEREZ JUAN CARLOS", "33999888");
  assert.ok(!otherDni.sources.length && otherDni.reasons.includes("el documento leído es diferente al del laboratorio del servicio"), JSON.stringify(otherDni));
});
