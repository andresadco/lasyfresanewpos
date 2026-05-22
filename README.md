# Lady Fresa POS

Sistema POS para Lady Fresa Mexicana, conectado a Supabase con cache offline.

## 🚀 Setup Supabase (primera vez)

### 1. Crear las tablas

1. Entra a [app.supabase.com](https://app.supabase.com) → tu proyecto `cohskhrjecuwqlqhjvnh`
2. Sidebar → **SQL Editor** → **+ New query**
3. Copia y pega TODO el contenido de `schema.sql`
4. Click **Run** (botón verde abajo a la derecha)
5. Deberías ver `Success. No rows returned`

### 2. Verificar

- Sidebar → **Table Editor**: deberías ver 10 tablas
- En `branches`: 2 sucursales (Balbuena, Del Valle)
- En `products`: 13 productos iniciales
- En `app_users`: 4 usuarios (0000 Lozo, 1111 Mariana, 2222 Ana, 3333 Luis)

### 3. Abrir la app

- Abre `index.html` localmente o desde GitHub Pages
- Chip verde abajo a la izquierda: **"Conectado · 13 productos"**
- Login con tu PIN

## 🗂 Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | App POS completa |
| `schema.sql` | Schema de Supabase — corre 1 vez |
| `supabase-sync.js` | Sync con Supabase (load + push + realtime + cola offline) |
| `tokens.css` | Variables de diseño |
| `img/` | Imágenes de productos |

## 🔐 Acceso

Login estricto: solo PINs registrados en `app_users` entran. Un PIN desconocido se rechaza.

| PIN | Usuario | Rol |
|---|---|---|
| 0000 | Lozo | 👑 Admin |
| 1111 | Mariana | 👩‍💼 Gerente |
| 2222 | Ana | 🍓 Cajera |
| 3333 | Luis | 🧑‍🍳 Cajero |

Los chips de acceso rápido en la pantalla de login se generan dinámicamente desde `app_users`.

## 📊 Todo se calcula desde datos reales

Nada está hardcoded como demo. Las pantallas leen de `ORDERS_MOCK` (cargado desde Supabase) y `AJ` (configuración persistente):

- **Cierre de turno**: ventas reales del día por método de pago, top productos, ticket promedio, cancelaciones
- **Dashboard del dueño**: KPIs comparativos hoy/ayer/semana/mes desde ventas reales
- **Historial de ventas**: filtros por día (hoy/ayer/semana) con totales calculados al vuelo
- **Sucursales**: KPIs por sucursal (today, semana, top productos) calculados desde ORDERS_MOCK
- **Turnos**: agrupación por cajero + día, con horas trabajadas calculadas
- **Detalle de cliente**: timeline de visitas reales del cliente, gasto por mes
- **Reportes admin**: totales y top productos del día
- **Caja**: fondo inicial configurable, retiros/depósitos registrables, saldo esperado vivo
- **Impresora**: vista previa con la orden actual o última venta cerrada
- **Integraciones**: status real desde `AJ.integrations` (vacío hasta que el usuario configure)
- **Hardware**: muestra "Sin configurar" hasta que se conecten desde Integraciones

## 📡 ¿Qué se sincroniza con Supabase?

- ✅ Productos · Categorías · Modificadores · Descuentos
- ✅ Clientes Lady Club
- ✅ Usuarios y PINs
- ✅ Sucursales (incluido dirección, teléfono editables desde Ajustes)
- ✅ Órdenes (ventas) — con cola offline
- ✅ Reembolsos (status + razón) — sincronizan entre dispositivos
- ✅ Órdenes aparcadas
- ✅ Ajustes (incluye config de integraciones, caja, etc.)
- ✅ **Realtime**: ventas nuevas y reembolsos aparecen en otros dispositivos

## 💼 Caja / Apertura de turno

- Sheet "Caja" tiene 3 tabs: Apertura, Movimientos, Corte
- **Apertura**: botón para configurar fondo inicial. Persiste vía `AJ.caja`
- **Movimientos**: registra retiros (➖) y depósitos (➕) durante el turno
- **Corte**: muestra esperado en caja = fondo + ventas efectivo del día + depósitos − retiros

El cierre de turno (Z) usa estos valores reales para calcular cuadre.

## 🐛 Troubleshooting

| Problema | Solución |
|---|---|
| No carga datos | Revisa consola. Si dice "supabase-js no está cargado", verifica que estén todos los archivos juntos |
| Chip dice "Sin conexión" | Las ventas que hagas se encolan y suben al volver internet |
| Algo no guarda | Supabase → Authentication → revisa que las policies del schema estén creadas |
| Ver órdenes pendientes (encoladas) | Consola: `window.LFSync.pendingCount()` |
| Forzar reintento de cola | Consola: `window.LFSync.flushPendingOrders()` |

## ⚠️ Seguridad

Las políticas RLS de Supabase son **abiertas** (cualquier anon lee/escribe). Antes de producción real:

1. Implementar Supabase Auth
2. Cerrar las policies por usuario / sucursal
3. Mover keys sensibles a variables de entorno

## 📝 Resumen de mejoras vs versión original

**Bugs críticos arreglados:**
- `confirmarPago` enviaba `NaN` a Supabase (usaba campos inexistentes de `orderFinal()`)
- `persistAll()` interceptado pero nunca llamado (setInterval capturaba la referencia vieja)
- Ventas no aparecían en historial local hasta refrescar la página
- Reembolsos no sincronizaban a Supabase
- Login aceptaba cualquier PIN de 4 dígitos como cajero anónimo
- Datos demo hardcodeados en cierre de turno, dashboard, sucursales, etc.

**Nuevas funcionalidades:**
- Cola offline: ventas se reintentan al volver internet
- Realtime UPDATE: reembolsos se propagan entre dispositivos
- Sistema de caja con apertura, retiros y depósitos persistidos
- Fetch directo de Supabase para corte de turno (sin límite del cache local)
- Chips de login dinámicos desde `app_users`
- Integraciones configurables (impresora, terminal, etc.) en lugar de stubs

**Mejoras de performance:**
- Batch upsert de clientes (1 request en lugar de N)
- Upsert por id de parked_orders (en lugar de delete-all + insert-all)
- `REPLICA IDENTITY FULL` para que realtime envíe todos los campos en UPDATEs

**Limpieza:**
- Eliminado `Lady Fresa POS.html` (copia vieja sin Supabase)
- Eliminada carpeta `uploads/` con duplicados (3.5 MB)
- Vaciados `ORDERS_MOCK` y `CLIENTES_MOCK` (se llenan desde Supabase)
- Eliminadas referencias a sucursal "Centro" hardcoded (usa la actual)
- Eliminadas IPs, números de teléfono y RFCs falsos
