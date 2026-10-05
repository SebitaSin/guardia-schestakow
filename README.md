# Hospital Schestakow · plataforma privada

Aplicación de guardias, camas, internación y continuidad operativa del Hospital Teodoro J. Schestakow. El paquete contiene datos clínicos reales y debe ejecutarse con el servidor privado incluido.

## Estado operativo

- Interfaz React/Vite mobile-first con Dashboard, Guardias, Servicios, Camas, Pacientes, Alertas, Captura, Plantel, Cambios, Archivo y Continuidad.
- Acceso privado mediante usuarios, contraseñas con `scrypt` y sesiones firmadas `HttpOnly`.
- Emergencia OFF por defecto. Sólo `DIRECTION` o `ADMIN` pueden cambiarla y deben registrar un motivo.
- Continuidad en modo sombra: las rutas son recomendaciones; no existe despacho automático.
- El conductor recibe una pantalla separada y únicamente su registro operativo.
- Fotos manuales o recibidas por WhatsApp quedan `A_CONFIRMAR`; se conserva el original privado.
- La IA es opcional, está apagada por defecto, usa una llamada sin reintentos, caché por imagen, salida JSON y límites mensuales de llamadas y dinero.
- Gmail se consulta por IMAP en modo sólo lectura con `BODY.PEEK`; los adjuntos nuevos quedan privados y pendientes de revisión.

## Inicio local seguro

Requisitos: Node.js 24 o compatible y Python 3.11 o posterior.

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts/create-user.ps1 -Id direccion -Name "Dirección" -Role DIRECTION
npm run verify
.\INICIAR-HOSPITAL-SEGURO.cmd
```

Abrir `http://127.0.0.1:8788`. El iniciador genera un secreto de sesión local, compila la interfaz y levanta el servidor. `server/users.local.json`, `server/session.secret`, `server/*.clixml`, `.env` y `var/` están excluidos de Git.

## Verificación

```powershell
npm run verify
```

Ejecuta comprobación TypeScript, pruebas del servidor y continuidad, pruebas de ingesta IMAP y compilación de producción. Ninguna integración externa queda validada hasta configurar una cuenta real de prueba y ejecutar su prueba controlada.

## Configuración del servidor

Copiar `.env.example` al entorno del servidor y cargar los valores allí. No guardar claves en el repositorio ni en archivos dentro de `src/` o `public/`.

Variables obligatorias:

- `APP_ROOT`: carpeta del proyecto.
- `APP_DATA_DIR`: almacenamiento privado y persistente.
- `APP_USERS_FILE`: archivo privado de usuarios.
- `APP_SESSION_SECRET`: secreto aleatorio de al menos 32 caracteres.
- `APP_COOKIE_SECURE=true` cuando se usa HTTPS.

### Gmail

Configurar `HOSPITAL_IMAP_ACCOUNT`, `HOSPITAL_IMAP_PASSWORD` y `GMAIL_SYNC_ENABLED=true`. La sincronización no elimina, mueve ni marca correos como leídos. Deduplica por UID, `Message-ID` y SHA-256. El intervalo predeterminado es una vez cada 24 horas y no permite ejecuciones superpuestas.

En Windows también puede guardarse la contraseña de aplicación cifrada con DPAPI, ligada al mismo usuario y equipo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/configure-gmail.ps1 -Account correo@ejemplo.com
```

El lanzador detecta `server/imap-credential.clixml`, habilita la sincronización y ejecuta una primera revisión cinco segundos después del arranque. La contraseña sólo se descifra dentro del proceso del servidor.

Los cronogramas detectados aparecen en Archivo como documentos `A_CONFIRMAR`. Coordinación o Dirección pueden descargar el original privado para revisarlo; el acceso queda auditado. La descarga no publica ni modifica guardias automáticamente.

### WhatsApp

Configurar las variables `WHATSAPP_*` con una cuenta de WhatsApp Business/Cloud API del hospital. El webhook verifica la firma HMAC de Meta. La app no puede ingresar automáticamente a un grupo personal de WhatsApp; se requiere un canal oficial admitido por Meta o envío directo al número comercial.

### IA

Permanece deshabilitada mientras `AI_ENABLED=false`. Para habilitarla deben estar presentes el modelo, la clave, el consentimiento explícito `AI_ALLOW_CLINICAL_DATA=true`, las tarifas vigentes, el presupuesto y el límite de llamadas. El servidor envía únicamente una imagen seleccionada, usa `store:false`, limita la salida y conserva el resultado como borrador. Una persona debe corregir y confirmar cada fila; la confirmación continúa `NO_PUBLICADA` hasta existir un flujo de aplicación separado.

## Dominio propio y despliegue

El destino recomendado es un servidor Node privado con disco persistente, HTTPS y copias de seguridad de `APP_DATA_DIR`. El dominio debe apuntar a ese servidor mediante un proxy TLS. Para acceso desde Internet se necesitan además autenticación institucional, registro de accesos, política de copias y autorización del hospital.

Los despliegues estáticos de Vercel o Netlify están bloqueados porque el bundle actual contiene pacientes. Sólo pueden usarse con `CLINICAL_DATA_STRIPPED=true` después de generar un conjunto demostrativo sin datos clínicos. Subir `dist/` públicamente expondría información privada.

## Scripts de datos

Todos resuelven la raíz mediante `APP_ROOT`; no dependen de `/workspace`.

- `scripts/imap_sync.py`: ingesta IMAP operativa, privada y sólo lectura.
- `scripts/gmail_imap_probe.py`: prueba de conexión sin imprimir la contraseña.
- `scripts/ingest_mail.py` e `ingest.py`: conversores heredados; no corren automáticamente y deben usarse sobre copias controladas.
- `scripts/lab-fetch.py`: consulta opcional con credenciales del entorno; escribe en `APP_DATA_DIR/lab` y nunca en el bundle.
- `scripts/parte-2026-09-02.py`: importación histórica reproducible.
- `build-internacion.mjs`: no estaba presente en los archivos recibidos.

## Límites que requieren validación externa

- Credenciales reales de Gmail, Meta/OpenAI y laboratorio no se incluyen ni se prueban automáticamente.
- Los mínimos de dotación por servicio son decisiones de Dirección y siguen `UNKNOWN` hasta cargarlos.
- Cortes, clima y rutas conservan `UNKNOWN` cuando una fuente no confirma el estado.
- La plataforma no toma decisiones clínicas ni usa datos privados para presentismo o sanciones.
