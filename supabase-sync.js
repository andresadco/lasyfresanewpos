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
    try {
      const [products, categories, modifiers, discounts, customers, users, branches, parkedOrders, settings] = await Promise.all([
        sb.from('products').select('*').order('position', {ascending:true}),
        sb.from('categories').select('*').order('position', {ascending:true}),
        sb.from('modifiers').select('*'),
        sb.from('discounts').select('*'),
        sb.from('customers').select('*'),
        sb.from('app_users').select('*'),
        sb.from('branches').select('*'),
        sb.from('parked_orders').select('*').order('created_at', {ascending:false}),
        sb.from('app_settings').select('*').eq('id',1).maybeSingle(),
      ]);

      // PRODUCTS
      if(products.data && typeof PRODUCTS !== 'undefined'){
        PRODUCTS.length = 0;
        products.data.forEach(p => PRODUCTS.push({
          id: p.id, name: p.name, cat: p.cat, price: Number(p.price),
          desc: p.desc, img: p.img, mods: p.mods || [], active: p.active !== false,
        }));
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

      // Re-renderizar
      if(typeof renderProducts === 'function') renderProducts();
      if(typeof renderCats === 'function') renderCats();
      if(typeof renderOrderDrawer === 'function') renderOrderDrawer();

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
      desc: p.desc || '', img: p.img || null,
      mods: p.mods || [], active: p.active !== false, position: idx,
    }));
    const { error } = await sb.from('products').upsert(rows, {onConflict:'id'});
    if(error){ showSyncStatus('Error guardando', 'error'); console.error(error); }
    else showSyncStatus('Guardado ✓', 'ok');
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
    if(typeof CLIENTES_MOCK === 'undefined') return;
    for(const c of CLIENTES_MOCK) await pushCustomer(c);
  }

  async function pushUsers(){
    if(typeof USUARIOS === 'undefined') return;
    const rows = USUARIOS.map(u => ({
      pin: u.pin, nombre: u.nombre, alias: u.alias,
      rol: u.rol, emoji: u.emoji, color: u.color, active: true,
    }));
    await sb.from('app_users').upsert(rows, {onConflict:'pin'});
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
      branch_id: typeof currentBranchId !== 'undefined' ? currentBranchId : 'centro',
      cashier_pin: (typeof ROLE !== 'undefined' && ROLE.user) ? ROLE.user.pin : null,
    };
    const { error, data } = await sb.from('orders').insert([row]).select();
    if(error){ console.error('[LF-Sync] order:', error); return null; }
    return data?.[0];
  }

  async function pushParked(){
    if(typeof parked === 'undefined') return;
    // Reemplaza todo el set
    await sb.from('parked_orders').delete().neq('id','00000000-0000-0000-0000-000000000000');
    if(parked.length){
      const rows = parked.map(p => ({
        label: p.label, items: p.items,
        client: p.client || '', svc: p.svc,
        branch_id: typeof currentBranchId !== 'undefined' ? currentBranchId : 'centro',
      }));
      await sb.from('parked_orders').insert(rows);
    }
  }

  async function pushSettings(){
    if(typeof AJ === 'undefined') return;
    await sb.from('app_settings').upsert([{ id:1, data: AJ, updated_at: new Date().toISOString() }], {onConflict:'id'});
  }

  // ── EXPONER FUNCIONES (debounced) ─────────────────────────────
  window.LFSync = {
    load: loadFromSupabase,
    pushProducts: debounce(pushProducts, 800),
    pushCategories: debounce(pushCategories, 800),
    pushModifiers: debounce(pushModifiers, 800),
    pushDiscounts: debounce(pushDiscounts, 800),
    pushCustomer,
    pushAllCustomers: debounce(pushAllCustomers, 1200),
    pushUsers: debounce(pushUsers, 800),
    pushOrder, // se llama inmediato al cerrar venta
    pushParked: debounce(pushParked, 600),
    pushSettings: debounce(pushSettings, 1000),
    status: showSyncStatus,
  };

  // ── REALTIME: escuchar cambios en otros dispositivos ──────────
  function setupRealtime(){
    sb.channel('lf-orders').on('postgres_changes',
      { event:'INSERT', schema:'public', table:'orders' },
      (payload) => {
        const newN = payload.new?.n;
        if(typeof showToast === 'function'){
          showToast('Nueva venta · #' + newN, 0, '🛎️');
        }
      }
    ).subscribe();

    sb.channel('lf-products').on('postgres_changes',
      { event:'*', schema:'public', table:'products' },
      () => {
        // Re-fetch productos
        sb.from('products').select('*').order('position').then(({data}) => {
          if(!data || typeof PRODUCTS === 'undefined') return;
          PRODUCTS.length = 0;
          data.forEach(p => PRODUCTS.push({
            id: p.id, name: p.name, cat: p.cat, price: Number(p.price),
            desc: p.desc, img: p.img, mods: p.mods || [], active: p.active !== false,
          }));
          if(typeof renderProducts === 'function') renderProducts();
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
      window.LFSync.pushParked();
      window.LFSync.pushSettings();
    };
  }

  // ── INIT ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    await loadFromSupabase();
    setupRealtime();
  });

  // Si ya está cargado el DOM:
  if(document.readyState !== 'loading'){
    loadFromSupabase().then(setupRealtime);
  }

})();
