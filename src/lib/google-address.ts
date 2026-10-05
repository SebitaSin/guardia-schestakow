import { loadMapConfig } from "./private-locations";

let loading: Promise<any> | null = null;
export function loadGoogleMaps(key: string): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=es&region=AR`;
    script.async = true;
    const timer = setTimeout(() => reject(new Error("Google Maps no respondió.")), 15000);
    script.onload = () => { clearTimeout(timer); window.google?.maps ? resolve(window.google) : reject(new Error("Google Maps no se pudo cargar.")); };
    script.onerror = () => { clearTimeout(timer); reject(new Error("Google Maps no se pudo cargar.")); };
    document.head.appendChild(script);
  }).catch((error) => { loading = null; throw error; });
  return loading;
}
export type AddressPoint = { address: string; lat: number; lng: number; precise: boolean };
export async function findGoogleAddress(address: string): Promise<AddressPoint[]> {
  if (address.trim().length < 5) throw new Error("Completá calle, número y localidad.");
  const config = await loadMapConfig();
  if (!config.browserKey) throw new Error("Falta configurar Google Maps.");
  const google = await loadGoogleMaps(config.browserKey);
  const query = /Mendoza|Argentina|San Rafael|General Alvear|Malarg/i.test(address) ? address : `${address}, San Rafael, Mendoza, Argentina`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("La consulta de domicilio no respondió.")), 12000);
    new google.maps.Geocoder().geocode({ address: query, region: "ar", componentRestrictions: { country: "AR" } }, (results: any[], status: string) => {
      clearTimeout(timer);
      if (status !== "OK" || !results?.length) return reject(new Error(status === "REQUEST_DENIED" ? "Google Maps: REQUEST_DENIED. La clave no tiene autorización para Geocoding API. El domicilio se puede guardar, pero Google no permite calcular el punto hasta habilitar esa API en la clave." : `Google Maps: ${status}. Revisá calle, número y localidad.`));
      resolve(results.slice(0, 5).map((result) => ({ address: result.formatted_address, lat: result.geometry.location.lat(), lng: result.geometry.location.lng(), precise: !result.partial_match && result.address_components.some((c: any) => c.types.includes("street_number")) && ["ROOFTOP", "RANGE_INTERPOLATED"].includes(result.geometry.location_type) })));
    });
  });
}
