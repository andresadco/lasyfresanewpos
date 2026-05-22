# Lady Fresa POS

Sistema POS para Lady Fresa Mexicana · Diseño y prototipo funcional.

## 🚀 Setup Supabase (primera vez)

### 1. Crear las tablas

1. Entra a [app.supabase.com](https://app.supabase.com) → tu proyecto `cohskhrjecuwqlqhjvnh`
2. Sidebar → **SQL Editor**
3. Click **+ New query**
4. Copia y pega TODO el contenido de `schema.sql`
5. Click **Run** (botón verde abajo a la derecha)
6. Deberías ver `Success. No rows returned`

### 2. Verificar

- Sidebar → **Table Editor**
- Deberías ver 10 tablas: `branches`, `categories`, `products`, `modifiers`, `discounts`, `customers`, `app_users`, `orders`, `parked_orders`, `app_settings`
- En `products` deberías ver los 13 productos seed (Fresas, Platanos, La Pistachona, etc.)
- En `app_users` deberías ver los 4 usuarios (0000 Lozo, 1111 Mariana, 2222 Ana, 3333 Luis)

### 3. Abrir la app

- Abre `index.html` localmente o desde GitHub Pages
- Si todo está bien verás abajo a la izquierda un chip verde **"Conectado · 13 productos"**
- Login con PIN **0000** (admin)
- Crea un producto, recarga la página → debe seguir ahí (ahora vive en Supabase)
- Abre el POS en 2 dispositivos → cambios en uno se reflejan en el otro en tiempo real

## 🗂 Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | App principal (POS) |
| `schema.sql` | Schema completo de Supabase — corre 1 vez |
| `supabase-sync.js` | Conecta la app con Supabase (load + push + realtime) |
| `tokens.css` | Variables de diseño (colores, tipografía) |
| `img/` | Imágenes de productos |

## 🔐 Credenciales demo

| PIN | Usuario | Rol |
|---|---|---|
| 0000 | Lozo | 👑 Admin |
| 1111 | Mariana | 👩‍💼 Gerente |
| 2222 | Ana | 🍓 Cajera |
| 3333 | Luis | 🧑‍🍳 Cajero |

## 📡 ¿Qué se sincroniza?

- ✅ Productos (CRUD)
- ✅ Categorías
- ✅ Modificadores
- ✅ Descuentos
- ✅ Clientes Lady Club
- ✅ Usuarios y PINs
- ✅ Sucursales
- ✅ Órdenes aparcadas
- ✅ Ajustes
- ✅ Realtime: nuevas ventas avisan en otros dispositivos

`localStorage` queda como cache offline — si caes sin internet la app sigue funcionando y al volver hace push.

## 🎨 Hosting

Puedes correr la app en cualquier static host:
- **GitHub Pages** (gratis) — Settings → Pages → branch `main`
- **Vercel** (gratis) — conecta el repo
- **Netlify** (gratis) — drag & drop del folder

## ⚠️ Notas de seguridad

Por ahora las políticas de Supabase RLS son **abiertas** (cualquier anon puede leer/escribir). Esto es OK para prototipo. Antes de producción real, hay que:
1. Implementar Supabase Auth
2. Cerrar las políticas RLS por usuario / sucursal
3. Mover keys sensibles a variables de entorno

## 🐛 Troubleshooting

- **No carga datos**: revisa la consola del navegador. Si dice "supabase-js no está cargado", asegúrate de subir todos los archivos al mismo lugar
- **El chip dice "Sin conexión"**: revisa que la URL y la key estén bien en `supabase-sync.js`
- **Algo no guarda**: en Supabase → Table Editor → Authentication tab → revisa que las policies estén creadas (deberían estar después de correr el schema)
