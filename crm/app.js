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
  } else if (v === 'detalle') {
    document.getElementById('vista-detalle').classList.add('active');
    document.getElementById('mi-clientes').classList.add('active');
    renderDetalle();
  } else if (v === 'speech') {
    document.getElementById('vista-speech').classList.add('active');
    document.getElementById('mi-speech').classList.add('active');
    mostrarSpeechPick();
  }
}

function renderTodo() {
  renderTareas();
  if (vistaActual === 'clientes') renderClientes();
  if (vistaActual === 'detalle') renderDetalle();
  if (vistaActual === 'speech' && document.getElementById('speechPick').style.display !== 'none') llenarSelectClientes();
}

/* =========================================================
   Catálogo de clientes
   ========================================================= */
function renderClientes() {
  const q = (document.getElementById('buscar').value || '').toLowerCase().trim();
  const lista = [...clientes]
    .filter(c => !q || (c.nombre + ' ' + (c.giro || '') + ' ' + (c.correo || '')).toLowerCase().includes(q))
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
      <td class="cell-muted">${n}</td>
    </tr>`;
  }).join('');
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
  document.getElementById('cComentarios').value = cli ? (cli.comentarios || '') : '';
  document.getElementById('fNombre').classList.remove('invalid');
  document.getElementById('fTel').classList.remove('invalid');
  document.getElementById('modalCliente').classList.add('active');
  setTimeout(() => document.getElementById('cNombre').focus(), 50);
}
function cerrarModalCliente() { document.getElementById('modalCliente').classList.remove('active'); }
function editarClienteActual() { abrirModalCliente(detalleId); }

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
    (c.interacciones || []).forEach(it => {
      if ((it.paso === 'cita' || it.paso === 'seguimiento') && it.cuando) {
        out.push({ clienteId: c.id, nombre: c.nombre, telefono: c.telefono, paso: it.paso, when: new Date(it.cuando) });
      }
    });
  });
  // solo la próxima tarea pendiente por cliente+paso ya está incluida; ordenamos por fecha
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
  </div>`;
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

function toast(titulo, cuerpo, alerta) {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (alerta ? ' alert' : '');
  el.innerHTML = `<div class="t-title">${escapeHtml(titulo)}</div><div class="t-body">${escapeHtml(cuerpo)}</div>`;
  el.onclick = () => el.remove();
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 6000);
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

  // refresca las tareas del día cada minuto (para que crucen de "hoy" a "vencidas")
  setInterval(renderTareas, 60 * 1000);

  if (window.FB) arrancarAuth();
  else window.addEventListener('fb-ready', arrancarAuth, { once: true });
}
document.addEventListener('DOMContentLoaded', init);
