import { existsSync, readFileSync } from "node:fs";

function valueFromEnvOrFile(env, valueName, fileName) {
  const direct = String(env[valueName] ?? "").trim();
  if (direct) return direct;
  const path = String(env[fileName] ?? "").trim();
  if (!path || !existsSync(path)) return "";
  try { return readFileSync(path, "utf8").trim(); } catch { return ""; }
}

export function mapsConfig(env = process.env) {
  return {
    // Both values may point at the same restricted Google key. The browser
    // value is returned only to load Maps JavaScript; the server value never
    // leaves this process and is used for Geocoding/Routes proxy calls.
    browserKey: valueFromEnvOrFile(env, "GOOGLE_MAPS_API_KEY", "GOOGLE_MAPS_API_KEY_FILE") || valueFromEnvOrFile(env, "GOOGLE_MAPS_BROWSER_KEY", "GOOGLE_MAPS_BROWSER_KEY_FILE"),
    serverKey: valueFromEnvOrFile(env, "GOOGLE_ROUTES_API_KEY", "GOOGLE_ROUTES_API_KEY_FILE") || valueFromEnvOrFile(env, "GOOGLE_MAPS_API_KEY", "GOOGLE_MAPS_API_KEY_FILE") || valueFromEnvOrFile(env, "GOOGLE_MAPS_SERVER_KEY", "GOOGLE_MAPS_SERVER_KEY_FILE"),
  };
}

export async function geocodeWithGoogle(address, config, fetchImpl = fetch) {
  if (!config.serverKey) throw new Error("google_maps_not_configured");
  const query = String(address ?? "").trim();
  if (query.length < 5 || query.length > 240) throw new Error("invalid_geocode_address");
  const qualified = /Mendoza|Argentina|San Rafael|General Alvear|Malarg/i.test(query) ? query : `${query}, San Rafael, Mendoza, Argentina`;
  const params = new URLSearchParams({ address: qualified, key: config.serverKey, region: "ar", language: "es" });
  const response = await fetchImpl(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("google_maps_http_error");
  const body = await response.json();
  if (body.status !== "OK" || !body.results?.[0]?.geometry?.location) throw new Error(body.status === "ZERO_RESULTS" ? "geocode_not_found" : "google_maps_error");
  const result = body.results[0];
  if (result.partial_match || (result.types?.length && !result.types.some((type) => ["street_address", "premise", "subpremise"].includes(type)))) throw new Error("geocode_not_precise");
  return { address: result.formatted_address, lat: result.geometry.location.lat, lng: result.geometry.location.lng };
}

