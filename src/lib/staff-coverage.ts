import { whatsappNumber, type DirectoryPerson } from "./staff-directory";
import type { PrivateStaffLocation } from "./private-locations";

export type MissingField = "phone" | "address" | "point" | "transport" | "email" | "dni" | "service";
export const missingLabels: Record<MissingField, string> = {
  phone: "Teléfono completo para WhatsApp", address: "Domicilio completo", point: "Punto verificado en el mapa",
  transport: "Medio de transporte", email: "Correo electrónico", dni: "DNI", service: "Servicio o tarea",
};
const emptyValue = (value?: string) => !value?.trim() || /^(sin\s+(datos|domicilio|direccion|dirección|informacion|información)|s\/?d|no\s+informado|desconocido)$/i.test(value.trim());
export function hasPreciseAddress(value?: string) {
  // A locality alone is not a home. Numberless/rural references require review.
  if (emptyValue(value)) return false;
  const first = value!.split(",")[0].trim();
  return /\d/.test(first) && /[a-záéíóúüñ]/i.test(first) && !/^(san rafael|mendoza|argentina|ciudad)\b/i.test(first);
}
export function validMapPoint(point?: Pick<PrivateStaffLocation, "lat" | "lng" | "address">): point is PrivateStaffLocation {
  return Boolean(point && typeof point.lat === "number" && Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 && typeof point.lng === "number" && Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180 && point.address?.trim());
}
export function missingFields(person: DirectoryPerson, point?: PrivateStaffLocation): MissingField[] {
  const missing: MissingField[] = [];
  if (!whatsappNumber(person.phone ?? "")) missing.push("phone");
  if (!validMapPoint(point) && !hasPreciseAddress(person.address)) missing.push("address");
  if (!validMapPoint(point)) missing.push("point");
  const mode = point?.transportMode ?? person.transportMode;
  if (!mode || mode === "UNKNOWN") missing.push("transport");
  if (!person.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim())) missing.push("email");
  if (!person.dni || !/^\d{5,12}$/.test(person.dni.trim())) missing.push("dni");
  if (emptyValue(person.service) && emptyValue(person.role)) missing.push("service");
  return missing;
}
