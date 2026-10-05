import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "./store.mjs";
import { staffDirectory } from "./staff-directory.mjs";
const labels = JSON.parse(readFileSync(new URL("../src/data/service-labels.json", import.meta.url), "utf8"));
const foldArea = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const aliases = new Map(Object.entries(labels).map(([key, value]) => [foldArea(key), value]));
const areaKey = (value) => foldArea(aliases.get(foldArea(value)) ?? value);

export function readStaffGroups(dataDir, secret) {
  const path = join(dataDir, "continuidad", "staff-groups.enc.json");
  if (!existsSync(path)) return [];
  const box = JSON.parse(readFileSync(path, "utf8"));
  const key = createHash("sha256").update(`staff-groups:${secret}`).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]).toString("utf8"));
  if (!Array.isArray(parsed)) throw new Error("group_store_invalid");
  return parsed;
}
function writeGroups(dataDir, secret, groups) {
  const key = createHash("sha256").update(`staff-groups:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(groups)), cipher.final()]);
  writeJsonAtomic(join(dataDir, "continuidad", "staff-groups.enc.json"), { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}
export function saveStaffGroup(dataDir, secret, input, actor) {
  const name = String(input.name ?? "").trim();
  const scope = String(input.scope ?? "MIXED");
  const service = scope === "SERVICE" ? String(input.service ?? "").trim() : "";
  if (!name || name.length > 100 || /[\r\n]/.test(name) || !["MIXED", "SERVICE"].includes(scope) || (scope === "SERVICE" && !service) || !Array.isArray(input.memberIds)) throw new Error("invalid_staff_group");
  const memberIds = [...new Set(input.memberIds)];
  if (!memberIds.length || memberIds.length > 2000) throw new Error("invalid_staff_group");
  const directory = new Map(staffDirectory(dataDir, secret).map((person) => [person.staffId, person]));
  if (memberIds.some((id) => !directory.has(id) || (scope === "SERVICE" && !String(directory.get(id).service || directory.get(id).role || "Sin servicio o tarea").split(",").some((area) => areaKey(area) === areaKey(service))))) throw new Error("invalid_staff_group_members");
  const groups = readStaffGroups(dataDir, secret);
  if (input.id && !groups.some((group) => group.id === input.id)) throw new Error("staff_group_not_found");
  const previous = groups.find((group) => group.id === input.id);
  const group = { id: previous?.id ?? randomUUID(), name, scope, service, memberIds, draft: previous?.draft ?? "", createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: actor };
  writeGroups(dataDir, secret, [...groups.filter((item) => item.id !== group.id), group]);
  return group;
}
export function saveGroupDraft(dataDir, secret, id, text, actor) {
  if (typeof text !== "string" || text.length > 4000) throw new Error("invalid_group_message");
  const groups = readStaffGroups(dataDir, secret);
  const group = groups.find((item) => item.id === id);
  if (!group) throw new Error("staff_group_not_found");
  group.draft = text; group.updatedAt = new Date().toISOString(); group.updatedBy = actor;
  writeGroups(dataDir, secret, groups);
  return group;
}
export function deleteStaffGroup(dataDir, secret, id) {
  const groups = readStaffGroups(dataDir, secret);
  const next = groups.filter((group) => group.id !== id);
  writeGroups(dataDir, secret, next);
  return next.length !== groups.length;
}
