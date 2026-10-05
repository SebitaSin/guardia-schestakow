import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useSch } from "@/lib/sch-resilience/use-sch";
import { availabilityLabel, transportLabel } from "@/lib/sch-resilience/format";
import pickups from "@/data/sch-resilience/pickups.json";
import { DEPARTMENTS } from "@/data/departments";
import { STAFF_INDEX } from "@/data/staff";
import type { StaffMark } from "@/lib/sch-resilience/staff-impact";
import type { AvailabilityStatus, DisasterSupportStatus, StaffOps, TransportStatus } from "@/lib/sch-resilience/types";

export const Route = createFileRoute("/continuidad/turno")({ component: TurnoPage });

const AVAILABILITY: AvailabilityStatus[] = ["UNKNOWN", "SCHEDULED_ONLY", "CAN_COVER_SHIFT", "CAN_SUPPORT_OTHER_SERVICE", "UNAVAILABLE"];
const ZONES = ["centro", "las_paredes", "cuadro_nacional", "rn143_sur", "rn144_oeste"];
const SUPPORT_AREAS = [
  ["guardia-triage", "Guardia y triage"],
  ["internacion", "Internación"],
  ["cuidados-criticos", "Cuidados críticos"],
  ["pediatria-neonatologia", "Pediatría y neonatología"],
  ["obstetricia", "Obstetricia"],
  ["quirofano", "Quirófano"],
  ["traslados-evacuacion", "Traslados y evacuación"],
  ["logistica-insumos", "Logística e insumos"],
  ["comunicaciones", "Comunicaciones"],
  ["administracion", "Administración"],
] as const;

type OperationalValues = Partial<StaffMark> & Partial<StaffOps>;
type MarkStaff = (id: string, patch: Partial<StaffMark>) => void;

function safeTransportValue(status: TransportStatus | undefined) {
  if (status === "NEEDS_TRANSPORT") return "NO";
  if (status === "SELF" || status === "CAN_DRIVE" || status === "ARRIVED") return "YES";
  return "UNKNOWN";
}

function boolValue(value: boolean | null | undefined) {
  return value === true ? "YES" : value === false ? "NO" : "UNKNOWN";
}

function TurnoPage() {
  const { snap, marks, markStaff, can, role, driverId } = useSch();
  const [query, setQuery] = useState("");
  const canCoordinate = ["COORDINATOR", "DIRECTION", "ADMIN"].includes(role);
  const markById = useMemo(() => new Map(marks.map((mark) => [mark.staff_id, mark])), [marks]);
  const searchResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    if (normalized.length < 2) return [];
    return STAFF_INDEX.filter((person) =>
      `${person.surname} ${person.name} ${person.serviceName}`.toLocaleLowerCase("es").includes(normalized),
    ).slice(0, 20);
  }, [query]);
  if (!snap) return <p className="text-sm text-muted">Sin snapshot.</p>;

  const people = role === "DRIVER" && driverId ? snap.staff.people.filter((person) => person.staff_id === driverId) : snap.staff.people;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Impacto del próximo turno</h2>
        <p className="mt-2 text-sm">
          Horizonte {snap.staff.horizon}. Confirmados {snap.staff.staff_confirmed}. UNKNOWN {snap.staff.staff_unknown}.
          Traslado {snap.staff.staff_needing_transport}. Cobertura ofrecida {snap.staff.coverage_available}. Apoyo a otros
          servicios {snap.staff.support_available}. Apoyo en catástrofe {snap.staff.disaster_support_available}. Mínimo Dirección: {snap.staff.staff_required ?? "SIN DATOS"}.
        </p>
        <p className="mt-2 text-sm text-muted">Sin respuesta no se interpreta como disponible. Ningún dato genera un despacho automático.</p>
        {snap.staff.critical_role_gaps.length ? (
          <ul className="mt-3 space-y-1 text-sm">
            {snap.staff.critical_role_gaps.map((gap) => <li key={gap.service}>{gap.service}: brecha {gap.gap}</li>)}
          </ul>
        ) : null}
      </section>

      <ul className="space-y-3">
        {people.length ? people.map((person) => {
          const own = !can.staff ? false : role === "DRIVER" || role === "STAFF" ? !driverId || person.staff_id === driverId : true;
          return (
            <li key={person.staff_id} className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
              <p className="font-medium">{person.name}</p>
              <p className="text-sm text-muted">
                {person.service} · {person.scheduled ? "turno programado" : "voluntario"} · {availabilityLabel(person.availability_status)} · {transportLabel(person.transport_status)}
              </p>
              {own && can.staff ? <OperationalForm id={person.staff_id} values={person} markStaff={markStaff} /> : null}
            </li>
          );
        }) : (
          <li className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-[var(--shadow-border)]">
            Nadie del cronograma matcheó con el plantel. Se conserva como SIN DATOS y no se inventa la lista.
          </li>
        )}
      </ul>

      {canCoordinate ? (
        <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Buscar personal para transporte, cobertura o catástrofe</h2>
          <p className="mt-1 text-sm text-muted">
            Vos o la directora registran la respuesta. No se guardan domicilios: el recorrido usa corredores y puntos públicos. Las capacidades declaradas requieren validación antes de una asignación.
          </p>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted">
            Nombre, apellido o servicio
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Escribí al menos 2 caracteres" className="mt-1 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm" />
          </label>
          <ul className="mt-3 space-y-3">
            {searchResults.map((person) => (
              <li key={person.id} className="rounded-xl border border-border p-3">
                <p className="font-medium">{person.surname}, {person.name}</p>
                <p className="text-sm text-muted">{person.serviceName}</p>
                <OperationalForm id={person.id} values={markById.get(person.id) ?? {}} markStaff={markStaff} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function OperationalForm({ id, values, markStaff }: { id: string; values: OperationalValues; markStaff: MarkStaff }) {
  const transport = values.transport_status ?? "UNKNOWN";
  const safeTransport = safeTransportValue(transport);
  const hasCar = boolValue(values.vehicle_available);
  const willingPickup = boolValue(values.can_transport_others);
  const availability = values.availability_status ?? "UNKNOWN";
  const disasterSupport = values.disaster_support_status ?? "UNKNOWN";
  const areas = values.disaster_support_areas ?? [];

  return (
    <div className="mt-3 space-y-3">
      <div className="grid gap-2 md:grid-cols-3">
        <SelectField label="¿Tiene un medio seguro para llegar?" value={safeTransport} onChange={(value) => {
          if (value === "NO") markStaff(id, { transport_status: "NEEDS_TRANSPORT", vehicle_available: false, can_transport_others: false });
          else if (value === "YES") markStaff(id, { transport_status: values.vehicle_available === true && values.can_transport_others === true ? "CAN_DRIVE" : "SELF" });
          else markStaff(id, { transport_status: "UNKNOWN", vehicle_available: null, can_transport_others: null });
        }} options={[["UNKNOWN", "SIN DATOS"], ["YES", "Sí"], ["NO", "No"]]} />

        {safeTransport === "YES" ? (
          <SelectField label="¿Tiene auto disponible?" value={hasCar} onChange={(value) => {
            if (value === "YES") markStaff(id, { vehicle_available: true });
            else if (value === "NO") markStaff(id, { vehicle_available: false, can_transport_others: false, transport_status: "SELF" });
            else markStaff(id, { vehicle_available: null, can_transport_others: null, transport_status: "SELF" });
          }} options={[["UNKNOWN", "SIN DATOS"], ["YES", "Sí"], ["NO", "No"]]} />
        ) : null}

        {safeTransport === "YES" && hasCar === "YES" ? (
          <SelectField label="¿Acepta buscar personas sin desviarse?" value={willingPickup} onChange={(value) => {
            if (value === "YES") markStaff(id, { can_transport_others: true, vehicle_available: true, transport_status: "CAN_DRIVE" });
            else markStaff(id, { can_transport_others: value === "NO" ? false : null, transport_status: "SELF" });
          }} options={[["UNKNOWN", "SIN DATOS"], ["YES", "Sí, sólo sobre su recorrido"], ["NO", "No"]]} />
        ) : null}

        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          Corredor de ingreso
          <select className="mt-1 h-11 w-full rounded-md border border-border bg-surface px-2 text-sm" value={values.operational_zone ?? ""} onChange={(event) => markStaff(id, { operational_zone: event.target.value || null })}>
            <option value="">SIN DATOS</option>
            {ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </label>

        {safeTransport === "NO" || (safeTransport === "YES" && hasCar === "YES" && willingPickup === "YES") ? (
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            {safeTransport === "NO" ? "Punto público donde espera" : "Punto público de inicio del corredor"}
            <select className="mt-1 h-11 w-full rounded-md border border-border bg-surface px-2 text-sm" value={values.preferred_pickup_point ?? values.pickup_id ?? ""} onChange={(event) => markStaff(id, { pickup_id: event.target.value || null })}>
              <option value="">SIN DATOS</option>
              {pickups.points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
            </select>
          </label>
        ) : null}

        {safeTransport === "YES" && hasCar === "YES" && willingPickup === "YES" ? (
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            Lugares disponibles
            <input type="number" min={1} max={8} className="mt-1 h-11 w-full rounded-md border border-border bg-surface px-2 text-sm" defaultValue={values.vehicle_capacity ?? 3} onBlur={(event) => {
              const capacity = Number(event.target.value);
              if (Number.isInteger(capacity) && capacity > 0 && capacity <= 8) markStaff(id, { vehicle_capacity: capacity });
            }} />
          </label>
        ) : null}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <SelectField label="Disponibilidad para cubrir o apoyar" value={availability} onChange={(value) => markStaff(id, { availability_status: value as AvailabilityStatus })} options={AVAILABILITY.map((status) => [status, availabilityLabel(status)])} />
        {availability === "CAN_SUPPORT_OTHER_SERVICE" ? (
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            Servicio al que puede apoyar
            <select className="mt-1 h-11 w-full rounded-md border border-border bg-surface px-2 text-sm" value={values.support_service ?? ""} onChange={(event) => markStaff(id, { support_service: event.target.value || null })}>
              <option value="">SIN DEFINIR</option>
              {DEPARTMENTS.map((department) => <option key={department.slug} value={department.slug}>{department.short}</option>)}
            </select>
          </label>
        ) : null}
        <SelectField label="¿Prestaría apoyo en una catástrofe?" value={disasterSupport} onChange={(value) => markStaff(id, { disaster_support_status: value as DisasterSupportStatus })} options={[["UNKNOWN", "SIN DATOS"], ["YES", "Sí"], ["NO", "No"]]} />
      </div>

      {disasterSupport === "YES" ? (
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Áreas en las que declara sentirse capacitado</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SUPPORT_AREAS.map(([area, label]) => (
              <label key={area} className="flex min-h-11 items-center gap-2 rounded-lg bg-bg px-3 text-sm">
                <input type="checkbox" checked={areas.includes(area)} onChange={(event) => {
                  const next = event.target.checked ? [...new Set([...areas, area])] : areas.filter((item) => item !== area);
                  markStaff(id, { disaster_support_areas: next });
                }} />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Es una declaración personal. La directora valida incumbencia, credenciales y tarea antes de asignar apoyo.</p>
        </fieldset>
      ) : null}
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-wide text-muted">
      {label}
      <select className="mt-1 h-11 w-full rounded-md border border-border bg-surface px-2 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}
