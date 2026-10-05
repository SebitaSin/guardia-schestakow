import type { ErrorComponentProps } from "@tanstack/react-router";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-3 p-6">
      <h1 className="font-display text-2xl font-medium">La pantalla falló</h1>
      <p className="text-sm text-muted">
        El resto de la app sigue. No se mandó mail. Tocá reintentar.
      </p>
      <p className="break-words text-xs text-subtle">{error instanceof Error ? error.message : String(error)}</p>
      <button
        type="button"
        className="flex min-h-12 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-fg"
        onClick={() => window.location.reload()}
      >
        Reintentar
      </button>
    </main>
  );
}

export function AppNotFound() {
  return (
    <main className="mx-auto max-w-lg space-y-3 p-6">
      <h1 className="font-display text-2xl font-medium">No está esa pantalla</h1>
      <a href="/" className="inline-flex min-h-12 items-center text-primary">
        Ir a Guardias
      </a>
    </main>
  );
}
