/* =========================================================
   EnvíoExpress — App de guía de llamada
   Datos compartidos en Firebase (Firestore) + login de equipo
   ========================================================= */

'use strict';

const STEP_LABELS = ['Apertura', 'Valor', 'Escucha y objeciones', 'Vs competencia', 'Resultado'];
const CALLBACK_LEAD_MS = 5 * 60 * 1000;        // 5 min antes
const CITA_LEAD_MS = 24 * 60 * 60 * 1000;      // 1 día antes
const CHECK_INTERVAL_MS = 30 * 1000;           // revisa cada 30 s
const NOTIFIED_KEY = 'ee_notified';            // dedupe de avisos (por dispositivo)

/* ---------- Estado en memoria ---------- */
let clientes = [];
let clienteActivoId = null;   // cliente en curso dentro de la guía
let cur = 0;                  // paso actual de la guía
let resultadoSel = null;      // resultado elegido en el paso final
let snapUnsub = null;         // para cancelar el listener de Firestore

/* =========================================================
   Datos (Firestore)
   La colección 'clientes' es la cartera compartida del equipo.
   El array `clientes` se mantiene en vivo con onSnapshot.
   ========================================================= */
function getCliente(id) {
  return clientes.find(c => c.id === id) || null;
}

// Guarda/actualiza un cliente: optimista en memoria + escritura a Firestore.
function upsertCliente(cli) {
  const i = clientes.findIndex(c => c.id === cli.id);
  if (i >= 0) clientes[i] = cli; else clientes.push(cli);
  if (window.FB) {
    FB.setDoc(FB.doc(FB.db, 'clientes', cli.id), cli)
      .catch(err => toast('Error al guardar', err.message, true));
  }
}

function nuevoId() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function iniciarSnapshot() {
  if (snapUnsub || !window.FB) return;
  snapUnsub = FB.onSnapshot(
    FB.collection(FB.db, 'clientes'),
    snap => {
      clientes = snap.docs.map(d => d.data());
      actualizarHomeCount();
      if (document.getElementById('vista-agenda').classList.contains('active')) renderAgenda();
      revisarRecordatorios();
    },
    err => toast('Error de sincronización', err.message, true)
  );
}

function detenerSnapshot() {
  if (snapUnsub) { snapUnsub(); snapUnsub = null; }
  clientes = [];
}

/* =========================================================
   Autenticación (cuenta compartida del equipo)
   ========================================================= */
function arrancarAuth() {
  document.getElementById('loginStatus').textContent = '';
  FB.onAuthStateChanged(FB.auth, user => {
    if (user) {
      mostrarLogueado();
      iniciarSnapshot();
    } else {
      detenerSnapshot();
      mostrarLogin();
    }
  });
}

function mostrarLogin() {
  document.getElementById('btnLogout').style.display = 'none';
  document.getElementById('callBadge').style.display = 'none';
  mostrarVista('vista-login');
}

function mostrarLogueado() {
  document.getElementById('btnLogout').style.display = 'inline-flex';
  document.getElementById('loginPass').value = '';
  actualizarHomeCount();
  mostrarVista('vista-inicio');
}

function iniciarSesion() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  err.classList.remove('show');

  if (!email || !pass) {
    err.textContent = 'Escribe correo y contraseña.';
    err.classList.add('show');
    return;
  }
  if (!window.FB) {
    err.textContent = 'Aún conectando con el servidor, intenta en un momento.';
    err.classList.add('show');
    return;
  }

  const btn = document.getElementById('btnLogin');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  FB.signInWithEmailAndPassword(FB.auth, email, pass)
    .catch(e => {
      err.textContent = mensajeErrorLogin(e.code);
      err.classList.add('show');
    })
    .finally(() => { btn.disabled = false; btn.textContent = 'Entrar'; });
}

function cerrarSesion() {
  if (window.FB) FB.signOut(FB.auth);
}

function mensajeErrorLogin(code) {
  switch (code) {
    case 'auth/invalid-email': return 'El correo no es válido.';
    case 'auth/missing-password': return 'Escribe la contraseña.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Correo o contraseña incorrectos.';
    case 'auth/too-many-requests': return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
    case 'auth/network-request-failed': return 'Sin conexión. Revisa tu internet.';
    default: return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
  }
}

/* =========================================================
   Navegación entre vistas
   ========================================================= */
function mostrarVista(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function irInicio() {
  if (window.FB && FB.auth.currentUser) {
    document.getElementById('callBadge').style.display = 'none';
    actualizarHomeCount();
    mostrarVista('vista-inicio');
  }
}

function irAgenda() {
  document.getElementById('callBadge').style.display = 'none';
  renderAgenda();
  mostrarVista('vista-agenda');
}

function irGuia(clienteId) {
  clienteActivoId = clienteId;
  const cli = getCliente(clienteId);
  if (!cli) { irInicio(); return; }

  document.getElementById('cbName').textContent = cli.nombre;
  document.getElementById('cbPhone').textContent = cli.telefono;
  document.getElementById('cbCall').href = 'tel:' + cli.telefono.replace(/\s+/g, '');
  document.getElementById('callBadge').style.display = 'flex';

  resultadoSel = null;
  resetResultadoUI();
  goTo(0);
  mostrarVista('vista-guia');
}

/* =========================================================
   Modal: nuevo cliente
   ========================================================= */
function abrirModalNuevo() {
  document.getElementById('inNombre').value = '';
  document.getElementById('inTel').value = '';
  document.getElementById('fieldNombre').classList.remove('invalid');
  document.getElementById('fieldTel').classList.remove('invalid');
  document.getElementById('modalNuevo').classList.add('active');
  setTimeout(() => document.getElementById('inNombre').focus(), 50);
}

function cerrarModalNuevo() {
  document.getElementById('modalNuevo').classList.remove('active');
}

function crearCliente() {
  const nombre = document.getElementById('inNombre').value.trim();
  const tel = document.getElementById('inTel').value.trim();
  const fNombre = document.getElementById('fieldNombre');
  const fTel = document.getElementById('fieldTel');

  const digitos = tel.replace(/\D/g, '');
  const okNombre = nombre.length > 0;
  const okTel = digitos.length >= 7;

  fNombre.classList.toggle('invalid', !okNombre);
  fTel.classList.toggle('invalid', !okTel);
  if (!okNombre || !okTel) return;

  const ahora = new Date().toISOString();
  const cli = {
    id: nuevoId(),
    nombre,
    telefono: tel,
    estado: 'contactado',
    creadoEn: ahora,
    contactadoEn: ahora,
    callbackEn: null,
    citaEn: null,
    citaDireccion: null,
    notas: ''
  };
  upsertCliente(cli);
  cerrarModalNuevo();
  irGuia(cli.id);
}

/* =========================================================
   Guía: navegación de pasos
   ========================================================= */
function goTo(n) {
  document.querySelectorAll('#vista-guia .panel')[cur].classList.remove('active');
  cur = n;
  document.querySelectorAll('#vista-guia .panel')[cur].classList.add('active');

  const steps = document.querySelectorAll('.prog-step');
  steps.forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i < cur) s.classList.add('done');
    if (i === cur) s.classList.add('active');
  });
  document.getElementById('progLabel').textContent = STEP_LABELS[cur];
  document.getElementById('navStep').textContent = (cur + 1) + ' / ' + STEP_LABELS.length;
  document.getElementById('btnPrev').disabled = cur === 0;

  const btnNext = document.getElementById('btnNext');
  btnNext.style.visibility = cur === STEP_LABELS.length - 1 ? 'hidden' : 'visible';
  btnNext.textContent = 'Siguiente →';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function navigate(dir) {
  const next = cur + dir;
  if (next < 0 || next > STEP_LABELS.length - 1) return;
  goTo(next);
}

function toggleObj(el) {
  const isOpen = el.classList.contains('open');
  document.querySelectorAll('.obj-item').forEach(o => o.classList.remove('open'));
  if (!isOpen) el.classList.add('open');
}

/* =========================================================
   Guía: paso de resultado
   ========================================================= */
function resetResultadoUI() {
  document.querySelectorAll('.result-opt').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('.result-detail').forEach(d => d.classList.remove('active'));
  document.querySelectorAll('#vista-guia .field').forEach(f => f.classList.remove('invalid'));
  document.getElementById('btnGuardarResultado').style.display = 'none';
  ['callbackDT', 'citaDT', 'citaDir', 'notasCallback', 'notasCita', 'notasNo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function seleccionarResultado(tipo) {
  resultadoSel = tipo;
  document.querySelectorAll('.result-opt').forEach(o =>
    o.classList.toggle('selected', o.dataset.result === tipo));
  document.querySelectorAll('.result-detail').forEach(d => d.classList.remove('active'));
  document.getElementById('detail-' + tipo).classList.add('active');
  document.getElementById('btnGuardarResultado').style.display = 'flex';
}

function guardarResultado() {
  const cli = getCliente(clienteActivoId);
  if (!cli || !resultadoSel) return;

  if (resultadoSel === 'por_contactar') {
    const val = document.getElementById('callbackDT').value;
    if (!esFechaFutura(val)) return marcarInvalido('callbackDT');
    cli.estado = 'por_contactar';
    cli.callbackEn = new Date(val).toISOString();
    cli.citaEn = null;
    cli.citaDireccion = null;
    cli.notas = document.getElementById('notasCallback').value.trim();
  } else if (resultadoSel === 'cita_agendada') {
    const val = document.getElementById('citaDT').value;
    if (!esFechaFutura(val)) return marcarInvalido('citaDT');
    cli.estado = 'cita_agendada';
    cli.citaEn = new Date(val).toISOString();
    cli.citaDireccion = document.getElementById('citaDir').value.trim();
    cli.callbackEn = null;
    cli.notas = document.getElementById('notasCita').value.trim();
  } else if (resultadoSel === 'no_interesado') {
    cli.estado = 'no_interesado';
    cli.callbackEn = null;
    cli.citaEn = null;
    cli.notas = document.getElementById('notasNo').value.trim();
  }

  upsertCliente(cli);
  toast('Guardado', mensajeResultado(cli), false);
  clienteActivoId = null;
  irAgenda();
}

function esFechaFutura(val) {
  if (!val) return false;
  const t = new Date(val).getTime();
  return !isNaN(t) && t > Date.now();
}

function marcarInvalido(inputId) {
  const field = document.getElementById(inputId).closest('.field');
  if (field) field.classList.add('invalid');
}

function mensajeResultado(cli) {
  if (cli.estado === 'por_contactar') return cli.nombre + ' quedó para seguimiento.';
  if (cli.estado === 'cita_agendada') return 'Cita agendada con ' + cli.nombre + '.';
  return cli.nombre + ' marcado como no interesado.';
}

/* =========================================================
   Agenda
   ========================================================= */
const BADGE_TXT = {
  contactado: 'Contactado',
  por_contactar: 'Por contactar',
  no_interesado: 'No interesado',
  cita_agendada: 'Cita agendada'
};

function recordatoriosProximos() {
  const lista = [];
  clientes.forEach(c => {
    if (c.estado === 'por_contactar' && c.callbackEn) {
      lista.push({ id: c.id, nombre: c.nombre, tipo: 'callback', when: new Date(c.callbackEn) });
    }
    if (c.estado === 'cita_agendada' && c.citaEn) {
      lista.push({ id: c.id, nombre: c.nombre, tipo: 'cita', when: new Date(c.citaEn), dir: c.citaDireccion });
    }
  });
  return lista
    .filter(r => r.when.getTime() > Date.now() - 60 * 60 * 1000)
    .sort((a, b) => a.when - b.when);
}

function actualizarHomeCount() {
  const n = recordatoriosProximos().length;
  const el = document.getElementById('homeCount');
  if (!el) return;
  el.textContent = n;
  el.classList.toggle('hidden', n === 0);
}

function renderAgenda() {
  const recs = recordatoriosProximos();
  const recSection = document.getElementById('remindersSection');
  const recList = document.getElementById('remindersList');
  if (recs.length === 0) {
    recSection.style.display = 'none';
  } else {
    recSection.style.display = 'block';
    recList.innerHTML = recs.map(r => {
      const lead = r.tipo === 'callback' ? CALLBACK_LEAD_MS : CITA_LEAD_MS;
      const soon = r.when.getTime() - Date.now() <= lead;
      const ic = r.tipo === 'callback' ? '🔁' : '📅';
      const tipoTxt = r.tipo === 'callback' ? 'Seguimiento' : 'Cita presencial';
      const dir = r.dir ? ' · ' + escapeHtml(r.dir) : '';
      return `<div class="reminder ${soon ? 'soon' : ''}">
        <span class="rm-ic">${ic}</span>
        <div class="rm-main">
          <div class="rm-name">${escapeHtml(r.nombre)}</div>
          <div class="rm-when">${tipoTxt} · ${fmtFecha(r.when)}${dir}</div>
        </div>
        <span class="rm-count">${cuentaRegresiva(r.when)}</span>
      </div>`;
    }).join('');
  }

  const list = document.getElementById('clientList');
  if (clientes.length === 0) {
    list.innerHTML = `<div class="empty-state">Aún no hay clientes. Toca <strong>+ Nuevo</strong> para empezar.</div>`;
    return;
  }
  const ordenados = [...clientes].sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
  list.innerHTML = ordenados.map(c => {
    let meta = '';
    if (c.estado === 'por_contactar' && c.callbackEn)
      meta = `🔁 Próximo contacto: ${fmtFecha(new Date(c.callbackEn))}`;
    else if (c.estado === 'cita_agendada' && c.citaEn)
      meta = `📅 Cita: ${fmtFecha(new Date(c.citaEn))}${c.citaDireccion ? ' · ' + escapeHtml(c.citaDireccion) : ''}`;
    return `<div class="client-row">
      <div class="cr-top">
        <div>
          <div class="cr-name">${escapeHtml(c.nombre)}</div>
          <div class="cr-phone">${escapeHtml(c.telefono)}</div>
        </div>
        <span class="badge ${c.estado}">${BADGE_TXT[c.estado] || c.estado}</span>
      </div>
      ${meta ? `<div class="cr-meta">${meta}</div>` : ''}
      ${c.notas ? `<div class="cr-meta">📝 ${escapeHtml(c.notas)}</div>` : ''}
      <div class="cr-actions">
        <a class="btn" href="tel:${escapeHtml(c.telefono.replace(/\s+/g, ''))}">📞 Llamar</a>
        <button class="btn primary" onclick="irGuia('${c.id}')">Abrir guía</button>
        <button class="btn danger" onclick="eliminarCliente('${c.id}')">Eliminar</button>
      </div>
    </div>`;
  }).join('');
}

function eliminarCliente(id) {
  const cli = getCliente(id);
  if (!cli) return;
  if (!confirm('¿Eliminar a ' + cli.nombre + '? Esta acción no se puede deshacer.')) return;
  clientes = clientes.filter(c => c.id !== id);
  if (window.FB) {
    FB.deleteDoc(FB.doc(FB.db, 'clientes', id))
      .catch(err => toast('Error al eliminar', err.message, true));
  }
  renderAgenda();
  actualizarHomeCount();
}

/* =========================================================
   Notificaciones / scheduler (dedupe local por dispositivo)
   ========================================================= */
function pedirPermisoNotif() {
  if (!('Notification' in window)) {
    toast('Sin soporte', 'Este navegador no permite notificaciones. Usaremos avisos dentro de la app.', true);
    cerrarBanner();
    return;
  }
  Notification.requestPermission().then(p => {
    if (p === 'granted') {
      cerrarBanner();
      toast('Listo', 'Notificaciones activadas.', false);
    } else {
      toast('Aviso', 'Sin permiso del sistema seguirás viendo avisos dentro de la app.', true);
      cerrarBanner();
    }
  });
}

function cerrarBanner() {
  document.getElementById('notifBanner').classList.remove('show');
}

function quizasMostrarBanner() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    document.getElementById('notifBanner').classList.add('show');
  }
}

function dispararNotif(titulo, cuerpo) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(titulo, { body: cuerpo, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
      n.onclick = () => { window.focus(); irAgenda(); n.close(); };
    } catch (e) { /* algunos navegadores requieren SW para notificar */ }
  }
  toast(titulo, cuerpo, true);
}

function getNotified() {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function saveNotified(set) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set]));
}

function revisarRecordatorios() {
  const ahora = Date.now();
  const notified = getNotified();
  let cambios = false;

  clientes.forEach(c => {
    if (c.estado === 'por_contactar' && c.callbackEn) {
      const t = new Date(c.callbackEn).getTime();
      const key = 'cb:' + c.id + ':' + c.callbackEn;
      if (!notified.has(key) && ahora >= t - CALLBACK_LEAD_MS && ahora <= t + 60 * 60 * 1000) {
        dispararNotif('Seguimiento en 5 min', `Llama a ${c.nombre} (${c.telefono}) a las ${fmtHora(new Date(t))}`);
        notified.add(key); cambios = true;
      }
    }
    if (c.estado === 'cita_agendada' && c.citaEn) {
      const t = new Date(c.citaEn).getTime();
      const key = 'ci:' + c.id + ':' + c.citaEn;
      if (!notified.has(key) && ahora >= t - CITA_LEAD_MS && ahora <= t) {
        const dir = c.citaDireccion ? ` en ${c.citaDireccion}` : '';
        dispararNotif('Recordatorio de cita', `Tienes una cita con ${c.nombre}${dir} el ${fmtFecha(new Date(t))}`);
        notified.add(key); cambios = true;
      }
    }
  });

  if (cambios) saveNotified(notified);
  actualizarHomeCount();
  if (document.getElementById('vista-agenda').classList.contains('active')) renderAgenda();
}

/* =========================================================
   Toasts (avisos in-app)
   ========================================================= */
function toast(titulo, cuerpo, alerta) {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast' + (alerta ? ' alert' : '');
  el.innerHTML = `<div class="t-title">${escapeHtml(titulo)}</div><div class="t-body">${escapeHtml(cuerpo)}</div>`;
  el.onclick = () => el.remove();
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 7000);
}

/* =========================================================
   Utilidades de formato
   ========================================================= */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function fmtFecha(d) {
  return d.toLocaleString('es-MX', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit'
  });
}

function fmtHora(d) {
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function cuentaRegresiva(d) {
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return '¡Ahora!';
  const min = Math.round(diff / 60000);
  if (min < 60) return 'en ' + min + ' min';
  const hrs = Math.round(min / 60);
  if (hrs < 24) return 'en ' + hrs + ' h';
  const dias = Math.round(hrs / 24);
  return 'en ' + dias + ' día' + (dias > 1 ? 's' : '');
}

/* =========================================================
   PWA / service worker
   ========================================================= */
function registrarSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW: la app sigue funcionando */ });
  }
}

/* =========================================================
   Init
   ========================================================= */
function init() {
  quizasMostrarBanner();
  setInterval(revisarRecordatorios, CHECK_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revisarRecordatorios();
  });

  document.getElementById('inTel').addEventListener('keydown', e => {
    if (e.key === 'Enter') crearCliente();
  });
  document.getElementById('loginPass').addEventListener('keydown', e => {
    if (e.key === 'Enter') iniciarSesion();
  });
  document.getElementById('modalNuevo').addEventListener('click', e => {
    if (e.target.id === 'modalNuevo') cerrarModalNuevo();
  });

  registrarSW();

  // Firebase puede estar listo antes o después de este punto
  if (window.FB) arrancarAuth();
  else window.addEventListener('fb-ready', arrancarAuth, { once: true });
}

document.addEventListener('DOMContentLoaded', init);
