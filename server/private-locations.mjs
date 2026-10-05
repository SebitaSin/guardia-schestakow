import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

const MODES = new Set(["CAR", "MOTORCYCLE", "BICYCLE", "PUBLIC_TRANSPORT", "WALKING", "OTHER", "UNKNOWN"]);

function filePath(dataDir) {
  return join(dataDir, "continuidad", "private-staff-locations.enc.json");
}

function keyFrom(secret) {
  if (String(secret ?? "").length < 32) throw new Error("location_secret_invalid");
  return createHash("sha256").update(`schestakow-private-locations:${secret}`).digest();
}

export function readPrivateLocations(dataDir, secret) {
  const path = filePath(dataDir);
  if (!existsSync(path)) return [];
  const box = JSON.parse(readFileSync(path, "utf8"));
  if (box?.version !== 1) throw new Error("location_store_invalid");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(box.data, "base64")), decipher.final()]);
  const parsed = JSON.parse(plain.toString("utf8"));
  if (!Array.isArray(parsed)) throw new Error("location_store_invalid");
  return parsed;
}

export function writePrivateLocations(dataDir, secret, locations) {
  const path = filePath(dataDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(locations), "utf8"), cipher.final()]);
  const box = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(box), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

export function validatePrivateLocation(input, actor) {
  const staffId = String(input?.staffId ?? "");
  const address = String(input?.address ?? "").trim();
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  const transportMode = String(input?.transportMode ?? "UNKNOWN");
  if (!/^[a-z0-9áéíóúüñ._-]{3,180}$/i.test(staffId)) throw new Error("invalid_private_location");
  if (address.length < 5 || address.length > 240 || /[\r\n]/.test(address)) throw new Error("invalid_private_location");
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error("invalid_private_location");
  if (!MODES.has(transportMode)) throw new Error("invalid_private_location");
  return { staffId, address, lat, lng, transportMode, updatedAt: new Date().toISOString(), updatedBy: actor };
}

export function upsertPrivateLocation(dataDir, secret, input, actor) {
  const location = validatePrivateLocation(input, actor);
  const all = readPrivateLocations(dataDir, secret).filter((item) => item.staffId !== location.staffId);
  all.push(location);
  writePrivateLocations(dataDir, secret, all);
  return location;
}

export function deletePrivateLocation(dataDir, secret, staffId) {
  const id = String(staffId ?? "");
  const all = readPrivateLocations(dataDir, secret);
  const next = all.filter((item) => item.staffId !== id);
  writePrivateLocations(dataDir, secret, next);
  return next.length !== all.length;
}

