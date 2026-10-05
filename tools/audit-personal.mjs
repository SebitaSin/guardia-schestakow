// Read-only reconciliation. Private identifiers are compared but never printed.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { staffDirectory } from "../server/staff-directory.mjs";
const [csvPath,xlsxPath,python] = process.argv.slice(2);
if (!csvPath || !xlsxPath || !python) throw new Error("sources_required");
const result=spawnSync(python,["-c",'import csv,json,sys,openpyxl; c=list(csv.DictReader(open(sys.argv[1],encoding="utf-8-sig",newline=""))); w=openpyxl.load_workbook(sys.argv[2],read_only=True,data_only=True); r=w["LISTADO_UNICO"].iter_rows(values_only=True); h=next(r); x=[dict(zip(h,row)) for row in r if any(v is not None for v in row)]; r=w["LISTADO"].iter_rows(values_only=True); h=next(r); raw=[dict(zip(h,row)) for row in r if any(v is not None for v in row)]; print(json.dumps({"csv":c,"xlsx":x,"raw":raw,"sheets":w.sheetnames},ensure_ascii=True))',csvPath,xlsxPath],{encoding:"utf8",maxBuffer:15*1024*1024});
if(result.status!==0) throw new Error("source_read_failed");
const source=JSON.parse(result.stdout);
const text=(v)=>String(v??"").trim();
const norm=(v)=>text(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const labels=JSON.parse(readFileSync(new URL("../src/data/service-labels.json",import.meta.url),"utf8"));
const aliases=new Map(Object.entries(labels).map(([key,value])=>[norm(key),norm(value)]));
const areas=(v)=>[...new Set(text(v).split(",").map(norm).filter(Boolean).map((key)=>aliases.get(key)??key))].sort().join("|");
const secret=readFileSync(new URL("../server/session.secret",import.meta.url),"utf8").trim();
const people=staffDirectory(resolve("var"),secret);
const imports=people.filter((p)=>p.sourceRow);
const mismatches=[],sourceDisagreements=[],missing=[];
for(let i=0;i<source.xlsx.length;i++){
 const x=source.xlsx[i],c=source.csv[i];
 if(!c || norm(c.Name)!==norm(x.APELLIDO_NOMBRE) || areas(c.Services)!==areas(x["SERVICIO(S)"])) sourceDisagreements.push({row:i+2,name:text(x.APELLIDO_NOMBRE)});
 const p=imports.find((p)=>p.sourceRow===i+2);
 if(!p){missing.push({row:i+2,name:text(x.APELLIDO_NOMBRE)});continue;}
 const fields=[];
 if(norm(p.name)!==norm(x.APELLIDO_NOMBRE)) fields.push("nombre");
 if(areas(p.service)!==areas(x["SERVICIO(S)"])) fields.push("servicio");
 if(text(p.dni)!==text(x.DNI)) fields.push("DNI");
 if(fields.length) mismatches.push({staffId:p.staffId,name:p.name,appService:p.service,fileService:text(x["SERVICIO(S)"]),row:i+2,fields});
}
function groupsBy(key){const groups=new Map();for(const p of people){const k=key(p);if(k)groups.set(k,[...(groups.get(k)??[]),p]);}return [...groups.values()].filter((v)=>v.length>1);}
const summaryGroup=(rows)=>({name:rows[0].name,people:rows.map((p)=>({staffId:p.staffId,name:p.name,service:p.service,source:p.source??"cronogramas"})),differentServices:new Set(rows.map((p)=>areas(p.service))).size>1});
const sameDni=groupsBy((p)=>/^\d{5,12}$/.test(text(p.dni))?text(p.dni):"").map(summaryGroup);
// Full-name equality is a candidate, not proof of identity. Single surnames remain unresolved.
const sameFullName=groupsBy((p)=>norm(p.name).split(" ").length>=2?norm(p.name):"").map(summaryGroup);
const importedSurnames=new Map();for(const p of imports){const surname=norm(p.name).split(" ")[0];importedSurnames.set(surname,[...(importedSurnames.get(surname)??[]),p]);}
const surnameCandidates=people.filter((p)=>!p.sourceRow && norm(p.name).split(" ").length===1).map((p)=>({name:p.name,staffId:p.staffId,service:p.service,candidates:(importedSurnames.get(norm(p.name))??[]).map((x)=>({name:x.name,service:x.service,staffId:x.staffId}))})).filter((p)=>p.candidates.length);
const rawAreas=new Map();
for(const row of source.raw){const id=text(row.DNI);if(!/^\d{5,12}$/.test(id)) continue;const set=rawAreas.get(id)??new Set();for(const area of areas(row.SERVICIO).split("|")) if(area)set.add(area);rawAreas.set(id,set);}
const sourceServiceReview=source.xlsx.map((row,i)=>{const raw=rawAreas.get(text(row.DNI));const unique=areas(row["SERVICIO(S)"]).split("|").filter(Boolean);return raw && [...raw].sort().join("|")!==unique.join("|")?{row:i+2,name:text(row.APELLIDO_NOMBRE),fileService:text(row["SERVICIO(S)"]),rawServices:[...raw].sort()}:null;}).filter(Boolean);
const nominalStatus={};for(const row of source.xlsx){const value=text(row.NOMINA_2023)||"Sin referencia";nominalStatus[value]=(nominalStatus[value]??0)+1;}
const audit={checkedAt:new Date().toISOString(),sourceCsv:csvPath,sourceXlsx:xlsxPath,sourceSheets:source.sheets,sourceCsvSha256:createHash("sha256").update(readFileSync(csvPath)).digest("hex"),sourceXlsxSha256:createHash("sha256").update(readFileSync(xlsxPath)).digest("hex"),counts:{csv:source.csv.length,xlsx:source.xlsx.length,raw:source.raw.length,app:people.length,imported:imports.length,sourceDisagreements:sourceDisagreements.length,sourceServiceReview:sourceServiceReview.length,missing:missing.length,mismatches:mismatches.length,sameDni:sameDni.length,sameFullName:sameFullName.length,surnameCandidates:surnameCandidates.length},nominalStatus,sourceServiceReview,sourceDisagreements,missing,mismatches,sameDni,sameFullName,surnameCandidates};
writeFileSync(resolve("var/continuidad/personal-source-audit.json"),JSON.stringify(audit,null,2),{mode:0o600});
console.log(JSON.stringify({counts:audit.counts,nominalStatus,sourceServiceReview:sourceServiceReview.slice(0,5),mismatches:mismatches.slice(0,5)}));
