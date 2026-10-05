import { emptySync, type GuardiaMailHit, type MailSyncState } from "@/lib/gmail-guardia";

type MailApi = {
  status: {
    status: "complete" | "partial" | "failed" | "blocked" | "unknown";
    at: string | null;
    account: string;
  };
  pending: {
    id: string;
    messageId: string;
    filename: string;
    date: string;
    from: string;
    subject: string;
  }[];
  running: boolean;
};

async function readStatus(): Promise<MailApi> {
  const response = await fetch("/api/mail/status", { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`mail_status_${response.status}`);
  return response.json() as Promise<MailApi>;
}

export async function requestGmailSync() {
  const response = await fetch("/api/mail/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`mail_sync_${response.status}`);
}

export async function syncGmailGuardias(): Promise<MailSyncState> {
  const data = await readStatus();
  const matches: GuardiaMailHit[] = data.pending.map((item) => ({
    id: item.id,
    date: item.date || "",
    from: item.from || "",
    subject: item.subject || "",
    filename: item.filename || "archivo sin nombre",
    messageId: item.messageId || item.filename,
  }));
  const ok = data.status.status === "complete";
  return emptySync({
    email: data.status.account || "Cuenta hospitalaria",
    checkedAt: data.status.at || "",
    imap: ok ? "ok" : data.status.status === "blocked" ? "auth_failed" : "unknown",
    gmailOauth: ok ? "ok" : data.status.status === "blocked" || data.status.status === "failed" ? "error" : "unknown",
    matches,
    note: data.running
      ? "Sincronización en curso."
      : matches.length
        ? `${matches.length} adjunto(s) pendientes de confirmación humana.`
        : "Sin adjuntos nuevos pendientes.",
    errorMessage:
      data.status.status === "blocked"
        ? "Falta configurar la credencial IMAP server-only."
        : data.status.status === "failed"
          ? "La última sincronización falló. Revisar el estado del servidor."
          : null,
  });
}
