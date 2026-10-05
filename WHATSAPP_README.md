# 🚀 WhatsApp Cloud API - Quick Start

## ¿Qué se hizo?
✅ Integración WhatsApp lista para guardia.mjs  
✅ Config local funcionando (sin tocar código existente)  
✅ Documentación completa para producción  
✅ Tests locales verificando cada parte  

## 🎯 Comienza Aquí

### 1. Verificar que todo funciona
```bash
node server/whatsapp.local-test.mjs
```
Debe retornar: `✅ All local tests passed!`

### 2. Iniciar servidor
```bash
npm run dev
```
Debe mostrar: `Hospital Schestakow listo en http://localhost:8788`

### 3. Test rápido
```bash
curl http://localhost:8788/api/health
```
Esperado: `{"ok":true}`

## 📁 Archivos Importantes

| Archivo | Propósito |
|---------|-----------|
| `.env` | Config local (valores ficticios, NO en git) |
| `server/whatsapp.mjs` | Core WhatsApp (YA EXISTE) |
| `server/whatsapp-send.mjs` | Envío de mensajes (YA EXISTE) |
| `server/whatsapp.local-test.mjs` | Test fixture |
| `WHATSAPP_LOCAL_TEST.md` | Guía de tests locales |
| `server/WHATSAPP_PRODUCTION_SETUP.md` | Setup producción |
| `INTEGRACION_WHATSAPP_COMPLETADA.md` | Resumen completo |

## 🔐 Credenciales

### Local (Desarrollo)
```env
WHATSAPP_VERIFY_TOKEN=LOCAL_VERIFY_TOKEN_DEV_1234567890ABCDEF
WHATSAPP_ACCESS_TOKEN=LOCAL_ACCESS_TOKEN_DEV_1234567890ABCDEF_XYZW
WHATSAPP_APP_SECRET=LOCAL_APP_SECRET_DEV_1234567890
WHATSAPP_PHONE_NUMBER_ID=1234567890123456
```
✓ Seguro, valores ficticios

### Producción (Cuando tengas dominio)
1. Leer: `server/WHATSAPP_PRODUCTION_SETUP.md`
2. Obtener tokens reales de Meta
3. Cargar variables en hosting
4. Registrar webhook HTTPS

## 📊 Endpoints Listos

```bash
GET  /api/health                    # Health check
GET  /api/whatsapp/webhook          # Webhook verification
POST /api/whatsapp/webhook          # Receive messages
GET  /api/whatsapp/inbox            # View messages
GET  /api/whatsapp/outbox           # View pending
```

## ⚠️ Importante
- `.env` NO se comitea a git (.gitignore está configurado)
- Código existente NO fue modificado
- Credenciales reales NUNCA se mostrar
- HTTPS es obligatorio en producción

## 🆘 Problemas?

**"Config incomplete"**  
→ Verificar .env tiene todas las variables: `node server/whatsapp.local-test.mjs`

**"ECONNREFUSED"**  
→ Servidor no corre: `npm run dev` en otra terminal

**"Cannot find module"**  
→ Instalar dependencias: `npm install`

## 🔄 Punto de Retorno
Si se complica, rollback:
```bash
cp _backups/20260930_165226/* .
```

---
**Documentación completa:** Ver archivos WHATSAPP_*.md
