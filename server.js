// server.js — Männertag-Game Backend
// Stellt das Spiel + die Controller-Seite bereit, generiert QR-Code,
// und bridged Inputs von den Handys zum Spiel-Host per Socket.IO.

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// Während der Entwicklung: kein Browser-Cache, damit Reloads garantiert
// die frischen JS/CSS-Dateien holen statt eine alte Version aus dem Cache.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false, lastModified: false, maxAge: 0
}));

// Lokale IP rausfinden, damit Handys im selben WLAN sich verbinden können
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();
const CONTROLLER_URL = `http://${LOCAL_IP}:${PORT}/controller.html`;

// QR-Code-Endpoint — der Host (index.html) holt sich den QR von hier
app.get('/qr', async (req, res) => {
  try {
    const dataUrl = await QRCode.toDataURL(CONTROLLER_URL, {
      margin: 2,
      width: 400,
      color: { dark: '#1a0f08', light: '#fef3d4' }
    });
    res.json({ qr: dataUrl, url: CONTROLLER_URL });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========== Game-State ===========
// Nur Spielerliste + Inputs. Die eigentliche Spiel-Logik läuft im Browser des Hosts.
const players = new Map(); // socketId -> { id, clientId, name, characterId, input }
const takenCharacters = new Map(); // characterId -> clientId
let hostSocketId = null;

// Pro Socket eine eigene "taken"-Liste schicken: der eigene (stale) Charakter
// soll für den jeweiligen Client NICHT als blockiert erscheinen, damit man ihn
// nach einem Reload direkt wieder zurückholen kann.
function takenForClient(clientId) {
  const out = [];
  for (const [charId, ownerClientId] of takenCharacters) {
    if (ownerClientId !== clientId) out.push(charId);
  }
  return out;
}

function broadcastTakenChars() {
  for (const [, sock] of io.sockets.sockets) {
    if (sock.id === hostSocketId) continue;
    sock.emit('taken-characters', takenForClient(sock.data.clientId));
  }
}

// Alte Session desselben Geräts (gleiche clientId) räumen, bevor wir neu joinen.
// Verhindert Doppel-Charaktere wenn der alte Socket noch im Disconnect-Grace hängt.
function evictStaleSession(clientId, exceptSocketId) {
  if (!clientId) return;
  for (const [sid, p] of players) {
    if (p.clientId === clientId && sid !== exceptSocketId) {
      players.delete(sid);
      if (takenCharacters.get(p.characterId) === clientId) {
        takenCharacters.delete(p.characterId);
      }
      io.to('host').emit('player-left', sid);
      const oldSock = io.sockets.sockets.get(sid);
      if (oldSock) {
        try { oldSock.disconnect(true); } catch (_) { /* ignore */ }
      }
      console.log(`[~] Alte Session aufgeräumt: ${p.name} (${p.characterId})`);
    }
  }
}

io.on('connection', (socket) => {
  // Stabile Geräte-ID aus dem Handshake (vom Controller per localStorage geliefert).
  // Fällt sie weg (z. B. Host), reicht die socket.id als schwacher Fallback.
  const clientId = (socket.handshake.auth && socket.handshake.auth.clientId) || null;
  socket.data.clientId = clientId;

  console.log('[+] Verbunden:', socket.id, clientId ? `(client ${clientId.slice(0, 8)})` : '');

  // Falls dieses Gerät schon eine offene Session hat (alter Tab, Reconnect-Race),
  // sofort räumen — sonst sieht der User seinen eigenen Charakter als "taken".
  evictStaleSession(clientId, socket.id);

  socket.emit('taken-characters', takenForClient(clientId));

  // Der Spiel-Bildschirm (index.html) registriert sich als Host
  socket.on('register-host', () => {
    hostSocketId = socket.id;
    socket.join('host');
    socket.emit('player-list', Array.from(players.values()));
    // Controller-Sockets, die noch offen sind (Host war kurz weg), feuern kein
    // zweites "connect" — sie sollen join-game erneut senden, damit die Lobby
    // wieder gefüllt wird.
    socket.broadcast.emit('host-ready');
    console.log('[★] Host registriert:', socket.id);
  });

  // Ein Handy-Controller tritt bei
  socket.on('join-game', ({ name, characterId }) => {
    // Sicherheitsnetz: falls evictStaleSession in der Connection-Phase
    // eine Race verpasst hat (z. B. weil clientId noch nicht da war), hier nochmal.
    evictStaleSession(socket.data.clientId, socket.id);

    // Wenn dieser Socket schon einen Charakter hat (User wechselt aktiv),
    // alten freigeben.
    const existing = players.get(socket.id);
    if (existing && existing.characterId !== characterId) {
      if (takenCharacters.get(existing.characterId) === socket.data.clientId) {
        takenCharacters.delete(existing.characterId);
      }
    }

    const owner = takenCharacters.get(characterId);
    if (owner && owner !== socket.data.clientId) {
      socket.emit('character-taken', characterId);
      return;
    }
    const player = {
      id: socket.id,
      clientId: socket.data.clientId,
      name: String(name).slice(0, 12),
      characterId,
      input: { left: false, right: false, up: false, action: false, drink: false }
    };
    players.set(socket.id, player);
    takenCharacters.set(characterId, socket.data.clientId);
    io.to('host').emit('player-joined', player);
    socket.emit('joined', { id: socket.id, characterId });
    broadcastTakenChars();
    console.log(`[+] ${player.name} (${characterId}) ist beigetreten`);
  });

  // Input-Update vom Handy
  socket.on('input', (input) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.input = { ...p.input, ...input };
    io.to('host').emit('player-input', { id: socket.id, input: p.input });
  });

  // Host benachrichtigt alle Controller (z. B. Baum-Event)
  socket.on('broadcast-controllers', (eventName, payload) => {
    if (socket.id !== hostSocketId || !eventName) return;
    socket.broadcast.emit(eventName, payload);
  });

  // Optional: Einzel-Event für haptisches Feedback bei wichtigen Momenten
  socket.on('haptic', () => {
    socket.emit('vibrate');
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p) {
      players.delete(socket.id);
      // Nur freigeben wenn der Eintrag tatsächlich diesem Client gehörte —
      // sonst könnten wir versehentlich den Slot eines Reconnect-Nachfolgers killen.
      if (takenCharacters.get(p.characterId) === p.clientId) {
        takenCharacters.delete(p.characterId);
      }
      io.to('host').emit('player-left', socket.id);
      broadcastTakenChars();
      console.log(`[-] ${p.name} (${p.characterId}) hat verlassen`);
    }
    if (hostSocketId === socket.id) {
      hostSocketId = null;
      // Wenn Host weg ist, Charaktere freigeben
      takenCharacters.clear();
      players.clear();
      broadcastTakenChars();
      console.log('[★] Host verschwunden — Reset');
    }
  });
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} ist schon belegt (z. B. alter node server.js).\n`);
    console.error(`  Windows: netstat -ano | findstr ":${PORT}"  →  taskkill /PID <PID> /F`);
    console.error('  Anderer Port (cmd):   set PORT=3001&& npm start');
    console.error('  Anderer Port (PowerShell):  $env:PORT=3001; npm start\n');
  } else {
    console.error(err);
  }
  process.exit(1);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n🍻  MÄNNERTAG-GAME-SERVER\n');
  console.log(`   Spiel-Bildschirm:  http://${LOCAL_IP}:${PORT}/`);
  console.log(`   Controller-URL:    ${CONTROLLER_URL}`);
  console.log('\n   Öffne das Spiel auf dem großen Display und scanne den QR-Code mit den Handys.\n');
});
