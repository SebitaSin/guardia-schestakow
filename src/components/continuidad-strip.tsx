import { Link } from "@tanstack/react-router";
import { Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { loadSnapshot, subscribeSch } from "@/lib/sch-resilience/snapshot";
import type { Snapshot, SystemState } from "@/lib/sch-resilience/types";
import { cn } from "@/lib/utils";

const LABEL: Record<SystemState, string> = {
  NORMAL: "Normal",
  WATCH: "Vigilancia",
  PREPARE: "Preparar",
  EMERGENCY: "Emergencia",
  RECOVERY: "Recuperación",
};

function tone(state: SystemState | undefined) {
  if (state === "EMERGENCY" || state === "PREPARE") return "danger";
  if (state === "WATCH") return "warn";
  if (state === "RECOVERY") return "warn";
  return "ok";
}

export function ContinuidadStrip() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    const read = () => setSnap(loadSnapshot());
    read();
    return subscribeSch(read);
  }, []);
  const t = tone(snap?.system_state);
  return (
    <Link
      to="/continuidad"
      className="flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]"
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          t === "danger" && "bg-danger-soft text-danger",
          t === "warn" && "bg-warn-soft text-warn",
          t === "ok" && "bg-primary-soft text-primary",
        )}
      >
        <Shield className="size-5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Contingencia</span>
        <span className="block truncate text-sm text-muted">
          {snap
            ? `${LABEL[snap.system_state]} · riesgo ${snap.risk.R} ${snap.risk.band}${snap.shadow_mode ? " · sombra" : ""}`
            : "Clima, acceso y transporte del próximo turno"}
        </span>
      </span>
      <span className="shrink-0 text-sm font-medium text-primary">Abrir</span>
    </Link>
  );
}

export function ContinuidadChip() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    const read = () => setSnap(loadSnapshot());
    read();
    return subscribeSch(read);
  }, []);
  const hot =
    snap?.system_state === "WATCH" ||
    snap?.system_state === "PREPARE" ||
    snap?.system_state === "EMERGENCY" ||
    snap?.system_state === "RECOVERY" ||
    snap?.degraded;
  if (!hot || !snap) return null;
  const t = tone(snap.system_state);
  return (
    <Link
      to="/continuidad"
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold uppercase tracking-wide",
        t === "danger" && "bg-danger-soft text-danger",
        t === "warn" && "bg-warn-soft text-warn",
        t === "ok" && "bg-primary-soft text-primary",
      )}
    >
      <Shield className="size-3.5" strokeWidth={2} />
      {LABEL[snap.system_state]}
    </Link>
  );
}
