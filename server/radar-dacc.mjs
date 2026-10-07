// Lectura automática del radar de la Dirección de Contingencias Climáticas de Mendoza (DACC).
// La DACC publica una imagen (GIF) del compuesto Sur cada pocos minutos, con la reflectividad en dBZ
// pintada con una escala fija de colores. Acá se decodifica la imagen y se mide qué tan fuerte es el eco
// y a qué distancia está de la ciudad. No usa IA: son colores y distancias.
export const RADAR_URL = "https://www2.contingencias.mendoza.gov.ar/radar/sur.gif";
/** Colores de la escala de la imagen (leídos de su leyenda) para los ecos fuertes. */
const SCALE = [[65, 253, 52, 28], [60, 254, 95, 5], [57, 254, 154, 88], [54, 255, 253, 1], [51, 250, 196, 49], [48, 210, 136, 59], [45, 192, 100, 135], [42, 200, 15, 134], [39, 110, 13, 198]];
const MAP = { left: 4, right: 750, top: 56, bottom: 735 }; // zona del mapa: sin título, ejes ni leyenda
const CITY = { x: 341, y: 275 }; // San Rafael en la imagen (calculado con Gral. Alvear y Monte Comán como referencia)
const PX_PER_KM = 4;
const MIN_AREA_PX = 160;  // 10 km²: menos que esto no se toma como celda
const MIN_STRONG_PX = 32; // 2 km² de 54 dBZ o más para hablar de posible granizo
const CARDINAL = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

/** Primer cuadro de un GIF: ancho, alto, paleta e índice de color de cada píxel. */
export function decodeGif(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (String.fromCharCode(...data.subarray(0, 3)) !== "GIF") throw new Error("no_es_gif");
  const width = data[6] | (data[7] << 8), height = data[8] | (data[9] << 8);
  let at = 13, palette = null;
  if (data[10] & 0x80) { const size = 3 * (1 << ((data[10] & 7) + 1)); palette = data.subarray(at, at + size); at += size; }
  while (at < data.length) {
    const block = data[at++];
    if (block === 0x21) { at++; while (data[at]) at += data[at] + 1; at++; continue; } // extensión: se saltea
    if (block !== 0x2c) break;
    const w = data[at + 4] | (data[at + 5] << 8), h = data[at + 6] | (data[at + 7] << 8), flags = data[at + 8];
    const x0 = data[at] | (data[at + 1] << 8), y0 = data[at + 2] | (data[at + 3] << 8);
    at += 9;
    if (flags & 0x80) { const size = 3 * (1 << ((flags & 7) + 1)); palette = data.subarray(at, at + size); at += size; }
    if (flags & 0x40) throw new Error("gif_entrelazado_no_soportado");
    const minCode = data[at++];
    const chunks = []; let total = 0;
    while (data[at]) { chunks.push(data.subarray(at + 1, at + 1 + data[at])); total += data[at]; at += data[at] + 1; }
    const stream = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { stream.set(chunk, offset); offset += chunk.length; }
    // LZW
    const clear = 1 << minCode, end = clear + 1;
    const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
    const frame = new Uint8Array(w * h);
    let codeSize = minCode + 1, mask = (1 << codeSize) - 1, next = end + 1, previous = -1, first = 0, bits = 0, buffer = 0, out = 0, top = 0;
    for (let i = 0; i < clear; i++) suffix[i] = i;
    for (let i = 0; i < stream.length && out < frame.length;) {
      while (bits < codeSize && i < stream.length) { buffer |= stream[i++] << bits; bits += 8; }
      if (bits < codeSize) break;
      let code = buffer & mask; buffer >>= codeSize; bits -= codeSize;
      if (code === clear) { codeSize = minCode + 1; mask = (1 << codeSize) - 1; next = end + 1; previous = -1; continue; }
      if (code === end) break;
      if (previous === -1) { frame[out++] = suffix[code]; previous = code; first = code; continue; }
      const incoming = code;
      if (code >= next) { stack[top++] = first; code = previous; }
      while (code >= clear) { stack[top++] = suffix[code]; code = prefix[code]; }
      first = suffix[code]; stack[top++] = first;
      if (next < 4096) { prefix[next] = previous; suffix[next] = first; next++; if ((next & mask) === 0 && next < 4096) { codeSize++; mask = (1 << codeSize) - 1; } }
      previous = incoming;
      while (top > 0 && out < frame.length) frame[out++] = stack[--top];
      top = 0;
    }
    if (w === width && h === height && x0 === 0 && y0 === 0) return { width, height, palette, pixels: frame };
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < h; y++) pixels.set(frame.subarray(y * w, (y + 1) * w), (y0 + y) * width + x0);
    return { width, height, palette, pixels };
  }
  throw new Error("gif_sin_imagen");
}

/**
 * Qué tan fuerte es el eco del radar cerca de la ciudad y dónde está la celda fuerte más cercana.
 * Sólo cuentan las celdas de verdad: manchas conectadas de 10 km² o más. Los puntos sueltos (eco de las sierras,
 * interferencias) se descartan; con la imagen real del 6/10/2026 eran todas manchas de menos de 6 km².
 */
export function analyzeRadar(bytes) {
  const { width, height, palette, pixels } = decodeGif(bytes);
  if (width !== 900 || height !== 761 || !palette) throw new Error("imagen_con_otro_formato"); // si la DACC cambia la imagen, no se adivina
  const dbzOf = new Int16Array(256).fill(0);
  for (let i = 0; i < palette.length / 3; i++) {
    const hit = SCALE.find(([, r, g, b]) => Math.abs(palette[3 * i] - r) <= 3 && Math.abs(palette[3 * i + 1] - g) <= 3 && Math.abs(palette[3 * i + 2] - b) <= 3);
    if (hit) dbzOf[i] = hit[0];
  }
  const inMap = (x, y) => x >= MAP.left && x < MAP.right && y >= MAP.top && y < MAP.bottom;
  const value = (x, y) => (inMap(x, y) ? dbzOf[pixels[y * width + x]] : 0);
  const seen = new Uint8Array(width * height);
  const reading = { ciudad_dbz: 0, cerca_dbz: 0, region_dbz: 0, celda: null, celdas: 0, ciudad: { km2_45: 0, km2_54: 0, km2_60: 0, km2_60_8km: 0 } };
  const stack = [];
  for (let y0 = MAP.top; y0 < MAP.bottom; y0++) {
    for (let x0 = MAP.left; x0 < MAP.right; x0++) {
      if (seen[y0 * width + x0] || !value(x0, y0)) continue;
      // mancha conectada de eco de 39 dBZ o más
      let area = 0, strong = 0, max = 0, near = Infinity, nearStrong = null, cityMax = 0, closeMax = 0, c45 = 0, c54 = 0, c60 = 0, c60near = 0;
      stack.push(x0, y0); seen[y0 * width + x0] = 1;
      while (stack.length) {
        const y = stack.pop(), x = stack.pop(), dbz = value(x, y);
        area++; if (dbz > max) max = dbz;
        const dx = (x - CITY.x) / PX_PER_KM, dy = (y - CITY.y) / PX_PER_KM, distance = Math.hypot(dx, dy);
        if (distance < near) near = distance;
        if (distance <= 15) { if (dbz > cityMax) cityMax = dbz; if (dbz >= 45) c45++; if (dbz >= 54) c54++; if (dbz >= 60) { c60++; if (distance <= 8) c60near++; } }
        if (distance <= 60 && dbz > closeMax) closeMax = dbz;
        if (dbz >= 54) { strong++; if (!nearStrong || distance < nearStrong.km) nearStrong = { km: distance, dx, dy }; }
        for (let ny = y - 1; ny <= y + 1; ny++) for (let nx = x - 1; nx <= x + 1; nx++) {
          if (!inMap(nx, ny) || seen[ny * width + nx] || !value(nx, ny)) continue;
          seen[ny * width + nx] = 1; stack.push(nx, ny);
        }
      }
      if (area < MIN_AREA_PX) continue;
      reading.celdas++;
      // Superficie de eco fuerte sobre la ciudad (radio de 15 km), en km²: un píxel suelto no es una tormenta.
      const km2 = (px) => Math.round((px / (PX_PER_KM * PX_PER_KM)) * 10) / 10;
      reading.ciudad.km2_45 += km2(c45); reading.ciudad.km2_54 += km2(c54); reading.ciudad.km2_60 += km2(c60); reading.ciudad.km2_60_8km += km2(c60near);
      reading.ciudad_dbz = Math.max(reading.ciudad_dbz, cityMax);
      reading.cerca_dbz = Math.max(reading.cerca_dbz, closeMax);
      reading.region_dbz = Math.max(reading.region_dbz, max);
      // La celda de referencia: la más cercana entre las de núcleo considerable (4 km² o más); si no hay, la más cercana.
      const core = strong / (PX_PER_KM * PX_PER_KM), big = core >= 4, bigNow = (reading.celda?.nucleo_km2 ?? 0) >= 4;
      if (strong >= MIN_STRONG_PX && nearStrong && (!reading.celda || (big && !bigNow) || (big === bigNow && nearStrong.km < reading.celda.km))) {
        reading.celda = { km: Math.round(nearStrong.km), dbz: max, km2: Math.round(area / (PX_PER_KM * PX_PER_KM)), nucleo_km2: Math.round((strong / (PX_PER_KM * PX_PER_KM)) * 10) / 10, grados: Math.round(((Math.atan2(nearStrong.dx, -nearStrong.dy) * 180) / Math.PI + 360) % 360), rumbo: CARDINAL[Math.round(((Math.atan2(nearStrong.dx, -nearStrong.dy) * 180) / Math.PI + 360) / 45) % 8] };
      }
    }
  }
  return reading;
}

/**
 * Alertas que salen del radar, cada una con su grado (1 a 9). Reglas revisadas con un especialista en emergencias:
 * SOBRE LA CIUDAD cuenta la superficie de eco fuerte en un radio de 15 km, no el píxel más alto:
 *   20 km² de 45 dBZ o más = tormenta (grado 3) · 4 km² de 54 o más = tormenta fuerte, granizo posible (5).
 *   Los grados altos piden además PERSISTENCIA (se cumple en 2 de los últimos 3 barridos) y cercanía:
 *   6 km² de 60 o más = granizo probable (6) · 10 km² de 60 o más con parte a 8 km o menos del hospital (7)
 *   · 25 km² de 60 o más a 8 km o menos (8). Entre 54 y 60 dBZ hay poca diferencia real: por eso el rojo no depende
 *   de 2 km² de un color.
 * LEJOS DE LA CIUDAD (15 a 60 km) sólo cuenta una celda con núcleo de 4 km² o más de 54 dBZ. Si el viento en altura
 * (`steer`, promedio de 700 y 500 hPa) la trae: hasta 30 km, grado 5 con 60 dBZ o 4 con menos; de 30 a 60 km, 4 ó 3.
 * Con viento flojo (menos de 15 km/h) o sin dato, la celda casi no se mueve: cuenta sólo hasta 30 km (4 ó 3).
 * `recent` son las lecturas de los últimos barridos, la actual primero.
 */
export function radarAlerts(reading, time, steer = null, recent = [reading]) {
  const alerts = [];
  const add = (grado, titulo, detalle) => alerts.push({ tipo: "radar", grado, nivel: grado >= 7 ? "rojo" : grado >= 5 ? "naranja" : "amarillo", titulo, detalle, desde: time, hasta: time });
  const zero = { km2_45: 0, km2_54: 0, km2_60: 0, km2_60_8km: 0 };
  const city = { ...zero, ...(reading.ciudad ?? {}) };
  const last = recent.slice(0, 3).map((item) => ({ ...zero, ...(item?.ciudad ?? {}) }));
  const persists = (test) => last.filter(test).length >= 2;
  if (persists((c) => c.km2_60_8km >= 25)) add(8, "Núcleo de granizo extenso sobre San Rafael", `${city.km2_60_8km} km² con 60 dBZ o más a menos de 8 km del hospital, en dos barridos seguidos`);
  else if (persists((c) => c.km2_60 >= 10 && c.km2_60_8km > 0)) add(7, "Granizo probable sobre San Rafael", `${city.km2_60} km² con 60 dBZ o más, parte a menos de 8 km del hospital, en dos barridos seguidos`);
  else if (persists((c) => c.km2_60 >= 6)) add(6, "Tormenta muy fuerte con granizo probable sobre San Rafael", `${city.km2_60} km² con 60 dBZ o más a menos de 15 km, en dos barridos seguidos`);
  else if (city.km2_54 >= 4) add(5, "Tormenta fuerte con posible granizo sobre San Rafael", `${city.km2_54} km² con 54 dBZ o más a menos de 15 km de la ciudad`);
  else if (city.km2_45 >= 20) add(3, "Tormenta sobre San Rafael", `${city.km2_45} km² con 45 dBZ o más a menos de 15 km de la ciudad`);
  const cell = reading.celda;
  if (!alerts.some((alert) => alert.grado >= 5) && cell && cell.km > 15 && cell.km <= 60 && (cell.nucleo_km2 ?? 0) >= 4) {
    const known = steer && Number.isFinite(steer.dir) && Number.isFinite(steer.kmh) && steer.kmh >= 15 && Number.isFinite(cell.grados);
    const coming = known && Math.abs(((steer.dir - cell.grados + 540) % 360) - 180) <= 50;
    const near = cell.km <= 30, big = cell.dbz >= 60;
    if (coming) add(near ? (big ? 5 : 4) : (big ? 4 : 3), `Celda con posible granizo a ${cell.km} km al ${cell.rumbo}, viene hacia la ciudad`, `Eco de ${cell.dbz} dBZ, núcleo de ${cell.nucleo_km2} km². El viento en altura la trae a unos ${Math.round(steer.kmh)} km/h (estimado: llegaría en ${Math.max(10, Math.round((cell.km / steer.kmh) * 6) * 10)} minutos)`);
    else if (!known && near) add(big ? 4 : 3, `Celda con posible granizo a ${cell.km} km al ${cell.rumbo}, casi sin moverse`, `Eco de ${cell.dbz} dBZ, núcleo de ${cell.nucleo_km2} km². Viento en altura flojo o sin dato: puede quedarse descargando en el lugar`);
  }
  // Celda que no se va: núcleo fuerte a 45 km o menos presente en tres barridos seguidos sin acercarse. Es la que
  // descarga en un mismo lugar (aluvión aguas arriba), aunque en la ciudad no llueva. Regla provisoria.
  const cells = recent.slice(0, 3).map((item) => item?.celda).filter((item) => item && (item.nucleo_km2 ?? 0) >= 4 && item.km > 15 && item.km <= 45);
  if (cells.length === 3 && Math.abs(cells[0].km - cells[2].km) <= 5 && !alerts.some((alert) => alert.grado >= 5)) {
    const stuck = { tipo: "radar", sostenida: true, grado: 3, nivel: "amarillo", titulo: `Lluvia sostenida a ${cells[0].km} km al ${cells[0].rumbo}: celda fuerte que no se mueve`, detalle: `Núcleo de ${cells[0].dbz} dBZ en el mismo lugar durante tres barridos seguidos: riesgo de aluvión en esa zona`, desde: time, hasta: time };
    return [...alerts.filter((alert) => / sobre San Rafael/.test(alert.titulo)), stuck];
  }
  return alerts;
}
