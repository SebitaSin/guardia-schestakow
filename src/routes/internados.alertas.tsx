import { createFileRoute } from "@tanstack/react-router";
import { alertasActivas } from "@/data/internacion";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/internados/alertas")({ component: AlertasPage });

function AlertasPage() {
  const alertas = alertasActivas();
  return (
    <ul className="space-y-3">
      {alertas.map((a) => (
        <li key={a.title} className="flex gap-3 rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <span
            className={cn(
              "mt-1 size-2.5 shrink-0 rounded-full",
              a.tone === "danger" && "bg-danger",
              a.tone === "warn" && "bg-warn",
              a.tone === "ok" && "bg-primary",
            )}
          />
          <span>
            <span className="block font-medium">{a.title}</span>
            <span className="block text-sm text-muted">{a.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
