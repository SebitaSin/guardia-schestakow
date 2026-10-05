import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cancelSchedule, createSchedule, processDueSchedules, readSchedules } from "./whatsapp-schedules.mjs";
import { readOutbox } from "./whatsapp-send.mjs";

const secret = "whatsapp-schedule-test-secret-with-enough-entropy";
function sandbox(t) { const dir = mkdtempSync(join(tmpdir(), "sch-schedule-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }

test("programming persists encrypted and due occurrence becomes a draft, never an automatic send", (t) => {
  const dir = sandbox(t), now = Date.UTC(2026, 8, 30, 12, 0);
  const schedule = createSchedule(dir, secret, { recipients: ["2604056998"], body: "Aviso de prueba", motivo: "Prueba programador", firstAt: new Date(now + 60_000).toISOString(), recurrence: "DAILY" }, "direction", now);
  assert.equal(schedule.recipientCount, 1);
  assert.equal(readSchedules(dir, secret)[0].active, true);
  assert.equal(processDueSchedules(dir, secret, now + 60_001), 1);
  const outbox = readOutbox(dir, secret);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].estado, "BORRADOR");
  assert.equal(readSchedules(dir, secret)[0].active, true);
  assert.ok(Date.parse(readSchedules(dir, secret)[0].nextAt) > now + 60_001);
  assert.equal(processDueSchedules(dir, secret, now + 60_002), 0);
});

test("schedule rejects invalid, duplicate-only, too-large and non-future recipient requests", (t) => {
  const dir = sandbox(t), now = Date.UTC(2026, 8, 30, 12, 0);
  const base = { recipients: ["invalid"], body: "Aviso", motivo: "Prueba", firstAt: new Date(now + 60_000).toISOString(), recurrence: "ONCE" };
  assert.throws(() => createSchedule(dir, secret, base, "direction", now), /invalid_schedule/);
  assert.throws(() => createSchedule(dir, secret, { ...base, recipients: ["2604056998"], firstAt: new Date(now).toISOString() }, "direction", now), /invalid_schedule/);
  assert.throws(() => createSchedule(dir, secret, { ...base, recipients: Array.from({ length: 26 }, (_, i) => `260405${String(6998 + i).padStart(4, "0")}`) }, "direction", now), /invalid_schedule/);
});

test("cancelled schedules do not materialize drafts", (t) => {
  const dir = sandbox(t), now = Date.UTC(2026, 8, 30, 12, 0);
  const item = createSchedule(dir, secret, { recipients: ["2604056998"], body: "Aviso", motivo: "Prueba", firstAt: new Date(now + 60_000).toISOString(), recurrence: "ONCE" }, "direction", now);
  assert.equal(cancelSchedule(dir, secret, item.id), true);
  assert.equal(processDueSchedules(dir, secret, now + 61_000), 0);
  assert.equal(readOutbox(dir, secret).length, 0);
});

test("recurrence does not pile up new drafts while the previous one awaits review", (t) => {
  const dir = sandbox(t), now = Date.UTC(2026, 8, 30, 12, 0);
  createSchedule(dir, secret, { recipients: ["2604056998"], body: "Aviso", motivo: "Prueba", firstAt: new Date(now + 60_000).toISOString(), recurrence: "DAILY" }, "direction", now);
  processDueSchedules(dir, secret, now + 61_000);
  processDueSchedules(dir, secret, now + 24 * 60 * 60_000 + 61_000);
  assert.equal(readOutbox(dir, secret).length, 1);
  assert.ok(readSchedules(dir, secret)[0].lastSkippedAt);
});
