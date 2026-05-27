/* ═══════════════════════════════════════════════════════════════
   LADY FRESA POS · Supabase Sync v2
   ─────────────────────────────────────────────────────────────
   Diferencias vs v1:
     1. Headers x-lf-role y x-lf-branch en cada request
        (la RLS los lee vía lf_current_role() y lf_current_branch())
     2. Autenticación por verify_pin() en vez de leer app_users
        directamente (ahora app_users no es legible por anon)
     3. loadBranchData(id) para recargar al cambiar de sucursal
     4. Paginación on-demand para historial (fetchOrdersRange)
     5. flushPendingOrders en batch con debounce
     6. Productos pushean SOLO el slice que cambió, no todos
     7. pushParked con delete().in() en vez de delete().not()
     8. orderSyncQueue: cola en memoria con backoff exponencial
═══════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  // ── CONFIG ────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://cohskhrjecuwqlqhjvnh.supabase.co';
  // ⚠ IMPORTANTE: rotar esta key después de cerrar RLS.
  // Aunque la nueva key sigue siendo "publishable", ya no concede
  // acceso a datos sensibles porque RLS los bloquea.
  const SUPABASE_KEY = 'sb_publishable_vJD6-jqKNPVTV0YZt2Q4NQ_p0SmB5e0';

  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    console.error('[LF-Sync] supabase-js no cargado.');
    return;
  }

  // Estado de auth (rol + sucursal del usuario actual).
  // Se setea cuando hace login vía verify_pin().
  const authState = {
    role: null,    // 'admin' | 'gerente' | 'cajero' | null
    branch: null,  // 'balbuena' | 'delvalle' | null
    pin: null,
  };

  // Cliente Supabase con headers globales que se actualizan al login
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
    global: {
      headers: {
        'x-lf-role': '',
        'x-lf-branch': '',
      },
      fetch: (url, opts = {}) => {
        // Inyectar headers en CADA request (createClient los cachea
        // al inicio; este wrapper los pone siempre frescos)
        const headers = new Headers(opts.headers || {});
        if (authState.role)   headers.set('x-lf-role',   authState.role);
        if (authState.branch) headers.set('x-lf-branch', authState.branch);
        return fetch(url, { ...opts, headers });
      },
    },
  });
  window.lfdb = sb;

  // ── UI HELPERS ────────────────────────────────────────────────
  function showSyncStatus(text, type){
    let el = document.getElementById('lf-sync-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lf-sync-status';
      el.style.cssText = `
        position: fixed; bottom: 16px; left: 16px;
        padding: 6px 12px; border-radius: 99px;
        font-family: var(--font-body, system-ui), system-ui;
        font-size: 11px; font-weight: 600;
        background: var(--ink-100, #eee); color: var(--ink-700, #444);
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        z-index: 200; display: flex; align-items: center; gap: 6px;
        cursor: pointer;
        transition: all 0.3s;
      `;
      el.innerHTML = '<span class="lf-sync-dot"></span><span class="lf-sync-text"></span>';
      el.addEventListener('click', () => {
        // Al tap, mostrar cola de pendientes
        const pending = getPending().length;
        if (pending > 0 && typeof window.alertModal === 'function') {
          window.alertModal('Ventas pendientes', `Hay ${pending} venta(s) sin subir. Se reintentarán al volver la conexión.`);
        }
      });
      document.body.appendChild(el);
    }
    const dot = el.querySelector('.lf-sync-dot');
    const txt = el.querySelector('.lf-sync-text');
    txt.textContent = text;
    const colors = {
      ok:      { bg:'#E0F5E0', col:'#0a7d2f', dot:'#0a7d2f' },
      sync:    { bg:'#FFF6DC', col:'#9A6B0F', dot:'#9A6B0F' },
      error:   { bg:'#FBE4E9', col:'#A6182E', dot:'#A6182E' },
      offline: { bg:'#EEE',    col:'#666',    dot:'#999'    },
    };
    const c = colors[type] || colors.ok;
    el.style.background = c.bg;
    el.style.color = c.col;
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${c.dot};box-shadow:0 0 0 2px ${c.bg};`;
  }

  // ── AUTH ──────────────────────────────────────────────────────

  /**
   * Reemplazo del login. Antes: leer app_users y comparar PIN.
   * Ahora: llamar verify_pin() en el servidor (security definer).
   * Devuelve los datos del usuario o null.
   */
  async function verifyPin(pin){
    if (!pin) return null;
    try {
      const { data, error } = await sb.rpc('verify_pin', { p_pin: pin });
      if (error) {
        console.error('[LF-Sync] verify_pin error:', error);
        return null;
      }
      if (!data || !data.length) return null;
      const u = data[0];
      // Setear estado de auth — todas las siguientes requests van con estos headers
      authState.role = u.rol;
      authState.branch = u.branch_id || (typeof currentBranchId !== 'undefined' ? currentBranchId : null);
      authState.pin = u.pin;
      return u;
    } catch (err) {
      console.error('[LF-Sync] verify_pin network error:', err);
      return null;
    }
  }

  function clearAuth(){
    authState.role = null;
    authState.branch = null;
    authState.pin = null;
  }

  function setBranchHeader(branchId){
    authState.branch = branchId;
  }

  // ── LOAD: bajar catálogo + datos operativos de la sucursal ────
  async function loadFromSupabase(){
    showSyncStatus('Sincronizando…', 'sync');
    const safe = (promise) => promise.catch(err => {
      console.warn('[LF-Sync] Query falló:', err?.message || err);
      return { data: null, error: err };
    });

    try {
      // Catálogo (público — sin filtro de sucursal)
      const catalogPromises = [
        safe(sb.from('products').select('*').order('position', { ascending: true })),
        safe(sb.from('categories').select('*').order('position', { ascending: true })),
        safe(sb.from('modifiers').select('*')),
        safe(sb.from('discounts').select('*')),
        safe(sb.from('branches').select('*')),
      ];

      // Datos operativos (filtrados por sucursal vía RLS)
      const opPromises = authState.role ? [
        safe(sb.from('customers').select('*')),
        safe(sb.from('parked_orders').select('*').order('created_at', { ascending: false })),
        safe(sb.from('app_settings').select('*').eq('id', 1).maybeSingle()),
        safe(sb.from('orders').select('*').order('created_at', { ascending: false }).limit(50)),
        safe(sb.from('inventory').select('*').order('cat', { ascending: true })),
      ] : [
        Promise.resolve({ data: null }),
        Promise.resolve({ data: null }),
        Promise.resolve({ data: null }),
        Promise.resolve({ data: null }),
        Promise.resolve({ data: null }),
      ];

      const [products, categories, modifiers, discounts, branches,
             customers, parkedOrders, settings, orders, inventory] =
        await Promise.all([...catalogPromises, ...opPromises]);

      // PRODUCTS
      if (products.data && typeof PRODUCTS !== 'undefined') {
        PRODUCTS.length = 0;
        products.data.forEach(p => {
          let imgVal = p.img;
          if (imgVal && imgVal.startsWith('blob:')) imgVal = null;
          PRODUCTS.push({
            id: p.id, name: p.name, cat: p.cat, price: Number(p.price),
            desc: p.desc, img: imgVal, mods: p.mods || [], active: p.active !== false,
          });
        });
      }

      // CATS
      if (categories.data && typeof CATS !== 'undefined') {
        CATS.length = 0;
        CATS.push('Todos');
        categories.data.forEach(c => CATS.push(c.name));
      }

      // MODS
      if (modifiers.data && typeof MODS !== 'undefined') {
        Object.keys(MODS).forEach(k => delete MODS[k]);
        modifiers.data.forEach(m => {
          MODS[m.name] = {
            required: m.required, max: m.max_select,
            label: m.label || '', options: m.options || [],
          };
        });
      }

      // DESCUENTOS
      if (discounts.data && typeof DESCUENTOS !== 'undefined') {
        DESCUENTOS.length = 0;
        discounts.data.forEach(d => DESCUENTOS.push({
          id: d.id, name: d.name, desc: d.description,
          type: d.type, value: Number(d.value), active: d.active,
        }));
      }

      // CLIENTES
      if (customers.data && typeof CLIENTES_MOCK !== 'undefined') {
        CLIENTES_MOCK.length = 0;
        customers.data.forEach(c => CLIENTES_MOCK.push({
          id: c.id, name: c.name, phone: c.phone, pts: c.pts,
          next: c.next, tier: c.tier, spend: Number(c.spend),
          orders: c.orders, last: c.last, vip: c.vip,
          bday: c.bday, since: c.since, note: c.note,
          favs: c.favs || [],
        }));
      }

      // BRANCHES
      if (branches.data && typeof BRANCHES !== 'undefined') {
        BRANCHES.length = 0;
        branches.data.forEach(b => BRANCHES.push({
          id: b.id, name: b.name, emoji: b.emoji, class: b.class,
          addr: b.addr, tel: b.tel, hours: b.hours,
          principal: b.principal, status: b.status,
          today: Number(b.today), ordenesHoy: b.ordenes_hoy,
          ticket: Number(b.ticket), vsAyer: b.vs_ayer,
          semana: Number(b.semana), clubActivos: b.club_activos,
          top: b.top || [],
        }));
      }

      // PARKED
      if (parkedOrders.data && typeof parked !== 'undefined') {
        parked.length = 0;
        parkedOrders.data.forEach(p => parked.push({
          id: p.id, label: p.label, items: p.items,
          client: p.client, svc: p.svc,
        }));
      }

      // SETTINGS
      if (settings.data && settings.data.data && typeof AJ !== 'undefined') {
        Object.assign(AJ, settings.data.data);
      }

      // ORDERS
      if (orders.data && typeof ORDERS_MOCK !== 'undefined') {
        ORDERS_MOCK.length = 0;
        orders.data.forEach(o => ORDERS_MOCK.push(mapOrderFromDB(o)));
      }

      // INVENTARIO
      if (inventory.data && typeof INV_MOCK !== 'undefined') {
        INV_MOCK.length = 0;
        inventory.data.forEach(i => INV_MOCK.push({
          sku: i.sku, name: i.name, cat: i.cat || '', ico: i.ico || '📦',
          qty: Number(i.qty) || 0, unit: i.unit || 'u',
          min: Number(i.min_qty) || 0, max: Number(i.max_qty) || 0,
          cost: Number(i.cost) || 0,
        }));
      }

      // Re-renderizar
      if (typeof renderProducts === 'function') renderProducts();
      if (typeof renderCats === 'function') renderCats();
      if (typeof renderOrderDrawer === 'function') renderOrderDrawer();
      if (typeof renderInvList === 'function' && document.querySelector('#screen-inventario.active')) renderInvList();

      showSyncStatus(`Conectado · ${(products.data?.length || 0)} productos`, 'ok');
      setTimeout(() => {
        const el = document.getElementById('lf-sync-status');
        if (el) el.style.opacity = '0.6';
      }, 2500);

      return true;
    } catch (err) {
      console.error('[LF-Sync] Load error:', err);
      showSyncStatus('Sin conexión · modo offline', 'offline');
      return false;
    }
  }

  /**
   * Recargar solo datos operativos para una sucursal (al hacer switchBranch).
   * No vuelve a bajar el catálogo (es global).
   */
  async function loadBranchData(branchId){
    if (branchId) setBranchHeader(branchId);
    showSyncStatus('Cargando sucursal…', 'sync');
    const safe = (p) => p.catch(err => ({ data: null, error: err }));

    try {
      const [orders, parkedOrders, inventory] = await Promise.all([
        safe(sb.from('orders').select('*').order('created_at', { ascending: false }).limit(50)),
        safe(sb.from('parked_orders').select('*').order('created_at', { ascending: false })),
        safe(sb.from('inventory').select('*').order('cat', { ascending: true })),
      ]);

      if (orders.data && typeof ORDERS_MOCK !== 'undefined') {
        ORDERS_MOCK.length = 0;
        orders.data.forEach(o => ORDERS_MOCK.push(mapOrderFromDB(o)));
      }
      if (parkedOrders.data && typeof parked !== 'undefined') {
        parked.length = 0;
        parkedOrders.data.forEach(p => parked.push({
          id: p.id, label: p.label, items: p.items,
          client: p.client, svc: p.svc,
        }));
      }
      if (inventory.data && typeof INV_MOCK !== 'undefined') {
        INV_MOCK.length = 0;
        inventory.data.forEach(i => INV_MOCK.push({
          sku: i.sku, name: i.name, cat: i.cat || '', ico: i.ico || '📦',
          qty: Number(i.qty) || 0, unit: i.unit || 'u',
          min: Number(i.min_qty) || 0, max: Number(i.max_qty) || 0,
          cost: Number(i.cost) || 0,
        }));
      }

      showSyncStatus('Sucursal cargada ✓', 'ok');
      setTimeout(() => {
        const el = document.getElementById('lf-sync-status');
        if (el) el.style.opacity = '0.6';
      }, 1500);
    } catch (err) {
      console.error('[LF-Sync] loadBranchData:', err);
      showSyncStatus('Error cargando sucursal', 'error');
    }
  }

  /**
   * Traer un rango de órdenes (para historial paginado).
   * Útil cuando el usuario quiere ver "ayer" o "esta semana"
   * y no están en los últimos 50.
   */
  async function fetchOrdersRange({ from, to, limit = 200 } = {}){
    let q = sb.from('orders').select('*').order('created_at', { ascending: false }).limit(limit);
    if (from) q = q.gte('created_at', from);
    if (to)   q = q.lte('created_at', to);
    const { data, error } = await q;
    if (error) { console.error('[LF-Sync] fetchOrdersRange:', error); return []; }
    return (data || []).map(mapOrderFromDB);
  }

  function mapOrderFromDB(o){
    return {
      id: o.id, n: o.n, time: o.time,
      items: o.items || [],
      client: o.client || '',
      customer_id: o.customer_id || null,
      svc: o.svc, pay: o.pay,
      subtotal: Number(o.subtotal) || 0,
      discount: Number(o.discount) || 0,
      iva: Number(o.iva) || 0,
      tip: Number(o.tip) || 0,
      fee: Number(o.fee) || 0,
      total: Number(o.total),
      status: o.status,
      refund: o.refund || null,
      cashier_pin: o.cashier_pin || null,
      branch_id: o.branch_id || null,
      created_at: o.created_at,
    };
  }

  // ── PUSH ──────────────────────────────────────────────────────
  const debounce = (fn, ms = 600) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  async function pushProducts(){
    if (typeof PRODUCTS === 'undefined') return;
    showSyncStatus('Guardando…', 'sync');
    const rows = PRODUCTS.map((p, idx) => ({
      id: p.id, name: p.name, cat: p.cat, price: p.price,
      desc: p.desc || '',
      img: (p.img && !p.img.startsWith('blob:')) ? p.img : null,
      mods: p.mods || [], active: p.active !== false, position: idx,
    }));
    const totalBytes = JSON.stringify(rows).length;
    if (totalBytes > 4 * 1024 * 1024) {
      console.warn('[LF-Sync] Payload grande:', (totalBytes / 1024 / 1024).toFixed(1), 'MB');
    }
    window._lastProductPush = Date.now();
    const { error } = await sb.from('products').upsert(rows, { onConflict: 'id' });
    if (error) {
      showSyncStatus('Error guardando', 'error');
      console.error('[LF-Sync] pushProducts:', error);
      if (typeof showToast === 'function') {
        showToast('⚠ Error guardando: ' + (error.message || error.code || 'desconocido'), 0, '⚠️');
      }
    } else {
      showSyncStatus('Guardado ✓', 'ok');
    }
  }

  // Push de UN solo producto (cuando solo cambia uno, no re-subir todo)
  async function pushProduct(p){
    if (!p || !p.id) return;
    const row = {
      id: p.id, name: p.name, cat: p.cat, price: p.price,
      desc: p.desc || '',
      img: (p.img && !p.img.startsWith('blob:')) ? p.img : null,
      mods: p.mods || [], active: p.active !== false,
    };
    window._lastProductPush = Date.now();
    const { error } = await sb.from('products').upsert([row], { onConflict: 'id' });
    if (error) console.error('[LF-Sync] pushProduct:', error);
  }

  async function pushCategories(){
    if (typeof CATS === 'undefined') return;
    const rows = CATS.filter(c => c !== 'Todos').map((name, idx) => ({ name, position: idx }));
    if (!rows.length) return;
    const { error } = await sb.from('categories').upsert(rows, { onConflict: 'name' });
    if (error) console.error('[LF-Sync] cat:', error);
  }

  async function pushModifiers(){
    if (typeof MODS === 'undefined') return;
    const rows = Object.entries(MODS).map(([name, m]) => ({
      name, required: m.required, max_select: m.max,
      label: m.label || '', options: m.options || [],
    }));
    if (!rows.length) return;
    const { error } = await sb.from('modifiers').upsert(rows, { onConflict: 'name' });
    if (error) console.error('[LF-Sync] mods:', error);
  }

  async function pushDiscounts(){
    if (typeof DESCUENTOS === 'undefined') return;
    const rows = DESCUENTOS.map(d => ({
      id: d.id, name: d.name, description: d.desc || '',
      type: d.type, value: d.value, active: d.active,
    }));
    if (!rows.length) return;
    await sb.from('discounts').upsert(rows, { onConflict: 'id' });
  }

  async function pushCustomer(c){
    if (!c) return;
    const row = {
      id: c.id, name: c.name, phone: c.phone, pts: c.pts,
      next: c.next, tier: c.tier, spend: c.spend, orders: c.orders,
      last: c.last, vip: c.vip, bday: c.bday, since: c.since,
      note: c.note, favs: c.favs || [],
    };
    await sb.from('customers').upsert([row], { onConflict: 'id' });
  }

  async function pushAllCustomers(){
    if (typeof CLIENTES_MOCK === 'undefined' || !CLIENTES_MOCK.length) return;
    const rows = CLIENTES_MOCK.map(c => ({
      id: c.id, name: c.name, phone: c.phone, pts: c.pts,
      next: c.next, tier: c.tier, spend: c.spend, orders: c.orders,
      last: c.last, vip: c.vip, bday: c.bday, since: c.since,
      note: c.note, favs: c.favs || [],
    }));
    const { error } = await sb.from('customers').upsert(rows, { onConflict: 'id' });
    if (error) console.error('[LF-Sync] customers batch:', error);
  }

  async function pushBranches(){
    if (typeof BRANCHES === 'undefined' || !BRANCHES.length) return;
    const rows = BRANCHES.map(b => ({
      id: b.id, name: b.name, emoji: b.emoji, class: b.class,
      addr: b.addr || '', tel: b.tel || '', hours: b.hours || '',
      principal: !!b.principal, status: b.status || 'open',
    }));
    const { error } = await sb.from('branches').upsert(rows, { onConflict: 'id' });
    if (error) console.error('[LF-Sync] branches:', error);
  }

  async function deleteBranch(id){
    if (!id) return;
    const { error } = await sb.from('branches').delete().eq('id', id);
    if (error) console.error('[LF-Sync] deleteBranch:', error);
  }

  async function pushInventoryItem(item){
    if (!item || !item.sku) return;
    const row = {
      sku: item.sku, name: item.name, cat: item.cat || '', ico: item.ico || '📦',
      qty: Number(item.qty) || 0, unit: item.unit || 'u',
      min_qty: Number(item.min) || 0, max_qty: Number(item.max) || 0,
      cost: Number(item.cost) || 0,
    };
    const { error } = await sb.from('inventory').upsert([row], { onConflict: 'sku' });
    if (error) console.error('[LF-Sync] inventory item:', error);
  }

  async function pushInventory(){
    if (typeof INV_MOCK === 'undefined' || !INV_MOCK.length) return;
    const rows = INV_MOCK.map(i => ({
      sku: i.sku, name: i.name, cat: i.cat || '', ico: i.ico || '📦',
      qty: Number(i.qty) || 0, unit: i.unit || 'u',
      min_qty: Number(i.min) || 0, max_qty: Number(i.max) || 0,
      cost: Number(i.cost) || 0,
    }));
    const { error } = await sb.from('inventory').upsert(rows, { onConflict: 'sku' });
    if (error) console.error('[LF-Sync] inventory:', error);
  }

  async function deleteInventoryItem(sku){
    if (!sku) return;
    const { error } = await sb.from('inventory').delete().eq('sku', sku);
    if (error) console.error('[LF-Sync] deleteInventory:', error);
  }

  // ── COLA OFFLINE ──────────────────────────────────────────────
  const PENDING_KEY = 'lf_pending_orders';

  function getPending(){
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
    catch { return []; }
  }

  function setPending(arr){
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); }
    catch {}
  }

  function queuePendingOrder(row){
    const q = getPending();
    q.push({ ...row, queued_at: Date.now(), attempts: 0 });
    setPending(q);
    updateStatusBadge();
  }

  function updateStatusBadge(){
    const pending = getPending().length;
    if (pending > 0) {
      showSyncStatus(`Sin conexión · ${pending} pendiente${pending > 1 ? 's' : ''}`, 'offline');
    }
  }

  // Flush con batch insert + backoff
  let _flushInProgress = false;
  async function flushPendingOrders(){
    if (_flushInProgress) return;
    const q = getPending();
    if (!q.length) return;
    _flushInProgress = true;

    try {
      // Batch insert: una sola request para todas
      const payloads = q.map(r => {
        const { queued_at, attempts, ...payload } = r;
        return payload;
      });

      const { error } = await sb.from('orders').insert(payloads);
      if (!error) {
        setPending([]);
        if (typeof showToast === 'function') {
          showToast(`${q.length} venta(s) sincronizada(s) ✓`, 0, '☁️');
        }
        return;
      }

      // Si falla el batch, intentar uno por uno (puede que solo una sea inválida)
      const remaining = [];
      for (const row of q) {
        const { queued_at, attempts, ...payload } = row;
        const { error: e2 } = await sb.from('orders').insert([payload]);
        if (e2) {
          remaining.push({ ...row, attempts: (row.attempts || 0) + 1 });
        }
      }
      setPending(remaining);
      const subidas = q.length - remaining.length;
      if (subidas > 0 && typeof showToast === 'function') {
        showToast(`${subidas} venta(s) sincronizada(s) ✓`, 0, '☁️');
      }
    } finally {
      _flushInProgress = false;
    }
  }

  const flushPendingDebounced = debounce(flushPendingOrders, 2000);

  async function pushOrder(o){
    const row = {
      n: o.n, time: o.time, items: o.items,
      client: o.client || '',
      customer_id: o.customer_id || null,
      svc: o.svc || 'mostrador',
      pay: o.pay || 'efectivo',
      subtotal: o.subtotal || 0,
      discount: o.discount || 0,
      iva: o.iva || 0,
      tip: o.tip || 0,
      fee: o.fee || 0,
      total: o.total,
      status: o.status || 'completada',
      branch_id: authState.branch || (typeof currentBranchId !== 'undefined' ? currentBranchId : 'balbuena'),
      cashier_pin: authState.pin || ((typeof ROLE !== 'undefined' && ROLE.user) ? ROLE.user.pin : null),
    };

    try {
      const { error, data } = await sb.from('orders').insert([row]).select();
      if (error) {
        console.error('[LF-Sync] order:', error);
        queuePendingOrder(row);
        return null;
      }
      flushPendingDebounced();
      return data?.[0];
    } catch (err) {
      console.error('[LF-Sync] order (network):', err);
      queuePendingOrder(row);
      return null;
    }
  }

  async function updateOrder(orderNumber, patch){
    if (!orderNumber || !patch) return null;
    const { error, data } = await sb.from('orders')
      .update(patch)
      .eq('n', orderNumber)
      .select();
    if (error) { console.error('[LF-Sync] updateOrder:', error); return null; }
    return data?.[0];
  }

  async function fetchTodayOrders(){
    try {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const { data, error } = await sb.from('orders').select('*')
        .gte('created_at', startOfDay)
        .order('created_at', { ascending: false });
      if (error) { console.error('[LF-Sync] fetchTodayOrders:', error); return null; }
      return data || [];
    } catch (err) {
      console.error('[LF-Sync] fetchTodayOrders network:', err);
      return null;
    }
  }

  async function pushParked(){
    if (typeof parked === 'undefined') return;
    const branchId = authState.branch || (typeof currentBranchId !== 'undefined' ? currentBranchId : 'balbuena');

    // 1) Saber qué hay en el servidor para esta sucursal
    const { data: remote } = await sb.from('parked_orders')
      .select('id')
      .eq('branch_id', branchId);
    const remoteIds = new Set((remote || []).map(r => r.id));
    const localIds = new Set(parked.filter(p => p.id).map(p => p.id));

    // 2) Lo que está en remoto pero no en local → borrar (con .in, no .not)
    const toDelete = [...remoteIds].filter(id => !localIds.has(id));
    if (toDelete.length) {
      await sb.from('parked_orders').delete().in('id', toDelete);
    }

    // 3) Upsert los actuales
    if (parked.length) {
      const rows = parked.map(p => ({
        ...(p.id ? { id: p.id } : {}),
        label: p.label, items: p.items,
        client: p.client || '', svc: p.svc,
        branch_id: branchId,
      }));
      const { error } = await sb.from('parked_orders').upsert(rows, { onConflict: 'id' });
      if (error) console.error('[LF-Sync] parked upsert:', error);
    }
  }

  async function pushSettings(){
    if (typeof AJ === 'undefined') return;
    await sb.from('app_settings').upsert(
      [{ id: 1, data: AJ, updated_at: new Date().toISOString() }],
      { onConflict: 'id' }
    );
  }

  // ── EXPONER ───────────────────────────────────────────────────
  window.LFSync = {
    // Auth
    verifyPin: async (pin) => {
      const u = await verifyPin(pin);
      if (u) {
        // Reinicializar realtime con los nuevos headers (rol/branch)
        // para que el suscriptor reciba updates según RLS
        try { setupRealtime(); } catch(e) { console.warn('Realtime re-init:', e); }
      }
      return u;
    },
    clearAuth,
    setBranchHeader: (id) => {
      setBranchHeader(id);
      // Re-suscribir realtime al nuevo branch
      try { setupRealtime(); } catch(e){}
    },
    authState,  // read-only externamente

    // Load
    load: loadFromSupabase,
    loadBranchData,
    fetchOrdersRange,
    fetchTodayOrders,

    // Push (catálogo)
    pushProducts,  // sin debounce: imágenes deben subir inmediato
    pushProduct,   // single — más eficiente
    pushCategories: debounce(pushCategories, 800),
    pushModifiers: debounce(pushModifiers, 800),
    pushDiscounts: debounce(pushDiscounts, 800),
    pushBranches: debounce(pushBranches, 800),
    deleteBranch,

    // Push (operativo)
    pushCustomer,
    pushAllCustomers: debounce(pushAllCustomers, 1200),
    pushInventory: debounce(pushInventory, 800),
    pushInventoryItem,
    deleteInventoryItem,
    pushOrder,
    updateOrder,
    pushParked: debounce(pushParked, 600),
    pushSettings: debounce(pushSettings, 1000),

    // Cola offline
    flushPendingOrders,
    pendingCount: () => getPending().length,
    pendingOrders: getPending,
    clearPending: () => setPending([]),  // emergencia

    // Status
    status: showSyncStatus,
  };

  // ── EVENTOS DE RED ────────────────────────────────────────────
  window.addEventListener('online', () => {
    showSyncStatus('Conexión restablecida · sincronizando…', 'sync');
    flushPendingOrders().then(() => loadFromSupabase());
  });
  window.addEventListener('offline', () => {
    showSyncStatus('Sin conexión · modo offline', 'offline');
  });

  // ── REALTIME ──────────────────────────────────────────────────
  let realtimeChannels = [];

  function setupRealtime(){
    // Limpiar canales viejos si los hay (reconnect tras switchBranch)
    realtimeChannels.forEach(ch => { try { sb.removeChannel(ch); } catch(e){} });
    realtimeChannels = [];

    const branchId = authState.branch || (typeof currentBranchId !== 'undefined' ? currentBranchId : null);
    const branchFilter = branchId ? `branch_id=eq.${branchId}` : undefined;

    // INSERT orders
    const insCh = sb.channel('lf-orders-ins-' + (branchId || 'all'))
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders', filter: branchFilter },
        (payload) => {
          const o = payload.new;
          if (!o || typeof ORDERS_MOCK === 'undefined') return;
          const exists = ORDERS_MOCK.find(x => (x.id && x.id === o.id) || (x.n === o.n && x.time === o.time));
          if (!exists) {
            ORDERS_MOCK.unshift(mapOrderFromDB(o));
            if (typeof renderHistList === 'function' && document.querySelector('#screen-historial.active')) {
              renderHistList();
            }
            if (typeof showToast === 'function') {
              showToast(`Nueva venta · #${o.n} · $${o.total}`, 0, '🛎️');
            }
          }
        }
      ).subscribe();
    realtimeChannels.push(insCh);

    // UPDATE orders
    const updCh = sb.channel('lf-orders-upd-' + (branchId || 'all'))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: branchFilter },
        (payload) => {
          const o = payload.new;
          if (!o || typeof ORDERS_MOCK === 'undefined') return;
          const local = ORDERS_MOCK.find(x => (x.id && x.id === o.id) || x.n === o.n);
          if (local) {
            local.status = o.status;
            local.refund = o.refund || null;
            if (typeof renderHistList === 'function' && document.querySelector('#screen-historial.active')) {
              renderHistList();
            }
            if (o.status === 'reembolsada' && typeof showToast === 'function') {
              showToast(`Orden #${o.n} reembolsada`, 0, '↩');
            }
          }
        }
      ).subscribe();
    realtimeChannels.push(updCh);

    // PRODUCTS (cambios en catálogo afectan a todas las sucursales)
    const prodCh = sb.channel('lf-products')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        () => {
          if (window._lastProductPush && (Date.now() - window._lastProductPush) < 3000) return;
          sb.from('products').select('*').order('position').then(({ data }) => {
            if (!data || typeof PRODUCTS === 'undefined') return;
            PRODUCTS.length = 0;
            data.forEach(p => PRODUCTS.push({
              id: p.id, name: p.name, cat: p.cat, price: Number(p.price),
              desc: p.desc,
              img: (p.img && !p.img.startsWith('blob:')) ? p.img : null,
              mods: p.mods || [], active: p.active !== false,
            }));
            if (typeof renderProducts === 'function') renderProducts();
          });
        }
      ).subscribe();
    realtimeChannels.push(prodCh);

    // CUSTOMERS
    const custCh = sb.channel('lf-customers')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'customers' },
        () => {
          sb.from('customers').select('*').then(({ data }) => {
            if (!data || typeof CLIENTES_MOCK === 'undefined') return;
            CLIENTES_MOCK.length = 0;
            data.forEach(c => CLIENTES_MOCK.push({
              id: c.id, name: c.name, phone: c.phone, pts: c.pts,
              next: c.next, tier: c.tier, spend: Number(c.spend),
              orders: c.orders, last: c.last, vip: c.vip,
              bday: c.bday, since: c.since, note: c.note, favs: c.favs || [],
            }));
            if (typeof renderCliList === 'function' && document.querySelector('#screen-clientes.active')) renderCliList();
          });
        }
      ).subscribe();
    realtimeChannels.push(custCh);
  }

  // Interceptar persistAll para push global (compatibilidad)
  if (typeof window.persistAll === 'function') {
    const oldPersist = window.persistAll;
    window.persistAll = function(){
      oldPersist();
      // Solo pushear si hay sesión activa
      if (!authState.role) return;
      window.LFSync.pushCategories();
      window.LFSync.pushModifiers();
      window.LFSync.pushDiscounts();
      window.LFSync.pushAllCustomers();
      window.LFSync.pushBranches();
      window.LFSync.pushInventory();
      window.LFSync.pushParked();
      window.LFSync.pushSettings();
      // NOTA: products NO se pushea aquí. Se pushea explícitamente
      // en saveProd() con pushProduct(p) (single) o pushProducts() (todos).
    };
  }

  // ── INIT ──────────────────────────────────────────────────────
  async function init(){
    // Restaurar sucursal del último uso
    try {
      const savedBranch = localStorage.getItem('lf_currentBranch');
      if (savedBranch) {
        authState.branch = savedBranch;
        if (typeof window !== 'undefined') {
          window.currentBranchId = savedBranch;
        }
      }
    } catch(e){}

    await loadFromSupabase();
    setupRealtime();
    flushPendingOrders();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
