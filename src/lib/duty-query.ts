import { DEPARTMENT_BY_SLUG } from "@/data/departments";
import { kindLabel, type GuardiaDoc } from "@/data/catalog";
import { staffFor } from "@/data/staff";

function fold(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesDutyQuery(query: string, doc: GuardiaDoc): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const slug = doc.departments[0] ?? "";
  const dept = DEPARTMENT_BY_SLUG[slug];
  const staff = staffFor(slug);
  const hay = fold(
    [
      dept?.name,
      dept?.short,
      slug,
      doc.title,
      kindLabel(doc.kind),
      ...doc.shifts.map((s) => s.text),
      ...staff.map((p) => `${p.name} ${p.surname}`),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function matchesDeptQuery(query: string, slug: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const dept = DEPARTMENT_BY_SLUG[slug];
  const staff = staffFor(slug);
  const hay = fold(
    [dept?.name, dept?.short, slug, ...staff.map((p) => `${p.name} ${p.surname}`)]
      .filter(Boolean)
      .join(" "),
  );
  return q.split(/\s+/).every((word) => hay.includes(word));
}
