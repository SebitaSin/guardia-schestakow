import { createFileRoute } from "@tanstack/react-router";
import { Search, Send, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadGroups, loadMessagingDirectory, personAreas, searchKey, serviceLabel, whatsappNumber, type MessagingContact, type StaffGroup } from "@/lib/staff-directory";

export const Route = createFileRoute("/comunicaciones")({ component: CommunicationsPage });

type Flags = { canSend: boolean; canApprove: boolean };
type Recipient = { name: string; to: string };
type Result = { name: string; to: string; ok: boolean; text: string; code?: string };

const MAX_RECIPIENTS = 25;
// Plantilla de apertura mientras no haya plantillas propias aprobadas (es_AR). Se usa solo si el usuario lo pide tras un rechazo por ventana de 24 h.
const OPENING_TEMPLATE = { name: "hello_world", language: "en_US" };
const WINDOW_CODES = new Set(["service_window_closed", "whatsapp_send_131047"]);

const ERROR_LABELS: Record<string, string> = {
  invalid_recipient: "Número incompleto o inválido.",
  service_window_closed: "Pasaron 24 h desde su último mensaje: hace falta abrir la conversación con una plantilla.",
  whatsapp_not_configured: "WhatsApp no está configurado en el servidor. No se envió nada.",
  duplicate_send: "Ese mismo mensaje ya se envió hace poco a este número.",
  send_rate_limit: "Se alcanzó el límite de envíos de esta hora.",
  whatsapp_send_190: "El token de WhatsApp venció. Hay que renovarlo en el servidor.",
  whatsapp_send_131030: "Ese número no está habilitado como destinatario en Meta (modo prueba).",
  whatsapp_send_131047: "Pasaron 24 h desde su último mensaje: hace falta abrir la conversación con una plantilla.",
  whatsapp_send_132001: "La plantilla no existe con ese nombre e idioma, o no está aprobada.",
};

async function postJson(url: string, data: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const out = await res.json().catch(() => ({})) as { error?: string; record?: { id: string } };
  if (!res.ok) throw new Error(out.error || `http_${res.status}`);
  return out;
}

function CommunicationsPage() {
  const [people, setPeople] = useState<MessagingContact[]>([]);
  const [groups, setGroups] = useState<StaffGroup[]>([]);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const [body, setBody] = useState("");
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    const found = window.location.hash.match(/para=(\d{8,15})/);
    if (found) setManual(`+${found[1]}`);
  }, []);

  async function refresh() {
    setLoading(true); setLoadError("");
    const [directory, groupList, outbox] = await Promise.allSettled([
      loadMessagingDirectory(),
      loadGroups(),
      fetch("/api/whatsapp/outbox", { signal: AbortSignal.timeout(8_000) }).then(async (res) => { if (!res.ok) throw new Error("outbox_unavailable"); return await res.json() as Flags; }),
    ]);
    if (directory.status === "fulfilled") setPeople(directory.value);
    else { const code = String(directory.reason?.message ?? ""); setLoadError(code.includes("_401") ? "La sesión venció. Volvé a ingresar." : code.includes("_403") ? "Tu cuenta no tiene permiso para ver el directorio." : "No se pudo cargar el directorio."); }
    setGroups(groupList.status === "fulfilled" ? groupList.value : []);
    setFlags(outbox.status === "fulfilled" ? { canSend: Boolean(outbox.value.canSend), canApprove: Boolean(outbox.value.canApprove) } : null);
    setLoading(false);
  }
  useEffect(() => { void refresh(); }, []);

  const visible = useMemo(() => {
    const key = searchKey(query);
    return people
      .filter((person) => searchKey(`${person.name ?? ""} ${person.service ?? ""} ${person.role ?? ""} ${person.phone ?? ""}`).includes(key))
      .sort((a, b) => (a.name ?? a.staffId).localeCompare(b.name ?? b.staffId, "es", { sensitivity: "base" }));
  }, [people, query]);

  const manualNumber = manual.trim() ? whatsappNumber(manual) : null;
  const recipients = useMemo<Recipient[]>(() => {
    const list: Recipient[] = [];
    for (const person of people) {
      if (!selectedIds.includes(person.staffId)) continue;
      const to = whatsappNumber(person.phone ?? "");
      if (to) list.push({ name: person.name || "Sin nombre", to });
    }
    if (manualNumber) list.push({ name: `+${manualNumber}`, to: manualNumber });
    return list.filter((item, index) => list.findIndex((other) => other.to === item.to) === index);
  }, [people, selectedIds, manualNumber]);
  const withoutPhone = people.filter((person) => selectedIds.includes(person.staffId) && !whatsappNumber(person.phone ?? "")).length;

  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  async function saveGroup() {
    if (!groupName.trim() || !selectedIds.length) return;
    setBusy(true); setNotice("");
    try {
      await postJson("/api/personal/groups", { name: groupName.trim(), scope: "MIXED", service: "", memberIds: selectedIds });
      setGroupName(""); setNotice("Grupo guardado."); await refresh();
    } catch { setNotice("No se pudo guardar el grupo."); }
    finally { setBusy(false); }
  }

  async function deliver(targets: Recipient[], payload: Record<string, unknown>, okText: string) {
    const out: Result[] = [];
    setBusy(true); setNotice(""); setResults([]);
    for (const target of targets) {
      try {
        const created = await postJson("/api/whatsapp/outbox", { to: `+${target.to}`, motivo: "Mensaje desde la plataforma", ...payload });
        if (!flags?.canApprove) { out.push({ name: target.name, to: target.to, ok: true, text: "quedó en aprobación de Dirección" }); continue; }
        const id = created.record!.id;
        await postJson("/api/whatsapp/outbox/action", { id, action: "approve" });
        await postJson("/api/whatsapp/outbox/action", { id, action: "send" });
        out.push({ name: target.name, to: target.to, ok: true, text: okText });
      } catch (error) {
        const code = (error as Error).message;
        out.push({ name: target.name, to: target.to, ok: false, code, text: ERROR_LABELS[code] || `no se pudo enviar (${code})` });
        if (code === "whatsapp_send_190" || code === "whatsapp_not_configured") break;
      }
      setResults([...out]);
    }
    setResults(out);
    setBusy(false);
    return out;
  }

  async function send() {
    if (!recipients.length || !body.trim() || !flags) return;
    if (recipients.length > MAX_RECIPIENTS) { setNotice(`Máximo ${MAX_RECIPIENTS} destinatarios por envío.`); return; }
    if (recipients.length > 1 && !window.confirm(`¿Enviar este mensaje a ${recipients.length} personas?`)) return;
    const out = await deliver(recipients, { kind: "text", body: body.trim() }, "aceptado por WhatsApp");
    if (out.every((item) => item.ok)) setBody("");
  }

  const needTemplate = results.filter((item) => !item.ok && item.code && WINDOW_CODES.has(item.code));
  async function sendOpeningTemplate() {
    await deliver(needTemplate.map((item) => ({ name: item.name, to: item.to })), { kind: "template", templateName: OPENING_TEMPLATE.name, languageCode: OPENING_TEMPLATE.language, params: [] }, "plantilla aceptada por WhatsApp");
  }

  const canPress = Boolean(flags) && !busy && recipients.length > 0 && body.trim().length > 0;
  const sendLabel = !flags?.canApprove ? "Enviar a aprobación" : recipients.length > 1 ? `Enviar a ${recipients.length}` : "Enviar";

  return <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
    <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] lg:sticky lg:top-4 lg:order-2 lg:self-start">
      <h2 className="font-semibold">Mensaje de WhatsApp</h2>
      {flags && !flags.canSend ? <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">WhatsApp no está configurado en el servidor.</p> : null}
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-sm font-medium">Para</p>
          {selectedIds.length ? <div className="mt-1 flex flex-wrap gap-1">{people.filter((person) => selectedIds.includes(person.staffId)).map((person) => <button key={person.staffId} type="button" onClick={() => toggle(person.staffId)} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-1 text-xs text-primary">{person.name || "Sin nombre"}<X className="size-3" /></button>)}</div> : null}
          <input value={manual} onChange={(event) => setManual(event.target.value)} inputMode="tel" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-bg px-3" placeholder={selectedIds.length ? "Otro número (opcional)" : "Elegí un contacto o escribí el número"} />
          {manual.trim() && !manualNumber ? <p className="mt-1 text-xs text-warn">Número incompleto.</p> : null}
          {withoutPhone > 0 ? <p className="mt-1 text-xs text-warn">{withoutPhone} contacto(s) sin teléfono válido: se omiten.</p> : null}
        </div>
        <label className="block text-sm font-medium">Mensaje<textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={5} className="mt-1 w-full rounded-lg border border-border bg-bg p-3" placeholder="Escribí el mensaje…" /></label>
        <Button type="button" size="lg" className="w-full" disabled={!canPress} onClick={() => void send()}><Send />{busy ? "Enviando…" : sendLabel}</Button>
      </div>
      {notice ? <p role="status" className="mt-3 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary">{notice}</p> : null}
      {results.length ? <ul className="mt-3 space-y-1 text-sm">{results.map((item) => <li key={item.to} className={item.ok ? "text-success" : "text-danger"}>{item.ok ? "✓" : "✕"} <strong>{item.name}</strong>: {item.text}</li>)}</ul> : null}
      {needTemplate.length && flags?.canApprove ? <Button type="button" variant="outline" className="mt-3 w-full" disabled={busy} onClick={() => void sendOpeningTemplate()}>Abrir conversación con plantilla ({needTemplate.length})</Button> : null}
    </section>

    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] lg:order-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Users className="size-5" />Contactos</h2>
        <p className="text-sm text-muted">{loading ? "Cargando…" : `${visible.length} · ${selectedIds.length} elegidos`}</p>
      </div>
      <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-bg pl-9 pr-3" placeholder="Buscar por nombre, servicio o teléfono" aria-label="Buscar contacto" /></label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value="" onChange={(event) => { const group = groups.find((item) => item.id === event.target.value); if (group) setSelectedIds(group.memberIds); }} className="min-h-9 rounded-lg border border-border bg-bg px-2 text-sm" aria-label="Elegir grupo guardado"><option value="">Grupo…</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.memberIds.length}</option>)}</select>
        <Button type="button" size="sm" variant="ghost" disabled={!visible.length} onClick={() => setSelectedIds([...new Set([...selectedIds, ...visible.filter((person) => whatsappNumber(person.phone ?? "")).map((person) => person.staffId)])])}>Elegir los {visible.length}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={!selectedIds.length} onClick={() => setSelectedIds([])}>Limpiar</Button>
      </div>
      {selectedIds.length ? <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-bg p-2"><input value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={100} className="min-h-9 min-w-40 flex-1 rounded-lg border border-border bg-surface px-3 text-sm" placeholder="Nombre del grupo (ej. Jefaturas)" aria-label="Nombre del grupo" /><Button type="button" size="sm" variant="outline" disabled={busy || !groupName.trim()} onClick={() => void saveGroup()}>Guardar grupo</Button></div> : null}
      {loadError ? <p role="status" className="mt-2 rounded-lg bg-warn-soft p-3 text-sm text-warn">{loadError} <button type="button" onClick={() => void refresh()} className="font-semibold underline">Reintentar</button></p> : null}
      {!loading && !loadError && !visible.length ? <p className="mt-3 text-sm text-muted">Sin resultados.</p> : null}
      <ul className="mt-2 max-h-[34rem] divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {visible.map((person) => {
          const ok = Boolean(whatsappNumber(person.phone ?? ""));
          const on = selectedIds.includes(person.staffId);
          return <li key={person.staffId}><label className={`flex items-center gap-3 px-3 py-2 ${ok ? "cursor-pointer" : "opacity-50"} ${on ? "bg-primary-soft" : "hover:bg-bg"}`}><input type="checkbox" checked={on} disabled={!ok} onChange={() => toggle(person.staffId)} className="size-4 accent-primary" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{person.name || "Nombre sin cargar"}</span><span className="block truncate text-xs text-muted">{personAreas(person).map(serviceLabel).join(" · ")}{ok ? ` · ${person.phone?.trim()}` : " · sin teléfono válido"}</span></span></label></li>;
        })}
      </ul>
    </section>
  </div>;
}
