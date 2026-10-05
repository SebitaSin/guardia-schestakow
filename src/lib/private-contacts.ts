export type PrivateStaffContact = {
  staffId: string;
  name?: string;
  service?: string;
  email?: string;
  dni?: string;
  cuil?: string;
  role?: string;
  specialty?: string;
  mp?: string;
  sectors?: string;
  locality?: string;
  sourceConfidence?: string;
  sourceNote?: string;
  source?: string;
  notes?: string;
  transportMode?: string;
  address: string;
  phone: string;
  updatedAt: string;
  updatedBy: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, signal: AbortSignal.timeout(8_000), headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`${path}_${response.status}:${body.error ?? "error"}`);
  }
  return response.json() as Promise<T>;
}

export async function loadPrivateContacts() {
  return (await api<{ contacts: PrivateStaffContact[] }>("/api/continuidad/private-contacts")).contacts;
}

export function savePrivateContact(contact: Pick<PrivateStaffContact, "staffId" | "address" | "phone"> & Partial<PrivateStaffContact> & { verifyAddress?: boolean }) {
  return api<{ contact: PrivateStaffContact; location?: { address: string; lat: number; lng: number; transportMode: string } | null; locationStatus?: string }>("/api/continuidad/private-contacts", { method: "POST", body: JSON.stringify(contact) });
}

export function removePrivateContact(staffId: string) {
  return api<{ deleted: boolean }>("/api/continuidad/private-contacts", { method: "DELETE", body: JSON.stringify({ staffId }) });
}
