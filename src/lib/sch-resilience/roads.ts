import roadsFile from "@/data/sch-resilience/roads.json";
import type { ClosureState, GraphEdge, GraphNode } from "./types";

export const NODES = roadsFile.nodes as GraphNode[];
export const BASE_EDGES = roadsFile.edges as GraphEdge[];

export type ClosurePatch = { edge_id: string; closure_state: ClosureState; source: string; updated_at: string };

export function applyClosures(base: GraphEdge[], patches: ClosurePatch[]): GraphEdge[] {
  const map = new Map(patches.map((p) => [p.edge_id, p]));
  return base.map((e) => {
    const p = map.get(e.id);
    if (!p) return { ...e };
    return {
      ...e,
      closure_state: p.closure_state,
      source: p.source,
      last_verified: p.updated_at,
      confidence: p.source.startsWith("HUMAN") ? 90 : e.confidence ?? 40,
    };
  });
}

/** Hard safety: CLOSED forbidden; UNKNOWN + water_risk>=50 forbidden for auto routes. */
export function edgeAllowed(e: GraphEdge, policy: { allowRestricted: boolean } = { allowRestricted: false }) {
  if (e.closure_state === "CLOSED") return false;
  if (e.closure_state === "UNKNOWN" && e.water_risk >= 50) return false;
  if (e.closure_state === "RESTRICTED" && !policy.allowRestricted) return false;
  return true;
}

export function undirected(edges: GraphEdge[]): GraphEdge[] {
  const extra: GraphEdge[] = [];
  for (const e of edges) {
    extra.push(e);
    extra.push({ ...e, id: `${e.id}_r`, from: e.to, to: e.from });
  }
  return extra;
}

export function dijkstra(
  edges: GraphEdge[],
  start: string,
  goal: string,
  policy?: { allowRestricted: boolean },
): { path: string[]; min: number; km: number } | null {
  const allowed = undirected(edges).filter((e) => edgeAllowed(e, policy));
  const adj = new Map<string, GraphEdge[]>();
  for (const e of allowed) {
    const list = adj.get(e.from) ?? [];
    list.push(e);
    adj.set(e.from, list);
  }
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, { node: string; edge: GraphEdge }>();
  const q = new Set<string>([start]);
  const seen = new Set<string>();
  while (q.size) {
    let u: string | null = null;
    let best = Infinity;
    for (const n of q) {
      const d = dist.get(n) ?? Infinity;
      if (d < best) {
        best = d;
        u = n;
      }
    }
    if (u == null) break;
    q.delete(u);
    if (u === goal) break;
    if (seen.has(u)) continue;
    seen.add(u);
    for (const e of adj.get(u) ?? []) {
      const nd = best + e.min;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { node: u, edge: e });
        q.add(e.to);
      }
    }
  }
  if (!dist.has(goal)) return null;
  const path = [goal];
  let km = 0;
  let cur = goal;
  while (cur !== start) {
    const p = prev.get(cur);
    if (!p) return null;
    km += p.edge.km;
    cur = p.node;
    path.push(cur);
  }
  path.reverse();
  return { path, min: dist.get(goal) ?? 0, km: Math.round(km * 10) / 10 };
}
