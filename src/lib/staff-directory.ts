import type { PrivateStaffContact } from "./private-contacts";
import { DEPARTMENTS } from "@/data/departments";
import labels from "@/data/service-labels.json";

export type DirectoryPerson = PrivateStaffContact;
export type MessagingContact = Pick<DirectoryPerson, "staffId" | "phone"> & Pick<DirectoryPerson, "name" | "service" | "role">;
export type StaffGroup = { id: string; name: string; scope: "SERVICE" | "MIXED"; service: string; memberIds: string[]; draft: string; updatedAt: string };
export const transportLabels: Record<string, string> = { UNKNOWN: "Sin datos", CAR: "Auto", PUBLIC_TRANSPORT: "Colectivo", BICYCLE: "Bicicleta", MOTORCYCLE: "Moto", WALKING: "A pie", OTHER: "Otro" };
const departmentLabels = new Map(DEPARTMENTS.map((department) => [department.slug, department.name]));
export const serviceLabel = (value: string) => departmentLabels.get(value) ?? areaLabel(value);
export const searchKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const foldArea = (value: string) => searchKey(value).replace(/\s+/g, " ").trim();
const areaAliases = new Map(Object.entries(labels).map(([key, value]) => [foldArea(key), value]));
export const areaKey = (value: string) => foldArea(areaAliases.get(foldArea(value)) ?? value);
const canonicalLabels = new Map(Object.values(labels).map((label) => [areaKey(label), label]));
export const areaLabel = (value: string) => canonicalLabels.get(areaKey(value)) ?? value;
export function personAreas(person: Pick<DirectoryPerson, "service" | "role">): string[] {
  const raw = person.service?.trim() || person.role?.trim() || "Sin servicio o tarea";
  return [...new Map(raw.split(",").map((part) => part.trim()).filter(Boolean).map((part) => [areaKey(part), areaLabel(part)])).values()];
}
export function worksInArea(person: Pick<DirectoryPerson, "service" | "role">, area: string) {
  return personAreas(person).some((part) => areaKey(part) === areaKey(area));
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, signal: AbortSignal.timeout(15_000), headers: { "content-type": "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP_${res.status}`);
  return body;
}
export const loadDirectory = async () => (await api<{ people: DirectoryPerson[] }>("/api/personal/directory")).people;
export const loadMessagingDirectory = async () => (await api<{ people: MessagingContact[] }>("/api/personal/messaging-directory")).people;
export const loadGroups = async () => (await api<{ groups: StaffGroup[] }>("/api/personal/groups")).groups;
export const saveGroup = async (group: { id?: string; name: string; scope: string; service: string; memberIds: string[] }) => (await api<{ group: StaffGroup }>("/api/personal/groups", { method: "POST", body: JSON.stringify(group) })).group;
export const removeGroup = (id: string) => api("/api/personal/groups", { method: "DELETE", body: JSON.stringify({ id }) });
export const saveGroupMessage = async (id: string, text: string) => (await api<{ group: StaffGroup }>("/api/personal/groups", { method: "PATCH", body: JSON.stringify({ id, text }) })).group;

export function whatsappNumber(phone: string) {
  if (/[^\d\s+().-]/.test(phone)) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (/^26015\d{7}$/.test(digits)) digits = `260${digits.slice(5)}`;
  if (/^\d{10}$/.test(digits)) return `549${digits}`;
  if (/^54\d{10}$/.test(digits)) return `549${digits.slice(2)}`;
  if (/^549\d{10}$/.test(digits)) return digits;
  if (phone.trim().startsWith("+") && /^[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}
export function whatsappLink(person: DirectoryPerson, text = "") {
  const number = whatsappNumber(person.phone);
  return number ? `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}` : null;
}
function vcardValue(value: string) { return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`); }
export function downloadContacts(people: DirectoryPerson[], fileName: string) {
  const cards = people.filter((person) => whatsappNumber(person.phone)).map((person) => ["BEGIN:VCARD", "VERSION:3.0", `FN:${vcardValue(person.name ?? person.staffId)}`, `ORG:Hospital Schestakow;${vcardValue(serviceLabel(person.service ?? ""))}`, `TEL;TYPE=CELL:+${whatsappNumber(person.phone)}`, ...(person.email ? [`EMAIL:${vcardValue(person.email)}`] : []), "END:VCARD"].join("\r\n")).join("\r\n");
  if (!cards) throw new Error("Sin teléfonos completos para descargar.");
  const url = URL.createObjectURL(new Blob([cards], { type: "text/vcard;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = fileName; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
