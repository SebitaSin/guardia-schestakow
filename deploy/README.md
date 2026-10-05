# Despliegue remoto privado — Schestakow Libre

Este paquete permite que la aplicación siga funcionando si esta PC está apagada: se ejecuta en un servidor remoto con un dominio HTTPS propio, login de la aplicación, disco persistente y datos de operación montados fuera de la imagen.

## Condiciones obligatorias

1. Servidor Linux administrado, con Docker/Compose, disco cifrado, actualizaciones, copia de seguridad y recuperación probada.
2. Dominio propio con registro DNS `A` (y `AAAA` si existe IPv6) dirigido al servidor; los puertos 80 y 443 deben estar abiertos para HTTPS.
3. Acceso institucional autorizado. La aplicación no es pública: cada persona usa su cuenta y los datos privados se restringen por rol.
4. Cree `deploy/.env` desde `.env.example` y `deploy/private/` con los tres archivos indicados allí. No cargue claves ni datos clínicos en Git, Vercel, Netlify, correo personal ni chat.

## Inicio y verificación

Desde `deploy/`, ejecute `docker compose up -d --build`. Compruebe primero `https://<dominio>/api/health` y luego inicio de sesión en una ventana privada. La aplicación y sus datos no requieren que esta PC permanezca encendida.

Los datos de trabajo, adjuntos, auditoría y contactos cifrados quedan en el volumen `schestakow_data`. Respalde ese volumen cifrado antes de actualizaciones y ensaye una restauración aislada. Para actualizar sin borrar datos: `docker compose up -d --build`.

## Límite de seguridad que queda explícito

La interfaz actual compila un resumen clínico para uso del personal autenticado. Por eso este diseño usa servidor privado y login, no hosting estático. La próxima fase necesaria para privilegio mínimo es terminar de servir camas y laboratorio sólo desde API, por rol, y sacar esos datos del paquete del navegador. No se debe declarar esa fase como realizada sin una auditoría del bundle final.
