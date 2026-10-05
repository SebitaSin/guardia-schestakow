# Estado

Actualizado: 5 de octubre de 2026.

## 1 y 2. Quién está de guardia, desde el correo

**Comprobado en la PC real**
- La app entra sola a la casilla (solo lectura), recorre todas las carpetas, no descarta ningún mail y guarda adjuntos y textos (`scripts/imap_sync.py`). 160 mails, 145 adjuntos.
- Lee sola Word, Excel y PDF con texto (`scripts/ingest_pending.py`, `scripts/pdfgrid.py`) y publica en `var/catalog/live.json`. 90 planillas leídas. Contra las 67 que tenían una carga anterior de referencia coincide en 1.972 de 1.972 días.
- Formatos reconocidos: grilla mensual lunes a domingo, lista por día, rangos "1 al 4", matriz nombre × día, bloques semanales, pares de fechas.
- Octubre 2026 leído: cirugía pediátrica, esterilización, guardia clínica, kinesiología, laboratorio, mantenimiento, mensajería, movilidad, obstetricia, portería.
- Ginecología de octubre (Word viejo, .doc): leída con el archivo real, 31 de 31 días. Entra sola en la próxima revisión del correo.
- Regla de corte: lo que no se pudo leer y llegó antes del 21/09/2026 queda como historia (no se procesa ni figura como pendiente). Lo ya leído se conserva. Todo lo que llega desde esa fecha se procesa.

**Probado fuera de la PC (falta verlo andar tras reiniciar)**
- Pantalla principal: botón Actualizar, guardias tomadas de lo leído, servicios sin planilla en blanco con los lugares de las semanas anteriores.
- Archivo: lista de archivos del correo por mes, con su destino o "sin procesar".
- Revisión del correo cada 10 minutos; si se cuelga, se corta sola; si falla, queda lo último bueno.

**Falta**
- 3 fotos recibidas desde el 21/09 (29/9, 1/10 y 2/10): necesitan lectura por imagen. No está conectada: falta autorización expresa para enviar esas imágenes a un servicio de IA.
- Excel viejo (.xls): sin lector. Desde el 21/09 no llegó ninguno.
- Cambios de guardia escritos en el texto del mail ("el 3 no va, va el 5"): se guardan, todavía no se aplican solos.
- El lector distingue Guardia Clínica, pero todavía no separa las guardias de cirugía y pediatría de sus servicios.
- Duda sin resolver: la grilla que llega con asunto "Guardias Obstetricia" estaba cargada antes como Pediatría. Hoy se muestra en Obstetricia.

## 3. WhatsApp

- Nunca recibió ni envió un mensaje real. Falta: registrar el número en Meta y una dirección pública. Pasos y reglas de Meta comprobadas en `WHATSAPP_README.md`.
- Bloqueo exacto: el 260 405 6998 está en la app WhatsApp Business y Meta no deja registrarlo así. Hay que eliminar esa cuenta en el teléfono (decisión de Sebastián) o contratar un proveedor socio de Meta.
- El grupo "Secretarios de Sala" no se puede leer por la API oficial: los secretarios tienen que escribir directo al número.
- Probado fuera de la PC, dentro de la imagen de publicación: verificación del webhook, mensaje firmado aceptado, mensaje sin firma rechazado.
- El texto libre queda bloqueado porque la ventana de 24 horas se calcula con mensajes recibidos, y no hay ninguno.
- El 1/10 hubo 3 borradores aprobados, 0 envíos y 9 errores sin causa registrada: el registro guarda sólo "Error".

## Publicación en internet

- **Probado fuera de la PC (datos de prueba):** imagen única (`deploy/Dockerfile`) con servidor, pantallas, lector de correo y de planillas; claves y usuarios por variables de entorno (`APP_USERS_B64`); disco `/data`; hora de Mendoza; el bloqueo por intentos fallidos distingue la dirección real detrás del proxy (`APP_TRUST_PROXY`).
- **Sin probar:** `PREPARAR-PUBLICACION.cmd` en la PC real (escribe `deploy/private/produccion.env`); la app publicada con datos reales.
- **Falta decidir:** proveedor y dominio. Requisitos en `deploy/README.md`.

## 4. Personal

**Comprobado sobre la nómina real:** 1.167 fichas quedan en 1.099 personas y 74 áreas unificadas (`src/lib/staff-unify.ts`, `src/data/service-labels.json`). Guardia separada en Clínica, Cirugía y Pediatría.

**Probado fuera de la PC:** pantalla única con mapa, abecedario y áreas desplegables; datos del marcador sólo con clic.

## Riesgos conocidos

- El respaldo de `var/` y de `server/session.secret` no existe fuera de la PC. Sin esa clave no se pueden abrir contactos, domicilios ni mensajes cifrados.
- La lectura de pizarras guarda el resultado como "no publicada": no actualiza camas ni pacientes.
- Precio del combustible del mapa: fijo (YPF Mendoza, 28/09/2026).
