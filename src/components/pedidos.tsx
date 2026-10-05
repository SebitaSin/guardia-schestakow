import { useEffect, useState } from "react";
import { Mail, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MONTHS_ES } from "@/data/catalog";
import {
  loadReclamos,
  mailtoHref,
  markSent,
  patchService,
  pendingReclamos,
  reclamoCopy,
  saveReclamos,
  type PendingReclamo,
  type ReclamosStore,
} from "@/lib/reclamos";
import { sendReclamo } from "@/lib/send-reclamo";
import { useCatalogTick } from "@/lib/use-catalog";
import { cn } from "@/lib/utils";

export function PedidosPanel() {
  useCatalogTick();
  const [store, setStore] = useState<ReclamosStore>(() => loadReclamos());
  const [busy, setBusy] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const items = pendingReclamos(store);

  useEffect(() => {
    saveReclamos(store);
  }, [store]);

  async function sendOne(item: PendingReclamo) {
    if (!item.email.trim()) {
      setNote(`Falta el mail de ${item.dept.short}.`);
      return;
    }
    setBusy(item.dept.slug);
    setNote(null);
    const { subject, body } = reclamoCopy(item);
    try {
      const res = await sendReclamo({ data: { to: item.email.trim(), subject, body } });
      if (res.ok) {
        setPrepared(item.dept.slug);
        setNote(`Se abrió el borrador para ${item.dept.short}. Confirmá abajo sólo después de enviarlo.`);
      } else {
        window.location.href = mailtoHref(item);
        setPrepared(item.dept.slug);
        setNote(`Se preparó el correo para ${item.dept.short}. Todavía no figura como enviado.`);
      }
    } catch {
      window.location.href = mailtoHref(item);
      setPrepared(item.dept.slug);
      setNote(`Se preparó el correo para ${item.dept.short}. Todavía no figura como enviado.`);
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) return null;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-medium md:text-xl">Falta cronograma</h2>
          <p className="mt-1 text-base text-muted md:text-sm">
            Recordatorio 10 días antes y durante el mes. Nunca envía correo solo: una persona prepara, revisa y confirma cada pedido.
          </p>
        </div>
        <Button
          type="button"
          variant={store.enabled ? "secondary" : "default"}
          size="sm"
          onClick={() => setStore((s) => ({ ...s, enabled: !s.enabled }))}
        >
          {store.enabled ? "Pausar todos" : "Reanudar pedidos"}
        </Button>
      </div>
      {note ? <p className="mb-3 text-sm text-primary">{note}</p> : null}
      <ul className="space-y-2">
        {items.map((item) => {
          const meses = item.targets
            .map((t) => `${MONTHS_ES[t.month - 1]} ${t.year}`)
            .join(" y ");
          const Icon = item.dept.icon;
          return (
            <li
              key={item.dept.slug}
              className="rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)] md:rounded-xl md:p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <span className="flex size-12 items-center justify-center rounded-lg bg-warn-soft text-warn md:size-9 md:rounded-md">
                  <Icon className="size-6 md:size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-medium md:text-base">{item.dept.short}</p>
                  <p className="text-base text-muted md:text-sm">Falta {meses}</p>
                  <Input
                    className="mt-2"
                    value={item.email}
                    placeholder="Mail de correos anteriores del servicio"
                    inputMode="email"
                    autoComplete="email"
                    onChange={(e) =>
                      setStore((s) => patchService(s, item.dept.slug, { email: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy === item.dept.slug || !item.email.trim()}
                    onClick={() => sendOne(item)}
                  >
                    <Mail className="size-4" />
                    Preparar
                  </Button>
                  {prepared === item.dept.slug ? <Button type="button" size="sm" onClick={() => { setStore((state) => markSent(state, item)); setPrepared(null); setNote(`Envío confirmado por el usuario para ${item.dept.short}.`); }}>Confirmar enviado</Button> : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(item.paused && "text-warn")}
                    onClick={() =>
                      setStore((s) => patchService(s, item.dept.slug, { paused: !item.paused }))
                    }
                  >
                    {item.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                    {item.paused ? "Reanudar" : "Pausar"}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
