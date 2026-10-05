import { useEffect, useState } from "react";
import { Download, MessageCircle } from "lucide-react";

type WhatsAppItem = {
  mensaje_id: string;
  recibido_en?: string;
  tipo?: string;
  texto?: string;
  estado?: string;
};

export function WhatsAppFiles() {
  const [configured, setConfigured] = useState(false);
  const [items, setItems] = useState<WhatsAppItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/whatsapp/inbox", { signal: AbortSignal.timeout(8_000) })
      .then(async (response) => {
        if (!response.ok) throw new Error("whatsapp_unavailable");
        return response.json() as Promise<{ configured?: boolean; inbox?: WhatsAppItem[] }>;
      })
      .then((data) => {
        if (!active) return;
        setConfigured(Boolean(data.configured));
        setItems((data.inbox ?? []).slice(0, 20));
      })
      .catch(() => { if (active) setError("No se pudo consultar WhatsApp Business."); });
    return () => { active = false; };
  }, []);

  const images = items.filter((item) => item.tipo === "image");
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><MessageCircle className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">WhatsApp Business · pizarras recibidas</h2>
          <p className="mt-0.5 text-sm text-muted">Fotos originales del número del hospital, privadas y pendientes de confirmar.</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${configured ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>{configured ? "API conectada" : "API pendiente"}</span>
      </div>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      {!error && !images.length ? <p className="mt-3 text-sm text-muted">Todavía no hay fotos de WhatsApp disponibles para descargar.</p> : null}
      {images.length ? <ul className="mt-4 space-y-2">{images.map((item) => <li key={item.mensaje_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg px-3 py-2 text-sm"><span className="min-w-0 truncate">{item.texto || "Foto de pizarra"} · {item.estado || "A_CONFIRMAR"}</span><a className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={`/api/whatsapp/media/${encodeURIComponent(item.mensaje_id)}`} download><Download className="size-4" />Descargar</a></li>)}</ul> : null}
    </section>
  );
}
