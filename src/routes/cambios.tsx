import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aplicarPermuta, loadCambios, syncCambios } from "@/lib/cambio-guardia";
import { useCatalogTick } from "@/lib/use-catalog";
import { DEPARTMENTS } from "@/data/departments";

export const Route = createFileRoute("/cambios")({ component: CambiosPage });

function CambiosPage() {
  useCatalogTick();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [diaA, setDiaA] = useState("3");
  const [diaB, setDiaB] = useState("4");
  const [slug, setSlug] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const items = loadCambios();

  useEffect(() => { void syncCambios(); }, []);

  async function apply() {
    setBusy(true);
    const r = await aplicarPermuta({
      a,
      b,
      diaA: Number(diaA),
      diaB: Number(diaB),
      slug: slug || undefined,
      fuente: "interfaz",
    });
    setMsg(r.ok ? `Registrado: ${r.cambio.dateA} ${r.cambio.afterA} · ${r.cambio.dateB} ${r.cambio.afterB}` : r.error);
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.6rem] font-semibold tracking-tight">Cambios de cronograma</h1>
        <p className="mt-1 text-sm text-muted">
          Mail o formulario. Se verifica que cada uno esté en su día y se permutan. Si no cierra, no se toca.
        </p>
      </header>

      <section className="space-y-2 rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <Input value={a} onChange={(e) => setA(e.target.value)} placeholder="Quién cede (ej. Dulong)" />
        <Input value={diaA} onChange={(e) => setDiaA(e.target.value)} placeholder="Día que tiene" inputMode="numeric" />
        <Input value={b} onChange={(e) => setB(e.target.value)} placeholder="Con quién cambia (ej. Centeno)" />
        <Input value={diaB} onChange={(e) => setDiaB(e.target.value)} placeholder="Día del otro" inputMode="numeric" />
        <select
          className="min-h-11 w-full rounded-lg bg-canvas px-3 text-sm"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        >
          <option value="">Servicio (si se sabe)</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
        <Button type="button" onClick={() => void apply()} disabled={busy || !a.trim() || !b.trim()}>
          {busy ? "Verificando…" : "Registrar permuta"}
        </Button>
        {msg ? <p className="text-sm">{msg}</p> : null}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Hechos</h2>
        {items.length ? (
          <ul className="space-y-2">
            {items.map((c) => (
              <li key={c.id} className="rounded-xl bg-surface px-4 py-3 text-sm shadow-[var(--shadow-border)]">
                <p className="font-medium">
                  {c.a} {c.dateA} ↔ {c.b} {c.dateB}
                </p>
                <p className="text-muted">
                  {c.beforeA} → {c.afterA}
                </p>
                <p className="text-muted">
                  {c.beforeB} → {c.afterB}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Todavía no hay permutas aplicadas.</p>
        )}
      </section>
    </div>
  );
}
