import type { ClosureState, Role } from "@/lib/sch-resilience/types";
import type { ClosurePatch } from "@/lib/sch-resilience/roads";
import type { StaffMark } from "@/lib/sch-resilience/staff-impact";

export type OperationalControl = {
  emergency: boolean;
  minima: Record<string, number | null>;
  closures: ClosurePatch[];
  staffMarks: StaffMark[];
  role: Role;
  staffId: string | null;
};

const FAIL_CLOSED: OperationalControl = {
  emergency: false,
  minima: {},
  closures: [],
  staffMarks: [],
  role: "VIEWER",
  staffId: null,
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, signal: AbortSignal.timeout(8_000), headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`operational_api_${response.status}`);
  return response.json() as Promise<T>;
}

export async function loadOperationalControl(): Promise<{ control: OperationalControl; connected: boolean }> {
  try {
    return { control: await request<OperationalControl>("/api/continuidad/control"), connected: true };
  } catch {
    return { control: structuredClone(FAIL_CLOSED), connected: false };
  }
}

export function setOperationalEmergency(on: boolean, reason: string) {
  return request<OperationalControl>("/api/continuidad/emergency", { method: "POST", body: JSON.stringify({ on, reason }) });
}

export function setOperationalMinimum(service: string, value: number | null) {
  return request<OperationalControl>("/api/continuidad/minima", { method: "POST", body: JSON.stringify({ service, value }) });
}

export function setOperationalClosure(edgeId: string, closureState: ClosureState) {
  return request<OperationalControl>("/api/continuidad/closure", { method: "POST", body: JSON.stringify({ edgeId, closureState }) });
}

export function setOperationalStaff(staffId: string, patch: Partial<StaffMark>) {
  return request<OperationalControl>("/api/continuidad/staff", { method: "POST", body: JSON.stringify({ staffId, patch }) });
}

export function reviewOperationalRoute(routeId: string) {
  return request<{ ok: true }>("/api/continuidad/review", { method: "POST", body: JSON.stringify({ routeId }) });
}
