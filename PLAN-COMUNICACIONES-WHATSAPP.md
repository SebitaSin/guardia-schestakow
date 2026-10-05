# Plan de trabajo — Comunicaciones y WhatsApp Business

## Objetivo

Convertir el número institucional **260 405 6998** en la entrada de comunicaciones de la aplicación: mensajes, alertas, pizarras, consultas de Dirección y pedidos de transporte. La automatización debe conservar la foto y el mensaje originales, justificar sus decisiones, registrar correcciones y evitar publicar datos clínicos contradictorios.

## Etapa 1 — Bandeja operativa local — TERMINADA

- Pantalla `/comunicaciones` integrada al menú principal.
- Diseño de chat con categorías: Alerta, Pizarra, Dirección, Duda, Transporte y General.
- Estado visible de WhatsApp: conectado o pendiente.
- Actualización automática de la bandeja cada 10 segundos.
- Contadores de pendientes, alertas y pizarras.
- Permisos limitados a Coordinación, Dirección y Administración.
- Mensajes manuales cifrados en disco.
- Sin datos ficticios: la bandeja empieza vacía.

## Etapa 2 — Funcionamiento inmediato sin Meta — TERMINADA

- Registro de un mensaje recibido y clasificación automática.
- Carga privada de fotos JPG, PNG o WEBP de hasta 15 MB.
- Deduplicación de imágenes por SHA-256.
- Acceso directo desde la comunicación a la revisión de la pizarra.
- Nada se envía por WhatsApp desde esta etapa.

## Etapa 3 — Precisión y aprendizaje — TERMINADA EN CÓDIGO

- Lectura estructurada por servicio, habitación, cama, paciente, diagnóstico y observaciones.
- Instrucción de lectura adaptada a nombres impresos con tipografía similar a Arial, aproximadamente 14 puntos.
- Contraste automático con:
  - servicio y cama del parte vigente;
  - nombre registrado en la cama;
  - lista disponible del laboratorio.
- Tres resultados por fila: `VERIFICADA`, `REVISAR` o `CONFLICTO`.
- Nunca completa un nombre ilegible por inferencia.
- Las correcciones quedan cifradas y auditadas.
- Una corrección frecuente de servicio se reutiliza solamente después de dos ejemplos consistentes y una coincidencia mínima del 80 %.
- No reutiliza automáticamente correcciones de nombres de pacientes.

## Etapa 4 — Recepción automática oficial — PREPARADA, BLOQUEO EXTERNO

El receptor admite mensajes de texto e imágenes, valida la firma de Meta, deduplica mensajes y descarga imágenes de forma autenticada. Para activarlo faltan acciones que requieren al titular de la cuenta:

1. Incorporar el **260 405 6998** a la cuenta oficial de WhatsApp Business Platform de Meta.
2. Autorizar el número mediante el código que Meta envíe al teléfono.
3. Crear y guardar fuera del chat los secretos del servidor:
   - `WHATSAPP_VERIFY_TOKEN`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_APP_SECRET`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_GRAPH_VERSION`
4. Publicar el webhook HTTPS permanente y suscribirlo en Meta.

Las claves nunca deben escribirse en el chat ni incluirse en un ZIP.

## Etapa 5 — Prueba real de extremo a extremo — PENDIENTE

1. Agregar el número Business al circuito de secretarios.
2. Enviar una foto real autorizada al chat directo del número institucional.
3. Verificar en pantalla: remitente, hora, imagen original, categoría Pizarra y deduplicación.
4. Ejecutar la lectura.
5. Confirmar que las filas claras se contrastan y que las ilegibles o contradictorias pasan a excepción.
6. Corregir una excepción y comprobar que la corrección queda auditada.

## Etapa 6 — Mensajes salientes — DESPUÉS DE VALIDAR LA RECEPCIÓN

- Respuestas a consultas.
- Avisos de Dirección con aprobación explícita antes del envío.
- Solicitudes de transporte y confirmaciones de disponibilidad.
- Plantillas autorizadas por Meta cuando correspondan.
- Registro de destinatario, autor, contenido, fecha, entrega y error.
- Sin envíos masivos ni acciones clínicas automáticas.

## Etapa 7 — Operación permanente

- Servidor privado 24/7 con HTTPS.
- Copia de seguridad cifrada y restauración probada.
- Monitoreo del webhook, errores, latencia y cola de mensajes.
- Reintentos limitados y deduplicados.
- Prueba desde datos móviles y otro dispositivo.
- Informe diario de mensajes recibidos, pendientes, conflictos y correcciones.

## Criterio de finalización

La integración se considera terminada solamente cuando una foto real autorizada enviada al **260 405 6998** aparece por sí sola en `/comunicaciones`, queda clasificada, se procesa una sola vez, se contrasta con fuentes registradas y toda contradicción queda visible sin modificar el censo.
