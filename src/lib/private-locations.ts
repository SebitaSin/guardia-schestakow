export type TransportMode = "CAR" | "MOTORCYCLE" | "BICYCLE" | "PUBLIC_TRANSPORT" | "WALKING" | "OTHER" | "UNKNOWN";

export type PrivateStaffLocation = {
  staffId: string;
  address: string;
  lat: number;
  lng: number;
  transportMode: TransportMode;
  updatedAt: string;
  updatedBy: string;
  /** Traslado solidario en catástrofe: lo que la persona declaró, con fecha y quién lo cargó. */
  solidario?: Solidario;
};
export type Solidario = { vehiculoSeguro: boolean; dispuesto: boolean; lugares: number; necesitaTraslado: boolean; en: string; por: string };

export type MapsConfig = { configured: boolean; browserKey: string | null; routesKey: string | null };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`${path}_${response.status}${body?.error ? `:${body.error}` : ""}`);
  }
  return response.json() as Promise<T>;
}

export function loadMapConfig() {
  return api<MapsConfig>("/api/maps/config");
}

export async function loadPrivateLocations() {
  return (await api<{ locations: PrivateStaffLocation[] }>("/api/continuidad/private-locations")).locations;
}

export function geocodeAddress(address: string) {
  return api<{ address: string; lat: number; lng: number }>("/api/maps/geocode", { method: "POST", body: JSON.stringify({ address }) });
}

export type RouteEndpoint = { lat: number; lng: number } | { address: string };
type ComputedRoute = { distanceMeters: number; durationSeconds: number; encodedPolyline: string };

function routeWaypoint(point: RouteEndpoint) {
  return "address" in point
    ? { address: point.address }
    : { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

export async function computeRoute(origin: RouteEndpoint, destination: RouteEndpoint, routesKey: string) {
  if (!routesKey) throw new Error("google_routes_not_configured");
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": routesKey,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: routeWaypoint(origin),
      destination: routeWaypoint(destination),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: true,
      languageCode: "es",
      units: "METRIC",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.routes?.[0]?.polyline?.encodedPolyline) {
    const status = body.error?.status || body.error?.message || `HTTP_${response.status}`;
    throw new Error(`google_routes_error:${status}`);
  }
  const routes: ComputedRoute[] = body.routes.filter((route: any) => route.polyline?.encodedPolyline).map((route: any) => ({ distanceMeters: Number(route.distanceMeters || 0), durationSeconds: Number.parseFloat(route.duration ?? "0s"), encodedPolyline: route.polyline.encodedPolyline as string }));
  return { ...routes[0], alternatives: routes.slice(1) };
}

export function savePrivateLocation(location: Pick<PrivateStaffLocation, "staffId" | "address" | "lat" | "lng" | "transportMode"> & { expectedAddress?: string }) {
  return api<{ location: PrivateStaffLocation }>("/api/continuidad/private-locations", { method: "POST", body: JSON.stringify(location) });
}

export function saveSolidario(input: { staffId: string; transportMode?: TransportMode; vehiculoSeguro: boolean; dispuesto: boolean; lugares: number; necesitaTraslado: boolean }) {
  return api<{ location: PrivateStaffLocation }>("/api/continuidad/solidario", { method: "POST", body: JSON.stringify(input) });
}

export function removePrivateLocation(staffId: string) {
  return api<{ deleted: boolean }>("/api/continuidad/private-locations", { method: "DELETE", body: JSON.stringify({ staffId }) });
}

