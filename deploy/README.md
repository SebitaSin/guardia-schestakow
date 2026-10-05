# Publicar la app en internet

Objetivo: abrirla con un enlace desde cualquier dispositivo, con la PC del hospital apagada. Todavía no hay proveedor elegido; esto sirve para cualquiera que cumpla tres cosas:

1. Corre un contenedor Docker encendido todo el tiempo.
2. Tiene un disco que no se borra al reiniciar (se monta en `/data`).
3. Da una dirección HTTPS (propia del proveedor o un dominio).

## Qué se sube

| Qué | De dónde sale | Para qué |
|---|---|---|
| La imagen | `docker build -f deploy/Dockerfile -t guardia-schestakow .` desde la carpeta de la PC (necesita `src/data`, que no está en GitHub) | La app completa: pantallas, servidor, lector de correo y planillas |
| `deploy/private/produccion.env` | Doble clic en `PREPARAR-PUBLICACION.cmd` | Claves y usuarios, como variables de entorno |
| La carpeta `var` completa | La PC | Va al disco `/data`: correo, planillas leídas, contactos y mensajes |

La clave `APP_SESSION_SECRET` tiene que ser la misma de la PC (el archivo la lleva): con otra no se abren los contactos, domicilios ni mensajes guardados.

## Servidor propio

En `deploy/`: crear `.env` con `SCHESTAKOW_DOMAIN` y `TLS_EMAIL`, y correr `docker compose up -d --build`. El proxy saca el certificado HTTPS solo.

## Comprobación

`https://<dominio>/api/health` responde `{"ok":true}`; después ingresar con usuario y contraseña desde un celular.

## Probado y sin probar

- Probado (5/10/2026, con datos de prueba): la imagen se construye; arranca; responde salud; ingresa con usuarios por variable de entorno y cookie segura; el webhook de WhatsApp verifica, acepta un mensaje firmado y rechaza uno sin firma; el lector de correo y de planillas corre adentro; hora de Mendoza.
- Sin probar: `PREPARAR-PUBLICACION.cmd` en la PC real; la app publicada con los datos reales; Gmail aceptando la conexión desde el servidor nuevo.

## Límite conocido

Las pantallas llevan compilados datos del personal y de internación para quien ingresa con usuario. Todo queda detrás del login; no usar hosting estático (Netlify, Vercel): no corren el servidor.
