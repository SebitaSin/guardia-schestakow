# WhatsApp: qué falta y en qué orden

Actualizado: 5 de octubre de 2026. Reemplaza versiones anteriores de este archivo que decían "listo para producción": no era cierto.

## Decisión vigente (5/10/2026)

Recibir: **no se usa la API de Meta por ahora.** El número sigue en los tres grupos y las fotos entran por la carpeta del WhatsApp Business del Android, sincronizada a Google Drive del hospital. Detalle en `ESTADO.md`, punto 3. Lo que sigue en este archivo vale para cuando la app tenga que enviar mensajes.

## Estado real

- El código de la app está: recibe por `/api/whatsapp/webhook` (texto y fotos, con firma de Meta), envía con borrador → aprobación → envío, registra acuses.
- Nunca recibió ni envió un mensaje real. Lo que falta no es código: es la cuenta de Meta y una dirección pública.

## Reglas de Meta comprobadas en su documentación (5/10/2026)

1. **Un número activo en la app WhatsApp o WhatsApp Business no se puede registrar en la API.** Hay que eliminar antes la cuenta en el teléfono. Después el número no se usa más desde la app del teléfono. ([números](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers))
2. **Usar app y API a la vez ("coexistencia") sólo lo puede activar un proveedor socio de Meta**, no uno mismo desde el panel. Por eso fallaron los intentos. ([coexistencia](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users))
3. **Los grupos comunes no se pueden leer por la API.** La API de grupos exige cuenta oficial verificada, sólo maneja grupos creados por ella y de hasta 8 personas; con coexistencia tampoco se sincronizan. El grupo "Secretarios de Sala" no se puede conectar: los secretarios tienen que escribirle **directo al 260 405 6998**. ([grupos](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups))
4. **Costo:** responder dentro de las 24 h desde el último mensaje de la persona es gratis. Sólo se cobran las plantillas enviadas fuera de esa ventana. ([precios](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing))
5. **Token permanente:** se genera con un "usuario del sistema" en la configuración del negocio, con permisos `business_management`, `whatsapp_business_management` y `whatsapp_business_messaging`, y con la app y la cuenta de WhatsApp asignadas. ([tokens](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens))

## Camino elegido para no depender de terceros ni pagar proveedor

Decisión que toma Sebastián (no se hace por inferencia): eliminar la cuenta de WhatsApp Business del chip 260 405 6998. Se pierde el historial de ese teléfono y el número sale de los grupos.

1. Teléfono: WhatsApp Business → Ajustes → Cuenta → Eliminar cuenta.
2. Meta, Administrador de WhatsApp → Números de teléfono → Agregar número → código por SMS → nombre visible → PIN de dos pasos.
3. Usuario del sistema → token permanente (regla 5).
4. Clave secreta de la app: Configuración de la app → Básica.
5. En la PC: `CONFIGURAR-WHATSAPP.cmd` con secreto de app. Las claves se escriben ahí, nunca en un chat.
6. Publicar la app (ver `deploy/README.md`). Sin dirección pública HTTPS Meta no puede entregar mensajes.
7. Meta → WhatsApp → Configuración → Webhook: `https://<dominio>/api/whatsapp/webhook`, token de verificación, suscribir el campo `messages`. Pasar la app de Meta a modo activo.
8. Pruebas, en este orden: mandar un texto al número y verlo en la app; mandar una foto no clínica; responder desde la app; repetir con la PC apagada.

## Sin probar todavía

- Formato argentino 549 / 54 al enviar (el código reintenta sin el 9 ante el error 131030).
- Plantillas en español aprobadas (`PLANTILLAS-WHATSAPP.md`), necesarias para escribir primero a alguien fuera de las 24 h.
- La app sólo guarda texto y fotos: audios, PDF y otros tipos que lleguen por WhatsApp hoy se ignoran.
