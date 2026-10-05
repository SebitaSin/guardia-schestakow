import { createFileRoute } from "@tanstack/react-router";
import { useSch } from "@/lib/sch-resilience/use-sch";

export const Route = createFileRoute("/continuidad/plan")({
  component: PlanPage,
});

function PlanPage() {
  const { planText, snap } = useSch();
  return (
    <div className="space-y-4">
      <div className="sch-no-print flex flex-wrap gap-2">
        <button type="button" className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg" onClick={() => window.print()}>
          Imprimir
        </button>
        <button
          type="button"
          className="h-11 rounded-lg bg-surface px-4 text-sm font-medium shadow-[var(--shadow-border)]"
          onClick={() => {
            const blob = new Blob([planText], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `plan-continuidad-${snap?.checked_at.slice(0, 10) ?? "sin-fecha"}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Descargar texto
        </button>
      </div>
      <pre className="overflow-auto whitespace-pre-wrap rounded-2xl bg-surface p-4 text-sm leading-relaxed shadow-[var(--shadow-border)]">
        {planText}
      </pre>
    </div>
  );
}
