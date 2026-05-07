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
const socket = io();

let myCharacter = null;
let takenChars = new Set();

// Charakter-Auswahl direkt beim Laden bauen — kein Name-Step mehr.
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
  left: false, right: false, up: false, down: false,
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

// Reconnection-Sicherheit: Bei Reconnect nochmal beitreten
socket.on('connect', () => {
  if (myCharacter) {
    socket.emit('join-game', { name: myCharacter.name.toUpperCase(), characterId: myCharacter.id });
  }
});

socket.on('disconnect', () => {
  toast('Verbindung verloren …', 4000);
});

// Versehentliches Pinch-Zoom / Scroll verhindern
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (e.target.tagName !== 'INPUT') e.preventDefault();
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
async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    } else if (el.webkitRequestFullscreen) {
      // iOS Safari (älter)
      el.webkitRequestFullscreen();
    }
  } catch (e) { /* user gesture nötig oder nicht unterstützt */ }
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
  document.body.classList.toggle('is-fullscreen', isFullscreen());
}

document.addEventListener('fullscreenchange', syncFullscreenClass);
document.addEventListener('webkitfullscreenchange', syncFullscreenClass);

function maybeAutoFullscreen() {
  // Auto-Vollbild geht nur als direkte Reaktion auf einen User-Tap.
  // Wir versuchen es opportunistisch beim nächsten Tap auf einen Pad-Button.
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
  fsBtn.addEventListener('click', enterFullscreen);
}
