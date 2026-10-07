import { useEffect, useMemo, useRef, useState } from "react";
import { STAFF_INDEX } from "@/data/staff";
import {
  loadMapConfig,
  loadPrivateLocations,
  computeRoute,
  removePrivateLocation,
  savePrivateLocation,
  saveSolidario,
  type PrivateStaffLocation,
  type TransportMode,
} from "@/lib/private-locations";
import { loadPrivateContacts, type PrivateStaffContact } from "@/lib/private-contacts";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { loadGoogleMaps, findGoogleAddress } from "@/lib/google-address";
import { loadDirectory, searchKey, type DirectoryPerson } from "@/lib/staff-directory";
import { groupByArea, unifyPeople, type UnifiedPerson } from "@/lib/staff-unify";
import { validMapPoint } from "@/lib/staff-coverage";
import { locatePendingStaff } from "@/lib/staff-map-batch";
import { fuelEstimate } from "@/lib/map-route-metrics";
import { storageGet, storageSet } from "@/lib/safe-storage";
import { Car } from "lucide-react";
import { TrasladoSolidario } from "@/components/traslado-solidario";
import { AutogestionPanel } from "@/components/autogestion-panel";

declare global {
  interface Window { google?: any }
}

const HOSPITAL = { lat: -34.620098, lng: -68.325299 };
const MODES: { value: TransportMode; label: string }[] = [
  { value: "CAR", label: "Auto" },
  { value: "PUBLIC_TRANSPORT", label: "Colectivo" },
  { value: "MOTORCYCLE", label: "Moto" },
  { value: "BICYCLE", label: "Bicicleta" },
  { value: "WALKING", label: "A pie" },
  { value: "OTHER", label: "Otro" },
  { value: "UNKNOWN", label: "Sin datos" },
];

// Consumo promedio por tipo de vehículo y precio de surtidor YPF en Mendoza.
// Para actualizar el precio alcanza con cambiar estos valores y la fecha.
const FUEL_AS_OF = "28/09/2026";
const VEHICLES = {
  CAR: { label: "Auto", litersPer100Km: 8, fuel: "Súper", pricePerLiter: 2125 },
  PICKUP: { label: "Camioneta", litersPer100Km: 10, fuel: "Diésel", pricePerLiter: 2295 },
} as const;
type VehicleKind = keyof typeof VEHICLES;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const HOVER_KEY = "schestakow.mapa.hover";
const SKIPPED_KEY = "schestakow.mapa.sin-punto";
const money = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

function colorFor(mode: TransportMode) {
  if (mode === "CAR") return "#2563eb";
  if (mode === "PUBLIC_TRANSPORT") return "#eab308";
  if (["MOTORCYCLE", "BICYCLE", "WALKING", "OTHER"].includes(mode)) return "#f97316";
  return "#6b7280";
}

function modeLabel(mode: TransportMode) {
  return MODES.find((item) => item.value === mode)?.label ?? "Sin datos";
}

function mapText(value: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

function decodePolyline(encoded: string) {
  const points: { lat: number; lng: number }[] = [];
  let index = 0; let lat = 0; let lng = 0;
  while (index < encoded.length) {
    let shift = 0; let result = 0; let byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function staffName(id: string, contacts: PrivateStaffContact[] = []) {
  const saved = contacts.find((contact) => contact.staffId === id)?.name;
  if (saved) return saved;
  const person = STAFF_INDEX.find((item) => item.id === id);
  return person ? `${person.surname}, ${person.name}` : id;
}

function letterOf(name: string) {
  return searchKey(name).toUpperCase().match(/[A-Z]/)?.[0] ?? "";
}

// Huella no reversible de un domicilio: permite recordar cuáles Google no pudo
// ubicar sin guardar el domicilio en el navegador.
function addressKey(address: string) {
  let hash = 5381;
  for (const char of searchKey(address).replace(/\s+/g, " ").trim()) hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

function readSkipped() {
  try {
    const parsed = JSON.parse(storageGet(SKIPPED_KEY) ?? "[]");
    return new Set<string>(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch { return new Set<string>(); }
}

export function PersonalMapPage() {
  const [directory, setDirectory] = useState<DirectoryPerson[]>([]);
  const [locations, setLocations] = useState<PrivateStaffLocation[]>([]);
  const [contacts, setContacts] = useState<PrivateStaffContact[]>([]);
  const [browserKey, setBrowserKey] = useState<string | null>(null);
  const [routesKey, setRoutesKey] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(() => storageGet(HOVER_KEY) === "1");
  const [letter, setLetter] = useState("");
  const [query, setQuery] = useState("");
  const [staffId, setStaffId] = useState("");
  const [address, setAddress] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode>("UNKNOWN");
  // Traslado solidario: lo que la persona declara. "ride" = necesita que la pasen a buscar.
  const [solidario, setSolidario] = useState({ safe: false, willing: false, seats: 1, ride: false });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [routeTarget, setRouteTarget] = useState<PrivateStaffLocation | null>(null);
  const [routeOrigin, setRouteOrigin] = useState("");
  const [requestedOrigin, setRequestedOrigin] = useState("");
  const [routeResult, setRouteResult] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const [routeStatus, setRouteStatus] = useState("");
  const [vehicle, setVehicle] = useState<VehicleKind>("CAR");
  const mounted = useRef(true);
  const autoAttempted = useRef(false);
  const appliedSelection = useRef(false);
  const fitted = useRef(false);
  const hoverRef = useRef(hoverInfo);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const infoRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routeLineRef = useRef<any>(null);

  // Una fila por persona real: las fichas repetidas se juntan y las áreas quedan unificadas.
  const people = useMemo(() => unifyPeople(directory).map((item) => ({ ...item, key: searchKey(`${item.name} ${item.areas.join(" ")}`) })), [directory]);
  const areaGroups = useMemo(() => groupByArea(people), [people]);
  const pointById = useMemo(() => new Map(locations.map((point) => [point.staffId, point])), [locations]);
  const pointOf = (item: UnifiedPerson) => item.ids.map((id) => pointById.get(id)).find(Boolean) ?? null;
  const usedLetters = useMemo(() => new Set(people.map((item) => letterOf(item.name))), [people]);
  const activeLetter = letter || LETTERS.find((item) => usedLetters.has(item)) || "A";
  const shown = useMemo(() => {
    const value = searchKey(query.trim());
    if (value.length >= 2) return people.filter((item) => item.key.includes(value)).slice(0, 60);
    return people.filter((item) => letterOf(item.name) === activeLetter);
  }, [people, query, activeLetter]);

  async function refresh() {
    const [config, privateLocations, privateContacts, rows] = await Promise.all([loadMapConfig(), loadPrivateLocations(), loadPrivateContacts(), loadDirectory()]);
    const points = privateLocations.filter(validMapPoint);
    if (!mounted.current) return { rows, points };
    setConfigured(config.configured);
    setBrowserKey(config.browserKey);
    setRoutesKey(config.routesKey);
    setLocations(points);
    setContacts(privateContacts);
    setDirectory(rows);
    setLoaded(true);
    return { rows, points };
  }

  // Al entrar: carga lo guardado y ubica sola los domicilios nuevos. Los que
  // Google no encuentra con precisión no se vuelven a consultar hasta que cambien.
  async function updatePoints(rows: DirectoryPerson[], points: PrivateStaffLocation[]) {
    const skipped = readSkipped();
    const pending = rows.filter((person) => !skipped.has(addressKey(person.address ?? "")));
    setUpdating(true);
    try {
      const summary = await locatePendingStaff(pending, points, {
        geocode: async (value) => {
          try {
            const found = await findGoogleAddress(value);
            if (!(found.length === 1 && found[0].precise)) skipped.add(addressKey(value));
            return found;
          } catch (error) {
            if (/ZERO_RESULTS/.test(String(error instanceof Error ? error.message : error))) skipped.add(addressKey(value));
            throw error;
          }
        },
        save: async (person, point) => { await savePrivateLocation({ staffId: person.staffId, address: point.address, lat: point.lat, lng: point.lng, transportMode: (person.transportMode as TransportMode) ?? "UNKNOWN", expectedAddress: person.address }); },
        cancelled: () => !mounted.current,
        progress: () => undefined,
      });
      if (summary.saved && mounted.current) await refresh();
    } catch { /* el mapa sigue mostrando los puntos ya guardados */ }
    finally {
      storageSet(SKIPPED_KEY, JSON.stringify([...skipped].slice(-3000)));
      if (mounted.current) setUpdating(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => { if (mounted.current) setNotice("No se pudo cargar el mapa."); });
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!configured || !directory.length || autoAttempted.current) return;
    autoAttempted.current = true;
    void updatePoints(directory, locations);
  }, [configured, directory]);

  function selectPerson(id: string, point: PrivateStaffLocation | null, person?: DirectoryPerson, pan = true) {
    setStaffId(id);
    setAddress(point?.address ?? person?.address ?? "");
    setTransportMode(point?.transportMode ?? (person?.transportMode as TransportMode) ?? "UNKNOWN");
    setSolidario({ safe: Boolean(point?.solidario?.vehiculoSeguro), willing: Boolean(point?.solidario?.dispuesto), seats: point?.solidario?.lugares || 1, ride: Boolean(point?.solidario?.necesitaTraslado) });
    setNotice("");
    setRequestedOrigin("");
    setRouteTarget(point);
    if (pan && point && mapRef.current) { mapRef.current.panTo({ lat: point.lat, lng: point.lng }); mapRef.current.setZoom(15); }
  }

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("staffId");
    const found = id ? people.find((item) => item.ids.includes(id)) : undefined;
    if (!id || !found || appliedSelection.current) return;
    appliedSelection.current = true;
    setLetter(letterOf(found.name));
    const point = pointOf(found);
    selectPerson(point?.staffId ?? found.person.staffId, point, found.person);
  }, [people, pointById]);

  useEffect(() => {
    if (!configured || !browserKey || !mapNode.current) return;
    let cancelled = false;
    void loadGoogleMaps(browserKey).then((google) => {
      if (cancelled || !mapNode.current) return;
      const map = new google.maps.Map(mapNode.current, { center: HOSPITAL, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
      new google.maps.Marker({ map, position: HOSPITAL, title: "Hospital Schestakow", label: { text: "H", color: "#ffffff", fontWeight: "bold" }, icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: "#dc2626", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2, scale: 12 } });
      mapRef.current = map;
      infoRef.current = new google.maps.InfoWindow();
      setMapReady(true);
    }).catch(() => { if (!cancelled) setNotice("Google Maps no pudo iniciar."); });
    return () => {
      cancelled = true;
      for (const marker of markersRef.current) marker.setMap(null);
      markersRef.current = [];
      routeLineRef.current?.setMap(null);
      routeLineRef.current = null;
      if (mapRef.current && window.google?.maps) window.google.maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
      infoRef.current = null;
      fitted.current = false;
      setMapReady(false);
    };
  }, [configured, browserKey]);

  useEffect(() => {
    const google = window.google;
    const map = mapRef.current;
    if (!mapReady || !map || !google?.maps) return;
    for (const marker of markersRef.current) marker.setMap(null);
    infoRef.current?.close();
    const byId = new Map(people.flatMap((item) => item.ids.map((id) => [id, item] as const)));
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(HOSPITAL);
    markersRef.current = locations.map((location) => {
      bounds.extend({ lat: location.lat, lng: location.lng });
      // Sin "title": el navegador lo mostraría como etiqueta al pasar el cursor.
      const marker = new google.maps.Marker({
        map,
        position: { lat: location.lat, lng: location.lng },
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: colorFor(location.transportMode), fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2, scale: 8 },
      });
      const item = byId.get(location.staffId);
      const person = item?.person;
      const name = item?.name ?? staffName(location.staffId, contacts);
      const lines = [`<strong>${mapText(name)}</strong>`, mapText(item?.areas.join(" · ") ?? ""), mapText(location.address), mapText(person?.phone ?? ""), mapText(modeLabel(location.transportMode))].filter(Boolean);
      const showDetails = () => { infoRef.current?.setContent(lines.join("<br>")); infoRef.current?.open({ map, anchor: marker }); };
      marker.addListener("mouseover", () => { if (hoverRef.current) showDetails(); });
      marker.addListener("click", () => {
        showDetails();
        setQuery("");
        setLetter(letterOf(name));
        selectPerson(location.staffId, location, person, false);
      });
      return marker;
    });
    if (locations.length && !fitted.current) { map.fitBounds(bounds, 50); fitted.current = true; }
  }, [mapReady, locations, people, contacts]);

  useEffect(() => {
    const google = window.google;
    const map = mapRef.current;
    if (!mapReady || !map || !google?.maps) return;
    routeLineRef.current?.setMap(null);
    routeLineRef.current = null;
    setRouteResult(null);
    if (!routeTarget && !requestedOrigin) { setRouteStatus(""); return; }
    let cancelled = false;
    setRouteStatus("Calculando ruta…");
    const origin = requestedOrigin ? { address: requestedOrigin } : { lat: routeTarget!.lat, lng: routeTarget!.lng };
    void computeRoute(origin, HOSPITAL, routesKey ?? "").then((route) => {
      if (cancelled) return;
      const path = decodePolyline(route.encodedPolyline);
      routeLineRef.current = new google.maps.Polyline({ map, path, geodesic: true, strokeColor: "#2563eb", strokeOpacity: 0.9, strokeWeight: 5 });
      const routeBounds = new google.maps.LatLngBounds();
      path.forEach((point) => routeBounds.extend(point));
      map.fitBounds(routeBounds, 50);
      setRouteResult({ distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds });
      setRouteStatus("");
    }).catch(() => { if (!cancelled) setRouteStatus("No se pudo calcular la ruta."); });
    return () => { cancelled = true; };
  }, [mapReady, routeTarget, requestedOrigin, routesKey]);

  function toggleHover(next: boolean) {
    hoverRef.current = next;
    setHoverInfo(next);
    storageSet(HOVER_KEY, next ? "1" : "0");
    if (!next) infoRef.current?.close();
  }

  async function save() {
    if (!staffId) return;
    const text = address.trim();
    setBusy(true); setNotice("");
    let point: { address: string; lat: number; lng: number } | null = null;
    try {
      const current = pointById.get(staffId);
      if (current && current.address === text) point = current;
      else {
        const found = await findGoogleAddress(text);
        if (found.length === 1 && found[0].precise) point = found[0];
      }
    } catch { point = null; }
    if (!point) { setBusy(false); setNotice("No se encontró esa dirección exacta. Escribí calle, número y localidad."); return; }
    try {
      const saved = await savePrivateLocation({ staffId, address: point.address, lat: point.lat, lng: point.lng, transportMode });
      // Sólo se guarda la disponibilidad si ya había una o si se marcó algo: no se crea un "no" que nadie declaró.
      if (pointById.get(staffId)?.solidario || solidario.safe || solidario.ride) await saveSolidario({ staffId, transportMode, vehiculoSeguro: solidario.safe, dispuesto: solidario.willing, lugares: solidario.seats, necesitaTraslado: solidario.ride });
      await refresh();
      if (!mounted.current) return;
      setAddress(saved.location.address);
      setRequestedOrigin("");
      setRouteTarget(saved.location);
      setNotice("Guardado.");
    } catch { if (mounted.current) setNotice("No se pudo guardar."); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function remove() {
    if (!staffId) return;
    setBusy(true); setNotice("");
    try {
      await removePrivateLocation(staffId);
      if (routeTarget?.staffId === staffId) setRouteTarget(null);
      await refresh();
      if (mounted.current) setNotice("Quitado del mapa.");
    } catch { if (mounted.current) setNotice("No se pudo quitar."); }
    finally { if (mounted.current) setBusy(false); }
  }

  const renderRow = (item: UnifiedPerson, showAreas: boolean) => {
    const { person, name } = item;
    const point = pointOf(item);
    const open = Boolean(staffId) && item.ids.includes(staffId);
    return (
      <li key={person.staffId} className="border-b border-border last:border-0">
        <button type="button" aria-expanded={open} onClick={() => selectPerson(point?.staffId ?? person.staffId, point, person)} className={`flex min-h-11 w-full items-center gap-2 px-2 text-left text-sm ${open ? "bg-subtle font-medium" : ""}`}>
          <span aria-hidden="true" style={{ color: point ? colorFor(point.transportMode) : "transparent" }}>●</span>
          <span className="flex-1">{name}</span>
          {point?.solidario?.dispuesto ? <Car className="size-4 shrink-0 text-primary" aria-label="Dispuesto a llevar compañeros en catástrofe" /> : null}
          {showAreas ? <span className="text-right text-xs text-muted">{item.areas.join(" · ")}</span> : null}
        </button>
        {open ? (
          <div className="grid gap-2 bg-subtle p-2 md:grid-cols-[1fr_auto_auto_auto]">
            <AddressAutocomplete value={address} onChange={(value) => { setAddress(value); setNotice(""); }} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm" placeholder="Calle, número y localidad" />
            <select aria-label="Medio de transporte" value={transportMode} onChange={(event) => setTransportMode(event.target.value as TransportMode)} className="h-11 rounded-lg border border-border bg-surface px-2 text-sm">
              {MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </select>
            <button type="button" disabled={busy || !configured || address.trim().length < 5} onClick={() => void save()} className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg disabled:opacity-40">{busy ? "Guardando…" : "Guardar"}</button>
            {point ? <button type="button" disabled={busy} onClick={() => void remove()} className="h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40">Quitar del mapa</button> : null}
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm md:col-span-4">
              <legend className="px-1 text-xs font-semibold text-muted">En caso de catástrofe</legend>
              <label className="flex min-h-9 items-center gap-2"><input type="checkbox" className="size-4" checked={solidario.safe} onChange={(event) => setSolidario({ ...solidario, safe: event.target.checked, willing: event.target.checked ? solidario.willing : false, ride: event.target.checked ? false : solidario.ride })} />Tiene vehículo seguro</label>
              <label className={`flex min-h-9 items-center gap-2 ${solidario.safe ? "" : "opacity-40"}`}><input type="checkbox" className="size-4" disabled={!solidario.safe} checked={solidario.willing} onChange={(event) => setSolidario({ ...solidario, willing: event.target.checked })} /><Car className="size-4 text-primary" aria-hidden="true" />Acepta pasar a buscar compañeros</label>
              {solidario.willing ? <label className="flex min-h-9 items-center gap-2">Lugares<select className="h-9 rounded-md border border-border bg-surface px-2" value={solidario.seats} onChange={(event) => setSolidario({ ...solidario, seats: Number(event.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label> : null}
              <label className={`flex min-h-9 items-center gap-2 ${solidario.safe ? "opacity-40" : ""}`}><input type="checkbox" className="size-4" disabled={solidario.safe} checked={solidario.ride} onChange={(event) => setSolidario({ ...solidario, ride: event.target.checked })} />Necesita que la pasen a buscar</label>
              {point?.solidario ? <span className="text-xs text-muted">Cargado por {point.solidario.por} el {new Date(point.solidario.en).toLocaleDateString("es-AR")}</span> : null}
            </fieldset>
            {notice ? <p role="status" className="text-sm md:col-span-4">{notice}</p> : null}
          </div>
        ) : null}
      </li>
    );
  };

  const spec = VEHICLES[vehicle];
  const fuel = routeResult ? fuelEstimate(routeResult.distanceMeters, spec.litersPer100Km, spec.pricePerLiter) : null;

  return (
    <div className="space-y-3">
      {loaded ? <AutogestionPanel onChange={() => void refresh()} /> : null}
      {loaded ? <TrasladoSolidario people={people} pointOf={pointOf} hospital={HOSPITAL} /> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{loaded ? `${locations.length} en el mapa` : "Cargando…"}{updating ? " · actualizando…" : ""}</span>
        <span className="text-blue-600">● Auto</span>
        <span className="text-yellow-600">● Colectivo</span>
        <span className="text-orange-600">● Moto, bici o a pie</span>
        <span className="text-muted">● Sin datos</span>
        <label className="ml-auto flex min-h-11 items-center gap-2"><input type="checkbox" checked={hoverInfo} onChange={(event) => toggleHover(event.target.checked)} />Mostrar datos al pasar el cursor</label>
      </div>

      {loaded && !configured ? <p className="rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm">Google Maps no está configurado.</p> : null}

      <div ref={mapNode} className="h-[55vh] min-h-96 w-full rounded-2xl bg-subtle shadow-[var(--shadow-border)]" aria-label="Mapa de domicilios del personal" />

      <section className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]">
        <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Personal por letra">
          {LETTERS.map((item) => (
            <button key={item} type="button" role="tab" aria-selected={!query && item === activeLetter} disabled={!usedLetters.has(item)} onClick={() => { setQuery(""); setLetter(item); }} className={`h-11 min-w-11 shrink-0 rounded-lg text-sm font-semibold disabled:opacity-25 ${!query && item === activeLetter ? "bg-primary text-primary-fg" : "border border-border"}`}>{item}</button>
          ))}
        </div>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar persona" placeholder="Buscar por nombre o servicio" className="mt-2 h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
        <ul className="mt-2 max-h-96 overflow-auto">
          {shown.map((item) => renderRow(item, true))}
        </ul>
        {!staffId && notice ? <p role="status" className="mt-2 text-sm">{notice}</p> : null}
      </section>

      <section className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]">
        <h2 className="px-1 font-semibold">Áreas</h2>
        <div className="mt-2 space-y-1">
          {areaGroups.map((group) => (
            <details key={group.area} className="rounded-lg bg-bg">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-sm font-medium">
                <span>{group.area}</span><span className="tabular-nums text-muted">{group.people.length}</span>
              </summary>
              <ul className="border-t border-border bg-surface">{group.people.map((item) => renderRow(item, false))}</ul>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Ruta al hospital</h2>
          {(Object.keys(VEHICLES) as VehicleKind[]).map((kind) => (
            <button key={kind} type="button" aria-pressed={vehicle === kind} onClick={() => setVehicle(kind)} className={`h-11 rounded-lg px-4 text-sm font-medium ${vehicle === kind ? "bg-primary text-primary-fg" : "border border-border"}`}>{VEHICLES[kind].label}</button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input aria-label="Otro origen" value={routeOrigin} onChange={(event) => setRouteOrigin(event.target.value)} placeholder="Otro origen: calle, número, localidad" className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm" />
          <button type="button" disabled={!routeOrigin.trim() || !configured} onClick={() => { setRouteTarget(null); setRequestedOrigin(routeOrigin.trim()); }} className="h-11 rounded-lg border border-border px-4 text-sm disabled:opacity-40">Calcular</button>
        </div>
        {routeStatus ? <p className="mt-2 text-sm" role="status">{routeStatus}</p> : null}
        {routeResult ? (
          <p className="mt-2 font-semibold">
            {(routeResult.distanceMeters / 1000).toFixed(1)} km · {Math.ceil(routeResult.durationSeconds / 60)} min
            {fuel ? ` · ${fuel.liters.toFixed(1)} l · $ ${money.format(fuel.cost)}` : ""}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted">{spec.label}: {spec.litersPer100Km} l/100 km · {spec.fuel} $ {money.format(spec.pricePerLiter)}/l (YPF Mendoza, {FUEL_AS_OF}) · sólo ida</p>
      </section>
    </div>
  );
}
