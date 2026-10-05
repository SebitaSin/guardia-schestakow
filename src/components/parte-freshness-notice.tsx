import { PARTE_FECHA, formatParteFecha } from "@/data/internacion";
import { todayISO } from "@/data/catalog";

function ageInDays() {
  const today = Date.parse(`${todayISO()}T12:00:00`);
  const source = Date.parse(`${PARTE_FECHA}T12:00:00`);
  if (!Number.isFinite(today) || !Number.isFinite(source)) return null;
  return Math.max(0, Math.floor((today - source) / 86_400_000));
}

export function ParteFreshnessNotice() {
  const days = ageInDays();
  if (days === null || days <= 1) return null;

  return (
    <aside role="alert" className="rounded-xl border border-danger/50 bg-danger/10 p-3 text-sm">
      <p className="font-semibold">Parte de internación histórico · {days} días</p>
      <p className="mt-1">
        Fuente del {formatParteFecha()}. Estas camas y pacientes no representan la ocupación actual. Confirmá un parte nuevo antes de usarlos para decisiones operativas.
      </p>
    </aside>
  );
}
