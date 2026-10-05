import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

function filePath(dataDir) {
  return join(dataDir, "continuidad", "private-staff-contacts.enc.json");
}

function keyFrom(secret) {
  if (String(secret ?? "").length < 32) throw new Error("contact_secret_invalid");
  return createHash("sha256").update(`schestakow-private-staff-contacts:${secret}`).digest();
}

export function readPrivateContacts(dataDir, secret) {
  const path = filePath(dataDir);
  if (!existsSync(path)) return [];
  const box = JSON.parse(readFileSync(path, "utf8"));
  if (box?.version !== 1) throw new Error("contact_store_invalid");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]);
  const parsed = JSON.parse(plain.toString("utf8"));
  if (!Array.isArray(parsed)) throw new Error("contact_store_invalid");
  return parsed;
}

export function writePrivateContacts(dataDir, secret, contacts) {
  const path = filePath(dataDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(contacts), "utf8"), cipher.final()]);
  const box = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(box), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

export function validatePrivateContact(input, actor) {
  const staffId = String(input?.staffId ?? "").trim();
  const name = String(input?.name ?? "").trim();
  const service = String(input?.service ?? "").trim();
  const address = String(input?.address ?? "").trim();
  const phone = String(input?.phone ?? "").trim();
  if (!/^[a-z0-9áéíóúüñ._-]{3,180}$/i.test(staffId)) throw new Error("invalid_private_contact");
  if (name.length > 160 || service.length > 120 || address.length > 240 || phone.length > 160 || /[\r\n]/.test(name) || /[\r\n]/.test(service) || /[\r\n]/.test(address) || /[\r\n]/.test(phone) || ((!address && !phone) && (!name || !service))) throw new Error("invalid_private_contact");
  const extra = {};
  for (const field of ["email", "dni", "role", "specialty", "notes", "transportMode"]) {
    if (input[field] === undefined) continue;
    const value = String(input[field]).trim();
    if (value.length > (field === "notes" ? 1000 : 254) || (field !== "notes" && /[\r\n]/.test(value))) throw new Error("invalid_private_contact");
    if (field === "dni" && value && !/^\d{5,12}$/.test(value)) throw new Error("invalid_private_contact");
    if (field === "transportMode" && !["CAR", "MOTORCYCLE", "BICYCLE", "PUBLIC_TRANSPORT", "WALKING", "OTHER", "UNKNOWN"].includes(value)) throw new Error("invalid_private_contact");
    extra[field] = value;
  }
  return { staffId, ...(name ? { name } : {}), ...(service ? { service } : {}), address, phone, ...extra, updatedAt: new Date().toISOString(), updatedBy: actor };
}

export function upsertPrivateContact(dataDir, secret, input, actor) {
  const stored = readPrivateContacts(dataDir, secret);
  const previous = stored.find((item) => item.staffId === input.staffId);
  if (previous?.name && input.name !== undefined && String(input.name).trim() !== previous.name) throw new Error("staff_name_locked");
  const merged = { ...previous, ...input };
  const contact = { ...previous, ...validatePrivateContact(merged, actor) };
  const all = stored.filter((item) => item.staffId !== contact.staffId);
  all.push(contact);
  writePrivateContacts(dataDir, secret, all);
  return contact;
}

export function deletePrivateContact(dataDir, secret, staffId) {
  const id = String(staffId ?? "").trim();
  const all = readPrivateContacts(dataDir, secret);
  const next = all.filter((item) => item.staffId !== id);
  writePrivateContacts(dataDir, secret, next);
  return next.length !== all.length;
}
