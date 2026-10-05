export type MapPoint = { lat: number; lng: number };
export type HazardZone = { name: string; source: string; rings: MapPoint[][] };

export function fuelEstimate(meters: number, litersPer100Km: number, pricePerLiter: number) {
  if (![meters, litersPer100Km, pricePerLiter].every(Number.isFinite) || meters < 0 || litersPer100Km <= 0 || pricePerLiter < 0) return null;
  const liters = meters / 100000 * litersPer100Km;
  return { liters, cost: liters * pricePerLiter };
}

export function parseHazardZones(value: any): HazardZone[] {
  if (value?.type !== "FeatureCollection" || !Array.isArray(value.features)) throw new Error("Se necesita un GeoJSON FeatureCollection de polígonos.");
  if (value.features.length > 200) throw new Error("Máximo 200 zonas por capa.");
  let vertices = 0;
  return value.features.flatMap((feature: any) => {
    const geometry = feature.geometry;
    if (!["Polygon", "MultiPolygon"].includes(geometry?.type)) throw new Error("Sólo se aceptan Polygon y MultiPolygon.");
    const name = String(feature.properties?.name ?? feature.properties?.nombre ?? "").trim();
    const source = String(feature.properties?.source ?? feature.properties?.fuente ?? "").trim();
    if (!name || !source) throw new Error("Cada zona necesita nombre y fuente (properties.name y properties.source).");
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map((polygon: any) => ({ name, source, rings: polygon.map((ring: any) => {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error("Polígono incompleto.");
      vertices += ring.length;
      if (vertices > 25000) throw new Error("La capa supera los 25.000 vértices. Simplificala antes de cargarla.");
      if (ring[0]?.[0] !== ring[ring.length - 1]?.[0] || ring[0]?.[1] !== ring[ring.length - 1]?.[1]) throw new Error("Cada anillo debe estar cerrado.");
      return ring.map((coordinate: any) => {
        const [lng, lat] = coordinate;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error("Coordenadas inválidas.");
        return { lat, lng };
      });
    }) }));
  });
}

function inside(point: MapPoint, ring: MapPoint[]) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > point.lat) !== (b.lat > point.lat) && point.lng < (b.lng - a.lng) * (point.lat - a.lat) / (b.lat - a.lat) + a.lng) result = !result;
  }
  return result;
}
function cross(a: MapPoint, b: MapPoint, c: MapPoint) { return (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng); }
function intersects(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint) {
  if (Math.max(a.lng, b.lng) < Math.min(c.lng, d.lng) || Math.max(c.lng, d.lng) < Math.min(a.lng, b.lng) || Math.max(a.lat, b.lat) < Math.min(c.lat, d.lat) || Math.max(c.lat, d.lat) < Math.min(a.lat, b.lat)) return false;
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}
export function crossedZones(path: MapPoint[], zones: HazardZone[]) {
  return zones.filter((zone) => path.some((point) => inside(point, zone.rings[0]) && !zone.rings.slice(1).some((hole) => inside(point, hole))) ||
    path.some((point, index) => index > 0 && zone.rings.some((ring) => ring.some((vertex, i) => i > 0 && intersects(path[index - 1], point, ring[i - 1], vertex)))));
}
