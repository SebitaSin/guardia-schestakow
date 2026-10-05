import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Outbound = {
  id: string; to: string; kind: "text" | "template"; body?: string; templateName?: string;
  motivo: string; estado: string; error?: string; error_code?: number;
  creado_en: string; enviado_en?: string; serviceWindow: { open: boolean; expiresAt: string | null };
};
type Outbox = { configured: boolean; canSend: boolean; canApprove: boolean; items: Outbound[] };

const ERROR_LABELS: Record<string, string> = {
  invalid_recipient: "Revisá el número de celular completo.",
  service_window_closed: "Pasaron 24 horas desde el último mensaje recibido. Para iniciar conversación necesitás una plantilla aprobada por WhatsApp.",
  whatsapp_not_configured: "La API oficial todavía no está configurada en el servidor. No se envió nada.",
  outbound_not_approved: "Primero debe aprobarlo Dirección.",
  duplicate_send: "Ese mismo mensaje ya se envió recientemente a este número.",
  send_rate_limit: "Se alcanzó el límite de envíos de esta hora.",
  invalid_language_code: "Idioma de plantilla inválido. Ejemplos: es_AR, en_US.",
  invalid_template_params: "Una variable está vacía o tiene saltos de línea / espacios dobles.",
  whatsapp_send_190: "El token de WhatsApp venció o no es válido. Hay que renovarlo en el servidor.",
  whatsapp_send_131030: "Ese número no está habilitado como destinatario en Meta (modo prueba).",
  whatsapp_send_131047: "Pasaron más de 24 h desde su último mensaje. Hace falta una plantilla.",
  whatsapp_send_132001: "La plantilla no existe con ese nombre e idioma, o no está aprobada.",
  whatsapp_send_132000: "La cantidad de variables no coincide con la plantilla.",
};

export function WhatsAppConversation({ replyTo }: { replyTo?: string }) {
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [to, setTo] = useState("");
  const [kind, setKind] = useState<"text" | "template">("text");
  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [languageCode, setLanguageCode] = useState("es_AR");
  const [paramsText, setParamsText] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => { if (replyTo) setTo(replyTo); }, [replyTo]);

  async function refresh() {
    try {
      const res = await fetch("/api/whatsapp/outbox", { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error("read_failed");
      setOutbox(await res.json() as Outbox);
    } catch { setNotice("No se pudo consultar la bandeja de salida."); }
  }
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 10_000); return () => window.clearInterval(timer); }, []);

  async function draft(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setNotice("");
    try {
      const res = await fetch("/api/whatsapp/outbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, kind, body, templateName, languageCode, params: paramsText.split("\n").map((line) => line.trim()).filter(Boolean), motivo: motivo.trim() || "Mensaje desde la plataforma" }) });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || "draft_failed");
      setBody(""); setTemplateName(""); setParamsText(""); setMotivo("");
      setNotice("Borrador guardado. Todavía no se envió.");
      await refresh();
    } catch (error) { const code = (error as Error).message; setNotice(ERROR_LABELS[code] || `No se pudo guardar el borrador (${code}).`); }
    finally { setBusy(false); }
  }

  async function postJson(url: string, data: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const out = await res.json().catch(() => ({})) as { error?: string; record?: Outbound };
    if (!res.ok) throw new Error(out.error || `http_${res.status}`);
    return out;
  }

  async function sendNow() {
    if (!formRef.current?.reportValidity()) return;
    const payload = { to, kind, body, templateName, languageCode, params: paramsText.split("\n").map((line) => line.trim()).filter(Boolean), motivo: motivo.trim() || "Mensaje desde la plataforma" };
    setBusy(true); setNotice("");
    try {
      if (!outbox?.canApprove) {
        await postJson("/api/whatsapp/outbox", payload);
        setNotice("Enviado a aprobación de Dirección. Todavía no salió.");
      } else {
        if (!outbox.canSend) throw new Error("whatsapp_not_configured");
        if (!window.confirm(`¿Enviar por WhatsApp a ${to}?\n\n${kind === "text" ? body : `Plantilla: ${templateName}`}`)) return;
        const created = await postJson("/api/whatsapp/outbox", payload);
        const id = created.record!.id;
        await postJson("/api/whatsapp/outbox/action", { id, action: "approve" });
        await postJson("/api/whatsapp/outbox/action", { id, action: "send" });
        setNotice("WhatsApp aceptó el mensaje. La entrega se confirma con su acuse.");
      }
      setBody(""); setTemplateName(""); setParamsText(""); setMotivo("");
    } catch (error) { const code = (error as Error).message; setNotice(ERROR_LABELS[code] || `No se pudo enviar (${code}). Revisá la bandeja de salida.`); }
    finally { setBusy(false); await refresh(); }
  }

  async function action(item: Outbound, operation: "approve" | "reject" | "send") {
    if (operation === "send" && !window.confirm(`¿Enviar por WhatsApp a ${item.to}?\n\n${item.kind === "text" ? item.body : `Plantilla: ${item.templateName}`}`)) return;
    setBusy(true); setNotice("");
    try {
      const res = await fetch("/api/whatsapp/outbox/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, action: operation }) });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || `http_${res.status}`);
      setNotice(operation === "send" ? "WhatsApp aceptó el mensaje. La entrega se confirma con su acuse." : operation === "approve" ? "Aprobado. Aún no se envió." : "Borrador rechazado.");
      await refresh();
    } catch (error) { const code = (error as Error).message; setNotice(ERROR_LABELS[code] || `No se completó la acción (${code}). Revisá el estado antes de reintentar.`); await refresh(); }
    finally { setBusy(false); }
  }

  return <section className="space-y-4 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
    <div><h2 className="font-semibold">Responder y enviar por WhatsApp</h2><p className="mt-1 text-sm text-muted">Conversación bilateral 1 a 1. Cada envío requiere aprobación de Dirección; la aplicación no responde sola.</p></div>
    <p className={`rounded-lg px-3 py-2 text-sm ${outbox?.canSend ? "bg-success-soft text-success" : "bg-warn-soft text-warn"}`}>{outbox?.configured ? "API oficial conectada: se pueden recibir y enviar mensajes." : outbox?.canSend ? "Envío por API oficial activo. La recepción automática se activa cuando se configure el webhook." : "API oficial pendiente: los borradores se guardan, pero no se puede enviar ni recibir automáticamente todavía."}</p>
    <form ref={formRef} onSubmit={(event) => void draft(event)} className="grid gap-3">
      <label className="text-sm font-medium">Número del destinatario<input required value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-bg px-3" placeholder="260 405 6998" /></label>
      <label className="text-sm font-medium">Motivo (opcional)<input maxLength={240} value={motivo} onChange={(event) => setMotivo(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-bg px-3" placeholder="Ej. confirmar cambio de guardia" /></label>
      <label className="text-sm font-medium">Tipo de mensaje<select value={kind} onChange={(event) => setKind(event.target.value as "text" | "template")} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-bg px-3"><option value="text">Respuesta de texto (dentro de 24 h)</option><option value="template">Plantilla aprobada (para iniciar conversación)</option></select></label>
      {kind === "text" ? <label className="text-sm font-medium">Mensaje<textarea required maxLength={4000} rows={3} value={body} onChange={(event) => setBody(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg p-3" /></label> : <><label className="text-sm font-medium">Nombre exacto de plantilla aprobada<input required value={templateName} onChange={(event) => setTemplateName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-bg px-3" placeholder="aviso_guardia" /><span className="mt-1 block text-xs text-muted">Debe existir y estar aprobada en WhatsApp Manager; este formulario no crea plantillas.</span></label><label className="text-sm font-medium">Idioma de la plantilla<input required value={languageCode} onChange={(event) => setLanguageCode(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-bg px-3" placeholder="es_AR" /></label><label className="text-sm font-medium">Variables (una por línea, en orden; vacío si no tiene)<textarea rows={3} value={paramsText} onChange={(event) => setParamsText(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-bg p-3" /></label></>}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !outbox} onClick={() => void sendNow()}>{outbox?.canApprove ? "Enviar" : "Enviar a aprobación"}</Button><Button type="submit" variant="outline" disabled={busy}>Guardar borrador</Button></div>
    </form>
    {notice && <p role="status" className="rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary">{notice}</p>}
    <div><h3 className="font-semibold">Bandeja de salida</h3><p className="text-xs text-muted">ENVIADO significa aceptado por WhatsApp; ENTREGADO o LEÍDO llega después por acuse. Si figura FALLIDO, no lo consideres comunicado.</p></div>
    {!outbox?.items.length ? <p className="text-sm text-muted">Todavía no hay mensajes salientes.</p> : <ul className="max-h-96 space-y-2 overflow-auto">{outbox.items.map((item) => <li key={item.id} className="rounded-lg border border-border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{item.to}</strong><span>{item.estado}</span></div><p className="mt-1 whitespace-pre-wrap">{item.kind === "text" ? item.body : `Plantilla: ${item.templateName}`}</p><p className="mt-1 text-xs text-muted">{item.motivo} · {item.kind === "text" ? item.serviceWindow.open ? `Ventana abierta hasta ${new Date(item.serviceWindow.expiresAt!).toLocaleString("es-AR")}` : "Ventana de 24 h cerrada" : "Plantilla"}</p>{item.error && <p className="mt-1 text-xs text-danger">Error: {item.error_code ? `${item.error_code} · ` : ""}{item.error}</p>}{outbox.canApprove && <div className="mt-2 flex gap-2">{item.estado === "BORRADOR" && <><Button size="sm" disabled={busy} onClick={() => void action(item, "approve")}>Aprobar</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void action(item, "reject")}>Rechazar</Button></>}{item.estado === "APROBADO" && <Button size="sm" disabled={busy || !outbox.canSend || (item.kind === "text" && !item.serviceWindow.open)} onClick={() => void action(item, "send")}>Confirmar y enviar</Button>}</div>}</li>)}</ul>}
  </section>;
}
