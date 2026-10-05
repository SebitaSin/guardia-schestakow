/** What counts as a duty roster vs clinical/billing mail. Client-safe, no secrets. */

const KEEP =
  /\bguardias?\b|\bcronograma\b|pase\s*guardia|parte\s+mes|parte\s+diario|parte\s+de\s+guardia/i;
const DROP =
  /factura|constancia|cumplimiento fiscal|manuales?\b|ambulatorio|prestaciones|atm\b|epicrisis|traslado de pte/i;

export type GuardiaMailHit = {
  id: string;
  date: string;
  from: string;
  subject: string;
  filename: string;
  messageId: string;
};

export type MailSyncState = {
  email: string;
  checkedAt: string;
  imap: "ok" | "auth_failed" | "unknown";
  gmailOauth: "ok" | "login_required" | "error" | "unknown";
  matches: GuardiaMailHit[];
  skipped: string[];
  note: string;
  errorMessage?: string | null;
  loginUrl?: string | null;
};

export function isGuardiaAttachment(subject: string, filename: string): boolean {
  const t = `${subject} ${filename}`;
  if (KEEP.test(t)) return true;
  if (DROP.test(t)) return false;
  return false;
}

export function emptySync(partial?: Partial<MailSyncState>): MailSyncState {
  return {
    email: "",
    checkedAt: "",
    imap: "unknown",
    gmailOauth: "unknown",
    matches: [],
    skipped: [],
    note: "",
    errorMessage: null,
    loginUrl: null,
    ...partial,
  };
}
