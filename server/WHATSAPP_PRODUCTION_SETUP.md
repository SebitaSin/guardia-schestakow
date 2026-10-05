# WhatsApp Cloud API - Setup Producción

## 🎯 Objetivo
Configurar credenciales reales de WhatsApp para publicar en dominio con HTTPS.

## ⚠️ Estado Actual
- ✓ Código WhatsApp listo (server/whatsapp.mjs, whatsapp-send.mjs, whatsapp-schedules.mjs)
- ✓ Rutas integradas en app.mjs (/api/whatsapp/webhook, /api/whatsapp/inbox, /api/whatsapp/outbox)
- ✓ Almacenamiento en var/whatsapp/
- ✗ Credenciales reales NO configuradas
- ✗ Webhook HTTPS NO registrado en Meta
- ✗ Dominio público NO disponible aún

## 📋 Pasos para Producción

### Paso 1: Obtener Credenciales de Meta (10 min)
**Recurso:** https://developers.facebook.com/docs/whatsapp/cloud-api/get-started

1. **Meta App ID** → Acciones → Configuración de aplicación → Información básica
   - Guardar: `WHATSAPP_APP_ID`
   
2. **Access Token** → WhatsApp Manager → Cuenta → Información de acceso
   - Tipo: System User Token (válido 60 días, renovable)
   - Guardar: `WHATSAPP_ACCESS_TOKEN`
   
3. **App Secret** → Acciones → Mostrar → Copiar
   - Guardar: `WHATSAPP_APP_SECRET`
   
4. **Phone Number ID** → WhatsApp Manager → Teléfono → ID
   - Guardar: `WHATSAPP_PHONE_NUMBER_ID`
   
5. **Verify Token** → Generar aleatoriamente
   ```bash
   openssl rand -base64 32  # o node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   - Guardar: `WHATSAPP_VERIFY_TOKEN`

### Paso 2: Variables de Entorno
Una vez tengas el dominio, cargar en tu hosting (Vercel, Railway, AWS, etc.):

```env
# ========== CREDENCIALES META ==========
WHATSAPP_VERIFY_TOKEN=<your-verify-token-from-step-1>
WHATSAPP_ACCESS_TOKEN=<your-access-token-from-meta-dashboard>
WHATSAPP_APP_SECRET=<your-app-secret-from-meta>
WHATSAPP_PHONE_NUMBER_ID=<your-phone-number-id>
WHATSAPP_GRAPH_VERSION=v18.0

# ========== OPCIONAL ==========
WHATSAPP_GROUP_ID=<if-using-groups>
WHATSAPP_PUBLIC_NUMBER=2604056998  # Tu número real
```

### Paso 3: Registrar Webhook HTTPS en Meta
**Recurso:** https://developers.facebook.com/docs/whatsapp/webhooks/setup

1. WhatsApp Manager → Configuración → Webhook
2. URL del Webhook:
   ```
   https://yourdomain.com/api/whatsapp/webhook
   ```
3. Verify Token: Usar el mismo `WHATSAPP_VERIFY_TOKEN` de arriba
4. Subscripciones: `messages`, `message_status`, `message_template_status_update`

### Paso 4: Test con Webhook Real
```bash
curl -X GET "https://yourdomain.com/api/whatsapp/webhook" \
  -H "hub.challenge=CHALLENGE_TOKEN" \
  -H "hub.verify_token=<your-verify-token>"
```

Expected: `200 OK` con `CHALLENGE_TOKEN` en respuesta

## 🔍 Validación
- `whatsappReady()` en server/whatsapp.mjs valida que todas las vars estén presentes
- Si falta alguna, `/api/whatsapp/webhook` retorna `503 Not Configured`
- Verificar logs: `Hospital Schestakow WhatsApp config loaded`

## 📊 Endpoints Disponibles
- `GET /api/whatsapp/webhook` — Verificación Meta (paso 3)
- `POST /api/whatsapp/webhook` — Recibir mensajes
- `GET /api/whatsapp/inbox` — Ver mensajes recibidos
- `GET /api/whatsapp/outbox` — Ver cola de envío
- `POST /api/whatsapp/send` — Enviar mensaje (privado, requiere auth)

## ⚠️ Seguridad
- Access Token expira en 60 días → implementar renovación automática
- App Secret es sensible → NUNCA en git, usar secrets del hosting
- Webhook verificación usa HMAC-SHA256 → protegido contra suplantación
- Todas las rutas privadas requieren autenticación Bearer

## 🆘 Troubleshooting
- **503 Not Configured**: Faltan variables en .env
- **Webhook verification failed**: `WHATSAPP_VERIFY_TOKEN` no coincide con Meta
- **401 Invalid token**: Access Token expirado o incorrecto
- **No messages arriving**: Webhook URL no es HTTPS o no está registrada en Meta

## 📚 Referencias
- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
- Webhooks: https://developers.facebook.com/docs/whatsapp/webhooks/setup
- Business Accounts: https://developers.facebook.com/docs/whatsapp/business-accounts
