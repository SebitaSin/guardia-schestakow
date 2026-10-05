import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch() {
    try {
      if (sessionStorage.getItem("schestakow-autoreload") === "1") return;
      sessionStorage.setItem("schestakow-autoreload", "1");
      window.setTimeout(() => window.location.reload(), 400);
    } catch {
      /* ignore */
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="font-display text-2xl font-medium">La app tuvo un error</h1>
        <p className="text-muted">
          Se reintentó solo. No se mandó ningún mail de error. Si sigue, avisá a quien esté de guardia.
        </p>
        <button
          type="button"
          className="flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-fg"
          onClick={() => {
            this.setState({ error: null });
            window.location.reload();
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }
}
