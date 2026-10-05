import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { ContinuidadTabs } from "@/components/sch-board";
import { SchProvider } from "@/lib/sch-resilience/use-sch";

export const Route = createFileRoute("/continuidad")({
  component: ContinuidadLayout,
});

function ContinuidadLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = pathname.replace(/\/$/, "") || "/continuidad";
  const tab = current === "/continuidad" ? "/continuidad" : current;
  return (
    <SchProvider>
      <div className="space-y-4">
        <div className="sch-no-print">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Contingencia</p>
          <ContinuidadTabs current={tab} />
        </div>
        <Outlet />
      </div>
    </SchProvider>
  );
}
