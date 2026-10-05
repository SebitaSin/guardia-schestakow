/**
 * Pedido de cronograma a un servicio.
 *
 * Antes salía por el conector de Gmail de la plataforma. La app ahora es
 * estática y no tiene servidor: mandar mail desde el navegador exigiría
 * credenciales del lado del cliente, que es exactamente lo que no se hace.
 *
 * Se abre el cliente de correo del usuario con el pedido ya redactado. El mail
 * sale de su propia casilla, queda en Enviados y él ve lo que manda antes de
 * mandarlo — que para un pedido a otro servicio del hospital es lo correcto.
 */

type Payload = { to: string; subject: string; body: string };

export type ReclamoResult = {
  ok: boolean;
  errorMessage: string | null;
  loginRequired: boolean;
  loginUrl: string | null;
};

export async function sendReclamo(input: { data: Payload }): Promise<ReclamoResult> {
  const data = input?.data;
  if (!data?.to || !data.subject || !data.body) {
    return {
      ok: false,
      errorMessage: "Falta destinatario o texto del pedido.",
      loginRequired: false,
      loginUrl: null,
    };
  }
  if (typeof window === "undefined") {
    return { ok: false, errorMessage: "Sin navegador.", loginRequired: false, loginUrl: null };
  }
  const href =
    `mailto:${encodeURIComponent(data.to.trim())}` +
    `?subject=${encodeURIComponent(data.subject)}` +
    `&body=${encodeURIComponent(data.body)}`;
  try {
    window.location.href = href;
    return { ok: true, errorMessage: null, loginRequired: false, loginUrl: null };
  } catch (e) {
    return {
      ok: false,
      errorMessage: e instanceof Error ? e.message : "No se pudo abrir el correo.",
      loginRequired: false,
      loginUrl: null,
    };
  }
}
