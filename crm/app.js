/* =========================================================
   CRM EnvíoExpress — lógica
   Datos compartidos en Firebase (Firestore) + login de equipo.
   Modelo:
     clientes/{id} = {
       id, nombre, telefono, correo, giro, comentarios,
       creadoEn, actualizadoEn,
       interacciones: [
         { id, fecha, notas, paso: 'cita'|'seguimiento'|'no_interesado', cuando: ISO|null }
       ]
     }
   Las tareas del día se derivan de las interacciones con paso
   'cita'/'seguimiento' cuya fecha `cuando` cae hoy (o está vencida).
   ========================================================= */
'use strict';

const STEP_LABELS = ['Apertura', 'Valor', 'Escucha y objeciones', 'Vs competencia', 'Resultado'];
const PASO_TXT = { cita: 'Cita concretada', seguimiento: 'Seguimiento', no_interesado: 'No interesado', contacto: 'Contacto' };

/* ---------- estado ---------- */
let clientes = [];
let snapUnsub = null;
let vistaActual = 'clientes';
let detalleId = null;       // cliente abierto en detalle
let editId = null;          // cliente en edición (modal)
let speechId = null;        // cliente en curso del speech
let cur = 0;                // paso del speech
let resultadoSel = null;

/* =========================================================
   Firestore
   ========================================================= */
function getCliente(id) { return clientes.find(c => c.id === id) || null; }

function nuevoId(p) { return (p || 'c_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function upsertCliente(cli) {
  cli.actualizadoEn = new Date().toISOString();
  const i = clientes.findIndex(c => c.id === cli.id);
  if (i >= 0) clientes[i] = cli; else clientes.push(cli);
  if (window.FB) {
    FB.setDoc(FB.doc(FB.db, 'clientes', cli.id), cli)
      .catch(err => toast('Error al guardar', err.message, true));
  }
}

function iniciarSnapshot() {
  if (snapUnsub || !window.FB) return;
  snapUnsub = FB.onSnapshot(
    FB.collection(FB.db, 'clientes'),
    snap => {
      clientes = snap.docs.map(d => d.data());
      renderTodo();
    },
    err => toast('Error de sincronización', err.message, true)
  );
}

function detenerSnapshot() {
  if (snapUnsub) { snapUnsub(); snapUnsub = null; }
  if (mapsUsoUnsub) { mapsUsoUnsub(); mapsUsoUnsub = null; }
  clientes = [];
}

/* =========================================================
   Autenticación
   ========================================================= */
function arrancarAuth() {
  document.getElementById('loginStatus').textContent = '';
  FB.onAuthStateChanged(FB.auth, user => {
    if (user) {
      document.getElementById('loginScreen').classList.remove('active');
      document.getElementById('app').classList.add('active');
      document.getElementById('menuUser').textContent = user.email || '';
      iniciarSnapshot();
      suscribirUsoMaps();
      irVista('clientes');
    } else {
      detenerSnapshot();
      document.getElementById('app').classList.remove('active');
      document.getElementById('loginScreen').classList.add('active');
    }
  });
}

function iniciarSesion() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  err.classList.remove('show');
  if (!email || !pass) { err.textContent = 'Escribe correo y contraseña.'; err.classList.add('show'); return; }
  if (!window.FB) { err.textContent = 'Conectando con el servidor, intenta en un momento.'; err.classList.add('show'); return; }

  const btn = document.getElementById('btnLogin');
  btn.disabled = true; btn.textContent = 'Entrando…';
  FB.signInWithEmailAndPassword(FB.auth, email, pass)
    .catch(e => { err.textContent = mensajeErrorLogin(e.code); err.classList.add('show'); })
    .finally(() => { btn.disabled = false; btn.textContent = 'Entrar'; });
}

function cerrarSesion() { if (window.FB) FB.signOut(FB.auth); }

function mensajeErrorLogin(code) {
  switch (code) {
    case 'auth/invalid-email': return 'El correo no es válido.';
    case 'auth/missing-password': return 'Escribe la contraseña.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Correo o contraseña incorrectos.';
    case 'auth/too-many-requests': return 'Demasiados intentos. Espera un momento.';
    case 'auth/network-request-failed': return 'Sin conexión. Revisa tu internet.';
    default: return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
  }
}

/* =========================================================
   Navegación de vistas (menú)
   ========================================================= */
function irVista(v) {
  vistaActual = v;
  document.querySelectorAll('.col-main .view').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));

  if (v === 'clientes') {
    document.getElementById('vista-clientes').classList.add('active');
    document.getElementById('mi-clientes').classList.add('active');
    renderClientes();
  } else if (v === 'porcontactar') {
    document.getElementById('vista-porcontactar').classList.add('active');
    document.getElementById('mi-porcontactar').classList.add('active');
    renderPorContactar();
  } else if (v === 'detalle') {
    document.getElementById('vista-detalle').classList.add('active');
    document.getElementById('mi-clientes').classList.add('active');
    renderDetalle();
  } else if (v === 'speech') {
    document.getElementById('vista-speech').classList.add('active');
    document.getElementById('mi-speech').classList.add('active');
    mostrarSpeechPick();
  } else if (v === 'maps') {
    document.getElementById('vista-maps').classList.add('active');
    document.getElementById('mi-maps').classList.add('active');
    initMapaOSM();
  }
}

function renderTodo() {
  renderTareas();
  if (vistaActual === 'clientes') renderClientes();
  if (vistaActual === 'porcontactar') renderPorContactar();
  if (vistaActual === 'detalle') renderDetalle();
  if (vistaActual === 'speech' && document.getElementById('speechPick').style.display !== 'none') llenarSelectClientes();
}

/* =========================================================
   Catálogo de clientes
   ========================================================= */
function renderClientes() {
  const q = (document.getElementById('buscar').value || '').toLowerCase().trim();
  const origenSel = document.getElementById('filtroOrigen').value;
  const lista = [...clientes]
    .filter(c => !q || (c.nombre + ' ' + (c.giro || '') + ' ' + (c.correo || '')).toLowerCase().includes(q))
    .filter(c => !origenSel || (c.origen || 'propio') === origenSel)
    .sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));

  document.getElementById('clientesCount').textContent =
    clientes.length + (clientes.length === 1 ? ' cliente' : ' clientes');

  const body = document.getElementById('clientesBody');
  const empty = document.getElementById('clientesEmpty');
  const wrap = document.querySelector('#vista-clientes .table-wrap');

  if (lista.length === 0) {
    wrap.style.display = 'none';
    empty.innerHTML = `<div class="empty-state">${clientes.length === 0
      ? 'Aún no hay clientes. Toca <strong>+ Nuevo cliente</strong> para empezar.'
      : 'Sin resultados para tu búsqueda.'}</div>`;
    return;
  }
  wrap.style.display = 'block';
  empty.innerHTML = '';
  body.innerHTML = lista.map(c => {
    const n = (c.interacciones || []).length;
    return `<tr onclick="abrirDetalle('${c.id}')">
      <td class="cell-name">${escapeHtml(c.nombre)}</td>
      <td class="cell-muted">${escapeHtml(c.telefono || '—')}</td>
      <td class="cell-muted">${escapeHtml(c.correo || '—')}</td>
      <td>${c.giro ? `<span class="giro-pill">${escapeHtml(c.giro)}</span>` : '<span class="cell-muted">—</span>'}</td>
      <td>${origenPill(c.origen)}</td>
      <td class="cell-muted">${n}</td>
    </tr>`;
  }).join('');
}

/* Etiqueta visual del origen del cliente. Por compatibilidad, los
   clientes sin campo `origen` (registrados antes) se tratan como "propio". */
function origenPill(origen) {
  const o = origen || 'propio';
  return o === 'leads'
    ? '<span class="origen-pill leads">Leads</span>'
    : '<span class="origen-pill propio">Propio</span>';
}

/* =========================================================
   Clientes por contactar
   Un cliente sigue "por contactar" mientras NO tenga un siguiente
   paso definido: si se le agendó cita/seguimiento entra al pipeline
   (tareas del día) y sale de aquí; si se marcó "no interesado" también
   sale. En ambos casos permanece en el Catálogo completo.
   ========================================================= */
function estaPorContactar(c) {
  // Última vez que se marcó "No interesado" (reactivable si luego hubo otra interacción).
  let ultimoNoInteresado = 0;
  let ultimaFecha = -1;
  let ultimoPaso = null;
  (c.interacciones || []).forEach(it => {
    const t = new Date(it.fecha).getTime();
    if (it.paso === 'no_interesado' && t > ultimoNoInteresado) ultimoNoInteresado = t;
    if (t >= ultimaFecha) { ultimaFecha = t; ultimoPaso = it.paso; }
  });
  // Tiene un siguiente paso agendado posterior al último "No interesado" → en pipeline.
  const tienePendiente = (c.interacciones || []).some(it =>
    (it.paso === 'cita' || it.paso === 'seguimiento') && it.cuando &&
    new Date(it.fecha).getTime() > ultimoNoInteresado);
  if (tienePendiente) return false;
  // Su estado más reciente es "No interesado" → fuera de la lista.
  if (ultimoPaso === 'no_interesado') return false;
  return true;
}

function renderPorContactar() {
  const q = (document.getElementById('buscarPC').value || '').toLowerCase().trim();
  const base = clientes.filter(estaPorContactar);
  const lista = base
    .filter(c => !q || (c.nombre + ' ' + (c.giro || '') + ' ' + (c.correo || '')).toLowerCase().includes(q))
    .sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));

  document.getElementById('porContactarCount').textContent =
    base.length + (base.length === 1 ? ' cliente' : ' clientes');

  const body = document.getElementById('porContactarBody');
  const empty = document.getElementById('porContactarEmpty');
  const wrap = document.querySelector('#vista-porcontactar .table-wrap');

  if (lista.length === 0) {
    wrap.style.display = 'none';
    empty.innerHTML = `<div class="empty-state">${base.length === 0
      ? 'No hay clientes por contactar. Cuando registres clientes nuevos aparecerán aquí.'
      : 'Sin resultados para tu búsqueda.'}</div>`;
    return;
  }
  wrap.style.display = 'block';
  empty.innerHTML = '';
  body.innerHTML = lista.map(c => `
    <tr onclick="abrirDetalle('${c.id}')">
      <td class="cell-name">${escapeHtml(c.nombre)}</td>
      <td class="cell-muted">${escapeHtml(c.telefono || '—')}</td>
      <td class="cell-muted">${escapeHtml(c.correo || '—')}</td>
      <td>${c.giro ? `<span class="giro-pill">${escapeHtml(c.giro)}</span>` : '<span class="cell-muted">—</span>'}</td>
      <td><button class="btn primary sm" onclick="event.stopPropagation();speechDesde('${c.id}')">🎙️ Llamar</button></td>
    </tr>`).join('');
}

function speechDesde(id) {
  speechId = id;
  irVista('speech');
  arrancarGuia();
}

/* ---- modal cliente ---- */
function abrirModalCliente(id) {
  editId = id || null;
  document.getElementById('modalClienteTitulo').textContent = editId ? 'Editar cliente' : 'Nuevo cliente';
  const cli = editId ? getCliente(editId) : null;
  document.getElementById('cNombre').value = cli ? cli.nombre : '';
  document.getElementById('cTel').value = cli ? cli.telefono : '';
  document.getElementById('cCorreo').value = cli ? (cli.correo || '') : '';
  document.getElementById('cGiro').value = cli ? (cli.giro || '') : '';
  document.getElementById('cOrigen').value = cli ? (cli.origen || 'propio') : 'propio';
  document.getElementById('cComentarios').value = cli ? (cli.comentarios || '') : '';
  document.getElementById('fNombre').classList.remove('invalid');
  document.getElementById('fTel').classList.remove('invalid');
  document.getElementById('modalCliente').classList.add('active');
  setTimeout(() => document.getElementById('cNombre').focus(), 50);
}
function cerrarModalCliente() { document.getElementById('modalCliente').classList.remove('active'); }
function editarClienteActual() { abrirModalCliente(detalleId); }

/* Abre el modal en modo "nuevo cliente" prellenado con datos externos (p. ej. del mapa).
   El usuario revisa y guarda con guardarCliente() (sin cambios). */
function abrirModalClientePrefill(data) {
  abrirModalCliente();
  document.getElementById('cNombre').value = data.nombre || '';
  document.getElementById('cTel').value = data.telefono || '';
  document.getElementById('cCorreo').value = data.correo || '';
  document.getElementById('cGiro').value = data.giro || '';
}

function guardarCliente() {
  const nombre = document.getElementById('cNombre').value.trim();
  const tel = document.getElementById('cTel').value.trim();
  const okNombre = nombre.length > 0;
  const okTel = tel.replace(/\D/g, '').length >= 7;
  document.getElementById('fNombre').classList.toggle('invalid', !okNombre);
  document.getElementById('fTel').classList.toggle('invalid', !okTel);
  if (!okNombre || !okTel) return;

  let cli = editId ? getCliente(editId) : null;
  if (!cli) {
    cli = { id: nuevoId(), creadoEn: new Date().toISOString(), interacciones: [] };
  }
  cli.nombre = nombre;
  cli.telefono = tel;
  cli.correo = document.getElementById('cCorreo').value.trim();
  cli.giro = document.getElementById('cGiro').value.trim();
  cli.origen = document.getElementById('cOrigen').value;
  cli.comentarios = document.getElementById('cComentarios').value.trim();
  upsertCliente(cli);
  cerrarModalCliente();
  toast('Guardado', cli.nombre + ' se guardó correctamente.', false);

  if (vistaActual === 'detalle') renderDetalle();
  else renderClientes();
}

/* =========================================================
   Detalle de cliente + interacciones
   ========================================================= */
function abrirDetalle(id) { detalleId = id; irVista('detalle'); }

function renderDetalle() {
  const cli = getCliente(detalleId);
  if (!cli) { irVista('clientes'); return; }
  document.getElementById('detNombre').textContent = cli.nombre;

  const telLink = cli.telefono ? `<a href="tel:${escapeHtml(cli.telefono.replace(/\s+/g, ''))}" style="color:var(--brand);font-weight:600;text-decoration:none;">${escapeHtml(cli.telefono)}</a>` : '—';
  document.getElementById('detDatos').innerHTML = `
    <div class="data-row"><span class="k">Teléfono</span><span class="v">${telLink}</span></div>
    <div class="data-row"><span class="k">Correo</span><span class="v">${escapeHtml(cli.correo || '—')}</span></div>
    <div class="data-row"><span class="k">Giro</span><span class="v">${cli.giro ? `<span class="giro-pill">${escapeHtml(cli.giro)}</span>` : '—'}</span></div>
    <div class="data-row"><span class="k">Comentarios</span><span class="v">${escapeHtml(cli.comentarios || '—')}</span></div>
    <div class="data-row"><span class="k">Alta</span><span class="v">${fmtFecha(new Date(cli.creadoEn))}</span></div>`;

  const tl = document.getElementById('detTimeline');
  const inters = [...(cli.interacciones || [])].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  if (inters.length === 0) {
    tl.innerHTML = `<div class="empty-state" style="padding:1.75rem 1rem;">Sin interacciones aún.</div>`;
    return;
  }
  tl.innerHTML = inters.map(it => `
    <div class="inter">
      <div class="i-top">
        <span class="i-date">${fmtFecha(new Date(it.fecha))}</span>
        <span class="tag ${it.paso}">${PASO_TXT[it.paso] || it.paso}</span>
      </div>
      ${it.notas ? `<div class="i-notes">${escapeHtml(it.notas)}</div>` : '<div class="i-notes cell-muted">Sin notas.</div>'}
      ${it.cuando ? `<div class="i-when">📌 ${PASO_TXT[it.paso]}: ${fmtFecha(new Date(it.cuando))}</div>` : ''}
    </div>`).join('');
}

function eliminarClienteActual() {
  const cli = getCliente(detalleId);
  if (!cli) return;
  if (!confirm('¿Eliminar a ' + cli.nombre + '? Esta acción no se puede deshacer.')) return;
  clientes = clientes.filter(c => c.id !== detalleId);
  if (window.FB) FB.deleteDoc(FB.doc(FB.db, 'clientes', detalleId)).catch(err => toast('Error al eliminar', err.message, true));
  irVista('clientes');
}

/* ---- modal interacción manual ---- */
function abrirModalInteraccion() {
  document.getElementById('iNotas').value = '';
  document.getElementById('iPaso').value = 'cita';
  document.getElementById('iFecha').value = '';
  document.getElementById('fInterFecha').classList.remove('invalid');
  toggleInterFecha();
  document.getElementById('modalInteraccion').classList.add('active');
}
function cerrarModalInteraccion() { document.getElementById('modalInteraccion').classList.remove('active'); }
function toggleInterFecha() {
  const paso = document.getElementById('iPaso').value;
  document.getElementById('fInterFecha').style.display = (paso === 'no_interesado') ? 'none' : 'block';
}
function guardarInteraccionManual() {
  const cli = getCliente(detalleId);
  if (!cli) return;
  const paso = document.getElementById('iPaso').value;
  const notas = document.getElementById('iNotas').value.trim();
  let cuando = null;
  if (paso !== 'no_interesado') {
    const val = document.getElementById('iFecha').value;
    if (!esFechaFutura(val)) { document.getElementById('fInterFecha').classList.add('invalid'); return; }
    cuando = new Date(val).toISOString();
  }
  agregarInteraccion(cli, { notas, paso, cuando });
  cerrarModalInteraccion();
  toast('Interacción registrada', cli.nombre, false);
  renderDetalle();
}

function agregarInteraccion(cli, data) {
  if (!cli.interacciones) cli.interacciones = [];
  cli.interacciones.push({
    id: nuevoId('i_'),
    fecha: new Date().toISOString(),
    notas: data.notas || '',
    paso: data.paso,
    cuando: data.cuando || null
  });
  upsertCliente(cli);
}

/* =========================================================
   Tareas del día (columna derecha)
   ========================================================= */
function tareasPendientes() {
  const out = [];
  clientes.forEach(c => {
    // Última vez que se marcó al cliente como "No interesado".
    // Si una tarea se programó antes de eso, ya no es relevante y se oculta.
    let ultimoNoInteresado = 0;
    (c.interacciones || []).forEach(it => {
      if (it.paso === 'no_interesado') {
        const t = new Date(it.fecha).getTime();
        if (t > ultimoNoInteresado) ultimoNoInteresado = t;
      }
    });
    // Solo la última interacción agendada (por fecha de registro) del cliente:
    // si reprogramó o cambió de paso, vale el estado más reciente, no los previos.
    let ultima = null;
    (c.interacciones || []).forEach(it => {
      if ((it.paso === 'cita' || it.paso === 'seguimiento') && it.cuando) {
        // Excluir tareas registradas antes (o a la vez) del último "No interesado".
        if (new Date(it.fecha).getTime() <= ultimoNoInteresado) return;
        if (!ultima || new Date(it.fecha).getTime() >= new Date(ultima.fecha).getTime()) ultima = it;
      }
    });
    if (ultima) {
      out.push({ clienteId: c.id, interId: ultima.id, nombre: c.nombre, telefono: c.telefono, paso: ultima.paso, when: new Date(ultima.cuando) });
    }
  });
  return out.sort((a, b) => a.when - b.when);
}

function esHoy(d) {
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function renderTareas() {
  const hoy = new Date();
  document.getElementById('hoyFecha').textContent = hoy.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  const all = tareasPendientes();
  const finHoy = new Date(); finHoy.setHours(23, 59, 59, 999);
  const vencidas = all.filter(t => t.when < new Date() && !esHoy(t.when));
  const hoyList = all.filter(t => esHoy(t.when));

  const cont = document.getElementById('tareasLista');
  if (vencidas.length === 0 && hoyList.length === 0) {
    cont.innerHTML = `<div class="task-empty">Nada pendiente para hoy 🎉</div>`;
    return;
  }
  let html = '';
  if (vencidas.length) {
    html += `<div class="task-group-label">Vencidas</div>` + vencidas.map(t => taskHtml(t, true)).join('');
  }
  if (hoyList.length) {
    html += `<div class="task-group-label">Hoy</div>` + hoyList.map(t => taskHtml(t, false)).join('');
  }
  cont.innerHTML = html;
}

function taskHtml(t, vencida) {
  const ic = t.paso === 'cita' ? '📅' : '🔁';
  return `<div class="task ${vencida ? 'vencida' : t.paso}" onclick="abrirDetalle('${t.clienteId}')">
    <div class="t-top">
      <span class="t-name">${escapeHtml(t.nombre)}</span>
      <span class="t-time">${fmtHora(t.when)}</span>
    </div>
    <div class="t-kind">${ic} <b>${PASO_TXT[t.paso]}</b>${vencida ? ' · ' + fmtFechaCorta(t.when) : ''}</div>
    <button class="t-del" title="Quitar esta tarea" onclick="event.stopPropagation();borrarTarea('${t.clienteId}','${t.interId}')">🗑️</button>
  </div>`;
}

/* Quita una tarea pendiente: borra esa interacción agendada del cliente.
   El cliente y sus demás interacciones permanecen intactos. */
function borrarTarea(clienteId, interId) {
  const cli = getCliente(clienteId);
  if (!cli) return;
  if (!confirm('¿Quitar esta tarea pendiente? El cliente y sus demás datos no se borran.')) return;
  cli.interacciones = (cli.interacciones || []).filter(it => it.id !== interId);
  upsertCliente(cli);
  toast('Tarea quitada', cli.nombre, false);
  renderTodo();
}

/* =========================================================
   Speech Flow
   ========================================================= */
function mostrarSpeechPick() {
  document.getElementById('speechPick').style.display = 'block';
  document.getElementById('speechGuide').style.display = 'none';
  llenarSelectClientes();
}

function llenarSelectClientes() {
  const sel = document.getElementById('speechCliente');
  const prev = sel.value;
  const ord = [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre));
  sel.innerHTML = ord.length
    ? ord.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)} · ${escapeHtml(c.telefono || '')}</option>`).join('')
    : `<option value="">No hay clientes registrados</option>`;
  if (prev) sel.value = prev;
}

function speechDesdeDetalle() {
  speechId = detalleId;
  irVista('speech');
  arrancarGuia();
}

function iniciarSpeech() {
  const id = document.getElementById('speechCliente').value;
  if (!id) { toast('Sin cliente', 'Registra o elige un cliente primero.', true); return; }
  speechId = id;
  arrancarGuia();
}

function arrancarGuia() {
  const cli = getCliente(speechId);
  if (!cli) { mostrarSpeechPick(); return; }
  document.getElementById('speechPick').style.display = 'none';
  document.getElementById('speechGuide').style.display = 'block';
  document.getElementById('cbName').textContent = cli.nombre;
  document.getElementById('cbPhone').textContent = cli.telefono || '—';
  document.getElementById('cbCall').href = 'tel:' + (cli.telefono || '').replace(/\s+/g, '');
  resultadoSel = null;
  resetResultadoUI();
  goTo(0);
}

function goTo(n) {
  const panels = document.querySelectorAll('#speechGuide .panel');
  panels[cur].classList.remove('active');
  cur = n;
  panels[cur].classList.add('active');
  document.querySelectorAll('#speechGuide .prog-step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i < cur) s.classList.add('done');
    if (i === cur) s.classList.add('active');
  });
  document.getElementById('progLabel').textContent = STEP_LABELS[cur];
  document.getElementById('navStep').textContent = (cur + 1) + ' / ' + STEP_LABELS.length;
  document.getElementById('btnPrev').disabled = cur === 0;
  document.getElementById('btnNext').style.visibility = cur === STEP_LABELS.length - 1 ? 'hidden' : 'visible';
}

function navigate(dir) {
  const next = cur + dir;
  if (next < 0 || next > STEP_LABELS.length - 1) return;
  goTo(next);
}

function toggleObj(el) {
  const open = el.classList.contains('open');
  document.querySelectorAll('.obj-item').forEach(o => o.classList.remove('open'));
  if (!open) el.classList.add('open');
}

/* ---- paso resultado ---- */
function resetResultadoUI() {
  document.querySelectorAll('.result-opt').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('.result-detail').forEach(d => d.classList.remove('active'));
  document.querySelectorAll('#vista-speech .field').forEach(f => f.classList.remove('invalid'));
  document.getElementById('btnGuardarResultado').style.display = 'none';
  ['citaDT', 'seguimientoDT', 'notasLlamada'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function seleccionarResultado(tipo) {
  resultadoSel = tipo;
  document.querySelectorAll('.result-opt').forEach(o => o.classList.toggle('selected', o.dataset.result === tipo));
  document.querySelectorAll('.result-detail').forEach(d => d.classList.remove('active'));
  const det = document.getElementById('detail-' + tipo);
  if (det) det.classList.add('active');
  document.getElementById('btnGuardarResultado').style.display = 'block';
}

function guardarResultado() {
  const cli = getCliente(speechId);
  if (!cli || !resultadoSel) return;
  const notas = document.getElementById('notasLlamada').value.trim();
  let cuando = null;

  if (resultadoSel === 'cita' || resultadoSel === 'seguimiento') {
    const inputId = resultadoSel === 'cita' ? 'citaDT' : 'seguimientoDT';
    const val = document.getElementById(inputId).value;
    if (!esFechaFutura(val)) {
      document.getElementById(inputId).closest('.field').classList.add('invalid');
      return;
    }
    cuando = new Date(val).toISOString();
  }

  agregarInteraccion(cli, { notas, paso: resultadoSel, cuando });
  toast('Llamada documentada', mensajeResultado(cli, resultadoSel), false);
  speechId = null;
  irVista('clientes');
}

function mensajeResultado(cli, paso) {
  if (paso === 'cita') return 'Cita concretada con ' + cli.nombre + '.';
  if (paso === 'seguimiento') return 'Seguimiento agendado con ' + cli.nombre + '.';
  return cli.nombre + ' marcado como no interesado.';
}

/* =========================================================
   Utilidades
   ========================================================= */
function esFechaFutura(val) {
  if (!val) return false;
  const t = new Date(val).getTime();
  return !isNaN(t) && t > Date.now();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function fmtFecha(d) { return d.toLocaleString('es-MX', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function fmtFechaCorta(d) { return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }); }
function fmtHora(d) { return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }

function toast(titulo, cuerpo, alerta, detalle) {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (alerta ? ' alert' : '');
  let html = `<div class="t-head"><div class="t-title">${escapeHtml(titulo)}</div>`;
  if (detalle) html += `<button class="t-info" type="button" title="Ver detalle técnico" aria-label="Ver detalle técnico">ℹ️</button>`;
  html += `</div><div class="t-body">${escapeHtml(cuerpo)}</div>`;
  if (detalle) html += `<div class="t-detail" hidden>${escapeHtml(detalle)}</div>`;
  el.innerHTML = html;

  const cerrar = () => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); };
  let timer = setTimeout(cerrar, detalle ? 14000 : 6000);
  el.addEventListener('click', cerrar);

  if (detalle) {
    const info = el.querySelector('.t-info');
    const det = el.querySelector('.t-detail');
    info.addEventListener('click', e => {
      e.stopPropagation();      // no cerrar el toast al abrir el detalle
      clearTimeout(timer);      // dejar de auto-cerrar mientras se lee
      det.hidden = !det.hidden;
    });
  }
  wrap.appendChild(el);
}

/* =========================================================
   Buscar clientes en Maps (Google Maps Platform)
   - Mapa: Maps JavaScript API (los POIs/negocios los pinta Google).
   - Click en un negocio → se obtiene su placeId (solo el click izquierdo
     entrega placeId; es limitación de la API) y aparece el menú "Agregar
     cliente". Al confirmarlo se hace 1 Place Details para traer los datos.
   - Búsqueda de zona → Geocoding.
   Tope de uso: máx. 1000 llamadas por periodo mensual que inicia el día 17.
   El contador es compartido por el equipo (Firestore: meta/mapsUsage).
   ========================================================= */

// API key de Google Maps. NO se guarda en el repo: se define en
// crm/config.local.js (ignorado por git) como window.CRM_CONFIG.GOOGLE_MAPS_API_KEY.
// Recuerda restringir la key por dominio (*.web.app) en Google Cloud.
const GOOGLE_MAPS_API_KEY = (window.CRM_CONFIG && window.CRM_CONFIG.GOOGLE_MAPS_API_KEY) || 'PEGA_TU_API_KEY_AQUI';

let mapa = null;
let geocoder = null;
let poiSeleccionado = null;     // { placeId }
let mapsInit = false;
let googleCargando = false;

const MAPS_POS_KEY = 'crm_maps_pos';
const MAPS_DEF = { lat: 19.4326, lon: -99.1332, zoom: 15 }; // CDMX por defecto

/* ---------- Tope de llamadas: 1000 por mes, reinicia el día 17 ---------- */
const MAPS_CAP = 1000;
const MAPS_RESET_DAY = 17;
const MAPS_USO_LS = 'crm_maps_uso';
let mapsUso = { periodo: null, count: 0 };
let mapsUsoUnsub = null;

// Identificador del periodo actual: la fecha del día 17 que lo inició (YYYY-MM-DD).
function periodoMaps(d) {
  d = d || new Date();
  let y = d.getFullYear(), m = d.getMonth();
  if (d.getDate() < MAPS_RESET_DAY) { m -= 1; if (m < 0) { m = 11; y -= 1; } }
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(MAPS_RESET_DAY).padStart(2, '0')}`;
}

// Suscripción al contador compartido del equipo (se llama tras autenticar).
function suscribirUsoMaps() {
  if (mapsUsoUnsub || !window.FB) return;
  mapsUsoUnsub = FB.onSnapshot(
    FB.doc(FB.db, 'meta', 'mapsUsage'),
    snap => { const d = snap.data(); if (d) mapsUso = { periodo: d.periodo, count: d.count || 0 }; actualizarHintUso(); },
    () => {}
  );
}

function usoMapsActual() {
  const p = periodoMaps();
  if (!window.FB) {
    try { const l = JSON.parse(localStorage.getItem(MAPS_USO_LS)); if (l && l.periodo === p) return l.count; } catch (e) {}
    return 0;
  }
  return mapsUso.periodo === p ? mapsUso.count : 0;
}

function puedeLlamarMaps(n) { return usoMapsActual() + (n || 1) <= MAPS_CAP; }

function registrarLlamadaMaps(n) {
  const p = periodoMaps();
  const nuevo = { periodo: p, count: usoMapsActual() + (n || 1), actualizado: new Date().toISOString() };
  mapsUso = { periodo: p, count: nuevo.count };
  if (window.FB) FB.setDoc(FB.doc(FB.db, 'meta', 'mapsUsage'), nuevo).catch(() => {});
  else { try { localStorage.setItem(MAPS_USO_LS, JSON.stringify(nuevo)); } catch (e) {} }
  actualizarHintUso();
}

function actualizarHintUso() {
  const hint = document.getElementById('mapsHint');
  if (!hint || !mapsInit) return;
  const restantes = Math.max(0, MAPS_CAP - usoMapsActual());
  hint.textContent = `Click en un negocio para agregarlo · ${restantes}/${MAPS_CAP} llamadas restantes (reinicia el 17)`;
}

function mostrarLimiteMaps() {
  const hint = document.getElementById('mapsHint');
  if (hint) hint.textContent = `Límite mensual alcanzado (${MAPS_CAP} llamadas). Se reinicia el día 17.`;
  toast('Límite de Maps alcanzado', `Se llegó al tope de ${MAPS_CAP} llamadas este mes. Se reinicia el día 17.`, true);
}

/* ---------- Categorías de Google (place.types) → giro en español ---------- */
const GIRO_GOOGLE = {
  restaurant: 'Restaurante', cafe: 'Cafetería', meal_takeaway: 'Comida rápida',
  meal_delivery: 'Comida a domicilio', bar: 'Bar', bakery: 'Panadería',
  supermarket: 'Supermercado', grocery_or_supermarket: 'Supermercado',
  convenience_store: 'Tienda de conveniencia', store: 'Tienda', clothing_store: 'Ropa',
  shoe_store: 'Zapatería', hardware_store: 'Ferretería', furniture_store: 'Muebles',
  electronics_store: 'Electrónica', book_store: 'Librería', florist: 'Florería',
  jewelry_store: 'Joyería', pet_store: 'Mascotas', liquor_store: 'Vinos y licores',
  pharmacy: 'Farmacia', drugstore: 'Farmacia', bank: 'Banco', atm: 'Cajero',
  hospital: 'Hospital', doctor: 'Consultorio', dentist: 'Dentista',
  veterinary_care: 'Veterinaria', beauty_salon: 'Estética', hair_care: 'Estética',
  gym: 'Gimnasio', spa: 'Spa', school: 'Escuela', lodging: 'Hotel',
  gas_station: 'Gasolinera', car_repair: 'Taller mecánico', car_dealer: 'Automotriz',
  car_wash: 'Autolavado', laundry: 'Lavandería', real_estate_agency: 'Inmobiliaria',
  insurance_agency: 'Seguros', lawyer: 'Despacho legal', accounting: 'Contabilidad',
  travel_agency: 'Agencia de viajes'
};

function giroDesdeTypes(types) {
  if (!types || !types.length) return '';
  for (const t of types) if (GIRO_GOOGLE[t]) return GIRO_GOOGLE[t];
  const t = types.find(x => !['point_of_interest', 'establishment'].includes(x));
  return t ? t.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : '';
}

/* ---------- Carga diferida del API de Google Maps ---------- */
function cargarGoogleMapsAPI(cb) {
  if (window.google && window.google.maps) { cb(); return; }
  if (googleCargando) { window.addEventListener('gmaps-ready', cb, { once: true }); return; }
  googleCargando = true;
  window.__gmapsReady = function () { window.dispatchEvent(new Event('gmaps-ready')); cb(); };
  const s = document.createElement('script');
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(GOOGLE_MAPS_API_KEY) +
          '&libraries=places&loading=async&callback=__gmapsReady';
  s.async = true; s.defer = true;
  s.onerror = () => {
    googleCargando = false;
    const hint = document.getElementById('mapsHint');
    if (hint) hint.textContent = 'No se pudo cargar Google Maps. Revisa la API key, sus restricciones y tu conexión.';
    toast('Mapa no disponible', 'No se pudo cargar Google Maps.', true);
  };
  document.head.appendChild(s);
}

function initMapaOSM() { // (nombre conservado: lo llama irVista('maps'))
  if (mapsInit) { actualizarHintUso(); return; }
  const hint = document.getElementById('mapsHint');

  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.indexOf('PEGA_TU_API_KEY') === 0) {
    if (hint) hint.textContent = 'Falta configurar GOOGLE_MAPS_API_KEY en crm/app.js.';
    return;
  }
  if (!puedeLlamarMaps(1)) { mostrarLimiteMaps(); return; }
  if (hint) hint.textContent = 'Cargando mapa…';
  cargarGoogleMapsAPI(crearMapaGoogle);
}

function crearMapaGoogle() {
  if (mapsInit || !(window.google && window.google.maps)) return;
  if (!puedeLlamarMaps(1)) { mostrarLimiteMaps(); return; }

  let pos = MAPS_DEF;
  try { const g = JSON.parse(localStorage.getItem(MAPS_POS_KEY)); if (g && g.lat) pos = g; } catch (e) {}

  mapa = new google.maps.Map(document.getElementById('mapaOSM'), {
    center: { lat: pos.lat, lng: pos.lon },
    zoom: pos.zoom || 15,
    clickableIcons: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false
  });
  geocoder = new google.maps.Geocoder();
  mapsInit = true;
  registrarLlamadaMaps(1); // carga del mapa (Dynamic Maps)

  // Click izquierdo sobre un negocio: Google solo entrega placeId en 'click'.
  mapa.addListener('click', ev => {
    if (ev.placeId) {
      ev.stop(); // evita el info window por defecto de Google
      poiSeleccionado = { placeId: ev.placeId };
      const de = ev.domEvent || {};
      const menu = document.getElementById('mapCtx');
      menu.style.left = (de.clientX || 0) + 'px';
      menu.style.top = (de.clientY || 0) + 'px';
      menu.style.display = 'block';
    } else {
      cerrarMenuMapa();
    }
  });
  mapa.addListener('dragstart', cerrarMenuMapa);
  mapa.addListener('idle', () => {
    const c = mapa.getCenter();
    if (c) localStorage.setItem(MAPS_POS_KEY, JSON.stringify({ lat: c.lat(), lon: c.lng(), zoom: mapa.getZoom() }));
  });

  actualizarHintUso();
}

function buscarZonaMaps() {
  const q = (document.getElementById('mapsBuscar').value || '').trim();
  if (!q || !mapa || !geocoder) return;
  if (!puedeLlamarMaps(1)) { mostrarLimiteMaps(); return; }
  registrarLlamadaMaps(1); // Geocoding
  geocoder.geocode({ address: q }, (res, status) => {
    if (status === 'OK' && res && res[0]) {
      mapa.setCenter(res[0].geometry.location);
      mapa.setZoom(16);
    } else {
      toast('Sin resultados', 'Toca ℹ️ para ver el detalle técnico de Google.', true, 'Geocoding status: ' + status);
    }
  });
}

function cerrarMenuMapa() {
  const menu = document.getElementById('mapCtx');
  if (menu) menu.style.display = 'none';
}

async function agregarClienteDesdeMapa() {
  cerrarMenuMapa();
  if (!poiSeleccionado || !poiSeleccionado.placeId || !(window.google && google.maps.places)) return;
  if (!puedeLlamarMaps(1)) { mostrarLimiteMaps(); return; }
  registrarLlamadaMaps(1); // Place Details (API nueva: Place.fetchFields)
  try {
    const place = new google.maps.places.Place({ id: poiSeleccionado.placeId });
    await place.fetchFields({
      fields: ['displayName', 'nationalPhoneNumber', 'internationalPhoneNumber', 'types', 'primaryTypeDisplayName']
    });
    abrirModalClientePrefill({
      nombre: place.displayName || '',
      telefono: place.nationalPhoneNumber || place.internationalPhoneNumber || '',
      correo: '', // Google no entrega correo del negocio
      giro: place.primaryTypeDisplayName || giroDesdeTypes(place.types)
    });
  } catch (e) {
    const detalle = (e && (e.message || e.toString())) || 'Error desconocido.';
    toast('No se pudo obtener el negocio', 'Toca ℹ️ para ver el detalle técnico de Google.', true, detalle);
  }
}

/* =========================================================
   Panel de tareas ajustable: slider abajo del panel
   (ancho guardado por dispositivo en localStorage)
   ========================================================= */
const TAREAS_W_KEY = 'crm_tareas_w';
const TAREAS_W_MIN = 240;
const TAREAS_W_MAX = 560;
const TAREAS_W_DEF = 320;

function aplicarAnchoTareas(px) {
  const w = Math.max(TAREAS_W_MIN, Math.min(TAREAS_W_MAX, px));
  document.documentElement.style.setProperty('--tareas-w', w + 'px');
  return w;
}

function initResizer() {
  const slider = document.getElementById('anchoPanel');
  if (!slider) return;

  const guardado = parseInt(localStorage.getItem(TAREAS_W_KEY), 10);
  const inicial = isNaN(guardado) ? TAREAS_W_DEF : guardado;
  slider.value = aplicarAnchoTareas(inicial);

  slider.addEventListener('input', () => {
    const w = aplicarAnchoTareas(parseInt(slider.value, 10));
    localStorage.setItem(TAREAS_W_KEY, w);
  });
}

/* =========================================================
   Init
   ========================================================= */
function init() {
  initResizer();
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') iniciarSesion(); });
  document.getElementById('modalCliente').addEventListener('click', e => { if (e.target.id === 'modalCliente') cerrarModalCliente(); });
  document.getElementById('modalInteraccion').addEventListener('click', e => { if (e.target.id === 'modalInteraccion') cerrarModalInteraccion(); });
  // cerrar el menú contextual del mapa al hacer click fuera de él
  document.addEventListener('click', e => { if (!e.target.closest('#mapCtx')) cerrarMenuMapa(); });

  // refresca las tareas del día cada minuto (para que crucen de "hoy" a "vencidas")
  setInterval(renderTareas, 60 * 1000);

  if (window.FB) arrancarAuth();
  else window.addEventListener('fb-ready', arrancarAuth, { once: true });
}
document.addEventListener('DOMContentLoaded', init);
