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
const players = new Map(); // socketId -> { id, name, characterId, input }
const takenCharacters = new Set();
let hostSocketId = null;

function broadcastTakenChars() {
  io.emit('taken-characters', Array.from(takenCharacters));
}

io.on('connection', (socket) => {
  console.log('[+] Verbunden:', socket.id);
  socket.emit('taken-characters', Array.from(takenCharacters));

  // Der Spiel-Bildschirm (index.html) registriert sich als Host
  socket.on('register-host', () => {
    hostSocketId = socket.id;
    socket.join('host');
    socket.emit('player-list', Array.from(players.values()));
    console.log('[★] Host registriert:', socket.id);
  });

  // Ein Handy-Controller tritt bei
  socket.on('join-game', ({ name, characterId }) => {
    if (takenCharacters.has(characterId)) {
      socket.emit('character-taken', characterId);
      return;
    }
    const player = {
      id: socket.id,
      name: String(name).slice(0, 12),
      characterId,
      input: { left: false, right: false, up: false, down: false, action: false, drink: false }
    };
    players.set(socket.id, player);
    takenCharacters.add(characterId);
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

  // Optional: Einzel-Event für haptisches Feedback bei wichtigen Momenten
  socket.on('haptic', () => {
    socket.emit('vibrate');
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (p) {
      players.delete(socket.id);
      takenCharacters.delete(p.characterId);
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

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n🍻  MÄNNERTAG-GAME-SERVER\n');
  console.log(`   Spiel-Bildschirm:  http://${LOCAL_IP}:${PORT}/`);
  console.log(`   Controller-URL:    ${CONTROLLER_URL}`);
  console.log('\n   Öffne das Spiel auf dem großen Display und scanne den QR-Code mit den Handys.\n');
});
