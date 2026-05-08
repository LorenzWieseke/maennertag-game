// controller.js — läuft auf dem Handy
// Bietet 3-Schritt-Flow: Name → Charakter → Steuerung
// und schickt Touch-Inputs per Socket.IO an den Host.

const CHARACTERS = [
  { id: 'manu',   name: 'Manu',   color: '#4a90e2', ability: 'Ausdauer-Bestie' },
  { id: 'ahln',   name: 'Ahln',   color: '#c94f4f', ability: 'Bierschwamm' },
  { id: 'schumi', name: 'Schumi', color: '#6dbf47', ability: 'Chillout-Modus' },
  { id: 'lorenz', name: 'Lorenz', color: '#e8a04e', ability: 'Glücksgriff' },
  { id: 'stefan', name: 'Stefan', color: '#2c2c2c', ability: 'Coolness-Aura' },
  { id: 'jan',    name: 'Jan',    color: '#4a8a8a', ability: 'Paddel-König' },
  { id: 'sven',   name: 'Sven',   color: '#b84a9e', ability: 'Marathon-Mann' }
];

const $ = (sel) => document.querySelector(sel);

// Stabile Geräte-ID — überlebt Tab-Reload und Browser-Suspend.
// Der Server nutzt sie, um beim Reconnect die alte Session zu räumen,
// damit nicht der eigene Charakter als "taken" angezeigt wird.
function ensureClientId() {
  try {
    let id = localStorage.getItem('maennertag-clientId');
    if (!id) {
      id = 'c-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
      localStorage.setItem('maennertag-clientId', id);
    }
    return id;
  } catch (_) {
    return 'c-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
  }
}
const CLIENT_ID = ensureClientId();

// Letzten Charakter merken, damit ein versehentlicher Reload den User direkt
// wieder im Spiel landet — statt zwingend einen anderen wählen zu müssen.
function loadSavedCharId() {
  try { return sessionStorage.getItem('maennertag-charId') || null; }
  catch (_) { return null; }
}
function saveCharId(id) {
  try {
    if (id) sessionStorage.setItem('maennertag-charId', id);
    else sessionStorage.removeItem('maennertag-charId');
  } catch (_) { /* ignore */ }
}

const socket = io({ auth: { clientId: CLIENT_ID } });

let myCharacter = null;
let takenChars = new Set();

document.addEventListener('DOMContentLoaded', () => {
  buildCharacterGrid();
});

// ===== Schritt-Navigation =====
function showStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ===== Toast =====
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ===== Server-Events =====
socket.on('taken-characters', (list) => {
  takenChars = new Set(list);
  updateCharacterGrid();
});

socket.on('character-taken', (charId) => {
  toast('Schon vergeben — nimm einen anderen!');
});

socket.on('joined', ({ characterId }) => {
  const c = CHARACTERS.find(c => c.id === characterId);
  if (!c) return;
  myCharacter = c;
  saveCharId(c.id);
  document.documentElement.style.setProperty('--char-color', c.color);
  $('#banner-name').textContent = c.name.toUpperCase();
  $('#banner-ability').textContent = c.ability;

  // Mini-Avatar links im Banner
  const banner = $('#char-banner');
  const oldAvatar = banner.querySelector('.banner-avatar');
  if (oldAvatar) oldAvatar.remove();
  if (window.MaennertagPixelChars) {
    const av = window.MaennertagPixelChars.buildCharCanvas(c.id, 4);
    av.className = 'banner-avatar';
    banner.insertBefore(av, banner.firstChild);
  }

  showStep('#step-controller');
  if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
  // beim Wechsel auf den Controller dezent zum Vollbild ermutigen
  maybeAutoFullscreen();
});

socket.on('vibrate', () => {
  if (navigator.vibrate) navigator.vibrate(60);
});

// ===== STEP 1: Charakter =====
function buildCharacterGrid() {
  const grid = $('#character-grid');
  grid.innerHTML = '';
  CHARACTERS.forEach(c => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.dataset.id = c.id;
    card.style.setProperty('--char-color', c.color);
    if (takenChars.has(c.id)) card.classList.add('taken');

    // Pixelart-Avatar (statt CSS-Rechteck)
    let avatarNode;
    if (window.MaennertagPixelChars) {
      avatarNode = window.MaennertagPixelChars.buildCharCanvas(c.id, 5);
      avatarNode.className = 'char-avatar';
    } else {
      avatarNode = document.createElement('div');
      avatarNode.className = 'char-avatar';
      avatarNode.style.background = c.color;
    }
    card.appendChild(avatarNode);

    const h3 = document.createElement('h3');
    h3.textContent = c.name.toUpperCase();
    card.appendChild(h3);

    const ability = document.createElement('div');
    ability.className = 'ability';
    ability.textContent = c.ability;
    card.appendChild(ability);

    card.addEventListener('click', () => pickCharacter(c));
    grid.appendChild(card);
  });
}

function updateCharacterGrid() {
  document.querySelectorAll('.char-card').forEach(card => {
    if (takenChars.has(card.dataset.id) && card.dataset.id !== (myCharacter && myCharacter.id)) {
      card.classList.add('taken');
    } else {
      card.classList.remove('taken');
    }
  });
}

function pickCharacter(c) {
  if (takenChars.has(c.id)) {
    toast('Schon vergeben!');
    return;
  }
  // Name = Charakter-Name. Server clamped serverseitig auf 12 Zeichen.
  socket.emit('join-game', { name: c.name.toUpperCase(), characterId: c.id });
  if (navigator.vibrate) navigator.vibrate(30);
}

// ===== STEP 3: Controller (Touch) =====
const inputState = {
  left: false, right: false, up: false,
  action: false, drink: false
};
let lastSentJSON = '';

function sendInput() {
  const json = JSON.stringify(inputState);
  if (json === lastSentJSON) return;
  lastSentJSON = json;
  socket.emit('input', inputState);
}

// Multi-Touch-fähiges Setup
document.querySelectorAll('[data-input]').forEach(btn => {
  const key = btn.dataset.input;

  const press = (e) => {
    if (e.cancelable) e.preventDefault();
    if (inputState[key]) return;
    inputState[key] = true;
    btn.classList.add('pressed');
    sendInput();
    if (navigator.vibrate && (key === 'drink' || key === 'action')) {
      navigator.vibrate(20);
    }
  };

  const release = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!inputState[key]) return;
    inputState[key] = false;
    btn.classList.remove('pressed');
    sendInput();
  };

  // Touch
  btn.addEventListener('touchstart', press, { passive: false });
  btn.addEventListener('touchend', release, { passive: false });
  btn.addEventListener('touchcancel', release, { passive: false });

  // Pointer/Maus für Tests am Desktop
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointerleave', (e) => {
    // Nur freigeben wenn der Button nicht aktiv gehalten wird
    if (e.pressure === 0) release(e);
  });
});

// Baum-Event: kein Schütteln (zu viel iOS-Permission-Theater) — der Host
// zählt einfach 10× ACTION-Press. Hier nur ein dezentes Overlay als Hinweis.
function showChopOverlay(visible) {
  let overlay = document.getElementById('chop-overlay');
  if (!overlay && visible) {
    overlay = document.createElement('div');
    overlay.id = 'chop-overlay';
    overlay.style.cssText = `
      position:fixed; bottom:120px; left:50%; transform:translateX(-50%);
      background:#1a0f08cc; color:#f4c842; font-family:Bungee,sans-serif;
      font-size:22px; padding:14px 28px; border-radius:12px;
      border:2px solid #f4c842; text-align:center; z-index:999; pointer-events:none;
      letter-spacing: 0.05em;
    `;
    overlay.innerHTML = '30× ACTION HÄMMERN!';
    document.body.appendChild(overlay);
  }
  if (overlay) overlay.style.display = visible ? 'block' : 'none';
}

// Reconnect / neuer Host: gleiche Join-Logik (nach Host-Reload ist players
// leer, aber unser Socket lebt noch — dann kommt host-ready vom Server).
function tryRejoinGame() {
  const charId = (myCharacter && myCharacter.id) || loadSavedCharId();
  if (!charId) return;
  const c = CHARACTERS.find(x => x.id === charId);
  if (!c) return;
  socket.emit('join-game', { name: c.name.toUpperCase(), characterId: c.id });
}

socket.on('connect', tryRejoinGame);

socket.on('host-ready', tryRejoinGame);

socket.on('tree-event-start', () => {
  showChopOverlay(true);
  if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
});

socket.on('tree-event-end', () => {
  showChopOverlay(false);
});

socket.on('disconnect', () => {
  toast('Verbindung verloren …', 4000);
});

// Versehentliches Pinch-Zoom / Scroll verhindern
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (e.target.tagName === 'INPUT') return;
  // Charakter-Liste: natives vertikales Scrollen erlauben (Querformat / kurze Viewports)
  if (e.target.closest && e.target.closest('#character-grid')) return;
  if (e.cancelable) e.preventDefault();
}, { passive: false });

// Bildschirm wach halten (best effort)
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* ignore */ }
}
document.addEventListener('click', keepAwake, { once: true });

// =====================================================
//  VOLLBILD — fixt das abgeschnittene Gamepad in iOS Safari
// =====================================================

// iPhone Safari unterstützt die Fullscreen-API NICHT (Stand 2026).
// Auf dem iPad gibt's webkitRequestFullscreen ab iPadOS 13, auf dem
// iPhone ist beides undefined → Button wirkt kaputt.
function fullscreenSupported() {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

function isIos() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ meldet sich als "MacIntel" mit Touch
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function isIphone() {
  return /iPhone|iPod/.test(navigator.userAgent || '');
}

function isStandalone() {
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

async function enterFullscreen() {
  // iPhone-Fallback: API existiert nicht → User muss "Zum Home-Bildschirm".
  if (!fullscreenSupported()) {
    if (isIos()) {
      showIosHomescreenHint();
    } else {
      toast('Vollbild wird auf diesem Gerät nicht unterstützt.', 3000);
    }
    return;
  }
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  } catch (e) {
    toast('Vollbild blockiert. Tippe nochmal auf den Button.', 2500);
  }
  // Querformat versuchen — auf iOS oft nicht erlaubt, ist aber ein
  // No-op-Fallback und bricht nichts
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) { /* ignore */ }
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function syncFullscreenClass() {
  document.body.classList.toggle(
    'is-fullscreen',
    isFullscreen() || isStandalone()
  );
}

document.addEventListener('fullscreenchange', syncFullscreenClass);
document.addEventListener('webkitfullscreenchange', syncFullscreenClass);

// iOS-Hinweis-Overlay: erklärt einmalig "Teilen → Zum Home-Bildschirm".
// Wird lazy gebaut, damit Nicht-iOS-User nichts davon sehen.
function showIosHomescreenHint() {
  let overlay = document.getElementById('ios-fs-hint');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ios-fs-hint';
    overlay.innerHTML = `
      <div class="ios-fs-hint__card">
        <h2>Echter Vollbild auf dem iPhone</h2>
        <p>Safari erlaubt keinen Vollbild-Modus auf Knopfdruck.</p>
        <ol>
          <li>Tippe unten auf <strong>Teilen</strong>
            <span aria-hidden="true">▵</span></li>
          <li>Wähle <strong>"Zum Home-Bildschirm"</strong></li>
          <li>Öffne MÄNNERTAG vom Home-Bildschirm
            — startet ohne Adresszeile.</li>
        </ol>
        <button type="button" class="ios-fs-hint__close">VERSTANDEN</button>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.classList.remove('show');
    overlay.querySelector('.ios-fs-hint__close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }
  overlay.classList.add('show');
}

function maybeAutoFullscreen() {
  // Auto-Vollbild geht nur als direkte Reaktion auf einen User-Tap.
  // Auf iPhone-Safari sinnlos (API fehlt) → gar nicht erst versuchen,
  // damit wir nicht beim ersten Tap stumm scheitern.
  if (!fullscreenSupported() || isStandalone()) return;
  const oneShot = () => {
    enterFullscreen();
    document.removeEventListener('touchstart', oneShot, true);
    document.removeEventListener('pointerdown', oneShot, true);
  };
  document.addEventListener('touchstart', oneShot, { capture: true, once: true, passive: true });
  document.addEventListener('pointerdown', oneShot, { capture: true, once: true });
}

const fsBtn = document.getElementById('fs-btn');
if (fsBtn) {
  // touchend feuert auf iOS zuverlässig & ohne 300ms-Delay; click bleibt
  // für Desktop. Flag verhindert Doppel-Trigger, wenn beides feuert.
  let lastFsTrigger = 0;
  const trigger = (e) => {
    const now = Date.now();
    if (now - lastFsTrigger < 500) return;
    lastFsTrigger = now;
    if (e.cancelable) e.preventDefault();
    enterFullscreen();
  };
  fsBtn.addEventListener('touchend', trigger, { passive: false });
  fsBtn.addEventListener('click', trigger);
  // Standalone-Modus: kein Button nötig, läuft schon ohne URL-Bar.
  if (isStandalone()) {
    fsBtn.style.display = 'none';
  } else if (isIphone()) {
    fsBtn.title = 'iPhone: Zum Home-Bildschirm hinzufügen';
  }
}
syncFullscreenClass();
