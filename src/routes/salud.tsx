import { createFileRoute } from "@tanstack/react-router";
import { allDocuments, catalog, dutiesOn, todayISO } from "@/data/catalog";
import { resumenHospital, formatParteFecha } from "@/data/internacion";
import { OPS } from "@/data/ops";

export const Route = createFileRoute("/salud")({ component: SaludPage });

function SaludPage() {
  const today = todayISO();
  const duties = dutiesOn(today).filter((d) => d.text.trim());
  const docs = allDocuments().length;
  const k = resumenHospital();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-medium">Estado</h1>
      <p className="text-lg font-medium text-ok">Operativa</p>
      <p className="text-sm text-muted">Usá siempre la dirección sin www.</p>
      <ul className="space-y-1 text-sm text-muted">
        <li>Parte: {formatParteFecha()}</li>
        <li>
          Camas {k.total} · ocupadas {k.ocupadas} · libres {k.libres}
        </li>
        <li>Cronogramas: {docs} · actualizado {catalog.generatedAt}</li>
        <li>Servicios con guardia hoy: {duties.length}</li>
        <li>
          Contacto humano: {OPS.email} · {OPS.phone}
        </li>
      </ul>
    </div>
  );
}
