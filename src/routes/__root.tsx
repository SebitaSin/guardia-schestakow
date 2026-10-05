import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppErrorBoundary } from "@/components/error-boundary";
import { BootGuard } from "@/components/boot-guard";
import { AppErrorComponent, AppNotFound } from "@/lib/error-component";
import { Shell } from "@/components/shell";

export const Route = createRootRoute({
  errorComponent: AppErrorComponent,
  notFoundComponent: AppNotFound,
  component: () => (
    <>
      <BootGuard />
      <AppErrorBoundary>
        <Shell>
          <Outlet />
        </Shell>
      </AppErrorBoundary>
    </>
  ),
});
