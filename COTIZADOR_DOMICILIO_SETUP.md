# Configuración del Cotizador a Domicilio

Este documento explica cómo configurar la nueva funcionalidad de **Cotización a Domicilio** en el sistema.

## 📋 Descripción

El Cotizador a Domicilio es una nueva modalidad que permite a los clientes solicitar una visita profesional a su hogar para realizar una cotización completa y personalizada de su mudanza. Este servicio tiene un precio fijo de **$33.000** y está disponible solo en la **Región Metropolitana**.

## 🏗️ Arquitectura

### Separación de Código
- **Página independiente**: `/domicilio` (separada de `/cotizador`)
- **Store independiente**: `homeQuoteStore.ts`
- **Componentes propios**: En `src/components/steps/home/`
- **Rutas API propias**: `/api/home-quote/`

### Flujo del Servicio
1. Cliente ingresa datos personales
2. Cliente ingresa dirección de visita (solo RM)
3. Cliente ve resumen y paga $33.000 mediante Flow
4. Sistema crea reserva de tipo "domicilio"
5. Administrador ve la reserva en el panel
6. Se realiza la visita
7. Administrador marca el servicio como "completado"

## 🔧 Instalación

### 1. Migración de Base de Datos

Ejecuta la siguiente migración en tu editor SQL de Supabase:

```sql
-- Ubicación: database/migrations/add_booking_type_and_home_service_fields.sql

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS booking_type VARCHAR(20) DEFAULT 'online' CHECK (booking_type IN ('online', 'domicilio')),
ADD COLUMN IF NOT EXISTS service_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS visit_address TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_booking_type ON bookings(booking_type);
CREATE INDEX IF NOT EXISTS idx_bookings_service_completed ON bookings(booking_type, status) WHERE booking_type = 'domicilio';

COMMENT ON COLUMN bookings.booking_type IS 'Tipo de reserva: online (mudanza completa) o domicilio (visita a domicilio para cotizar)';
COMMENT ON COLUMN bookings.service_completed_at IS 'Fecha y hora en que se completó el servicio a domicilio';
COMMENT ON COLUMN bookings.visit_address IS 'Dirección donde se realizará la visita a domicilio para cotizar';

UPDATE bookings SET booking_type = 'online' WHERE booking_type IS NULL;
```

### 2. Verificar Variables de Entorno

Asegúrate de que tienes configuradas las credenciales de Flow en tu archivo `.env.local`:

```env
FLOW_API_KEY=tu_api_key
FLOW_SECRET_KEY=tu_secret_key
FLOW_API_URL=https://sandbox.flow.cl/api  # o https://www.flow.cl/api para producción
```

### 3. Instalar Dependencias (si es necesario)

```bash
npm install
```

### 4. Ejecutar el Servidor de Desarrollo

```bash
npm run dev
```

## 📂 Estructura de Archivos Nuevos

```
src/
├── app/
│   ├── domicilio/
│   │   └── page.tsx                          # Página principal del cotizador a domicilio
│   └── api/
│       └── home-quote/
│           └── create/
│               └── route.ts                  # API para crear reservas a domicilio
├── components/
│   └── steps/
│       └── home/
│           ├── HomePersonalInfoStep.tsx      # Paso 1: Datos personales
│           ├── HomeAddressStep.tsx           # Paso 2: Dirección de visita
│           └── HomeSummaryStep.tsx           # Paso 3: Resumen y pago
└── store/
    └── homeQuoteStore.ts                     # State management para cotizador a domicilio

database/
└── migrations/
    └── add_booking_type_and_home_service_fields.sql
```

## 🎯 Características Principales

### Para el Cliente

1. **Elección de Modalidad**: En `/cotizador` puede elegir entre:
   - Cotizador Online (flujo existente)
   - Cotizador a Domicilio (nuevo flujo)

2. **Flujo Simplificado**: Solo 3 pasos:
   - Datos personales (nombre, email, teléfono)
   - Dirección de visita (solo RM)
   - Resumen y pago ($33.000 fijo)

3. **Restricción Geográfica**: Solo disponible en la Región Metropolitana

4. **Pago Seguro**: Integración con Flow para procesar el pago

### Para el Administrador

1. **Filtro por Tipo**: En el panel admin puede filtrar entre:
   - Todos los servicios
   - Mudanzas Online
   - Cotizaciones a Domicilio

2. **Vista Diferenciada**: Las reservas se muestran con badges:
   - 📦 Online (azul)
   - 🏠 Domicilio (morado)

3. **Gestión Específica**:
   - Ver dirección de visita
   - Botón "Marcar visitado" para servicios a domicilio
   - Registro de fecha de completación

4. **Información Completa**:
   - Todos los datos del cliente
   - Dirección de la visita
   - Estado del pago
   - Fecha de creación y completación

## 🔄 Flujo de Estados

### Para Cotizaciones a Domicilio:

```
pending (Pendiente de pago)
    ↓
confirmed (Pago aprobado, pendiente de visita)
    ↓
completed (Visita realizada)
```

Cuando se marca como "completed", el sistema automáticamente guarda `service_completed_at` con la fecha y hora actual.

## 💰 Precio y Pagos

- **Precio Fijo**: $33.000. Se edita en el panel (Configuración → Precios → «Visita a domicilio») y se guarda en `pricing_config.additional_services.homeVisitPrice`
- **Método de Pago**: Flow (WebPay, tarjetas, transferencias)
- **Tipo de Pago**: Siempre "completo" (no hay opción de mitad)

## 🎨 Personalización

### Cambiar el Precio

Se cambia desde el panel: **Configuración → Precios → «Visita a domicilio»**. Queda
guardado en la base (`pricing_config.additional_services.homeVisitPrice`) y lo toman
todas las pantallas, el botón de pago y el comprobante.

El valor por defecto del código (`DEFAULT_HOME_VISIT_PRICE` en
`src/lib/homeVisitPricing.ts`) es solo el respaldo para cuando no se puede leer la
configuración; conviene dejarlo igual al precio vigente.

### Agregar Más Comunas

Edita el archivo `src/components/steps/home/HomeAddressStep.tsx`:

```typescript
const COMUNAS_RM = [
  'Santiago',
  'Las Condes',
  // ... agrega más comunas aquí
]
```

### Modificar el Texto de Bienvenida

Edita el archivo `src/components/steps/WelcomeScreen.tsx` para cambiar los textos de las tarjetas de selección.

## 🐛 Solución de Problemas

### La migración no se aplica

- Verifica que tienes permisos de administrador en Supabase
- Asegúrate de estar conectado a la base de datos correcta
- Revisa los logs de error en el editor SQL

### No aparece la opción de Cotizador a Domicilio

- Limpia el caché del navegador
- Verifica que el archivo `WelcomeScreen.tsx` fue actualizado correctamente
- Revisa la consola del navegador para errores

### El pago no funciona

- Verifica las credenciales de Flow en `.env.local`
- Asegúrate de estar usando el ambiente correcto (sandbox vs producción)
- Revisa los logs del servidor en la terminal

### No se muestran las reservas en el admin

- Ejecuta la migración de base de datos
- Verifica que el campo `booking_type` existe en la tabla `bookings`
- Limpia el caché del navegador

## 📚 Recursos Adicionales

- [Documentación de Flow](https://www.flow.cl/docs/api.html)
- [Documentación de Supabase](https://supabase.com/docs)
- [Documentación de Next.js](https://nextjs.org/docs)

## ✅ Checklist de Implementación

- [ ] Ejecutar migración de base de datos
- [ ] Verificar variables de entorno de Flow
- [ ] Probar flujo completo en desarrollo
- [ ] Probar pago en ambiente sandbox de Flow
- [ ] Verificar panel de administración
- [ ] Probar filtros y búsquedas
- [ ] Validar restricción geográfica (solo RM)
- [ ] Verificar emails de confirmación (si aplica)
- [ ] Probar en diferentes navegadores
- [ ] Deploy a producción

## 🎉 ¡Listo!

Tu sistema ahora tiene dos modalidades de cotización funcionando de forma independiente. Los clientes pueden elegir la que más les convenga y tú puedes gestionar ambas desde un solo panel de administración.

---

**Nota**: Este sistema está diseñado para ser mantenible y escalable. Cada modalidad tiene su propio código, lo que facilita futuras modificaciones sin afectar el otro sistema.
