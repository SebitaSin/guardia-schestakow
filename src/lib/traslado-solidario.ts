// Traslado solidario en catástrofe: propuesta de cadenas de compañeros.
// Quien tiene un vehículo seguro y aceptó ayudar pasa a buscar a uno o más compañeros que le quedan de camino al hospital.
// Es una propuesta para revisar: usa el domicilio registrado (no la ubicación del momento) y distancias estimadas.

export type Punto = { lat: number; lng: number };
export type PersonaTraslado = {
  id: string; nombre: string; areas: string[]; rol: string; punto: Punto;
  dispuesto: boolean; lugares: number; necesitaTraslado: boolean;
};
export type Cadena = { conductor: PersonaTraslado; pasajeros: { persona: PersonaTraslado; afinidad: string[] }[]; kmDirecto: number; kmConPasadas: number; kmExtra: number };
export type Propuesta = { cadenas: Cadena[]; sinLugar: PersonaTraslado[]; conductoresLibres: PersonaTraslado[] };

/** Las calles no van en línea recta: se estima el recorrido como la distancia recta por 1,3. */
const FACTOR_CALLE = 1.3;
/** "Sin cambiar la ruta": el desvío total no puede pasar de 2 km ni del 25 % del viaje directo (lo que sea mayor). */
export const DESVIO_MAX_KM = 2;
export const DESVIO_MAX_PROPORCION = 0.25;

export function km(a: Punto, b: Punto) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h)) * FACTOR_CALLE;
}

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
/** Grupo de trabajo, para priorizar que viajen juntos colegas: médicos con médicos, enfermería con enfermería. */
export function grupoDe(rol: string) {
  const text = fold(rol ?? "");
  if (/MEDIC|CIRUJ|DOCTOR|RESIDENT/.test(text)) return "médicos";
  if (/ENFERM/.test(text)) return "enfermería";
  if (/TECNIC|BIOQUIM|KINESI|RADIOL|LABORAT/.test(text)) return "técnicos";
  if (/ADMINIST|SECRETAR/.test(text)) return "administración";
  if (/MANTEN|CHOFER|CAMILL|PORTER|LIMPIEZA|SERVICIOS GENERALES/.test(text)) return "servicios generales";
  return "";
}

/** Largo del viaje del conductor pasando por los pasajeros (primero el más lejano al hospital) y terminando en el hospital. */
function recorrido(conductor: PersonaTraslado, pasajeros: PersonaTraslado[], hospital: Punto) {
  const paradas = [...pasajeros].sort((a, b) => km(b.punto, hospital) - km(a.punto, hospital));
  let total = 0, desde = conductor.punto;
  for (const parada of paradas) { total += km(desde, parada.punto); desde = parada.punto; }
  return total + km(desde, hospital);
}

function afinidad(a: PersonaTraslado, b: PersonaTraslado) {
  const out: string[] = [];
  const comun = a.areas.find((area) => b.areas.includes(area));
  if (comun) out.push(`mismo servicio (${comun})`);
  const grupo = grupoDe(a.rol);
  if (grupo && grupo === grupoDe(b.rol)) out.push(`ambos ${grupo}`);
  return out;
}

export function proponerCadenas(personas: PersonaTraslado[], hospital: Punto): Propuesta {
  const conductores = personas.filter((p) => p.dispuesto && p.lugares > 0);
  const pasajeros = personas.filter((p) => p.necesitaTraslado && !p.dispuesto).sort((a, b) => km(b.punto, hospital) - km(a.punto, hospital));
  const carga = new Map<string, { persona: PersonaTraslado; afinidad: string[] }[]>(conductores.map((c) => [c.id, []]));
  const sinLugar: PersonaTraslado[] = [];
  for (const pasajero of pasajeros) {
    let mejor: { conductor: PersonaTraslado; puntaje: number; afinidad: string[] } | null = null;
    for (const conductor of conductores) {
      const actuales = carga.get(conductor.id)!;
      if (actuales.length >= conductor.lugares) continue;
      const directo = km(conductor.punto, hospital);
      const extra = recorrido(conductor, [...actuales.map((item) => item.persona), pasajero], hospital) - directo;
      if (extra > Math.max(DESVIO_MAX_KM, directo * DESVIO_MAX_PROPORCION)) continue; // se desvía demasiado: no es "de camino"
      const lazos = afinidad(conductor, pasajero);
      // Menos desvío es mejor; ser del mismo servicio o del mismo grupo pesa como ahorrar hasta 1,5 km.
      const puntaje = extra - (lazos.some((l) => l.startsWith("mismo servicio")) ? 1 : 0) - (lazos.some((l) => l.startsWith("ambos")) ? 0.5 : 0);
      if (!mejor || puntaje < mejor.puntaje) mejor = { conductor, puntaje, afinidad: lazos };
    }
    if (mejor) carga.get(mejor.conductor.id)!.push({ persona: pasajero, afinidad: mejor.afinidad });
    else sinLugar.push(pasajero);
  }
  const cadenas: Cadena[] = [];
  const conductoresLibres: PersonaTraslado[] = [];
  for (const conductor of conductores) {
    const lleva = carga.get(conductor.id)!;
    if (!lleva.length) { conductoresLibres.push(conductor); continue; }
    const kmDirecto = km(conductor.punto, hospital), kmConPasadas = recorrido(conductor, lleva.map((item) => item.persona), hospital);
    const orden = [...lleva].sort((a, b) => km(b.persona.punto, hospital) - km(a.persona.punto, hospital));
    cadenas.push({ conductor, pasajeros: orden, kmDirecto, kmConPasadas, kmExtra: Math.max(0, kmConPasadas - kmDirecto) });
  }
  cadenas.sort((a, b) => b.pasajeros.length - a.pasajeros.length || a.kmExtra - b.kmExtra);
  return { cadenas, sinLugar, conductoresLibres };
}

/** Los que quedaron sin compañero que los lleve, agrupados por zona (cuadrícula de unos 2 km) para pedir un transporte privado por zona. */
export function zonasSinLugar(personas: PersonaTraslado[], hospital: Punto) {
  const zonas = new Map<string, PersonaTraslado[]>();
  for (const persona of personas) {
    const key = `${Math.round(persona.punto.lat / 0.018)}|${Math.round(persona.punto.lng / 0.022)}`;
    zonas.set(key, [...(zonas.get(key) ?? []), persona]);
  }
  const rumbo = (p: Punto) => ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"][Math.round(((Math.atan2(p.lng - hospital.lng, p.lat - hospital.lat) * 180) / Math.PI + 360) / 45) % 8];
  return [...zonas.values()].map((grupo) => {
    const centro = { lat: grupo.reduce((s, p) => s + p.punto.lat, 0) / grupo.length, lng: grupo.reduce((s, p) => s + p.punto.lng, 0) / grupo.length };
    return { personas: grupo, km: km(centro, hospital), rumbo: rumbo(centro) };
  }).sort((a, b) => b.personas.length - a.personas.length || a.km - b.km);
}
