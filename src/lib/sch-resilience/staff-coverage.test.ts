import test from "node:test";
import assert from "node:assert/strict";
import { hasPreciseAddress, missingFields, validMapPoint } from "../staff-coverage.ts";
import type { DirectoryPerson } from "../staff-directory.ts";
import type { PrivateStaffLocation } from "../private-locations.ts";
const person = { staffId: "person-one", name: "Fuente", service: "Movilidad", address: "Mitre 1222, San Rafael", phone: "2604056998", email: "fuente@example.org", dni: "12345678", transportMode: "CAR" } as DirectoryPerson;
const point = {staffId: person.staffId, address: person.address, lat: -34.6, lng: -68.3, transportMode: "CAR"} as PrivateStaffLocation;
test("pending coverage distinguishes missing home from missing verified point", () => {
  assert.deepEqual(missingFields(person), ["point"]);
  assert.deepEqual(missingFields(person, point), []);
  assert.equal(hasPreciseAddress("San Rafael, Mendoza, Argentina"), false);
  assert.equal(hasPreciseAddress("LAS PAREDES, SAN RAFAEL"), false);
  assert.equal(hasPreciseAddress("Sin datos"), false);
  assert.equal(hasPreciseAddress(person.address), true);
  assert.equal(missingFields({...person, address:"SAN RAFAEL, Argentina"}).includes("address"),true);
});
test("pending group resolves immediately from corrected fields and rejects invalid points", () => {
  assert.deepEqual(missingFields({...person, phone:"REVISAR 2604056998", address:"", email:"", dni:"", transportMode:"UNKNOWN"}), ["phone","address","point","transport","email","dni"]);
  assert.equal(validMapPoint({...point,lat:NaN}),false);
  assert.equal(validMapPoint({...point,lng:200}),false);
  assert.deepEqual(missingFields({...person, address:""},point),[]);
});
