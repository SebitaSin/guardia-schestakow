# Estado

Actualizado: 5 de octubre de 2026.

## 1 y 2. Quién está de guardia, desde el correo

**Comprobado en la PC real**
- La app entra sola a la casilla (solo lectura), recorre todas las carpetas, no descarta ningún mail y guarda adjuntos y textos (`scripts/imap_sync.py`). 160 mails, 145 adjuntos.
- Lee sola Word, Excel y PDF con texto (`scripts/ingest_pending.py`, `scripts/pdfgrid.py`) y publica en `var/catalog/live.json`. 90 planillas leídas. Contra las 67 que tenían una carga anterior de referencia coincide en 1.972 de 1.972 días.
- Formatos reconocidos: grilla mensual lunes a domingo, lista por día, rangos "1 al 4", matriz nombre × día, bloques semanales, pares de fechas.
- Octubre 2026 leído: cirugía pediátrica, esterilización, guardia clínica, kinesiología, laboratorio, mantenimiento, mensajería, movilidad, obstetricia, portería.

**Probado fuera de la PC (falta verlo andar tras reiniciar)**
- Pantalla principal: botón Actualizar, guardias tomadas de lo leído, servicios sin planilla en blanco con los lugares de las semanas anteriores.
- Archivo: lista de archivos del correo por mes, con su destino o "sin procesar".
- Revisión del correo cada 10 minutos; si se cuelga, se corta sola; si falla, queda lo último bueno.

**Falta**
- 31 fotos y 12 PDF escaneados (ahí están UCCyQ, UTI y UCO): necesitan lectura por imagen con IA.
- 12 Word/Excel de formato viejo (.doc/.xls), entre ellos ginecología de octubre.
- Cambios de guardia escritos en el texto del mail ("el 3 no va, va el 5"): se guardan, todavía no se aplican solos.
- El lector distingue Guardia Clínica, pero todavía no separa las guardias de cirugía y pediatría de sus servicios.
- Duda sin resolver: la grilla que llega con asunto "Guardias Obstetricia" estaba cargada antes como Pediatría. Hoy se muestra en Obstetricia.

## 3. WhatsApp

- Nunca recibió ni envió un mensaje real. El servidor sólo escucha en `127.0.0.1`: falta la URL pública para que Meta entregue mensajes.
- El texto libre queda bloqueado porque la ventana de 24 horas se calcula con mensajes recibidos, y no hay ninguno.
- El 1/10 hubo 3 borradores aprobados, 0 envíos y 9 errores sin causa registrada: el registro guarda sólo "Error".

## 4. Personal

**Comprobado sobre la nómina real:** 1.167 fichas quedan en 1.099 personas y 74 áreas unificadas (`src/lib/staff-unify.ts`, `src/data/service-labels.json`). Guardia separada en Clínica, Cirugía y Pediatría.

**Probado fuera de la PC:** pantalla única con mapa, abecedario y áreas desplegables; datos del marcador sólo con clic.

## Riesgos conocidos

- El respaldo de `var/` y de `server/session.secret` no existe fuera de la PC. Sin esa clave no se pueden abrir contactos, domicilios ni mensajes cifrados.
- La lectura de pizarras guarda el resultado como "no publicada": no actualiza camas ni pacientes.
- Precio del combustible del mapa: fijo (YPF Mendoza, 28/09/2026).
