/* ═══════════════════════════════════════════════════════════════
   LADY FRESA POS · Supabase Sync Module
   ─────────────────────────────────────────────────────────────
   Conecta los arrays globales (PRODUCTS, CATS, MODS, etc.) con
   Supabase. localStorage queda como cache offline.

   Uso:
   1. Cargar @supabase/supabase-js antes de este archivo
   2. Cargar este archivo después de que se hayan definido los
      arrays globales (PRODUCTS, etc.) — al final del index.html
   ═══════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  // ── CONFIG (cambiar si rotas keys) ────────────────────────────
  const SUPABASE_URL = 'https://cohskhrjecuwqlqhjvnh.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_vJD6-jqKNPVTV0YZt2Q4NQ_p0SmB5e0';

  if(typeof window.supabase === 'undefined' || !window.supabase.createClient){
    console.error('[LF-Sync] supabase-js no está cargado. Agrega <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> antes de supabase-sync.js');
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });
  window.lfdb = sb;

  // ── UI HELPERS ────────────────────────────────────────────────
  function showSyncStatus(text, type){
    let el = document.getElementById('lf-sync-status');
    if(!el){
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
        transition: all 0.3s;
      `;
      el.innerHTML = '<span class="lf-sync-dot"></span><span class="lf-sync-text"></span>';
      document.body.appendChild(el);
    }
    const dot = el.querySelector('.lf-sync-dot');
    const txt = el.querySelector('.lf-sync-text');
    txt.textContent = text;
    const colors = {
      ok:    {bg:'#E0F5E0', col:'#0a7d2f', dot:'#0a7d2f'},
      sync:  {bg:'#FFF6DC', col:'#9A6B0F', dot:'#9A6B0F'},
      error: {bg:'#FBE4E9', col:'#A6182E', dot:'#A6182E'},
      offline: {bg:'#EEE', col:'#666', dot:'#999'},
    };
    const c = colors[type] || colors.ok;
    el.style.background = c.bg;
    el.style.color = c.col;
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${c.dot};box-shadow:0 0 0 2px ${c.bg};`;
  }

  // ── LOAD: bajar todo de Supabase ──────────────────────────────
  async function loadFromSupabase(){
    showSyncStatus('Sincronizando…', 'sync');
    // Wrapper que captura errores por query individual (tabla puede no existir)
    const safe = (promise) => promise.catch(err => {
      console.warn('[LF-Sync] Query falló (¿tabla no existe?):', err?.message || err);
      return { data: null, error: err };
    });
    try {
      const [products, categories, modifiers, discounts, customers, users, branches, parkedOrders, settings, orders, inventory] = await Promise.all([
        safe(sb.from('products').select('*').order('position', {ascending:true})),
        safe(sb.from('categories').select('*').order('position', {ascending:true})),
        safe(sb.from('modifiers').select('*')),
        safe(sb.from('discounts').select('*')),
        safe(sb.from('customers').select('*')),
        safe(sb.from('app_users').select('*')),
        safe(sb.from('branches').select('*')),
        safe(sb.from('parked_orders').select('*').order('created_at', {ascending:false})),
        safe(sb.from('app_settings').select('*').eq('id',1).maybeSingle()),
        safe(sb.from('orders').select('*').order('created_at', {ascending:false}).limit(100)),
        safe(sb.from('inventory').select('*').order('cat', {ascending:true})),
      ]);

      // PRODUCTS
      if(products.data && typeof PRODUCTS !== 'undefined'){
        PRODUCTS.length = 0;
        products.data.forEach(p => {
          let imgVal = p.img;
          // Ignorar blob: URLs (solo válidas en una sesión)
          if(imgVal && imgVal.startsWith('blob:')) imgVal = null;
          PRODUCTS.push({
            id: p.id, name: p.name, cat: p.cat, price: Number(p.price),
            desc: p.desc, img: imgVal, mods: p.mods || [], active: p.active !== false,
          });
        });
      }

      // CATS (incluye "Todos" al inicio)
      if(categories.data && typeof CATS !== 'undefined'){
        CATS.length = 0;
        CATS.push('Todos');
        categories.data.forEach(c => CATS.push(c.name));
      }

      // MODS
      if(modifiers.data && typeof MODS !== 'undefined'){
        Object.keys(MODS).forEach(k => delete MODS[k]);
        modifiers.data.forEach(m => {
          MODS[m.name] = {
            required: m.required, max: m.max_select,
            label: m.label || '', options: m.options || [],
          };
        });
      }

      // DESCUENTOS
      if(discounts.data && typeof DESCUENTOS !== 'undefined'){
        DESCUENTOS.length = 0;
        discounts.data.forEach(d => DESCUENTOS.push({
          id: d.id, name: d.name, desc: d.description,
          type: d.type, value: Number(d.value), active: d.active,
        }));
      }

      // CLIENTES
      if(customers.data && typeof CLIENTES_MOCK !== 'undefined'){
        CLIENTES_MOCK.length = 0;
        customers.data.forEach(c => CLIENTES_MOCK.push({
          id: c.id, name: c.name, phone: c.phone, pts: c.pts,
          next: c.next, tier: c.tier, spend: Number(c.spend),
          orders: c.orders, last: c.last, vip: c.vip,
          bday: c.bday, since: c.since, note: c.note,
          favs: c.favs || [],
        }));
      }

      // USUARIOS
      if(users.data && typeof USUARIOS !== 'undefined'){
        USUARIOS.length = 0;
        users.data.forEach(u => USUARIOS.push({
          pin: u.pin, nombre: u.nombre, alias: u.alias || u.nombre,
          rol: u.rol, emoji: u.emoji, color: u.color,
        }));
      }

      // BRANCHES
      if(branches.data && typeof BRANCHES !== 'undefined'){
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
      if(parkedOrders.data && typeof parked !== 'undefined'){
        parked.length = 0;
        parkedOrders.data.forEach(p => parked.push({
          id: p.id, label: p.label, items: p.items,
          client: p.client, svc: p.svc,
        }));
      }

      // SETTINGS
      if(settings.data && settings.data.data && typeof AJ !== 'undefined'){
        Object.assign(AJ, settings.data.data);
      }

      // ORDERS (historial)
      if(orders.data && typeof ORDERS_MOCK !== 'undefined'){
        ORDERS_MOCK.length = 0;
        orders.data.forEach(o => ORDERS_MOCK.push({
          id: o.id, // UUID de Supabase, útil para updates posteriores
          n: o.n, time: o.time,
          items: o.items || [],
          client: o.client || '',
          svc: o.svc, pay: o.pay,
          subtotal: Number(o.subtotal) || 0,
          discount: Number(o.discount) || 0,
          iva: Number(o.iva) || 0,
          fee: Number(o.fee) || 0,
          total: Number(o.total),
          status: o.status,
          refund: o.refund || null,
          cashier_pin: o.cashier_pin || null,
          branch_id: o.branch_id || null,
          created_at: o.created_at,
        }));
      }

      // INVENTARIO
      if(inventory.data && typeof INV_MOCK !== 'undefined'){
        INV_MOCK.length = 0;
        inventory.data.forEach(i => INV_MOCK.push({
          sku: i.sku,
          name: i.name,
          cat: i.cat || '',
          ico: i.ico || '📦',
          qty: Number(i.qty) || 0,
          unit: i.unit || 'u',
          min: Number(i.min_qty) || 0,
          max: Number(i.max_qty) || 0,
          cost: Number(i.cost) || 0,
        }));
      }

      // Re-renderizar
      if(typeof renderProducts === 'function') renderProducts();
      if(typeof renderCats === 'function') renderCats();
      if(typeof renderOrderDrawer === 'function') renderOrderDrawer();
      if(typeof renderLoginChips === 'function') renderLoginChips();
      if(typeof renderInvList === 'function' && document.querySelector('#screen-inventario.active')) renderInvList();

      showSyncStatus('Conectado · ' + (products.data?.length||0) + ' productos', 'ok');
      setTimeout(()=>{ const el=document.getElementById('lf-sync-status'); if(el) el.style.opacity='0.6'; }, 2500);

      return true;
    } catch(err){
      console.error('[LF-Sync] Load error:', err);
      showSyncStatus('Sin conexión · modo offline', 'offline');
      return false;
    }
  }

  // ── PUSH: subir cambios específicos ───────────────────────────
  const debounce = (fn, ms=600) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
  };

  async function pushProducts(){
    if(typeof PRODUCTS === 'undefined') return;
    showSyncStatus('Guardando…', 'sync');
    const rows = PRODUCTS.map((p, idx) => ({
      id: p.id, name: p.name, cat: p.cat, price: p.price,
      desc: p.desc || '',
      // Ignorar blob: URLs (solo válidas en la sesión actual)
      img: (p.img && !p.img.startsWith('blob:')) ? p.img : null,
      mods: p.mods || [], active: p.active !== false, position: idx,
    }));
    // Calcular tamaño total para detectar payloads grandes
    const totalBytes = JSON.stringify(rows).length;
    if(totalBytes > 1024 * 1024 * 4){
      // Más de 4 MB → muy probable que falle el upload
      console.warn('[LF-Sync] Payload muy grande:', (totalBytes/1024/1024).toFixed(1), 'MB');
    }
    // Marcar timestamp del push para que el realtime no sobrescriba inmediatamente
    window._lastProductPush = Date.now();
    const { error } = await sb.from('products').upsert(rows, {onConflict:'id'});
    if(error){
      showSyncStatus('Error guardando', 'error');
      console.error('[LF-Sync] pushProducts error:', error);
      if(typeof showToast === 'function'){
        showToast('⚠ Error guardando: ' + (error.message || error.code || 'desconocido'), 0, '⚠️');
      }
    } else {
      showSyncStatus('Guardado ✓', 'ok');
    }
  }

  async function pushCategories(){
    if(typeof CATS === 'undefined') return;
    const rows = CATS.filter(c => c !== 'Todos').map((name, idx) => ({
      name, position: idx,
    }));
    if(!rows.length) return;
    const { error } = await sb.from('categories').upsert(rows, {onConflict:'name'});
    if(error) console.error('[LF-Sync] cat:', error);
  }

  async function pushModifiers(){
    if(typeof MODS === 'undefined') return;
    const rows = Object.entries(MODS).map(([name, m]) => ({
      name, required: m.required, max_select: m.max,
      label: m.label || '', options: m.options || [],
    }));
    if(!rows.length) return;
    const { error } = await sb.from('modifiers').upsert(rows, {onConflict:'name'});
    if(error) console.error('[LF-Sync] mods:', error);
  }

  async function pushDiscounts(){
    if(typeof DESCUENTOS === 'undefined') return;
    const rows = DESCUENTOS.map(d => ({
      id: d.id, name: d.name, description: d.desc || '',
      type: d.type, value: d.value, active: d.active,
    }));
    if(!rows.length) return;
    await sb.from('discounts').upsert(rows, {onConflict:'id'});
  }

  async function pushCustomer(c){
    if(!c) return;
    const row = {
      id: c.id, name: c.name, phone: c.phone, pts: c.pts,
      next: c.next, tier: c.tier, spend: c.spend, orders: c.orders,
      last: c.last, vip: c.vip, bday: c.bday, since: c.since,
      note: c.note, favs: c.favs || [],
    };
    await sb.from('customers').upsert([row], {onConflict:'id'});
  }
  async function pushAllCustomers(){
    if(typeof CLIENTES_MOCK === 'undefined' || !CLIENTES_MOCK.length) return;
    // Batch upsert: una sola llamada para todos los clientes
    const rows = CLIENTES_MOCK.map(c => ({
      id: c.id, name: c.name, phone: c.phone, pts: c.pts,
      next: c.next, tier: c.tier, spend: c.spend, orders: c.orders,
      last: c.last, vip: c.vip, bday: c.bday, since: c.since,
      note: c.note, favs: c.favs || [],
    }));
    const { error } = await sb.from('customers').upsert(rows, {onConflict:'id'});
    if(error) console.error('[LF-Sync] customers batch:', error);
  }

  async function pushUsers(){
    if(typeof USUARIOS === 'undefined') return;
    const rows = USUARIOS.map(u => ({
      pin: u.pin, nombre: u.nombre, alias: u.alias,
      rol: u.rol, emoji: u.emoji, color: u.color, active: true,
    }));
    await sb.from('app_users').upsert(rows, {onConflict:'pin'});
  }

  async function pushBranches(){
    if(typeof BRANCHES === 'undefined' || !BRANCHES.length) return;
    const rows = BRANCHES.map(b => ({
      id: b.id, name: b.name, emoji: b.emoji, class: b.class,
      addr: b.addr || '', tel: b.tel || '', hours: b.hours || '',
      principal: !!b.principal, status: b.status || 'open',
    }));
    const { error } = await sb.from('branches').upsert(rows, {onConflict:'id'});
    if(error) console.error('[LF-Sync] branches:', error);
  }

  async function deleteBranch(id){
    if(!id) return;
    const { error } = await sb.from('branches').delete().eq('id', id);
    if(error) console.error('[LF-Sync] deleteBranch:', error);
  }

  async function pushInventory(){
    if(typeof INV_MOCK === 'undefined' || !INV_MOCK.length) return;
    const rows = INV_MOCK.map(i => ({
      sku: i.sku,
      name: i.name,
      cat: i.cat || '',
      ico: i.ico || '📦',
      qty: Number(i.qty) || 0,
      unit: i.unit || 'u',
      min_qty: Number(i.min) || 0,
      max_qty: Number(i.max) || 0,
      cost: Number(i.cost) || 0,
    }));
    const { error } = await sb.from('inventory').upsert(rows, {onConflict:'sku'});
    if(error) console.error('[LF-Sync] inventory:', error);
  }
  async function pushInventoryItem(item){
    if(!item || !item.sku) return;
    const row = {
      sku: item.sku, name: item.name, cat: item.cat || '', ico: item.ico || '📦',
      qty: Number(item.qty) || 0, unit: item.unit || 'u',
      min_qty: Number(item.min) || 0, max_qty: Number(item.max) || 0,
      cost: Number(item.cost) || 0,
    };
    const { error } = await sb.from('inventory').upsert([row], {onConflict:'sku'});
    if(error) console.error('[LF-Sync] inventory item:', error);
  }
  async function deleteInventoryItem(sku){
    if(!sku) return;
    const { error } = await sb.from('inventory').delete().eq('sku', sku);
    if(error) console.error('[LF-Sync] deleteInventory:', error);
  }

  // ── COLA OFFLINE para órdenes que no pudieron subir ───────────
  const PENDING_KEY = 'lf_pending_orders';
  function getPending(){
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
  }
  function setPending(arr){
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); } catch {}
  }
  function queuePendingOrder(row){
    const q = getPending();
    q.push({ ...row, queued_at: Date.now() });
    setPending(q);
  }
  async function flushPendingOrders(){
    const q = getPending();
    if(!q.length) return;
    const remaining = [];
    for(const row of q){
      const { queued_at, ...payload } = row;
      const { error } = await sb.from('orders').insert([payload]);
      if(error){ remaining.push(row); }
    }
    setPending(remaining);
    if(q.length > remaining.length){
      const subidas = q.length - remaining.length;
      if(typeof showToast === 'function') showToast(`${subidas} venta(s) sincronizada(s) ✓`, 0, '☁️');
    }
  }

  async function pushOrder(o){
    const row = {
      n: o.n, time: o.time, items: o.items,
      client: o.client || '',
      svc: o.svc || 'mostrador',
      pay: o.pay || 'efectivo',
      subtotal: o.subtotal || 0,
      discount: o.discount || 0,
      iva: o.iva || 0,
      fee: o.fee || 0,
      total: o.total,
      status: o.status || 'completada',
      branch_id: typeof currentBranchId !== 'undefined' ? currentBranchId : 'balbuena',
      cashier_pin: (typeof ROLE !== 'undefined' && ROLE.user) ? ROLE.user.pin : null,
    };
    try {
      const { error, data } = await sb.from('orders').insert([row]).select();
      if(error){
        console.error('[LF-Sync] order:', error);
        // Encolar para reintento
        queuePendingOrder(row);
        return null;
      }
      // Aprovechar para vaciar la cola si hay pendientes
      flushPendingOrders();
      return data?.[0];
    } catch(err){
      console.error('[LF-Sync] order (network):', err);
      queuePendingOrder(row);
      return null;
    }
  }

  // Actualizar una orden existente (típicamente para refunds)
  async function updateOrder(orderNumber, patch){
    if(!orderNumber || !patch) return null;
    const { error, data } = await sb.from('orders')
      .update(patch)
      .eq('n', orderNumber)
      .select();
    if(error){ console.error('[LF-Sync] updateOrder:', error); return null; }
    return data?.[0];
  }

  // Traer ventas del día actual para la sucursal actual.
  // Útil para el corte de caja, donde no queremos depender del cache local.
  async function fetchTodayOrders(){
    try {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const branchId = typeof currentBranchId !== 'undefined' ? currentBranchId : null;
      let q = sb.from('orders').select('*')
        .gte('created_at', startOfDay)
        .order('created_at', {ascending: false});
      if(branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if(error){ console.error('[LF-Sync] fetchTodayOrders:', error); return null; }
      return data || [];
    } catch(err){
      console.error('[LF-Sync] fetchTodayOrders (network):', err);
      return null;
    }
  }

  async function pushParked(){
    if(typeof parked === 'undefined') return;
    // Estrategia: upsert los actuales, luego borrar los que el servidor tiene pero local ya no
    const localIds = parked.filter(p => p.id).map(p => p.id);

    if(parked.length){
      const rows = parked.map(p => ({
        // Si tiene id (uuid de Supabase) lo respetamos, si no Postgres genera uno
        ...(p.id ? {id: p.id} : {}),
        label: p.label, items: p.items,
        client: p.client || '', svc: p.svc,
        branch_id: typeof currentBranchId !== 'undefined' ? currentBranchId : 'balbuena',
      }));
      const { error } = await sb.from('parked_orders').upsert(rows, {onConflict:'id'});
      if(error) console.error('[LF-Sync] parked upsert:', error);
    }

    // Borrar de Supabase los que ya no están en local (de esta sucursal)
    const branchId = typeof currentBranchId !== 'undefined' ? currentBranchId : 'balbuena';
    if(localIds.length){
      // Borrar todos los que NO están en la lista local
      const { error } = await sb.from('parked_orders')
        .delete()
        .eq('branch_id', branchId)
        .not('id', 'in', '(' + localIds.map(id => `"${id}"`).join(',') + ')');
      if(error) console.error('[LF-Sync] parked cleanup:', error);
    } else {
      // No hay ningún parked local: borrar todos los de esta sucursal
      await sb.from('parked_orders').delete().eq('branch_id', branchId);
    }
  }

  async function pushSettings(){
    if(typeof AJ === 'undefined') return;
    await sb.from('app_settings').upsert([{ id:1, data: AJ, updated_at: new Date().toISOString() }], {onConflict:'id'});
  }

  // ── EXPONER FUNCIONES ─────────────────────────────
  window.LFSync = {
    load: loadFromSupabase,
    pushProducts, // sin debounce: cambios de productos (incl. imagen) deben subir inmediato
    pushCategories: debounce(pushCategories, 800),
    pushModifiers: debounce(pushModifiers, 800),
    pushDiscounts: debounce(pushDiscounts, 800),
    pushCustomer,
    pushAllCustomers: debounce(pushAllCustomers, 1200),
    pushUsers: debounce(pushUsers, 800),
    pushBranches: debounce(pushBranches, 800),
    deleteBranch,
    pushInventory: debounce(pushInventory, 800),
    pushInventoryItem,
    deleteInventoryItem,
    pushOrder, // se llama inmediato al cerrar venta
    updateOrder, // para refunds y cambios de status — inmediato
    fetchTodayOrders, // ventas del día (para corte de caja)
    pushParked: debounce(pushParked, 600),
    pushSettings: debounce(pushSettings, 1000),
    flushPendingOrders, // intenta subir órdenes encoladas
    pendingCount: () => getPending().length,
    status: showSyncStatus,
  };

  // Cuando vuelve la conexión, vaciar la cola
  window.addEventListener('online', () => {
    showSyncStatus('Conexión restablecida · sincronizando…', 'sync');
    flushPendingOrders().then(() => loadFromSupabase());
  });
  window.addEventListener('offline', () => {
    showSyncStatus('Sin conexión · modo offline', 'offline');
  });

  // ── REALTIME: escuchar cambios en otros dispositivos ──────────
  function setupRealtime(){
    // INSERT de ordenes: nueva venta en otro dispositivo
    sb.channel('lf-orders-ins').on('postgres_changes',
      { event:'INSERT', schema:'public', table:'orders' },
      (payload) => {
        const o = payload.new;
        if(!o) return;
        if(typeof ORDERS_MOCK !== 'undefined'){
          // Evitar duplicar (puede que ya esté si la venta fue local)
          const exists = ORDERS_MOCK.find(x => (x.id && x.id === o.id) || (x.n === o.n && x.time === o.time));
          if(!exists){
            ORDERS_MOCK.unshift({
              id: o.id,
              n: o.n, time: o.time,
              items: o.items || [],
              client: o.client || '',
              svc: o.svc, pay: o.pay,
              subtotal: Number(o.subtotal) || 0,
              discount: Number(o.discount) || 0,
              iva: Number(o.iva) || 0,
              fee: Number(o.fee) || 0,
              total: Number(o.total),
              status: o.status,
              refund: o.refund || null,
              cashier_pin: o.cashier_pin || null,
              branch_id: o.branch_id || null,
              created_at: o.created_at,
            });
            if(typeof renderHistList === 'function' && document.querySelector('#screen-historial.active')){
              renderHistList();
            }
            if(typeof showToast === 'function'){
              showToast('Nueva venta · #' + o.n + ' · $' + o.total, 0, '🛎️');
            }
          }
        }
      }
    ).subscribe();

    // UPDATE de ordenes: refund o cambio de status hecho en otro dispositivo
    sb.channel('lf-orders-upd').on('postgres_changes',
      { event:'UPDATE', schema:'public', table:'orders' },
      (payload) => {
        const o = payload.new;
        if(!o || typeof ORDERS_MOCK === 'undefined') return;
        const local = ORDERS_MOCK.find(x => (x.id && x.id === o.id) || x.n === o.n);
        if(local){
          local.status = o.status;
          local.refund = o.refund || null;
          if(typeof renderHistList === 'function' && document.querySelector('#screen-historial.active')){
            renderHistList();
          }
          if(o.status === 'reembolsada' && typeof showToast === 'function'){
            showToast('Orden #' + o.n + ' reembolsada', 0, '↩');
          }
        }
      }
    ).subscribe();

    sb.channel('lf-products').on('postgres_changes',
      { event:'*', schema:'public', table:'products' },
      () => {
        // Si acabamos de hacer push, ignorar el eco (3 segundos de gracia)
        if(window._lastProductPush && (Date.now() - window._lastProductPush) < 3000){
          return;
        }
        sb.from('products').select('*').order('position').then(({data}) => {
          if(!data || typeof PRODUCTS === 'undefined') return;
          PRODUCTS.length = 0;
          data.forEach(p => PRODUCTS.push({
            id: p.id, name: p.name, cat: p.cat, price: Number(p.price),
            desc: p.desc,
            img: (p.img && !p.img.startsWith('blob:')) ? p.img : null,
            mods: p.mods || [], active: p.active !== false,
          }));
          if(typeof renderProducts === 'function') renderProducts();
        });
      }
    ).subscribe();

    sb.channel('lf-customers').on('postgres_changes',
      { event:'*', schema:'public', table:'customers' },
      () => {
        sb.from('customers').select('*').then(({data}) => {
          if(!data || typeof CLIENTES_MOCK === 'undefined') return;
          CLIENTES_MOCK.length = 0;
          data.forEach(c => CLIENTES_MOCK.push({
            id: c.id, name: c.name, phone: c.phone, pts: c.pts,
            next: c.next, tier: c.tier, spend: Number(c.spend),
            orders: c.orders, last: c.last, vip: c.vip,
            bday: c.bday, since: c.since, note: c.note, favs: c.favs || [],
          }));
          if(typeof renderCliList === 'function' && document.querySelector('#screen-clientes.active')) renderCliList();
        });
      }
    ).subscribe();
  }

  // ── INTERCEPTAR persistAll() para añadir Supabase ─────────────
  if(typeof window.persistAll === 'function'){
    const oldPersist = window.persistAll;
    window.persistAll = function(){
      oldPersist();
      window.LFSync.pushProducts();
      window.LFSync.pushCategories();
      window.LFSync.pushModifiers();
      window.LFSync.pushDiscounts();
      window.LFSync.pushAllCustomers();
      window.LFSync.pushUsers();
      window.LFSync.pushBranches();
      window.LFSync.pushInventory();
      window.LFSync.pushParked();
      window.LFSync.pushSettings();
    };
  }

  // ── INIT ──────────────────────────────────────────────────────
  async function init(){
    await loadFromSupabase();
    setupRealtime();
    // Intentar subir órdenes encoladas (si quedaron de una sesión anterior offline)
    flushPendingOrders();
  }

  document.addEventListener('DOMContentLoaded', init);
  // Si ya está cargado el DOM:
  if(document.readyState !== 'loading'){
    init();
  }

})();
