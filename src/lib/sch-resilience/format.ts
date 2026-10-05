const TZ = "America/Argentina/Mendoza";

export function fmtHora(iso: string | null | undefined) {
  if (!iso) return "SIN DATOS";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "SIN DATOS";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(t));
}

export function estadoLabel(s: string) {
  if (s === "NORMAL") return "NORMAL";
  if (s === "WATCH") return "VIGILANCIA";
  if (s === "PREPARE") return "PREPARAR";
  if (s === "EMERGENCY") return "EMERGENCIA";
  if (s === "RECOVERY") return "RECUPERACIÓN";
  return s;
}

export function transportLabel(s: string) {
  if (s === "UNKNOWN") return "SIN DATOS";
  if (s === "SELF") return "Llega por sus medios";
  if (s === "NEEDS_TRANSPORT") return "Necesita traslado";
  if (s === "CAN_DRIVE") return "Puede conducir";
  if (s === "UNAVAILABLE") return "No disponible";
  if (s === "ARRIVED") return "En el hospital";
  return s;
}

export function availabilityLabel(s: string) {
  if (s === "UNKNOWN") return "Sin respuesta";
  if (s === "SCHEDULED_ONLY") return "Sólo su turno programado";
  if (s === "CAN_COVER_SHIFT") return "Puede cubrir otro turno";
  if (s === "CAN_SUPPORT_OTHER_SERVICE") return "Puede apoyar otro servicio";
  if (s === "UNAVAILABLE") return "No disponible";
  return s;
}

export function closureLabel(s: string) {
  if (s === "OPEN") return "ABIERTA";
  if (s === "CLOSED") return "CERRADA";
  if (s === "RESTRICTED") return "RESTRINGIDA";
  return "DESCONOCIDA";
}

export function healthLabel(s: string) {
  if (s === "OK") return "OK";
  if (s === "STALE") return "VENCIDO";
  if (s === "FAILED") return "FALLÓ";
  if (s === "DEGRADED") return "DEGRADADO";
  return s;
}
