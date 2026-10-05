# Archivos privados de producción

Esta carpeta no se versiona ni se comparte. En el servidor remoto debe contener:

- `users.json`: usuarios, roles y hashes scrypt. Parta de `server/users.example.json`; no use cuentas ni claves de prueba.
- `catalog.json`: catálogo/cronograma operativo aprobado.
- `internacion.json`: parte de camas autorizado y vigente.
- `google-maps-browser-key.txt`: clave de navegador restringida al dominio público.
- `google-maps-server-key.txt`: clave de servidor restringida a Geocoding API y a la IP del servidor.

Transfiera los cinco archivos por un canal institucional seguro. Los archivos clínicos y las claves no deben ir a un repositorio público, correo personal, servicio estático ni chat.
