import { useEffect } from "react";
import { syncIdentityMarks } from "@/lib/identidad";
import { syncCambios } from "@/lib/cambio-guardia";
import { startLive } from "@/lib/live-catalog";

function isChunkFail(msg: string) {
  return /Loading chunk|Failed to fetch dynamically imported module|ChunkLoadError|Importing a module script failed/i.test(
    msg,
  );
}

/** Sin cartel. Solo repara: www → dominio bueno, y recarga si un JS no carga. */
export function BootGuard() {
  useEffect(() => {
    void syncIdentityMarks();
    void syncCambios();
    const stopLive = startLive();
    const host = window.location.hostname;
    if (host.startsWith("www.")) {
      const bare = host.slice(4);
      window.location.replace(
        `https://${bare}${window.location.pathname}${window.location.search}`,
      );
      return;
    }

    const t = window.setTimeout(() => {
      try {
        sessionStorage.removeItem("schestakow-autoreload");
        sessionStorage.removeItem("schestakow-chunk");
      } catch {
        /* ignore */
      }
    }, 12000);

    const onError = (ev: ErrorEvent) => {
      if (!isChunkFail(String(ev.message))) return;
      try {
        if (sessionStorage.getItem("schestakow-chunk") === "1") return;
        sessionStorage.setItem("schestakow-chunk", "1");
      } catch {
        return;
      }
      window.location.reload();
    };
    const onRej = (ev: PromiseRejectionEvent) => {
      if (!isChunkFail(String(ev.reason))) return;
      onError({ message: String(ev.reason) } as ErrorEvent);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      stopLive();
      window.clearTimeout(t);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  return null;
}
