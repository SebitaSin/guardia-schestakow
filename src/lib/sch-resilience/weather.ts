import cfg from "@/data/sch-resilience/config.json";
import type { Provenance, WeatherState, WeatherWindow } from "./types";
import { nowIso } from "./hash";

const HAIL_CODES = new Set([96, 99]);

export type SimKind = "off" | "dry" | "rain" | "hail" | "api_down" | "access_closed";

function windowFromHours(
  id: WeatherWindow["id"],
  hours: { time: string[]; precipitation?: number[]; weathercode?: number[]; weather_code?: number[]; windspeed_10m?: number[]; wind_speed_10m?: number[]; visibility?: number[]; precipitation_probability?: number[] },
  startH: number,
  endH: number,
): WeatherWindow {
  const codes = hours.weather_code ?? hours.weathercode ?? [];
  const wind = hours.wind_speed_10m ?? hours.windspeed_10m ?? [];
  const precip = hours.precipitation ?? [];
  const vis = hours.visibility ?? [];
  const prob = hours.precipitation_probability ?? [];
  let p = 0;
  let maxI = 0;
  let hail: boolean | null = codes.length ? false : null;
  let maxW = 0;
  let minV: number | null = null;
  let maxProb = 0;
  let n = 0;
  for (let i = startH; i < Math.min(endH, precip.length || hours.time.length); i++) {
    const mm = precip[i] ?? 0;
    p += mm;
    maxI = Math.max(maxI, mm);
    if (codes[i] != null && HAIL_CODES.has(Number(codes[i]))) hail = true;
    if (wind[i] != null) maxW = Math.max(maxW, Number(wind[i]));
    if (vis[i] != null) minV = minV == null ? Number(vis[i]) : Math.min(minV, Number(vis[i]));
    if (prob[i] != null) maxProb = Math.max(maxProb, Number(prob[i]));
    n++;
  }
  return {
    id,
    precip_mm: n ? Math.round(p * 10) / 10 : null,
    intensity_mmh: n ? Math.round(maxI * 10) / 10 : null,
    hail,
    wind_kmh: n && maxW ? Math.round(maxW) : n ? 0 : null,
    visibility_m: minV,
    storm_prob: n ? maxProb : null,
  };
}

export function parseOpenMeteo(raw: Record<string, unknown>, retrieved = nowIso()): WeatherState {
  const current = (raw.current ?? raw.current_weather ?? {}) as Record<string, unknown>;
  const hourly = (raw.hourly ?? { time: [] }) as {
    time: string[];
    precipitation?: number[];
    weather_code?: number[];
    weathercode?: number[];
    wind_speed_10m?: number[];
    windspeed_10m?: number[];
    visibility?: number[];
    precipitation_probability?: number[];
  };
  const code = Number(current.weather_code ?? current.weathercode ?? 0);
  const now: WeatherWindow = {
    id: "NOW",
    precip_mm: current.precipitation != null ? Number(current.precipitation) : current.rain != null ? Number(current.rain) : 0,
    intensity_mmh: current.precipitation != null ? Number(current.precipitation) : 0,
    hail: Number.isFinite(code) ? HAIL_CODES.has(code) : null,
    wind_kmh: current.wind_speed_10m != null ? Number(current.wind_speed_10m) : current.windspeed != null ? Number(current.windspeed) : null,
    visibility_m: current.visibility != null ? Number(current.visibility) : null,
    storm_prob: null,
  };
  const windows: WeatherWindow[] = [
    now,
    windowFromHours("0-2h", hourly, 0, 2),
    windowFromHours("2-6h", hourly, 2, 6),
    windowFromHours("6-12h", hourly, 6, 12),
    windowFromHours("12-24h", hourly, 12, 24),
  ];
  const issued = String(current.time ?? hourly.time?.[0] ?? retrieved);
  const expires = new Date(Date.parse(retrieved) + cfg.weather_ttl_minutes * 60000).toISOString();
  const prov: Provenance<"ok"> = {
    value: "ok",
    source: "Open-Meteo",
    source_type: "DYNAMIC",
    timestamp: issued,
    retrieved_at: retrieved,
    expires_at: expires,
    confidence: 70,
    status: "VALID",
  };
  return { windows, warning_level: null, raw: null, provenance: prov };
}

export function staleWeather(prev: WeatherState | null, reason: string): WeatherState {
  const retrieved = nowIso();
  if (!prev) {
    const empty: WeatherWindow["id"][] = ["NOW", "0-2h", "2-6h", "6-12h", "12-24h"];
    return {
      windows: empty.map((id) => ({
        id,
        precip_mm: null,
        intensity_mmh: null,
        hail: null,
        wind_kmh: null,
        visibility_m: null,
        storm_prob: null,
      })),
      warning_level: null,
      raw: { error: reason },
      provenance: {
        value: "failed",
        source: "Open-Meteo",
        source_type: "DYNAMIC",
        timestamp: null,
        retrieved_at: retrieved,
        expires_at: null,
        confidence: 0,
        status: "UNKNOWN",
      },
    };
  }
  return {
    ...prev,
    provenance: {
      ...prev.provenance,
      retrieved_at: retrieved,
      status: "STALE",
      confidence: Math.min(prev.provenance.confidence, 30),
      value: "failed",
    },
  };
}

export function weatherUrl() {
  const { lat, lon } = cfg.hospital;
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation,rain,weather_code,wind_speed_10m,visibility&hourly=precipitation,precipitation_probability,rain,weather_code,wind_speed_10m,visibility&forecast_days=2&timezone=${encodeURIComponent(cfg.timezone)}`;
}

export async function fetchWeather(timeoutMs = 8000, retrier: typeof fetch = fetch): Promise<WeatherState> {
  let lastErr = "timeout";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await retrier(weatherUrl(), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      return parseOpenMeteo(json);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "fetch failed";
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(lastErr);
}

/** Labeled synthetic weather. Never presented as Open-Meteo. */
export function simulateWeather(kind: Exclude<SimKind, "off">): WeatherState {
  if (kind === "api_down") return staleWeather(null, "SIMULACIÓN: API meteorológica no disponible");
  const hail = kind === "hail";
  const rain = kind === "rain" || hail || kind === "access_closed";
  const heavy = kind === "rain" || hail;
  const precip = hail ? 18 : heavy ? 24 : kind === "access_closed" ? 6 : 0;
  const code = hail ? 96 : heavy ? 63 : 0;
  const w = parseOpenMeteo({
    current: {
      time: nowIso(),
      precipitation: precip,
      weather_code: code,
      wind_speed_10m: hail ? 55 : heavy ? 38 : 8,
      visibility: heavy ? 2000 : 20000,
    },
    hourly: {
      time: Array.from({ length: 24 }, (_, i) => `h${i}`),
      precipitation: Array(24).fill(heavy ? precip / 3 : precip ? 1 : 0),
      weather_code: Array(24).fill(code),
      wind_speed_10m: Array(24).fill(hail ? 55 : 8),
      visibility: Array(24).fill(heavy ? 2000 : 20000),
      precipitation_probability: Array(24).fill(heavy ? 85 : 5),
    },
  });
  return {
    ...w,
    provenance: {
      ...w.provenance,
      source: "SIMULACIÓN (no es meteorología real)",
      confidence: 10,
    },
  };
}
