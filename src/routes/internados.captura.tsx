import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { type ChangeEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/internados/captura")({ component: CapturaPage });

type CaptureItem = { captura_id: string; fuente: "CARGA_MANUAL" | "WHATSAPP_API" | "WHATSAPP_CARPETA" | "WHATSAPP_VINCULADO"; grupo?: string | null; remitente_nombre?: string | null; texto?: string | null; servicio?: string | null; publicacion?: { estado: "PUBLICADA" | "NO_PUBLICADA"; slug?: string | null; servicio?: string | null; motivo?: string | null; a_revisar?: number } | null; recibido_en: string; estado: string; remitente?: string; nombre_original?: string; turno?: "M" | "T" | "N"; turno_origen?: string };
type Intake = { vinculo?: { estado: string; numero?: string | null; ultimaFoto?: string | null; error?: string | null } | null; configurada: boolean; lastScanAt: string | null; lastNewAt: string | null; lastError: string | null; lecturaAutomatica: boolean };
type Verification = { status: "VERIFICADA" | "REVISAR" | "CONFLICTO"; reasons: string[]; sources: string[]; patientSuggestion: string | null; scores: { part: number | null; lab: number | null } };
type AiRow = { service: string | null; room: string | null; bed: string | null; patient: string | null; dni?: string | null; age?: string | null; hc?: string | null; insurance?: string | null; admission?: string | null; diagnosis: string | null; arm: boolean | null; post_surgical: boolean | null; observations: string | null; confidence: number; verification?: Verification; learnedCorrections?: { field: string; from: string | null; to: string; examples: number }[] };
type AiResult = { status: string; rows: AiRow[]; verificationSummary?: { verified: number; review: number; conflicts: number } };

const FIELD_LABELS = { service: "Servicio", room: "Sala", bed: "Cama", patient: "Apellido y nombre", dni: "DNI", age: "Edad", hc: "Historia clínica", insurance: "Obra social", admission: "Ingreso", diagnosis: "Diagnóstico", observations: "Observaciones" } as const;

function CapturaPage() {
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [sourceStatus, setSourceStatus] = useState("Consultando fuentes…");
  const [intake, setIntake] = useState<Intake | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiVerification, setAiVerification] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [aiResults, setAiResults] = useState<Record<string, AiResult>>({});
  const [editingRows, setEditingRows] = useState<string[]>([]);

  async function loadSources() {
    try {
      const [captureResponse, waResponse, aiResponse] = await Promise.all([
        fetch("/api/capture/inbox", { signal: AbortSignal.timeout(8_000) }),
        fetch("/api/whatsapp/inbox", { signal: AbortSignal.timeout(8_000) }),
        fetch("/api/ai/status", { signal: AbortSignal.timeout(8_000) }),
      ]);
      if (!captureResponse.ok) throw new Error("capture_source");
      const captureBody = (await captureResponse.json()) as { inbox: CaptureItem[]; intake?: Intake | null };
      setCaptures(captureBody.inbox);
      setIntake(captureBody.intake ?? null);
      const wa = waResponse.ok ? (await waResponse.json()) as { configured?: boolean; mode?: string } : null;
      setSourceStatus(wa?.configured ? `WhatsApp configurado · ${wa.mode === "API_GROUP" ? "grupo API" : "chat directo"}` : "Carga manual disponible · WhatsApp pendiente");
      setAiConfigured(aiResponse.ok && Boolean(((await aiResponse.json()) as { configured?: boolean }).configured));
    } catch { setSourceStatus("Fuentes no disponibles"); }
  }

  useEffect(() => {
    void loadSources();
    const id = setInterval(() => void loadSources(), 30_000);
    return () => clearInterval(id);
  }, []);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("upload"); setNotice("");
    try {
      const response = await fetch("/api/capture/upload", { method: "POST", headers: { "content-type": file.type, "x-file-name": encodeURIComponent(file.name) }, body: file, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`upload_${response.status}`);
      const result = (await response.json()) as { duplicate: boolean };
      setNotice(result.duplicate ? "La imagen ya estaba guardada; no se duplicó." : "Imagen original guardada. Quedó A CONFIRMAR.");
      await loadSources();
    } catch { setNotice("No se pudo guardar la imagen. No se publicó ningún dato."); }
    finally { setBusy(null); }
  }

  async function interpret(captureId: string) {
    setBusy(captureId); setNotice("");
    try {
      const response = await fetch("/api/ai/interpret", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ captureId }), signal: AbortSignal.timeout(65_000) });
      if (!response.ok) throw new Error(`ai_${response.status}`);
      const result = (await response.json()) as AiResult;
      setAiResults((current) => ({ ...current, [captureId]: result }));
      const summary = result.verificationSummary;
      setNotice(summary ? `Lectura terminada: ${summary.verified} fila(s) verificadas, ${summary.review} para revisar y ${summary.conflicts} con conflicto.` : "Lectura terminada. Los campos inciertos quedaron para revisión.");
    } catch { setNotice("La interpretación no se completó. La captura sigue A CONFIRMAR."); }
    finally { setBusy(null); }
  }

  async function verifyAi() {
    setAiVerification("Verificando clave y modelo…");
    try {
      const response = await fetch("/api/ai/verify", { method: "POST", signal: AbortSignal.timeout(15_000) });
      const result = (await response.json()) as { ok?: boolean; reason?: string; model?: string | null };
      setAiVerification(result.ok ? `OpenAI verificado · ${result.model ?? "modelo configurado"}` : `OpenAI no disponible · ${result.reason ?? "revisar configuración"}`);
    } catch {
      setAiVerification("No se pudo verificar OpenAI desde el servidor.");
    }
  }

  function editRow(captureId: string, index: number, field: keyof AiRow, value: string | number | boolean | null) {
    setAiResults((current) => {
      const result = current[captureId];
      if (!result) return current;
      const rows = result.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row);
      return { ...current, [captureId]: { ...result, rows } };
    });
  }

  async function review(captureId: string, decision: "CONFIRMADA" | "DESCARTADA") {
    setBusy(`review-${captureId}`); setNotice("");
    try {
      const response = await fetch("/api/capture/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ captureId, decision, rows: decision === "CONFIRMADA" ? aiResults[captureId]?.rows ?? [] : [] }), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`review_${response.status}`);
      setNotice(decision === "CONFIRMADA" ? "Revisión humana registrada. Los datos siguen sin publicarse automáticamente." : "Captura descartada y decisión registrada.");
      setAiResults((current) => { const next = { ...current }; delete next[captureId]; return next; });
    } catch { setNotice("No se pudo registrar la revisión. No se publicó ningún dato."); }
    finally { setBusy(null); }
  }

  return <div className="space-y-5">
    <header><h1 className="text-[1.6rem] font-semibold tracking-tight">Captura de pizarrones</h1><p className="mt-1 text-sm text-muted">Lectura automática con contraste de cama, parte actual y laboratorio. Sólo las excepciones se destacan para revisión.</p></header>

    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{sourceStatus}</p><Button type="button" size="sm" variant="secondary" onClick={() => void verifyAi()}>Verificar ChatGPT/OpenAI</Button></div>
      {intake ? <p className={`mt-2 text-sm ${intake.lastError ? "text-warn" : "text-muted"}`}>{intake.lastError ? "Carpeta de fotos de WhatsApp: no se pudo leer. No están entrando fotos solas." : `Carpeta de fotos de WhatsApp revisada ${intake.lastScanAt ? new Date(intake.lastScanAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "—"} · ${intake.lastNewAt ? `última foto nueva ${new Date(intake.lastNewAt).toLocaleString("es-AR")}` : "sin fotos nuevas desde el último reinicio"}`}</p> : null}
      {intake?.vinculo && intake.vinculo.estado !== "NO_INSTALADO" ? <p className={`mt-2 text-sm ${intake.vinculo.estado === "CONECTADO" ? "text-ok" : "text-warn"}`}>{intake.vinculo.estado === "CONECTADO" ? `WhatsApp del hospital conectado${intake.vinculo.ultimaFoto ? ` · última foto recibida ${new Date(intake.vinculo.ultimaFoto).toLocaleString("es-AR")}` : " · todavía no llegó ninguna foto"}` : intake.vinculo.estado === "SIN_VINCULAR" ? "WhatsApp del hospital sin vincular: no entran fotos solas. En la PC, abrir VINCULAR-WHATSAPP y escanear el código con el celular del 260 405 6998." : "WhatsApp del hospital desconectado; la app está reintentando. Mientras tanto no entran fotos."}</p> : null}
      {aiVerification ? <p role="status" className="mt-2 text-sm text-muted">{aiVerification}</p> : null}
      <label className="mt-3 inline-flex min-h-12 cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">{busy === "upload" ? "Guardando…" : "Subir foto del pizarrón"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy === "upload"} onChange={(event) => void upload(event)} /></label>
      {notice ? <p role="status" className="mt-3 text-sm text-warn">{notice}</p> : null}
    </section>

    <section className="rounded-2xl bg-surface p-4 text-sm leading-relaxed shadow-[var(--shadow-border)]"><p>Las fotos entran desde el WhatsApp del hospital (260 405 6998) como dispositivo vinculado. La app sólo recibe: no envía ni marca mensajes como leídos.</p><p className="mt-2 text-muted">La IA es opcional, tiene presupuesto y límite mensual, no reintenta en bucle y permanece apagada hasta autorizar datos clínicos.</p></section>

    <section><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Capturas recientes</h2>
      {captures.length ? <ul className="space-y-3">{captures.slice(0, 20).map((capture) => {
        const result = aiResults[capture.captura_id];
        return <li key={capture.captura_id} className="rounded-xl bg-surface px-4 py-3 text-sm shadow-[var(--shadow-border)]">
          <p className="font-medium">{new Date(capture.recibido_en).toLocaleString("es-AR")} · {capture.fuente === "CARGA_MANUAL" ? "Carga manual" : "WhatsApp"}{capture.turno ? capture.turno_origen === "GRUPO" ? <span className="ml-2 text-xs font-normal text-primary">{capture.turno}</span> : <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs font-normal text-warn">turno {capture.turno} estimado</span> : null}</p>
          <p className="text-muted">{capture.estado} · {[capture.grupo, capture.remitente_nombre].filter(Boolean).join(" · ") || capture.nombre_original || capture.remitente || "origen registrado"}</p>
          {capture.texto || capture.servicio ? <p className="mt-1 font-medium">{capture.servicio ?? capture.texto}{capture.servicio && capture.texto && capture.servicio !== capture.texto ? <span className="ml-2 text-xs font-normal text-muted">texto del mensaje: {capture.texto}</span> : null}</p> : null}
          {capture.publicacion?.estado === "PUBLICADA" && capture.publicacion.slug ? <p className="mt-1 text-sm text-ok">Publicada en <Link to="/internados/$slug" params={{ slug: capture.publicacion.slug }} className="font-medium underline">{capture.publicacion.servicio}</Link>{capture.publicacion.a_revisar ? <span className="ml-2 text-warn">{capture.publicacion.a_revisar} cama(s) a confirmar</span> : null}</p> : null}
          {capture.publicacion?.estado === "NO_PUBLICADA" ? <p className="mt-1 text-sm text-warn">No se publicó: {capture.publicacion.motivo}.</p> : null}
          <img className="mt-3 max-h-80 w-full rounded-lg bg-bg object-contain" src={`/api/capture/image/${encodeURIComponent(capture.captura_id)}`} alt="Imagen original del pizarrón para revisión" />
          {aiConfigured && capture.estado === "A_CONFIRMAR" && !result && capture.publicacion?.estado !== "PUBLICADA" ? <Button className="mt-2" type="button" size="sm" variant="secondary" disabled={busy === capture.captura_id} onClick={() => void interpret(capture.captura_id)}>{busy === capture.captura_id ? "Interpretando…" : "Crear borrador con IA"}</Button> : null}
          {result ? <div className="mt-3 space-y-3 border-t pt-3"><p className={`font-semibold ${result.status === "VERIFICADA_AUTOMATICAMENTE" ? "text-ok" : "text-warn"}`}>{result.status === "VERIFICADA_AUTOMATICAMENTE" ? "Lectura contrastada" : "Excepciones a revisar"} · {result.rows.length} fila(s)</p>
            {result.verificationSummary ? <p className="rounded-lg bg-bg px-3 py-2 text-xs text-muted">Verificadas {result.verificationSummary.verified} · revisar {result.verificationSummary.review} · conflictos {result.verificationSummary.conflicts}</p> : null}
            {result.rows.map((row, index) => {
              const rowKey = `${capture.captura_id}:${index}`;
              const verified = row.verification?.status === "VERIFICADA";
              const editing = editingRows.includes(rowKey) || !verified;
              return <div key={index} className={`rounded-lg border p-3 ${verified ? "border-ok/40 bg-ok-soft" : row.verification?.status === "CONFLICTO" ? "border-danger/40 bg-danger-soft" : "border-warn/40 bg-warn-soft"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{row.service || "Servicio ilegible"} · cama {row.bed || "ilegible"}</p><p className="text-sm">{row.patient || "Paciente ilegible"}{row.dni ? ` · DNI ${row.dni}` : ""}{row.age ? ` · ${row.age} años` : ""}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${verified ? "bg-ok text-white" : row.verification?.status === "CONFLICTO" ? "bg-danger text-white" : "bg-warn text-white"}`}>{row.verification?.status ?? "A CONFIRMAR"}</span></div>
                {row.verification?.sources.length ? <p className="mt-2 text-xs text-muted">Contrastado con {row.verification.sources.join(" + ")} · parte {row.verification.scores.part ?? "—"}% · lab {row.verification.scores.lab ?? "—"}%</p> : null}
                {row.verification?.reasons.length ? <p className="mt-2 text-xs text-danger">{row.verification.reasons.join(" · ")}</p> : null}
                {row.learnedCorrections?.length ? <p className="mt-2 text-xs text-primary">Corrección frecuente aplicada: {row.learnedCorrections.map((item) => `${item.from} → ${item.to}`).join(", ")}</p> : null}
                {verified && !editing ? <Button className="mt-3" type="button" size="sm" variant="ghost" onClick={() => setEditingRows((current) => [...current, rowKey])}>Editar igualmente</Button> : null}
                {editing ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(["service", "room", "bed", "patient", "dni", "age", "hc", "insurance", "admission", "diagnosis", "observations"] as const).map((field) => <label key={field} className="text-xs text-muted">{FIELD_LABELS[field]}<input className="mt-1 min-h-10 w-full rounded-md border bg-surface px-2 text-fg" value={row[field] ?? ""} onChange={(event) => editRow(capture.captura_id, index, field, event.target.value || null)} /></label>)}
                  <label className="text-xs text-muted">Confianza<input className="mt-1 min-h-10 w-full rounded-md border bg-surface px-2 text-fg" type="number" min="0" max="100" value={row.confidence} onChange={(event) => editRow(capture.captura_id, index, "confidence", Number(event.target.value))} /></label>
                  {(["arm", "post_surgical"] as const).map((field) => <label key={field} className="text-xs text-muted">{field === "arm" ? "ARM" : "Postquirúrgico"}<select className="mt-1 min-h-10 w-full rounded-md border bg-surface px-2 text-fg" value={row[field] === null ? "UNKNOWN" : row[field] ? "YES" : "NO"} onChange={(event) => editRow(capture.captura_id, index, field, event.target.value === "UNKNOWN" ? null : event.target.value === "YES")}><option value="UNKNOWN">A confirmar</option><option value="YES">Sí</option><option value="NO">No</option></select></label>)}
                </div> : null}
              </div>;
            })}
            <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy === `review-${capture.captura_id}`} onClick={() => void review(capture.captura_id, "CONFIRMADA")}>Confirmar revisión</Button><Button type="button" variant="secondary" disabled={busy === `review-${capture.captura_id}`} onClick={() => void review(capture.captura_id, "DESCARTADA")}>Descartar</Button></div>
          </div> : null}
        </li>;
      })}</ul> : <p className="text-sm text-muted">No hay capturas pendientes.</p>}
    </section>

  </div>;
}
