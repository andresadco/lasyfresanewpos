# Lady Fresa POS · v2 (hardened)

POS web de Lady Fresa Mexicana. Hosted en GitHub Pages, backend Supabase.

## Stack
- **Frontend:** HTML/CSS/JS vanilla en `index.html` + estilos compartidos en `tokens.css`.
- **Backend:** Supabase (Postgres + Realtime + RLS).
- **Offline:** Service Worker + cola de ventas pendientes en localStorage.
- **PWA:** instalable en tablets/desktop. Funciona sin conexión tras primer login.

## Archivos

| Archivo | Función |
|---|---|
| `index.html` | App completa: POS, historial, caja, inventario, clientes, sucursales, ajustes |
| `supabase-sync.js` | Cliente Supabase: auth vía `verify_pin`, load/push, realtime, cola offline |
| `sw.js` | Service Worker: caché de app shell + imágenes; pasa-a-red Supabase API |
| `manifest.webmanifest` | Configuración PWA (instalable) |
| `tokens.css` | Variables CSS de diseño (colores, espaciado, tipografía) |
| `schema.sql` | Schema Postgres + RLS + función `verify_pin()` |
| `limpiar-cache.html` | Utilidad para borrar Service Worker y caché en emergencias |

## Setup

1. **Supabase:** correr `schema.sql` **por secciones** (ver `MIGRATION_PLAN.md` si vienes de v1).
2. **Hosting:** push a GitHub Pages. Eso es todo.
3. **Primer login:** PINs por defecto son 0000, 1111, 2222, 3333. Cámbialos en cuanto puedas.

## Cambios v2 vs v1

### Seguridad
- **RLS por rol y sucursal**: cajero solo ve órdenes de su sucursal; `app_users` y `app_settings` ocultos a `anon`.
- **PINs hasheados con bcrypt** y rate limit (5 intentos → bloqueo 5 min).
- **Login server-side** vía función `verify_pin()` (security definer) — el cliente nunca ve la tabla de usuarios.
- **Headers `x-lf-role` y `x-lf-branch`** inyectados en cada request para que la RLS sepa quién pregunta.
- **Sanitización completa** del render de productos (emoji, nombre, imagen) — adiós XSS latente.

### UX
- **PWA instalable** con manifest, theme-color, splash screen.
- **Offline real** vía Service Worker: la app carga sin red si ya entró una vez.
- **Modales propios** (`confirmModal`, `alertModal`, `promptModal`) reemplazan `confirm/alert/prompt` nativos.
- **Cambio de sucursal recarga datos**: cambiar de Balbuena a Del Valle ahora trae las órdenes correctas.

### Correctitud
- **IVA configurable** (lee `AJ.iva` y `AJ.ivaIncluido`) — antes estaba hardcoded a 16% incluido.
- **Tip persistido** en columna aparte de `orders`.
- **`customer_id` real** en `orders` (FK) — antes era match por nombre.
- **`confirmarPago` atómico**: el cliente solo recibe +1 visita si la venta se guardó o se encoló.
- **Cola offline en batch**: 20 ventas pendientes = 1 INSERT en vez de 20.

### Performance
- **Event delegation** en grid de productos.
- **Imágenes 400px @ 0.75** (antes 800px @ 0.85).
- **Imágenes pesadas NO se guardan en localStorage** — viven en Supabase.
- **Autosave inteligente con `markDirty`**.
- **Service Worker** sirve assets desde caché.
- **Índice compuesto** `(branch_id, created_at desc)`.

### Limpieza
- Eliminado el bloque `eval(fn)` final.
- `replica identity full` solo donde se necesita.
- Carpeta `uploads/` (3.5 MB de duplicados) eliminada.

## PINs de cajeros (cambiar en producción)

| Pin | Alias | Rol |
|-----|-------|-----|
| 0000 | Lozo | admin |
| 1111 | Mary | gerente |
| 2222 | Cap | cajero |
| 3333 | Ant | cajero |

## Versionado

- **v1** (mayo 2026): primera versión funcional, RLS abierto, sin PWA.
- **v2** (mayo 2026): este commit. Seguridad, PWA, offline real, atomicidad.
