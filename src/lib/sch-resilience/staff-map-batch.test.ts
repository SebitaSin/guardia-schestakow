import test from "node:test";
import assert from "node:assert/strict";
import { locatePendingStaff } from "../staff-map-batch.ts";
import type { DirectoryPerson } from "../staff-directory.ts";
import type { PrivateStaffLocation } from "../private-locations.ts";
const person = (staffId: string, address = "Mitre 1222, San Rafael") => ({staffId, address, service:"Auditoría", phone:"", name:staffId}) as DirectoryPerson;
const point = {address:"Mitre 1222, San Rafael",lat:-34.6,lng:-68.3,precise:true};
test("batch preserves existing points, skips incomplete/uncertain addresses and shares identical searches", async () => {
  let queries=0; const saved:string[]=[];
  const result = await locatePendingStaff([person("existing"),person("one"),person("two"),person("incomplete","San Rafael"),{...point, ...person("uncertain"),sourceConfidence:"DUDOSO"}], [{...point,staffId:"existing",transportMode:"UNKNOWN",updatedAt:"",updatedBy:""} as PrivateStaffLocation], {geocode:async()=>{queries++;return [point];},save:async(p)=>{saved.push(p.staffId);},cancelled:()=>false,progress:()=>{}});
  assert.equal(queries,1); assert.deepEqual(saved,["one","two"]); assert.equal(result.saved,2);
});
test("batch stops on API rejection and never stores approximate or ambiguous points", async () => {
  let queries=0,saved=0;
  const result=await locatePendingStaff([person("one"),person("two")],[],{geocode:async()=>{queries++;throw new Error("REQUEST_DENIED");},save:async()=>{saved++;},cancelled:()=>false,progress:()=>{}});
  assert.equal(queries,1); assert.equal(saved,0); assert.equal(result.blocker,"REQUEST_DENIED");
  const approximate=await locatePendingStaff([person("one")],[],{geocode:async()=>[{...point,precise:false}],save:async()=>{saved++;},cancelled:()=>false,progress:()=>{}});
  assert.equal(approximate.review,1); assert.equal(saved,0);
});
test("one timeout does not stop the batch, but three consecutive failures do", async () => {
  let queries = 0;
  const rows = [person("one", "Mitre 1, San Rafael"), person("two", "Mitre 2, San Rafael"), person("three", "Mitre 3, San Rafael"), person("four", "Mitre 4, San Rafael")];
  const result = await locatePendingStaff(rows, [], { geocode: async () => { queries++; if (queries === 1) throw new Error("La consulta de domicilio no respondió."); return [point]; }, save: async () => {}, cancelled: () => false, progress: () => {} });
  assert.equal(result.saved, 3); assert.equal(result.review, 1); assert.equal(result.blocker, "");
  queries = 0;
  const outage = await locatePendingStaff(rows, [], { geocode: async () => { queries++; throw new Error("La consulta de domicilio no respondió."); }, save: async () => {}, cancelled: () => false, progress: () => {} });
  assert.equal(queries, 3); assert.match(outage.blocker, /Tres fallos/);
});
