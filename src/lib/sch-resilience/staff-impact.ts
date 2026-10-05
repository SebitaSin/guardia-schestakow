import crit from "@/data/sch-resilience/service-criticality.json";
import { DEPARTMENTS } from "@/data/departments";
import { staffFor, personById, personId } from "@/data/staff";
import { dutiesOn } from "@/data/catalog";
import type { AvailabilityStatus, DisasterSupportStatus, StaffImpact, StaffOps, TransportStatus } from "./types";

export type StaffMark = {
  staff_id: string;
  transport_status?: TransportStatus;
  operational_zone?: string | null;
  pickup_id?: string | null;
  vehicle_available?: boolean | null;
  vehicle_capacity?: number | null;
  can_transport_others?: boolean | null;
  availability_status?: AvailabilityStatus;
  support_service?: string | null;
  disaster_support_status?: DisasterSupportStatus;
  disaster_support_areas?: string[];
  updated_at?: string | null;
  source?: string;
};

const SURNAME_RE = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}/g;

function namesFromDuty(text: string) {
  return (text.match(SURNAME_RE) ?? []).map((s) => s.toUpperCase());
}

export function buildStaffImpact(opts: {
  dateIso: string;
  marks?: StaffMark[];
  highRiskZones?: string[];
  minima?: Record<string, number | null>;
}): StaffImpact {
  const marks = new Map((opts.marks ?? []).map((m) => [m.staff_id, m]));
  const people: StaffOps[] = [];
  const scheduledIds = new Set<string>();
  for (const hit of dutiesOn(opts.dateIso)) {
    const roster = staffFor(hit.dept.slug);
    const tokens = namesFromDuty(hit.text);
    const matched = roster.filter((p) => tokens.some((t) => p.surname.toUpperCase() === t || p.name.toUpperCase().includes(t)));
    const use = matched.length ? matched : [];
    for (const p of use) {
      const id = personId(hit.dept.slug, p.surname);
      const m = marks.get(id);
      scheduledIds.add(id);
      people.push({
        staff_id: id,
        name: `${p.surname}, ${p.name}`,
        service: hit.dept.slug,
        shift_date: opts.dateIso,
        criticality: null,
        operational_zone: m?.operational_zone ?? null,
        preferred_pickup_point: m?.pickup_id ?? null,
        transport_status: m?.transport_status ?? "UNKNOWN",
        vehicle_available: m?.vehicle_available ?? null,
        vehicle_capacity: m?.vehicle_capacity ?? null,
        can_transport_others: m?.can_transport_others ?? null,
        availability_timestamp: m?.updated_at ?? null,
        availability_status: m?.availability_status ?? "SCHEDULED_ONLY",
        support_service: m?.support_service ?? null,
        disaster_support_status: m?.disaster_support_status ?? "UNKNOWN",
        disaster_support_areas: m?.disaster_support_areas ?? [],
        scheduled: true,
      });
    }
  }
  for (const [id, m] of marks) {
    if (scheduledIds.has(id) || (!["CAN_COVER_SHIFT", "CAN_SUPPORT_OTHER_SERVICE"].includes(m.availability_status ?? "UNKNOWN") && m.disaster_support_status !== "YES")) continue;
    const found = personById(id);
    if (!found) continue;
    people.push({
      staff_id: id,
      name: `${found.person.surname}, ${found.person.name}`,
      service: found.slug,
      shift_date: null,
      criticality: null,
      operational_zone: m.operational_zone ?? null,
      preferred_pickup_point: m.pickup_id ?? null,
      transport_status: m.transport_status ?? "UNKNOWN",
      vehicle_available: m.vehicle_available ?? null,
      vehicle_capacity: m.vehicle_capacity ?? null,
      can_transport_others: m.can_transport_others ?? null,
      availability_timestamp: m.updated_at ?? null,
      availability_status: m.availability_status ?? "UNKNOWN",
      support_service: m.support_service ?? null,
      disaster_support_status: m.disaster_support_status ?? "UNKNOWN",
      disaster_support_areas: m.disaster_support_areas ?? [],
      scheduled: false,
    });
  }
  const scheduledPeople = people.filter((p) => p.scheduled);
  const staff_unknown = scheduledPeople.filter((p) => p.transport_status === "UNKNOWN" && p.availability_status !== "UNAVAILABLE").length;
  const staff_confirmed = scheduledPeople.filter((p) => (p.transport_status === "SELF" || p.transport_status === "ARRIVED" || p.transport_status === "CAN_DRIVE") && p.availability_status !== "UNAVAILABLE").length;
  const staff_needing_transport = people.filter((p) => p.transport_status === "NEEDS_TRANSPORT").length;
  const coverage_available = people.filter((p) => p.availability_status === "CAN_COVER_SHIFT").length;
  const support_available = people.filter((p) => p.availability_status === "CAN_SUPPORT_OTHER_SERVICE").length;
  const disaster_support_available = people.filter((p) => p.disaster_support_status === "YES").length;
  const high = new Set(opts.highRiskZones ?? []);
  const staff_at_risk = people.filter((p) => p.operational_zone && high.has(p.operational_zone)).length;
  const gaps: StaffImpact["critical_role_gaps"] = [];
  const bySvc = new Map<string, StaffOps[]>();
  for (const p of people) {
    const list = bySvc.get(p.service) ?? [];
    list.push(p);
    bySvc.set(p.service, list);
  }
  const services = crit.services as Record<string, { minimum_staff_required: number | null }>;
  for (const d of DEPARTMENTS) {
    const configured = opts.minima && d.slug in opts.minima ? opts.minima[d.slug] : services[d.slug]?.minimum_staff_required;
    if (configured == null) continue;
    const have = (bySvc.get(d.slug) ?? []).filter((p) => p.scheduled && p.transport_status !== "UNAVAILABLE" && p.availability_status !== "UNAVAILABLE").length;
    const gap = configured - have;
    if (gap > 0) gaps.push({ service: d.slug, gap });
  }
  const requiredValues = DEPARTMENTS.map((d) =>
    opts.minima && d.slug in opts.minima ? opts.minima[d.slug] : services[d.slug]?.minimum_staff_required,
  );
  const requiredSet = requiredValues.some((v) => v != null);
  return {
    horizon: opts.dateIso,
    staff_required: requiredSet ? requiredValues.reduce<number>((a, s) => a + (s ?? 0), 0) : null,
    staff_confirmed,
    staff_unknown,
    staff_at_risk,
    staff_needing_transport,
    coverage_available,
    support_available,
    disaster_support_available,
    critical_role_gaps: gaps.length
      ? gaps
      : requiredSet
        ? []
        : [{ service: "*", gap: "UNKNOWN" }],
    people,
  };
}
