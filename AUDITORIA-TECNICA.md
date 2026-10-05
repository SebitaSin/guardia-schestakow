# Auditoría técnica · Hospital Schestakow

Fecha de revisión: 20/09/2026  
Base elegida: `schestakow-libre.zip`  
Carpeta operativa: `work/schestakow-libre`

## Veredicto

La base elegida es recuperable y compila. La aplicación queda preparada como servidor Node privado con interfaz React/Vite; no es seguro publicar el `dist/` actual como sitio estático porque contiene datos clínicos. La construcción en Vercel/Netlify se bloquea si no se declara que el conjunto fue desidentificado.

Gmail IMAP fue validado con la cuenta hospitalaria en modo de sólo lectura. WhatsApp, laboratorio, OpenAI, dominio y rutas reales continúan sin validación productiva hasta contar con sus cuentas oficiales, autorización institucional y pruebas controladas. Esas integraciones permanecen cerradas o apagadas cuando falta configuración.

## Material recibido

| Archivo | Resultado comprobado |
|---|---|
| `CONTINUAR-AQUI.md` | Mapa de continuidad y reglas del rescate. |
| `schestakow-libre.zip` | Mejor base: SPA React/TanStack/Vite/Tailwind, datos, archivo y continuidad. |
| `guardias-portable.zip` | Rescate alternativo. Contenía nombres de archivos de secretos; no se usa como base. |
| `guardias-codigo.zip` | Respaldo de código. También contenía nombres de archivos de secretos. |
| `grok se bloqueo.zip` | No era un ZIP válido; era texto equivalente al mapa de continuidad. |
| `nexo-guardia-auditoria-demo.json` | Ejemplo de eventos, no una base de datos productiva. |

Los archivos de credenciales encontrados en respaldos no fueron incorporados. Deben considerarse expuestos y rotarse antes de una conexión real.

## Mapa principal

```text
src/
  components/       interfaz y navegación
  data/             cronogramas, plantel, camas, internación y continuidad
  lib/              reglas de guardias, pacientes y motor de resiliencia
  routes/           pantallas y rutas
server/
  app.mjs           servidor HTTP privado y APIs
  auth.mjs          usuarios, scrypt, sesión firmada y roles
  capture.mjs       originales, deduplicación y revisión humana
  ai.mjs            IA opcional, caché y presupuesto
  whatsapp.mjs      webhook firmado y descarga server-only
  catalog.mjs       permutas verificadas y auditadas
  identity.mjs      confirmación humana de identidad
  scheduler.mjs     sincronización finita sin solapamiento
scripts/
  imap_sync.py      Gmail IMAP sólo lectura
  create-user.ps1   alta local de usuarios
  start-secure.ps1  compilación e inicio privado
var/                datos runtime privados, excluidos de Git
```

## Módulos existentes

- Dashboard hospitalario.
- Guardias por día, servicio y archivo mensual.
- Servicios y plantel.
- Camas, pacientes y alertas con procedencia del parte.
- Captura manual y WhatsApp, con imagen original y estado `A_CONFIRMAR`.
- Cambios de guardia con antes/después y validación en servidor.
- Archivo y búsqueda.
- Continuidad: clima, riesgo, acceso, mapa, transporte, turno, historial, configuración y plan imprimible.

## Continuidad y seguridad

- `shadow_mode=true`.
- Emergencia inicia OFF y sólo `DIRECTION`/`ADMIN` pueden cambiarla con motivo.
- `UNKNOWN` se conserva; no se convierte en calle abierta, dotación suficiente ni clima seguro.
- Un tramo `CLOSED` no participa del ruteo.
- No hay despacho automático.
- El conductor recibe una pantalla separada y únicamente su registro operativo.
- Los mínimos de dotación continúan `null` hasta decisión de Dirección.
- Las direcciones de consultorio fueron retiradas del paquete de plantel.
- Los archivos estáticos clínicos usan `Cache-Control: no-store`.

## Correo, WhatsApp e IA

- IMAP usa `BODY.PEEK`, deduplicación UID/Message-ID/SHA-256 y no mueve, borra ni marca mensajes.
- La contraseña IMAP local se guarda cifrada con DPAPI y ligada al mismo usuario/equipo de Windows; no queda en el código ni en el navegador.
- Los adjuntos quedan privados y `A_CONFIRMAR`.
- WhatsApp exige firma HMAC y secretos del entorno. No puede entrar por código a un grupo personal; requiere un canal oficial compatible de Meta.
- La IA está OFF por defecto. Requiere consentimiento explícito para datos clínicos, presupuesto, límite mensual, modelo, tarifa y clave.
- La IA recibe una imagen por cambio, usa caché, salida JSON, razonamiento bajo, una llamada sin reintentos y `store:false`.
- Toda salida queda como borrador editable; confirmar o descartar registra usuario, fecha y fuente y no publica automáticamente.

## Datos y límites actuales

- El parte incluido contiene 296 camas y está fechado 02/09/2026.
- El inventario de correo fue generado el 31/08/2026.
- El archivo clínico y la lista de laboratorio son material histórico, no datos actuales verificados al 20/09/2026.
- No se inventaron pacientes, médicos, domicilios ni cortes para completar faltantes.

## Verificación ejecutada

- Instalación limpia de dependencias completada.
- 48 pruebas automatizadas aprobadas: 14 de servidor y seguridad, 27 del motor de continuidad y 7 de ingesta de datos.
- TypeScript sin errores y compilación de producción completada.
- Auditoría de dependencias: 0 vulnerabilidades informadas por `npm audit`.
- Recorrido autenticado: 17 pantallas y 8 API principales respondieron correctamente con rol `DIRECTION` y `Cache-Control: no-store`.
- Revisión visual en tamaño móvil de acceso, navegación, captura, continuidad y configuración; consola del navegador sin errores ni advertencias.
- La protección de despliegue estático rechazó correctamente una construcción de Netlify con datos clínicos no desidentificados.
- Gmail IMAP real: primera pasada completa sobre 131 mensajes, 77 relevantes y 70 adjuntos nuevos; 0 errores. La segunda pasada reconoció los 131 UID, descargó 0 duplicados y confirmó la deduplicación. Intervalo configurado: 24 horas, con revisión inicial al arrancar.
- Los adjuntos pendientes pueden descargarse desde Archivo sólo con rol de Coordinación, Dirección o Administración; se entregan como descarga, sin ejecución inline, sin caché y con auditoría de acceso.

La compilación mantiene una advertencia de rendimiento: el paquete inicial comprimido ocupa aproximadamente 212 kB y uno de los fragmentos supera el umbral de 500 kB antes de comprimir. No impide ejecutar la aplicación, pero conviene reducirlo antes de un despliegue con conectividad móvil limitada.

## Despliegue

Hoy se puede ejecutar en una PC o servidor Node privado. Para dominio propio productivo faltan:

1. servidor con disco persistente y reinicio automático;
2. HTTPS y dominio;
3. usuarios institucionales y política de roles;
4. copias de seguridad y retención aprobada;
5. credenciales y pruebas controladas de Meta/laboratorio/OpenAI;
6. pruebas reales de cada integración con datos controlados;
7. autorización institucional para datos clínicos y acceso remoto.

## Costos

El funcionamiento principal usa código y JSON. La IA no se llama por usuario ni por consulta: sólo por imagen nueva seleccionada. El presupuesto y el número mensual de llamadas cortan antes de exceder el límite. Gmail corre por intervalo, sin solapamiento. Un servidor Node pequeño con disco persistente es la opción más simple; el costo exacto depende del proveedor y de la política de copias.

## Comandos

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts/create-user.ps1 -Id direccion -Name "Dirección" -Role DIRECTION
npm run verify
.\INICIAR-HOSPITAL-SEGURO.cmd
```

Abrir `http://127.0.0.1:8788`. Para producción se usan las variables de `.env.example` en el administrador de secretos del servidor.

## Próximo paso exacto

Crear el primer usuario de Dirección con el comando anterior y probar localmente con datos históricos. Después, configurar una sola integración por vez, comenzando por Gmail IMAP de sólo lectura. No habilitar OpenAI ni publicar un dominio hasta completar una prueba controlada, revisar la auditoría y confirmar que no se expone información clínica fuera de los roles autorizados.
