import { Camera } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function ParteInbox() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("Las imágenes quedan privadas y A CONFIRMAR.");

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let saved = 0; let duplicates = 0; let failed = 0;
    for (const file of [...files]) {
      if (!file.type.startsWith("image/")) { failed += 1; continue; }
      try {
        const response = await fetch("/api/capture/upload", {
          method: "POST", headers: { "content-type": file.type, "x-file-name": encodeURIComponent(file.name) }, body: file,
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error("upload");
        const result = (await response.json()) as { duplicate?: boolean };
        if (result.duplicate) duplicates += 1; else saved += 1;
      } catch { failed += 1; }
    }
    setNote(`${saved} guardada(s) · ${duplicates} repetida(s)${failed ? ` · ${failed} con error` : ""}. Ningún dato fue publicado.`);
    setBusy(false);
  }

  return <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Parte de hoy</h2>
    <p className="mt-2 text-sm leading-relaxed text-muted">Subí fotos del pizarrón para revisión por Coordinación. El original se conserva en el servidor privado.</p>
    <label className={cn("mt-3 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-fg", busy && "opacity-60")}>
      <Camera className="size-4" />{busy ? "Guardando…" : "Subir fotos del pizarrón"}
      <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="sr-only" disabled={busy} onChange={(event) => { void onFiles(event.target.files); event.target.value = ""; }} />
    </label>
    <p role="status" className="mt-2 text-sm text-muted">{note}</p>
  </section>;
}
