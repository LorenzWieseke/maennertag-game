// game.js — läuft auf dem Host-Bildschirm
// Phaser 3 Side-Scroller mit netzwerk-gesteuerten Spielern.

// ================================================================
//  CHARAKTER-DATEN (synchron mit controller.js halten)
// ================================================================
const CHARACTERS = [
  { id: 'manu',   name: 'Manu',   color: 0x4a90e2, ability: 'Ausdauer-Bestie',  desc: 'Stamina regeneriert 2× schneller, höhere max. Stamina',
    stats: { maxStamina: 150, baseSpeed: 230, staminaRegen: 2.0 } },
  { id: 'ahln',   name: 'Ahln',   color: 0xc94f4f, ability: 'Bierschwamm',      desc: '2× Energie pro Schluck, immun gegen Besoffen-Debuff',
    stats: { maxStamina: 110, baseSpeed: 210, staminaRegen: 1.0, drinkMultiplier: 2.0, drunkImmune: true } },
  { id: 'schumi', name: 'Schumi', color: 0x6dbf47, ability: 'Chillout-Modus',   desc: 'Slow-Motion für 3s (Special-Taste), 15s Cooldown',
    stats: { maxStamina: 100, baseSpeed: 220, staminaRegen: 1.0 } },
  { id: 'lorenz', name: 'Lorenz', color: 0xe8a04e, ability: 'Glücksgriff',      desc: 'Findet öfter Power-Ups in seiner Nähe',
    stats: { maxStamina: 100, baseSpeed: 220, staminaRegen: 1.0, luckRadius: 200 } },
  { id: 'stefan', name: 'Stefan', color: 0x2c2c2c, ability: 'Coolness-Aura',    desc: 'Immun gegen Blendung, Special: +20% Speed-Buff für ganze Gruppe',
    stats: { maxStamina: 100, baseSpeed: 220, staminaRegen: 1.0, hasSunglasses: true } },
  { id: 'jan',    name: 'Jan',    color: 0x4a8a8a, ability: 'Paddel-König',     desc: '2× Paddel-Speed, Angel-Special zieht Items aus der Ferne',
    stats: { maxStamina: 110, baseSpeed: 215, staminaRegen: 1.2, paddleBonus: 2.0 } },
  { id: 'sven',   name: 'Sven',   color: 0xb84a9e, ability: 'Marathon-Mann',    desc: 'Höchstes Grundtempo, Sprint-Boost auf Special-Taste',
    stats: { maxStamina: 130, baseSpeed: 270, staminaRegen: 1.5 } }
];

const charById = (id) => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

// ================================================================
//  AUDIO (Web Audio API – kein Download, retro Beeps)
// ================================================================
const SFX = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    return this.ctx;
  },
  beep({ freq = 440, dur = 0.12, type = 'square', vol = 0.15, slide = 0 } = {}) {
    const ctx = this.ensure(); if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  },
  pickup()  { this.beep({ freq: 880, dur: 0.10, slide: 200, type: 'triangle', vol: 0.18 }); },
  drink()   { this.beep({ freq: 220, dur: 0.18, slide: -60,  type: 'sawtooth', vol: 0.20 }); },
  jump()    { this.beep({ freq: 520, dur: 0.10, slide: 200, type: 'square',   vol: 0.10 }); },
  hit()     { this.beep({ freq: 180, dur: 0.25, slide: -120, type: 'square',   vol: 0.30 }); },
  splash()  { this.beep({ freq: 350, dur: 0.20, type: 'sine', vol: 0.18 }); this.beep({ freq: 240, dur: 0.30, type: 'sine', vol: 0.12 }); },
  brewery() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.beep({ freq: f, dur: 0.18, type: 'triangle', vol: 0.18 }), i * 90)); },
  win()     { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep({ freq: f, dur: 0.22, type: 'triangle', vol: 0.22 }), i * 130)); },
  gameOver(){ [392, 330, 262].forEach((f, i) => setTimeout(() => this.beep({ freq: f, dur: 0.35, type: 'sawtooth', vol: 0.22 }), i * 220)); },
  ability() { this.beep({ freq: 660, dur: 0.18, slide: 400, type: 'square', vol: 0.15 }); }
};

// ================================================================
//  NETZWERK / INPUT-BRIDGE
// ================================================================
const socket = io();
const playerInputs = new Map();   // socketId -> input-state
const playerData = new Map();     // socketId -> { id, name, characterId, ... }

socket.on('connect', () => socket.emit('register-host'));

socket.on('player-list', (list) => {
  list.forEach(p => {
    playerInputs.set(p.id, p.input || {});
    playerData.set(p.id, p);
  });
  updateLobby();
});

socket.on('player-joined', (p) => {
  playerInputs.set(p.id, p.input || {});
  playerData.set(p.id, p);
  updateLobby();
});

socket.on('player-input', ({ id, input }) => {
  playerInputs.set(id, input);
});

socket.on('player-left', (id) => {
  playerInputs.delete(id);
  playerData.delete(id);
  updateLobby();
});

// ================================================================
//  LOBBY-UI
// ================================================================
async function loadQR() {
  try {
    const r = await fetch('/qr').then(r => r.json());
    document.getElementById('qr-img').src = r.qr;
    document.getElementById('url').textContent = r.url;
  } catch (e) {
    console.error('QR-Code konnte nicht geladen werden:', e);
  }
}
loadQR();

function updateLobby() {
  const list = document.getElementById('players-list');
  list.innerHTML = '';
  if (playerData.size === 0) {
    list.innerHTML = '<span class="empty-hint">Warte auf Spieler …</span>';
  } else {
    for (const p of playerData.values()) {
      const c = charById(p.characterId);
      const tag = document.createElement('div');
      tag.className = 'player-tag';
      tag.style.setProperty('--c', '#' + c.color.toString(16).padStart(6, '0'));
      // Pixelart-Avatar
      if (window.MaennertagPixelChars) {
        const canvas = window.MaennertagPixelChars.buildCharCanvas(c.id, 4);
        canvas.className = 'player-tag-avatar';
        tag.appendChild(canvas);
      }
      const label = document.createElement('span');
      label.textContent = `${p.name} → ${c.name}`;
      tag.appendChild(label);
      list.appendChild(tag);
    }
  }
  document.getElementById('start-btn').disabled = playerData.size < 1;
}

document.getElementById('start-btn').addEventListener('click', () => {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game-container').classList.add('active');
  startGame();
});

// ================================================================
//  PHASER-INIT
// ================================================================
let game;
function startGame() {
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    width: window.innerWidth,
    height: window.innerHeight,
    pixelArt: false,
    physics: {
      default: 'arcade',
      arcade: { gravity: { y: 1400 }, debug: false }
    },
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [LevelSelectScene, HikeScene, PaddleScene]
    // Später: WineCellarScene
  });
}

// ================================================================
//  HIKE-SCENE — Wandern von Brauerei zu Brauerei
// ================================================================
class HikeScene extends Phaser.Scene {
  constructor() { super('HikeScene'); }

  preload() {
    // Pixelart-Texturen für alle Charaktere generieren
    if (window.MaennertagPixelChars) {
      for (const c of CHARACTERS) {
        window.MaennertagPixelChars.buildPhaserCharTexture(this, 'char-' + c.id, c.id);
      }
    }
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    const LEVEL_WIDTH = 9000;
    const GROUND_Y = H - 80;

    this.LEVEL_WIDTH = LEVEL_WIDTH;
    this.GROUND_Y = GROUND_Y;

    // --- Himmel + Hügel-Parallax ---
    this.cameras.main.setBackgroundColor('#a8d8e8');

    // Sonnen-Glow (für Stefan-Bezug)
    const sun = this.add.circle(W * 0.7, H * 0.18, 60, 0xfff3a0, 0.85);
    sun.setScrollFactor(0);
    this.tweens.add({ targets: sun, alpha: 0.6, yoyo: true, duration: 3000, repeat: -1 });

    // Hügel hinten (Parallax)
    const hillsFar = this.add.graphics();
    hillsFar.fillStyle(0x6b8a5a, 1);
    for (let i = 0; i < 30; i++) {
      const x = i * 400;
      hillsFar.fillTriangle(x, GROUND_Y, x + 200, GROUND_Y - 220, x + 400, GROUND_Y);
    }
    hillsFar.setScrollFactor(0.3);

    const hillsNear = this.add.graphics();
    hillsNear.fillStyle(0x4a6a3a, 1);
    for (let i = 0; i < 40; i++) {
      const x = i * 280;
      hillsNear.fillTriangle(x, GROUND_Y, x + 140, GROUND_Y - 140, x + 280, GROUND_Y);
    }
    hillsNear.setScrollFactor(0.55);

    // --- Boden mit Bächen ---
    // Bach-Lücken: 4 Stück, an strategischen Stellen ZWISCHEN den Brauereien.
    // Damit man nicht einfach durchlaufen kann, muss man sie überspringen.
    // Brauereien stehen bei i*LEVEL_WIDTH/5, i=1..4, also bei 0.2, 0.4, 0.6, 0.8.
    // Bäche zwischen je zwei Brauereien (0.3, 0.5, 0.7) und einer vor dem Ziel (0.9).
    const gapW = 140; // Bach-Breite in Pixeln (springbar mit -560 jumpVel)
    const gapCenters = [
      LEVEL_WIDTH * 0.30,
      LEVEL_WIDTH * 0.50,
      LEVEL_WIDTH * 0.70,
      LEVEL_WIDTH * 0.88
    ];
    const gaps = gapCenters.map(c => ({ start: c - gapW / 2, end: c + gapW / 2 }));
    this.gaps = gaps;

    // --- Höhenprofil: Plattformen unterschiedlicher Höhe pro Sektion ---
    // Eine "Sektion" ist alles zwischen zwei Bächen (oder Start/Ende).
    // Pro Sektion 3 Plattformen mit verschiedenen yOffsets, sodass der
    // Boden mal hoch, mal tief geht.
    this.terrain = [];
    const sectStarts = [0, ...gaps.map(g => g.end)];
    const sectEnds = [...gaps.map(g => g.start), LEVEL_WIDTH];

    // 7-Stufen-Hügel pro Sektion: gleichmäßiger Anstieg → Plateau → Abstieg.
    // So entsteht der Eindruck eines echten Hangs (nicht nur Treppen),
    // mit einem klaren Gipfel-Plateau in der Mitte. Erste und letzte Platform
    // jeder Sektion liegen auf Standard-Höhe (yOff=0), damit die Bäche an den
    // Sektionsrändern ein sauberes Wasserbett haben.
    const heightPatterns = [
      [0, -35, -70, -100, -70, -35, 0],     // mittelhoher Hügel
      [0, -45, -85, -115, -85, -45, 0],     // hoher Hügel
      [0, -25, -55, -90,  -90, -55, -25],   // Plateau-Schwerpunkt
      [0, -50, -95, -130, -95, -50, 0]      // sehr hoher Hügel
    ];
    const flatPattern = [0, 0, -30, -60, -60, -30, 0];

    for (let i = 0; i < sectStarts.length; i++) {
      const sStart = sectStarts[i];
      const sEnd = sectEnds[i];
      const sW = sEnd - sStart;
      // Spawn-Sektion (erste): flacherer Hügel, damit der Start nicht zu hart ist
      const pat = i === 0 ? flatPattern : heightPatterns[i % heightPatterns.length];
      const platCount = pat.length;
      for (let j = 0; j < platCount; j++) {
        const platStart = sStart + (sW * j) / platCount;
        const platEnd = sStart + (sW * (j + 1)) / platCount;
        this.terrain.push({
          start: platStart, end: platEnd,
          topY: GROUND_Y + pat[j],
          sectionIndex: i
        });
      }
    }

    // Hilfsfunktion: Topkante an einer x-Position (für Brauerei-Höhe etc.)
    this.topYAt = (x) => {
      for (const p of this.terrain) {
        if (x >= p.start && x <= p.end) return p.topY;
      }
      return GROUND_Y;
    };

    // --- Boden: Visuals + Collider pro Plattform ---
    this.ground = this.physics.add.staticGroup();
    const groundGfx = this.add.graphics();
    for (const p of this.terrain) {
      const w = p.end - p.start;
      const h = (GROUND_Y + 80) - p.topY;  // Erde reicht bis 80 unter GROUND_Y
      // Erde
      groundGfx.fillStyle(0x4a3520);
      groundGfx.fillRect(p.start, p.topY, w, h);
      // Gras-Streifen oben
      groundGfx.fillStyle(0x6dbf47);
      groundGfx.fillRect(p.start, p.topY, w, 14);
      // dunklere Erde unter Gras (Schatten-Akzent)
      groundGfx.fillStyle(0x3a2510);
      groundGfx.fillRect(p.start, p.topY + 14, w, 4);
      // Gras-Tufts
      for (let i = 0; i < Math.floor(w / 25); i++) {
        const gx = p.start + Math.random() * w;
        groundGfx.fillStyle(0x4a8a3a);
        groundGfx.fillTriangle(gx, p.topY, gx + 4, p.topY - 8, gx + 8, p.topY);
      }
      // Statischer Collider — eine Box von topY bis topY+h
      const body = this.add.rectangle(p.start + w / 2, p.topY + h / 2, w, h, 0, 0);
      this.physics.add.existing(body, true);
      this.ground.add(body);
    }

    // Bach-Visuals (Wasser unten, Schaum oben, Wellenanimation)
    for (const g of gaps) {
      const gw = g.end - g.start;
      // Erde-Seitenwände
      groundGfx.fillStyle(0x2d1f12);
      groundGfx.fillRect(g.start - 4, GROUND_Y, 4, 80);
      groundGfx.fillRect(g.end, GROUND_Y, 4, 80);
      // Wasser
      const water = this.add.rectangle(g.start + gw / 2, GROUND_Y + 40, gw, 80, 0x3a7aa8, 0.85);
      water.setStrokeStyle(2, 0x6da3c8);
      // Schaum-Streifen oben
      const foam = this.add.rectangle(g.start + gw / 2, GROUND_Y + 4, gw, 6, 0xa0d8e8);
      // Schaum animiert leicht
      this.tweens.add({
        targets: foam, alpha: 0.5, yoyo: true,
        duration: 700, repeat: -1, ease: 'Sine.inOut'
      });
    }

    // --- Bier-Textur einmalig erzeugen, damit spawnBeer normale Sprites nutzt ---
    if (!this.textures.exists('beer-can')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x6b2e0c);  // dunkler Außenrand
      g.fillRect(0, 0, 18, 28);
      g.fillStyle(0xf4c842);  // Dose Gold
      g.fillRect(2, 2, 14, 24);
      g.fillStyle(0xe88a3a);  // Banderole
      g.fillRect(2, 12, 14, 4);
      g.fillStyle(0xc4c4c4);  // Deckel
      g.fillRect(3, 0, 12, 3);
      g.generateTexture('beer-can', 18, 28);
      g.destroy();
    }

    // --- Stein-Texturen ---
    // Kleiner Stein (drüberlaufen geht nicht, blockiert)
    if (!this.textures.exists('stone-small')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x3a3a3a); g.fillCircle(28, 22, 25);          // Schatten
      g.fillStyle(0x6b6b6b); g.fillCircle(28, 18, 24);          // Hauptkörper
      g.fillStyle(0x8a8a8a); g.fillCircle(20, 12, 7);           // Glanz oben links
      g.fillStyle(0x4a4a4a); g.fillRect(34, 20, 4, 10);         // Riss
      g.fillStyle(0x4a4a4a); g.fillRect(15, 22, 3, 6);          // Riss 2
      g.generateTexture('stone-small', 56, 36);
      g.destroy();
    }
    // Großer Felsen (mit Moos oben)
    if (!this.textures.exists('stone-big')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x2d1f12); g.fillCircle(40, 38, 36);          // Schatten
      g.fillStyle(0x5a4a3a); g.fillCircle(40, 35, 34);          // Felsen
      g.fillStyle(0x7a6a5a); g.fillCircle(28, 24, 10);          // Glanz
      g.fillStyle(0x4a8a3a);                                    // Moos-Kappe
      g.fillCircle(40, 12, 24);
      g.fillCircle(28, 16, 8);
      g.fillCircle(52, 16, 8);
      g.fillStyle(0x3a3a30); g.fillRect(48, 36, 5, 14);         // Riss
      g.fillStyle(0x3a3a30); g.fillRect(22, 46, 4, 10);
      g.generateTexture('stone-big', 80, 76);
      g.destroy();
    }
    // Rollender Stein (mittel, wird von Hügeln gespawnt)
    if (!this.textures.exists('stone-roller')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x2a2a2a); g.fillCircle(22, 22, 22);
      g.fillStyle(0x6b6b6b); g.fillCircle(22, 20, 20);
      g.fillStyle(0x8a8a8a); g.fillCircle(15, 14, 5);
      g.fillStyle(0x4a4a4a); g.fillRect(28, 14, 3, 8);
      g.fillStyle(0x4a4a4a); g.fillRect(18, 28, 6, 3);
      g.generateTexture('stone-roller', 44, 44);
      g.destroy();
    }

    // --- Brauerei-Checkpoints: auf dem höchsten Plateau ihrer Sektion ---
    // Brauereien stehen jetzt oben auf dem Hügel — du musst hochklettern
    // und kriegst dort dein Refill. Das ergibt zusammen mit den vom
    // Plateau rollenden Steinen die "Brauerei-auf-dem-Berg"-Geometrie.
    this.breweries = [];
    const brewNames = ['Klosterbräu', 'Hopfenglück', 'Maibockstube', 'Gerstensaft'];
    // Sektionen 0..3 bekommen je eine Brauerei (Sektion 4 endet im Ziel)
    for (let i = 0; i < 4; i++) {
      // Höchstes Plateau in dieser Sektion finden
      const inSection = this.terrain.filter(p => p.sectionIndex === i);
      let highest = inSection[0];
      for (const p of inSection) if (p.topY < highest.topY) highest = p;
      // Brauerei-X in der Mitte des höchsten Plateaus
      const x = (highest.start + highest.end) / 2;
      const baseY = highest.topY;
      const post = this.add.rectangle(x, baseY - 130, 8, 260, 0x3d1a06);
      const sign = this.add.rectangle(x, baseY - 240, 220, 80, 0x6b2e0c);
      sign.setStrokeStyle(4, 0xf4c842);
      const label = this.add.text(x, baseY - 240, '🍺 ' + brewNames[i], {
        fontFamily: 'Bungee, sans-serif', fontSize: '22px', color: '#f4c842'
      }).setOrigin(0.5);
      this.breweries.push({
        x, name: brewNames[i],
        plateau: highest,                // Referenz auf die Plateau-Plattform
        signObjects: [sign, label]
      });
    }

    // Ziel-Flagge — auf Plattform-Höhe
    const goalX = LEVEL_WIDTH - 200;
    this.goalX = goalX;
    this.gameWon = false;
    const goalBaseY = this.topYAt(goalX);
    this.add.rectangle(goalX, goalBaseY - 150, 8, 300, 0x3d1a06);
    this.add.triangle(goalX + 60, goalBaseY - 250, 0, 0, 120, 30, 0, 60, 0xc94f4f);
    this.add.text(goalX, goalBaseY - 320, 'ZIEL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '32px', color: '#c94f4f',
      stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5);

    // --- Bier-Pickups — entlang des Höhenprofils ---
    // Pro Plattform: 3 Biere am Boden, plus 18 Sprung-Belohnungen in der Luft.
    // Mehr Biere als vorher, damit Wiederbelebungs-Würfe immer verfügbar sind.
    this.beers = this.physics.add.staticGroup();
    for (const p of this.terrain) {
      const w = p.end - p.start;
      if (w < 200) continue;
      for (let i = 1; i <= 3; i++) {
        const x = p.start + w * (i / 4);
        this.spawnBeer(x, p.topY - 50);  // 50 px über der Grasoberfläche
      }
    }
    for (let i = 0; i < 20; i++) {
      const plat = this.terrain[Math.floor(Math.random() * this.terrain.length)];
      const w = plat.end - plat.start;
      if (w < 200) continue;
      const x = plat.start + 80 + Math.random() * (w - 160);
      this.spawnBeer(x, plat.topY - 150 - Math.random() * 80);
    }

    // --- Hindernisse: Steine auf den Plattformen (groß + klein) ---
    this.obstacles = this.physics.add.group();
    const isNearBrewery = (x) => this.breweries.some(b => Math.abs(b.x - x) < 100);
    const isNearGoal = (x) => Math.abs(x - this.goalX) < 200;
    // Pro Plattform 2-4 Steine, je nach Breite
    for (const p of this.terrain) {
      const w = p.end - p.start;
      if (w < 220) continue;
      const numStones = Math.max(2, Math.min(5, Math.floor(w / 280)));
      for (let i = 0; i < numStones; i++) {
        // Zufällige Position, aber Mindestabstand zu den Rändern (sonst
        // klemmt der Stein in der Plattform-Wand)
        const x = p.start + 60 + Math.random() * (w - 120);
        if (isNearBrewery(x) || isNearGoal(x)) continue;
        const big = Math.random() < 0.35;
        const tex = big ? 'stone-big' : 'stone-small';
        const offset = big ? 38 : 18;  // halbe Höhe der Texture
        const stone = this.physics.add.image(x, p.topY - offset, tex);
        stone.body.setAllowGravity(false);
        stone.body.setImmovable(true);
        stone.body.setSize(big ? 64 : 44, big ? 60 : 28);
        stone.isBig = big;
        this.obstacles.add(stone);
      }
    }

    // --- Rolling-Stones: Gruppe sofort, Spawner-Timer erst nach Mission-Banner-Dismiss
    this.rollingStones = this.physics.add.group();
    this._rollingSpawnersStarted = false;

    // --- Spieler erstellen ---
    this.players = new Map();
    let spawnX = 150;
    for (const [id, data] of playerData) {
      this.spawnPlayer(id, data, spawnX);
      spawnX += 60;
    }

    // Mid-Game Joins — Listener bei Scene-Wechsel entfernen (sonst doppelte Spawns)
    this._onHikePlayerJoined = (p) => {
      if (!this.players.has(p.id)) {
        this.spawnPlayer(p.id, p, this.cameras.main.scrollX + 100);
      }
    };
    this._onHikePlayerLeft = (id) => {
      const p = this.players.get(id);
      if (p) { p.destroy(); this.players.delete(id); }
      this.buildHUD();
    };
    socket.on('player-joined', this._onHikePlayerJoined);
    socket.on('player-left', this._onHikePlayerLeft);
    this.events.once('shutdown', () => {
      socket.off('player-joined', this._onHikePlayerJoined);
      socket.off('player-left', this._onHikePlayerLeft);
    });

    // Welt + Kamera
    this.physics.world.setBounds(0, 0, LEVEL_WIDTH, H);
    this.cameras.main.setBounds(0, 0, LEVEL_WIDTH, H);

    // --- HUD (Spielernamen + Stamina-Leisten unten) ---
    this.hudContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(1000);
    this.buildHUD();

    // --- Fortschrittsbalken oben (Distanz zum Ziel) ---
    const barW = W - 80;
    this.add.rectangle(W / 2, 22, barW, 12, 0x000000, 0.55)
      .setStrokeStyle(2, 0xf4c842).setScrollFactor(0).setDepth(900);
    this.progressFill = this.add.rectangle(40, 16, 0, 12, 0xf4c842)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(901);
    // Brauerei-Markierungen auf dem Balken
    this.breweries.forEach(b => {
      const fx = 40 + barW * (b.x / this.LEVEL_WIDTH);
      this.add.rectangle(fx, 22, 3, 18, 0x6dbf47).setScrollFactor(0).setDepth(902);
    });
    // Ziel-Markierung
    this.add.text(W - 40, 22, '🚩', { fontSize: '18px' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(902);

    // --- Mission-Banner (verschwindet nach 4s) ---
    this.showMissionBanner();

    // Resize-Handler
    this.scale.on('resize', this.handleResize, this);
  }

  showMissionBanner() {
    const W = this.scale.width, H = this.scale.height;
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.78)
      .setScrollFactor(0).setDepth(2500);
    const t1 = this.add.text(W / 2, H * 0.18, '🥾  BRAUEREI-WANDERUNG', {
      fontFamily: 'Bungee, sans-serif', fontSize: '60px', color: '#f4c842',
      stroke: '#3d1a06', strokeThickness: 10
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);

    const t2 = this.add.text(W / 2, H * 0.40,
      'ZIEL: Wandert nach RECHTS bis zur 🚩 Flagge.\n\n' +
      '🟢  ENERGIE-BALKEN — Laufen + Springen kostet Energie.\n' +
      '          Bei 0: ihr könnt kaum noch laufen, Sprung gesperrt.\n\n' +
      '🟥  PROMILLE-BALKEN — füllt sich beim TRINKEN.\n' +
      '          Über 70% = Steuerung verkehrt herum!\n\n' +
      '🍺  BIER aufheben → ins Inventar (oben rechts in deiner Karte)\n' +
      '🍺  TRINKEN-Knopf → konsumiert 1 Bier: +Energie aber +Promille\n' +
      '🍻  TRINKEN neben einem schwachen Mitspieler → du gibst es ihm ab!\n' +
      '🏠  Brauerei passieren → Energie voll + 3 Bier geschenkt\n\n' +
      '★ SPECIAL  hilft Mitspielern: aus dem Bach ziehen, K.O. tragen,\n' +
      '          sonst eigene Spezialfähigkeit (Name siehst du im HUD)',
      {
        fontFamily: 'Special Elite, monospace', fontSize: '22px',
        color: '#fef3d4', align: 'left', lineSpacing: 6
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);

    const t3 = this.add.text(W / 2, H * 0.88,
      '▶  DRÜCKE  ★ SPECIAL  ZUM STARTEN  ◀', {
        fontFamily: 'Bungee, sans-serif', fontSize: '24px',
        color: '#6dbf47', stroke: '#000', strokeThickness: 4
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);
    // Pulsierende Aufmerksamkeit auf den Start-Hinweis
    this.tweens.add({
      targets: t3, scale: 1.08, yoyo: true,
      duration: 600, repeat: -1, ease: 'Sine.inOut'
    });

    const dismiss = () => {
      // actionLatch setzen, damit Special nicht sofort nach Banner-Dismiss feuert
      for (const p of this.players.values()) p.actionLatch = true;
      this.tweens.killTweensOf(t3);
      this.tweens.add({
        targets: [overlay, t1, t2, t3], alpha: 0, duration: 400,
        onComplete: () => {
          overlay.destroy(); t1.destroy(); t2.destroy(); t3.destroy();
          this.startRollingStoneSpawners();
        }
      });
      socket.off('player-input', skipHandler);
    };
    const skipHandler = ({ input }) => { if (input && input.action) dismiss(); };
    socket.on('player-input', skipHandler);
    this.events.once('shutdown', () => socket.off('player-input', skipHandler));
  }

  handleResize(gameSize) {
    this.cameras.main.setSize(gameSize.width, gameSize.height);
    this.buildHUD();
  }

  /** Rolling-Stone-Spawner — erst nach Intro-Banner, damit niemand „blind“ getroffen wird */
  startRollingStoneSpawners() {
    if (this._rollingSpawnersStarted) return;
    this._rollingSpawnersStarted = true;
    const GROUND_Y = this.GROUND_Y;
    this.breweries.forEach(b => {
      if (b.plateau && b.plateau.topY < GROUND_Y - 50) {
        this.time.addEvent({
          delay: 5000 + Math.random() * 2500,
          loop: true,
          callback: () => this.spawnRollingStone(b.plateau)
        });
      }
    });
  }

  spawnBeer(x, y) {
    // y plattform-basiert clampen — Bier schwebt mindestens 40 px über
    // der lokalen Plattform-Oberkante (sonst sieht's nach „im Boden" aus).
    const topAtX = this.topYAt ? this.topYAt(x) : this.GROUND_Y;
    y = Math.min(y, topAtX - 40);
    y = Math.max(y, 60);
    // STATIC body — Phaser dynamic+allowGravity(false) hatte Sync-Bugs
    // (Biere fielen sichtbar 1-2 Frames bevor das Flag griff). Static
    // bodies haben strukturell keine Gravity und keine Velocity.
    const beer = this.physics.add.staticImage(x, y, 'beer-can');
    beer.body.setSize(22, 30);
    beer.body.updateFromGameObject();
    this.beers.add(beer);
    return beer;
  }

  spawnPlayer(id, data, x) {
    const charData = charById(data.characterId);
    const spawnY = this.topYAt ? this.topYAt(x) - 100 : this.GROUND_Y - 100;
    const player = new HikePlayer(this, x, spawnY, id, charData);
    this.physics.add.collider(player.sprite, this.ground);
    this.physics.add.overlap(player.sprite, this.beers, (sp, beer) => {
      beer.destroy();
      player.pickupBeer();
    });
    this.physics.add.collider(player.sprite, this.obstacles, () => {
      player.hitObstacle();
    });
    if (this.rollingStones) {
      this.physics.add.collider(
        player.sprite,
        this.rollingStones,
        (sp, stone) => {
          player.hitObstacle();
          // Rolling stone bouncet kurz weg, damit der Spieler durchatmen kann
          stone.body.setVelocityX(stone.body.velocity.x * -0.4);
        },
        () => !player.knockedOut
      );
    }
    this.players.set(id, player);
    this.buildHUD();
  }

  spawnRollingStone(platform) {
    if (!this.rollingStones) return;
    // Zufällige Roll-Richtung (links oder rechts), Stein startet am
    // entsprechenden Plateau-Rand
    const dir = Math.random() < 0.5 ? -1 : 1;
    const startX = dir === -1 ? platform.end - 30 : platform.start + 30;
    const targetVX = 240 * dir;

    const stone = this.physics.add.image(
      startX, platform.topY - 25, 'stone-roller'
    );
    stone.body.setAllowGravity(true);
    stone.body.setGravityY(900);
    stone.body.setCircle(18);          // Erst Kreis-Body, danach NICHT setSize!
    stone.body.setBounce(0.35, 0.1);
    stone.body.setVelocityX(targetVX);
    stone.targetVX = targetVX;          // damit update() ihn am Rollen hält
    stone.rotateSpeed = -10 * dir;      // dreht sich passend zur Richtung
    this.rollingStones.add(stone);

    this.physics.add.collider(stone, this.ground);
    // Kollision Spieler↔Stein nur über die Gruppe in spawnPlayer() (kein Doppel-Collider)

    // Auto-Cleanup nach 14 s (sollte längst aus dem Bild gerollt sein)
    this.time.delayedCall(14000, () => stone.active && stone.destroy());

    // Warnzeichen kurz oben am Hügel — Spieler haben Zeit zu reagieren
    const warn = this.add.text(startX, platform.topY - 80, '⚠ STEIN!', {
      fontFamily: 'Bungee, sans-serif', fontSize: '20px',
      color: '#c94f4f', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5);
    this.tweens.add({
      targets: warn, alpha: 0, y: warn.y - 30, duration: 1800,
      onComplete: () => warn.destroy()
    });
  }

  buildHUD() {
    if (!this.hudContainer) return;
    this.hudContainer.removeAll(true);
    const W = this.scale.width;
    const slots = Array.from(this.players.values());
    const slotWidth = Math.min(220, (W - 40) / Math.max(slots.length, 1));
    const slotHeight = 80;
    const labelW = 70; // Platz für "ENERGIE" / "PROMILLE" Labels
    slots.forEach((p, i) => {
      const x = 20 + i * slotWidth;
      const y = this.scale.height - slotHeight - 10;
      const bg = this.add.rectangle(x, y, slotWidth - 8, slotHeight, 0x000000, 0.55).setOrigin(0, 0);
      bg.setStrokeStyle(2, p.charData.color);
      const name = this.add.text(x + 10, y + 6, p.charData.name, {
        fontFamily: 'Bungee, sans-serif', fontSize: '15px',
        color: '#' + p.charData.color.toString(16).padStart(6, '0')
      });

      // Energie-Bar mit Label
      const energyLabel = this.add.text(x + 10, y + 32, 'ENERGIE', {
        fontFamily: 'Bungee, sans-serif', fontSize: '10px', color: '#6dbf47'
      });
      const barX = x + 10 + labelW;
      const barW = slotWidth - 18 - labelW;
      p.hudStaminaBg = this.add.rectangle(barX, y + 32, barW, 11, 0x1a0f08).setOrigin(0, 0);
      p.hudStaminaBg.setStrokeStyle(1, 0x4a8a3a);
      p.hudStaminaFill = this.add.rectangle(barX, y + 32, barW, 11, 0x6dbf47).setOrigin(0, 0);

      // Promille-Bar mit Label
      const drunkLabel = this.add.text(x + 10, y + 52, 'PROMILLE', {
        fontFamily: 'Bungee, sans-serif', fontSize: '10px', color: '#c94f4f'
      });
      p.hudDrunkBg = this.add.rectangle(barX, y + 52, barW, 11, 0x1a0f08).setOrigin(0, 0);
      p.hudDrunkBg.setStrokeStyle(1, 0x8a3a3a);
      p.hudDrunkBar = this.add.rectangle(barX, y + 52, barW, 11, 0xc94f4f).setOrigin(0, 0);
      p.hudDrunkBar.scaleX = 0;

      // Bier-Counter rechts oben
      p.hudBeerCount = this.add.text(x + slotWidth - 14, y + 6, '🍺×0', {
        fontFamily: 'Bungee, sans-serif', fontSize: '14px', color: '#f4c842'
      }).setOrigin(1, 0);

      // Special-Name + Cooldown-Anzeige unten in der Slot-Karte
      const ability = HikePlayer.ABILITY_INFO[p.charData.id];
      const abilityName = ability ? ability.name : 'SPECIAL';
      p.hudAbilityLabel = this.add.text(x + 10, y + slotHeight - 16,
        '★ ' + abilityName, {
          fontFamily: 'Bungee, sans-serif', fontSize: '10px', color: '#888'
        });
      p.hudAbilityCooldown = this.add.text(x + slotWidth - 14, y + slotHeight - 16,
        'BEREIT', {
          fontFamily: 'Bungee, sans-serif', fontSize: '10px', color: '#6dbf47'
        }).setOrigin(1, 0);

      this.hudContainer.add([
        bg, name, energyLabel, drunkLabel,
        p.hudStaminaBg, p.hudStaminaFill,
        p.hudDrunkBg, p.hudDrunkBar,
        p.hudBeerCount, p.hudAbilityLabel, p.hudAbilityCooldown
      ]);
    });
  }

  update(time, delta) {
    // Kamera folgt dem Schwerpunkt der Gruppe
    if (this.players.size === 0) return;
    let cx = 0, cy = 0;
    let minX = Infinity, maxX = -Infinity;
    let camCount = 0;
    for (const p of this.players.values()) {
      const input = playerInputs.get(p.id) || {};
      p.update(input, delta);
      // K.O. + Wasser von Kamera-Berechnung ausnehmen (verhindert Deadlocks am Rand)
      if (!p.knockedOut && !p.inWater) {
        cx += p.sprite.x;
        cy += p.sprite.y;
        minX = Math.min(minX, p.sprite.x);
        maxX = Math.max(maxX, p.sprite.x);
        camCount++;
      }
      // Sieg checken
      // atGoal-Flag pro Spieler setzen, sobald er die Flagge passiert
      if (!p.atGoal && p.sprite.x >= this.goalX && !p.knockedOut && !p.inWater) {
        p.atGoal = true;
        p.popText('🏁 AM ZIEL!', '#6dbf47');
      }
    }
    if (camCount === 0) {
      cx = 0;
      cy = 0;
      minX = Infinity;
      maxX = -Infinity;
      for (const p of this.players.values()) {
        cx += p.sprite.x;
        cy += p.sprite.y;
        minX = Math.min(minX, p.sprite.x);
        maxX = Math.max(maxX, p.sprite.x);
      }
      camCount = this.players.size;
    }
    cx /= camCount;
    cy /= camCount;

    // Fortschrittsbalken aktualisieren — Position des führenden Spielers
    if (this.progressFill) {
      const W2 = this.scale.width;
      const barW = W2 - 80;
      const lead = Math.max(...Array.from(this.players.values()).map(p => p.sprite.x));
      const ratio = Math.max(0, Math.min(1, lead / this.goalX));
      this.progressFill.width = barW * ratio;
    }

    // Brauerei-Effekte + Wasser-Detection
    for (const p of this.players.values()) {
      this.checkBreweryHit(p);
      // Wer in einen Bach rutscht, geht in den Wasser-Modus.
      if (!p.inWater && !p.frozen && !p.knockedOut) {
        const inGap = this.gaps && this.gaps.find(g =>
          p.sprite.x > g.start && p.sprite.x < g.end);
        if (inGap && p.sprite.y > this.GROUND_Y + 5) {
          p.enterWater(inGap);
        }
      }
      // Notfall: Spieler total durchgefallen (sollte nicht passieren)
      if (p.sprite.y > this.GROUND_Y + 200 && !p.frozen) {
        this.respawnAtLastCheckpoint(p);
      }
    }

    // Sieg: ALLE Spieler müssen am Ziel sein
    if (!this.gameWon && this.players.size > 0) {
      const all = Array.from(this.players.values());
      if (all.every(p => p.atGoal)) {
        this.triggerWin(all[0]);
      }
    }

    const W = this.scale.width;
    const H = this.scale.height;
    // Camera so dass alle Spieler im Bild bleiben:
    //  - wenn Span ≤ Screen-Breite-Margin → zentriert auf Mittelpunkt
    //  - wenn jemand zu weit zurück ist → an Min-X kleben, sodass er sichtbar bleibt
    const margin = 100;
    let span = maxX - minX;
    if (!Number.isFinite(span) || camCount === 0) span = 0;
    let targetX;
    if (span > W - 2 * margin) {
      // Crew zu weit auseinander — Camera am Min-X verankern
      targetX = minX - margin;
    } else {
      targetX = (minX + maxX) / 2 - W / 2;
    }
    const targetY = Math.min(this.GROUND_Y - H * 0.7, cy - H / 2);
    this.cameras.main.scrollX += (targetX - this.cameras.main.scrollX) * 0.06;
    this.cameras.main.scrollY += (targetY - this.cameras.main.scrollY) * 0.06;

    // --- Rolling-Stones: Rotation animieren + horizontale Geschwindigkeit
    // konstant halten (Phaser-Reibung würde sie sonst auf der ersten
    // flachen Plattform stoppen, dann drehen sie sich nur noch im Stand) ---
    if (this.rollingStones) {
      this.rollingStones.children.iterate((s) => {
        if (!s || !s.active || !s.body) return;
        if (s.rotateSpeed) s.rotation += s.rotateSpeed * (delta / 1000);
        // Wenn der Stein eine Ziel-VX hat und die aktuelle drunter sinkt,
        // wieder hochsetzen — sonst rollt er nach 1-2 Bounces nicht mehr
        if (s.targetVX) {
          const sign = Math.sign(s.targetVX);
          if (Math.abs(s.body.velocity.x) < Math.abs(s.targetVX) * 0.6) {
            s.body.setVelocityX(s.targetVX);
          }
          // Aus dem Bild → wegputzen
          if (sign === -1 && s.x < -200) s.destroy();
          if (sign === 1 && s.x > this.LEVEL_WIDTH + 200) s.destroy();
        }
      });
    }

    // --- Spieler dürfen nicht aus dem Bild laufen (NSMB-Wii-Style) ---
    // Schnellster wartet, bis langsamster nachkommt: Clamp an die
    // sichtbaren Bildränder, links und rechts.
    const camLeft = this.cameras.main.scrollX;
    const camRight = camLeft + this.scale.width;
    const edgeMargin = 60;
    for (const p of this.players.values()) {
      if (p.frozen || p.knockedOut || p.inWater) continue;
      if (p.sprite.x < camLeft + edgeMargin) {
        p.sprite.x = camLeft + edgeMargin;
        if (p.sprite.body.velocity.x < 0) p.sprite.body.setVelocityX(0);
      } else if (p.sprite.x > camRight - edgeMargin) {
        p.sprite.x = camRight - edgeMargin;
        if (p.sprite.body.velocity.x > 0) p.sprite.body.setVelocityX(0);
      }
    }
  }

  respawnAtLastCheckpoint(player) {
    // Letzten Brauerei-Checkpoint vor (oder gleich) der aktuellen Position finden,
    // sonst Start des Levels.
    let respawnX = 150;
    for (const b of this.breweries) {
      if (b.x < player.sprite.x - 50) respawnX = b.x;
    }
    // Falls Respawn-Punkt selbst zwischen zwei Bächen liegt (sollte er nicht),
    // ein bisschen versetzt setzen
    if (this.gaps && this.gaps.some(g => respawnX > g.start - 20 && respawnX < g.end + 20)) {
      respawnX += 100;
    }
    player.sprite.x = respawnX;
    player.sprite.y = (this.topYAt ? this.topYAt(respawnX) : this.GROUND_Y) - 120;
    player.sprite.body.setVelocity(0, 0);
    player.stamina = Math.max(0, player.stamina - 30);
    player.popText('💦 INS WASSER!', '#3a7aa8');
    this.cameras.main.flash(180, 60, 120, 200);
  }

  checkBreweryHit(player) {
    if (!player.visitedBreweries) player.visitedBreweries = new Set();
    for (let i = 0; i < this.breweries.length; i++) {
      if (player.visitedBreweries.has(i)) continue;
      const b = this.breweries[i];
      if (Math.abs(player.sprite.x - b.x) < 50) {
        player.visitedBreweries.add(i);
        this.applyBreweryEffect(player, b);
      }
    }
  }

  applyBreweryEffect(player, brewery) {
    SFX.brewery();
    // Stamina komplett auffüllen, +3 Bier ins Inventar
    player.stamina = player.maxStamina;
    player.beerInventory += 3;
    // Drunk leicht reduzieren — ein Brauerei-Stop bringt Klarheit
    player.drunkenness = Math.max(0, player.drunkenness - 25);

    // Visuelles Feedback: Pop-Up beim Spieler
    player.popText('🍺  ' + brewery.name.toUpperCase() + '  🍺', '#f4c842');
    const stat = this.add.text(player.sprite.x, player.sprite.y - 90,
      '+VOLL & 🍺×3', {
        fontFamily: 'Bungee, sans-serif', fontSize: '20px',
        color: '#6dbf47', stroke: '#000', strokeThickness: 4
      }).setOrigin(0.5).setDepth(901);
    this.tweens.add({
      targets: stat, y: stat.y - 60, alpha: 0,
      duration: 1400, onComplete: () => stat.destroy()
    });

    // Schild kurz wackeln + Kamera-Flash
    if (brewery.signObjects) {
      brewery.signObjects.forEach(obj => {
        this.tweens.add({
          targets: obj, scale: 1.15, yoyo: true, duration: 200, ease: 'Back.out'
        });
      });
    }
    this.cameras.main.flash(180, 244, 200, 66);
  }

  checkAllKO() {
    if (this.gameWon || this.gameLost) return;
    if (this.players.size === 0) return;
    let allDown = true;
    for (const p of this.players.values()) {
      if (!p.knockedOut) { allDown = false; break; }
    }
    if (allDown) this.triggerGameOver();
  }

  triggerGameOver() {
    if (this.gameLost) return;
    this.gameLost = true;
    SFX.gameOver();
    const W = this.scale.width, H = this.scale.height;
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x1a0204, 0.85)
      .setScrollFactor(0).setDepth(2000);
    this.add.text(W / 2, H * 0.35, '💀  ALLE BESOFFEN!  💀', {
      fontFamily: 'Bungee, sans-serif', fontSize: '64px', color: '#c94f4f',
      stroke: '#000', strokeThickness: 10
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    this.add.text(W / 2, H * 0.5,
      'Eure Crew liegt am Boden. Niemand schafft es zur Brauerei.', {
        fontFamily: 'Special Elite, monospace', fontSize: '24px', color: '#fef3d4'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    const back = this.add.text(W / 2, H * 0.7, '↩  ZURÜCK ZUR LEVEL-AUSWAHL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '22px', color: '#1a0f08',
      backgroundColor: '#c94f4f', padding: { x: 24, y: 12 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('LevelSelectScene'));
    const onInput = ({ input }) => {
      if (input && input.action) {
        socket.off('player-input', onInput);
        this.scene.start('LevelSelectScene');
      }
    };
    socket.on('player-input', onInput);
    this.events.once('shutdown', () => socket.off('player-input', onInput));
  }

  triggerWin(winner) {
    if (this.gameWon) return;
    this.gameWon = true;
    SFX.win();
    for (const p of this.players.values()) p.frozen = true;

    const W = this.scale.width, H = this.scale.height;
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65)
      .setScrollFactor(0).setDepth(2000);
    const title = this.add.text(W / 2, H * 0.35, '🍺  GESCHAFFT!', {
      fontFamily: 'Bungee, sans-serif', fontSize: '72px', color: '#f4c842',
      stroke: '#3d1a06', strokeThickness: 10
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    const sub = this.add.text(W / 2, H * 0.5,
      'Alle am Ziel — die Crew hat es zusammen geschafft!', {
      fontFamily: 'Special Elite, monospace', fontSize: '24px',
      color: '#fef3d4', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    const back = this.add.text(W / 2, H * 0.7, '↩  ZURÜCK ZUR LEVEL-AUSWAHL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '22px', color: '#1a0f08',
      backgroundColor: '#f4c842', padding: { x: 24, y: 12 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('LevelSelectScene'));

    // Auch ein Controller-Action-Press führt zurück zur Auswahl
    const onInput = ({ id, input }) => {
      if (input.action) {
        socket.off('player-input', onInput);
        this.scene.start('LevelSelectScene');
      }
    };
    socket.on('player-input', onInput);
    this.events.once('shutdown', () => socket.off('player-input', onInput));
  }
}

// ================================================================
//  PLAYER-KLASSE
// ================================================================
class HikePlayer {
  constructor(scene, x, y, id, charData) {
    this.scene = scene;
    this.id = id;
    this.charData = charData;
    this.playerName = (playerData.get(id) && playerData.get(id).name) || charData.name;

    // Pixelart-Sprite (14×22 px @ 5px/cell = 70×110 game units)
    const textureKey = 'char-' + charData.id;
    if (scene.textures.exists(textureKey)) {
      this.sprite = scene.physics.add.sprite(x, y, textureKey);
      this.sprite.setOrigin(0.5, 0.5);
    } else {
      // Fallback: einfaches Rechteck, falls Pixelchars nicht geladen wurden
      this.sprite = scene.add.rectangle(x, y, 32, 56, charData.color);
      this.sprite.setStrokeStyle(3, 0x000000);
      scene.physics.add.existing(this.sprite);
    }
    this.sprite.body.setCollideWorldBounds(true);
    this.sprite.body.setMaxVelocity(400, 800);
    // Hitbox bewusst kleiner als das Sprite, damit der Charakter nicht "zu fett"
    // an Hindernissen kleben bleibt
    this.sprite.body.setSize(34, 90);
    this.sprite.body.setOffset(18, 18);

    // Schumi kriegt 'nen kleinen grünen Glow (passt zum Joint)
    if (charData.id === 'schumi') {
      this.aura = scene.add.circle(x, y, 45, 0x88ff88, 0.15);
    }

    // Name oben
    this.label = scene.add.text(x, y - 70, this.playerName, {
      fontFamily: 'Bungee, sans-serif', fontSize: '12px',
      color: '#fef3d4', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);

    // Stats
    this.maxStamina = charData.stats.maxStamina;
    this.stamina = this.maxStamina;
    this.drunkenness = 0;
    this.invulnTimer = 0;
    this.abilityCooldown = 0;
    this.staminaRegen = charData.stats.staminaRegen;
    this.baseSpeed = charData.stats.baseSpeed;
    this.currentSpeed = this.baseSpeed;
    this.abilityActiveTimer = 0;
    this.beerInventory = 0;
    this.frozen = false;
    this.atGoal = false;            // hat das Ziel erreicht
    // K.O. / Wasser
    this.knockedOut = false;        // liegt ohnmächtig — nur Bier-Wurf weckt auf
    this.koTimer = 0;
    this.inWater = false;           // treibt im Bach — nur Mitspieler kann ziehen

    // Input-Latches
    this.drinkLatch = false;
    this.actionLatch = false;
    this.upLatch = false;
  }

  update(input, delta) {
    const dt = delta / 1000;
    const body = this.sprite.body;

    // Eingefroren (z.B. Sieg-Banner aktiv) → einfach stehen bleiben
    if (this.frozen) {
      body.setVelocityX(body.velocity.x * 0.7);
      return;
    }

    // K.O.-MODUS: liegt ohnmächtig — nur Bier-Wurf eines Mitspielers weckt
    if (this.knockedOut) {
      this.updateKnockedOut(dt);
      return;
    }

    // WASSER-MODUS: in den Bach gefallen — kommt allein nicht raus
    if (this.inWater) {
      this.updateInWater(input, dt);
      return;
    }

    // Steuerung — invertiert ab 70% Promille (Ahln immun)
    let left = !!input.left, right = !!input.right;
    const drunkBucket = this.charData.stats.drunkImmune ? 0 : this.drunkenness;
    const isDrunk = drunkBucket > 70;
    if (isDrunk) {
      [left, right] = [right, left];
    }

    // Bewegung — Stamina-Bremse
    let speed = this.currentSpeed;
    if (this.stamina <= 0)         speed *= 0.20;
    else if (this.stamina < 25)    speed *= 0.55;
    else if (this.stamina < 50)    speed *= 0.80;

    if (left)        body.setVelocityX(-speed);
    else if (right)  body.setVelocityX(speed);
    else             body.setVelocityX(body.velocity.x * 0.85);

    // Springen — bei <10 Stamina kein Sprung
    if (input.up && !this.upLatch && body.blocked.down) {
      this.upLatch = true;
      if (this.stamina < 10) {
        if (!this._lastTiredPop || this.scene.time.now - this._lastTiredPop > 1500) {
          this._lastTiredPop = this.scene.time.now;
          this.popText('ZU MÜDE!', '#c94f4f');
        }
      } else {
        body.setVelocityY(-650);
        this.stamina = Math.max(0, this.stamina - 8);
        SFX.jump();
      }
    }
    if (!input.up) this.upLatch = false;

    // Trinken (Edge-Trigger)
    if (input.drink && !this.drinkLatch) {
      this.drinkLatch = true;
      this.manualDrink();
    } else if (!input.drink) {
      this.drinkLatch = false;
    }

    // Special-Action — priorisiert Wasser-Rettung vor eigener Fähigkeit
    if (input.action && !this.actionLatch) {
      this.actionLatch = true;
      // 1. Mitspieler ertrinkt unter mir? → rausziehen
      if (this.tryPullFromWater()) {}
      // 2. Sonst: eigene Spezialfähigkeit
      else if (this.abilityCooldown <= 0) {
        this.useAbility();
      } else {
        // Cooldown läuft — präziseres Feedback
        if (!this._lastCDPop || this.scene.time.now - this._lastCDPop > 1200) {
          this._lastCDPop = this.scene.time.now;
          this.popText('NOCH ' + Math.ceil(this.abilityCooldown) + 's WARTEN', '#f4c842');
          // HUD-Label kurz aufblinken, damit der Spieler die Quelle sieht
          if (this.hudAbilityCooldown) {
            this.scene.tweens.add({
              targets: this.hudAbilityCooldown, scale: 1.5, yoyo: true, duration: 150
            });
          }
        }
      }
    } else if (!input.action) {
      this.actionLatch = false;
    }

    // Stamina-Drain beim Bewegen, sehr schwacher Regen wenn still.
    // Bewusst hart: man MUSS Brauereien und Trinken benutzen, sonst kommt
    // man nicht durch. Stehenbleiben regeneriert nur ein bisschen.
    if (left || right) {
      this.stamina = Math.max(0, this.stamina - dt * 7);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * dt * 1.5);
    }

    // Drunkenness baut langsam ab
    this.drunkenness = Math.max(0, this.drunkenness - dt * 6);

    // 100% Promille → K.O. (nur Bier-Wurf eines Mitspielers weckt auf)
    if (this.drunkenness >= 100 && !this.charData.stats.drunkImmune) {
      this.becomeKnockedOut('promille');
    }

    // Cooldowns
    if (this.abilityCooldown > 0) this.abilityCooldown -= dt;
    if (this.invulnTimer > 0)     this.invulnTimer -= dt;
    if (this.abilityActiveTimer > 0) {
      this.abilityActiveTimer -= dt;
      if (this.abilityActiveTimer <= 0) this.endAbility();
    }

    // Visuals nachziehen
    this.label.setPosition(this.sprite.x, this.sprite.y - 70);
    if (this.aura) this.aura.setPosition(this.sprite.x, this.sprite.y);

    // Sprite spiegeln je nach Laufrichtung
    if (this.sprite.setFlipX) {
      if (left) this.sprite.setFlipX(true);
      else if (right) this.sprite.setFlipX(false);
    }
    // Wenn besoffen: Sprite kippt sichtbar hin und her
    if (isDrunk && this.sprite.setRotation) {
      this.sprite.setRotation(Math.sin(this.scene.time.now / 130) * 0.18);
    } else if (this.sprite.setRotation) {
      this.sprite.setRotation(0);
    }
    // Kleines "Wackeln" beim Laufen — leicht verkippte Skala
    if ((left || right) && body.blocked.down && this.sprite.setScale) {
      const wob = 1 + Math.sin(this.scene.time.now / 70) * 0.04;
      this.sprite.setScale(1, wob);
    } else if (this.sprite.setScale && !this._isAbilityScaling) {
      this.sprite.setScale(1, 1);
    }

    // Drunk-Edge: einmal Toast + Bildschirm-Flash, sobald sich der Status ändert
    if (isDrunk && !this._wasDrunk) {
      this.popText('💀 BESOFFEN!', '#c94f4f');
      this.scene.cameras.main.flash(150, 200, 50, 50);
      this._wasDrunk = true;
    } else if (!isDrunk && this._wasDrunk) {
      this.popText('AUFGEKLART', '#6dbf47');
      this._wasDrunk = false;
    }

    // HUD aktualisieren
    if (this.hudStaminaFill) {
      const ratio = this.stamina / this.maxStamina;
      this.hudStaminaFill.scaleX = ratio;
      this.hudStaminaFill.fillColor = ratio > 0.5 ? 0x6dbf47 : ratio > 0.25 ? 0xe8a04e : 0xc94f4f;
    }
    if (this.hudDrunkBar) {
      this.hudDrunkBar.scaleX = this.drunkenness / 100;
    }
    if (this.hudBeerCount) {
      this.hudBeerCount.setText('🍺×' + this.beerInventory);
    }
    if (this.hudAbilityCooldown) {
      if (this.abilityCooldown > 0) {
        this.hudAbilityCooldown.setText(Math.ceil(this.abilityCooldown) + 's');
        this.hudAbilityCooldown.setColor('#888');
      } else {
        this.hudAbilityCooldown.setText('BEREIT');
        this.hudAbilityCooldown.setColor('#6dbf47');
      }
    }
  }

  // Bier wird im Vorbeilaufen aufgesammelt → kommt nur ins Inventar.
  // Stamina/Drunkenness ändern sich erst, wenn der Trinken-Knopf gedrückt wird.
  pickupBeer() {
    this.beerInventory++;
    this.popText('🍺 +1', '#f4c842');
    SFX.pickup();
  }

  // Trinken-Knopf: zwei Modi.
  // 1) K.O.-Mitspieler in der Nähe → wirf Bier auf ihn → er wacht auf
  // 2) Sonst → selbst trinken (Stamina rauf, Promille rauf)
  manualDrink() {
    if (this.beerInventory <= 0) {
      this.popText('LEER!', '#c94f4f');
      return;
    }

    // Koop: K.O.-Mitspieler in <140 px Nähe wiederbeleben
    let koTarget = null;
    let bestDist = 140;
    for (const other of this.scene.players.values()) {
      if (other === this) continue;
      if (!other.knockedOut) continue;
      const dx = other.sprite.x - this.sprite.x;
      const dy = other.sprite.y - this.sprite.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; koTarget = other; }
    }
    if (koTarget) {
      this.beerInventory--;
      this.throwReviveBeer(koTarget);
      this.popText('🍻 → ' + koTarget.charData.name.toUpperCase(), '#6dbf47');
      return;
    }

    // Selbst trinken
    this.beerInventory--;
    const mult = this.charData.stats.drinkMultiplier || 1;
    const gain = 25 * mult;
    this.stamina = Math.min(this.maxStamina, this.stamina + gain);
    this.drunkenness = Math.min(100, this.drunkenness + (this.charData.stats.drunkImmune ? 4 : 18));
    this.scene.tweens.add({
      targets: this.sprite, scaleY: 1.2, yoyo: true, duration: 150
    });
    this.popText('+' + Math.round(gain), '#f4c842');
    SFX.drink();
  }

  popText(msg, color) {
    const txt = this.scene.add.text(this.sprite.x, this.sprite.y - 70, msg, {
      fontFamily: 'Bungee, sans-serif', fontSize: '16px', color,
      stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5).setDepth(900);
    this.scene.tweens.add({
      targets: txt, y: txt.y - 40, alpha: 0, duration: 800,
      onComplete: () => txt.destroy()
    });
  }

  // ============== M1: KO-System ==============

  // K.O.-Auslöser: 'stone' (Stein-Treffer), 'promille' (100% Drunken),
  // 'drowning' (im Wasser ausgepowert). In allen Fällen: nur Bier-Wurf
  // eines Mitspielers weckt wieder auf.
  becomeKnockedOut(reason) {
    if (this.knockedOut) return;
    this.knockedOut = true;
    this.koTimer = 0;
    this.sprite.body.setVelocityX(0);
    // Hitbox auf "liegend" umstellen — Arcade rotiert Bodies nicht mit,
    // daher schwebt der Sprite sonst über dem Boden.
    this.sprite.body.setSize(70, 34);
    this.sprite.body.setOffset(0, 58);
    this.scene.tweens.add({
      targets: this.sprite, rotation: Math.PI / 2, duration: 400, ease: 'Bounce.out'
    });
    const msg = reason === 'stone'   ? '💀 STEIN!'
              : reason === 'drowning'? '💀 ERTRUNKEN!'
              :                        '💀 K.O.!';
    this.popText(msg, '#c94f4f');
    this.scene.cameras.main.shake(300, 0.008);
    if (this.scene.checkAllKO) this.scene.checkAllKO();
  }

  updateKnockedOut(dt) {
    this.koTimer += dt;
    this.sprite.body.setVelocityX(0);
    if (this.label) {
      this.label.setPosition(this.sprite.x, this.sprite.y - 30);
      this.label.setText(this.charData.name + ' 💤');
    }
    // Sehr langsame Promille-Reduktion solang man liegt
    this.drunkenness = Math.max(0, this.drunkenness - dt * 4);
  }

  // Helfer ruft das auf: ziehe einen Mitspieler aus dem Bach.
  // Bedingung: Helfer steht oben (nicht im Wasser), Zielspieler ist im
  // Wasser, dx <100 px, dy <140 px. Helfer zahlt 12 Stamina.
  tryPullFromWater() {
    if (this.inWater) return false;
    if (this.stamina < 8) return false;
    let target = null;
    let bestDist = 100;
    for (const other of this.scene.players.values()) {
      if (other === this) continue;
      if (!other.inWater) continue;
      const dx = Math.abs(other.sprite.x - this.sprite.x);
      const dy = this.sprite.y - other.sprite.y; // Helfer höher als Ziel
      if (dy < -40 || dy > 160) continue;
      if (dx < bestDist) { bestDist = dx; target = other; }
    }
    if (!target) return false;
    // Ziel direkt aus dem Wasser ziehen
    target.sprite.x = this.sprite.x + (this.sprite.x < target.sprite.x ? 30 : -30);
    target.exitWater();
    target.popText('🤝 GERETTET!', '#6dbf47');
    target.sprite.body.setVelocityY(-200);
    this.stamina = Math.max(0, this.stamina - 12);
    this.popText('✊ → ' + target.charData.name.toUpperCase(), '#a0d8e8');
    this.scene.cameras.main.flash(150, 200, 220, 255);
    return true;
  }

  // Bier-Wurf: ein gelbes Sprite fliegt vom Helfer zum K.O.-Mitspieler,
  // beim Aufprall wird der wiederbelebt.
  throwReviveBeer(target) {
    const proj = this.scene.add.image(this.sprite.x, this.sprite.y - 30, 'beer-can')
      .setDepth(950);
    this.scene.tweens.add({
      targets: proj,
      x: target.sprite.x,
      y: target.sprite.y - 20,
      duration: 450,
      ease: 'Quad.in',
      onUpdate: () => { proj.rotation += 0.3; },
      onComplete: () => {
        proj.destroy();
        target.reviveByBeer();
      }
    });
    this.scene.cameras.main.flash(120, 200, 220, 100);
  }

  // Wird durch Bier-Wurf eines Mitspielers ausgelöst — der einzige Weg
  // aus dem K.O. heraus.
  reviveByBeer() {
    if (!this.knockedOut) return;
    this.knockedOut = false;
    this.drunkenness = 30;
    this.stamina = Math.max(this.stamina, 50);
    // Aus Wasser-Modus auch raus (falls dort K.O. gegangen)
    if (this.inWater) this.exitWater();
    this.sprite.body.setAllowGravity(true);
    this.sprite.body.setVelocity(0, 0);
    // Hitbox auf "stehend" zurücksetzen
    this.sprite.body.setSize(34, 90);
    this.sprite.body.setOffset(18, 18);
    this.scene.tweens.add({
      targets: this.sprite, rotation: 0, duration: 300
    });
    if (this.label) {
      this.label.setText(this.charData.name);
      this.label.setPosition(this.sprite.x, this.sprite.y - 70);
    }
    this.popText('🌟 AUFGEWACHT!', '#6dbf47');
  }

  // ============== M2: Wasser-System ==============

  enterWater(gap) {
    if (this.inWater) return;
    this.inWater = true;
    this.sprite.body.setAllowGravity(false);
    this.popText('💦 INS WASSER!', '#3a7aa8');
    this.scene.cameras.main.flash(150, 60, 120, 200);
    SFX.splash();
  }

  exitWater() {
    this.inWater = false;
    this.sprite.body.setAllowGravity(true);
    // Auf lokale Terrain-Höhe setzen (Bäche können zwischen erhöhten Sektionen liegen)
    const top = this.scene.topYAt ? this.scene.topYAt(this.sprite.x) : this.scene.GROUND_Y;
    this.sprite.y = top - 80;
    this.sprite.body.setVelocityY(0);
    if (this.sprite.setRotation) this.sprite.setRotation(0);
  }

  updateInWater(input, dt) {
    const body = this.sprite.body;
    const gap = this.scene.gaps.find(g =>
      this.sprite.x > g.start && this.sprite.x < g.end);
    // Aus dem Gap rausgespült → Wasser-Modus aus, Spieler nach oben setzen
    if (!gap) {
      this.exitWater();
      return;
    }

    // Schwimm-Höhe: Spieler treibt mit Schultern an der Wasseroberfläche
    const targetY = this.scene.GROUND_Y + 35;
    body.setVelocityY((targetY - this.sprite.y) * 3);

    // Sanfte Strömung — eigene Bewegung lässt einen seitlich gleiten,
    // aber NICHT raus. Klettern geht nicht mehr — Mitspieler muss helfen.
    let vx = -20;
    if (input.right) vx += 50;
    if (input.left)  vx -= 50;
    body.setVelocityX(vx);

    // Stamina sickert milder weg (3 statt 6) — sonst gehen alle direkt
    // K.O. bevor Hilfe kommt.
    this.stamina = Math.max(0, this.stamina - dt * 3);

    // Hilferuf alle 2 Sek
    if (!this._lastDrowningPop || this.scene.time.now - this._lastDrowningPop > 2000) {
      this._lastDrowningPop = this.scene.time.now;
      this.popText('🆘 HILFE!', '#a0d8e8');
    }

    // Visual: Sprite leicht schwankend
    if (this.sprite.setRotation) {
      this.sprite.setRotation(Math.sin(this.scene.time.now / 200) * 0.1);
    }

    // Bei Stamina 0 im Wasser → K.O. (Mitspieler muss mit Bier wiederbeleben)
    if (this.stamina <= 0 && !this.knockedOut) {
      this.becomeKnockedOut('drowning');
    }

    // Sprung-Knopf macht im Wasser nichts — nur visueller Plitsch
    if (input.up && !this.upLatch) {
      this.upLatch = true;
      this.popText('💧', '#a0d8e8');
    }
    if (!input.up) this.upLatch = false;
  }

  // Klartext-Namen + Beschreibungen der Specials (für Pop-Up + HUD)
  static ABILITY_INFO = {
    schumi:  { name: 'ZEITLUPE',     desc: 'Welt 60% langsamer (3s)' },
    sven:    { name: 'SPRINT',       desc: '70% schneller (2.5s)'    },
    jan:     { name: 'ANGEL',        desc: 'Saugt Biere im Umkreis an' },
    stefan:  { name: 'TEAM-BOOST',   desc: 'Alle 20% schneller (4s)' },
    manu:    { name: 'ZWEITER WIND', desc: 'Stamina sofort voll'     },
    ahln:    { name: 'MEGA-SCHLUCK', desc: 'Stamina voll, Promille 0' },
    lorenz:  { name: 'GLÜCKSGRIFF',  desc: '5 Biere aus dem Hut'     }
  };

  useAbility() {
    SFX.ability();
    const id = this.charData.id;
    const info = HikePlayer.ABILITY_INFO[id] || { name: 'SPECIAL', desc: '' };
    // Großer Banner über dem Spieler — Name + Beschreibung
    const banner = this.scene.add.text(this.sprite.x, this.sprite.y - 110,
      '★ ' + info.name, {
        fontFamily: 'Bungee, sans-serif', fontSize: '24px',
        color: '#' + this.charData.color.toString(16).padStart(6, '0'),
        stroke: '#000', strokeThickness: 5
      }).setOrigin(0.5).setDepth(950);
    const desc = this.scene.add.text(this.sprite.x, this.sprite.y - 84,
      info.desc, {
        fontFamily: 'Special Elite, monospace', fontSize: '14px',
        color: '#fef3d4', stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5).setDepth(950);
    this.scene.tweens.add({
      targets: [banner, desc], y: '-=30', alpha: 0,
      duration: 1600, delay: 400,
      onComplete: () => { banner.destroy(); desc.destroy(); }
    });

    // Farbiger Aktivierungs-Kreis
    const flash = this.scene.add.circle(this.sprite.x, this.sprite.y, 60,
      this.charData.color, 0.5);
    this.scene.tweens.add({
      targets: flash, scale: 3, alpha: 0, duration: 500,
      onComplete: () => flash.destroy()
    });

    switch (id) {
      case 'schumi': // Slow-Mo
        this.scene.physics.world.timeScale = 2.5; // Phaser: höher = langsamer
        this.scene.tweens.timeScale = 0.4;
        this.scene.cameras.main.flash(200, 100, 200, 100);
        this.abilityActiveTimer = 3;
        this.abilityCooldown = 15;
        break;

      case 'sven': // Sprint-Boost
        this._origSpeed = this.baseSpeed;
        this.currentSpeed = this.baseSpeed * 1.7;
        this.abilityActiveTimer = 2.5;
        this.abilityCooldown = 10;
        break;

      case 'jan': // Angel — zieht Items im Umkreis an (Static-Bodies: Hitbox nach Tween syncen)
        this.scene.beers.children.iterate(beer => {
          if (!beer || !beer.active) return;
          const dx = beer.x - this.sprite.x;
          const dy = beer.y - this.sprite.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 350) {
            this.scene.tweens.add({
              targets: beer, x: this.sprite.x, y: this.sprite.y,
              duration: 600, ease: 'Quad.in',
              onUpdate: () => {
                if (!beer.active) return;
                if (beer.body && beer.body.updateFromGameObject) beer.body.updateFromGameObject();
              },
              onComplete: () => {
                if (!beer.active) return;
                if (beer.body && beer.body.updateFromGameObject) beer.body.updateFromGameObject();
              }
            });
          }
        });
        this.abilityCooldown = 8;
        break;

      case 'stefan': // Group-Speed-Buff — multiplikativ, damit Sven-Sprint o.ä. nicht „eingefroren“ wird
        this.scene.players.forEach(p => {
          if (!p._speedBuffActive) {
            p._speedBuffActive = true;
            p.currentSpeed *= 1.2;
            this.scene.time.delayedCall(4000, () => {
              p.currentSpeed /= 1.2;
              p._speedBuffActive = false;
            });
          }
        });
        this.abilityCooldown = 20;
        break;

      case 'manu': // Zweiter Wind — Stamina sofort voll
        this.stamina = this.maxStamina;
        this.abilityCooldown = 18;
        break;

      case 'ahln': // Mega-Schluck — Drunkenness leeren + Stamina voll
        this.stamina = this.maxStamina;
        this.drunkenness = 0;
        this.abilityCooldown = 12;
        break;

      case 'lorenz': // Glücksgriff — spawnt 5 Biere im oberen Halbkreis (sin ≤ 0)
        for (let i = 0; i < 5; i++) {
          // Winkel verteilt von π bis 2π → sin ist 0 bis -1 bis 0 (nach oben)
          const angle = Math.PI + (Math.PI / 4) * i;
          const r = 90;
          this.scene.spawnBeer(
            this.sprite.x + Math.cos(angle) * r,
            this.sprite.y - 60 + Math.sin(angle) * r
          );
        }
        this.abilityCooldown = 25;
        break;

      default:
        this.abilityCooldown = 5;
    }
  }

  endAbility() {
    if (this.charData.id === 'schumi') {
      this.scene.physics.world.timeScale = 1;
      this.scene.tweens.timeScale = 1;
    }
    if (this.charData.id === 'sven') {
      this.currentSpeed = this._origSpeed || this.baseSpeed;
    }
  }

  // Stein-Treffer = sofort K.O. (nur Bier-Wurf eines Mitspielers weckt auf).
  // Im K.O. selbst ist man durch knockedOut-Check sowieso geschützt.
  hitObstacle() {
    if (this.knockedOut) return;
    if (this.invulnTimer > 0) return;
    this.invulnTimer = 1.5;
    SFX.hit();
    this.becomeKnockedOut('stone');
  }

  destroy() {
    this.sprite.destroy();
    this.label.destroy();
    if (this.aura) this.aura.destroy();
    if (this.hudStaminaFill) this.hudStaminaFill.destroy();
    if (this.hudStaminaBg)   this.hudStaminaBg.destroy();
    if (this.hudDrunkBar)    this.hudDrunkBar.destroy();
    if (this.hudDrunkBg)     this.hudDrunkBg.destroy();
    if (this.hudBeerCount)   this.hudBeerCount.destroy();
    if (this.hudAbilityLabel)    this.hudAbilityLabel.destroy();
    if (this.hudAbilityCooldown) this.hudAbilityCooldown.destroy();
  }
}

// ================================================================
//  LEVEL-SELECT — startet als erste Szene und reicht zur Hike weiter
// ================================================================
class LevelSelectScene extends Phaser.Scene {
  constructor() { super('LevelSelectScene'); }

  preload() {
    if (window.MaennertagPixelChars) {
      for (const c of CHARACTERS) {
        window.MaennertagPixelChars.buildPhaserCharTexture(this, 'char-' + c.id, c.id);
      }
    }
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    this.cameras.main.setBackgroundColor('#1a0f08');

    this.add.text(W / 2, H * 0.15, 'WÄHLT EUER LEVEL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '48px', color: '#f4c842',
      stroke: '#3d1a06', strokeThickness: 8
    }).setOrigin(0.5);

    const levels = [
      { key: 'PaddleScene', title: '🛶  PADDELN',  sub: 'Top-Down · Fluss · Strömung' },
      { key: 'HikeScene',   title: '🥾  WANDERN',  sub: 'Side-Scroll · 4 Brauereien' },
      { key: '__TODO__',    title: '🍷  KELLER',   sub: 'Bald — Plattformer im Dunkeln', disabled: true }
    ];

    levels.forEach((lvl, i) => {
      const x = W * (0.22 + i * 0.28);
      const y = H * 0.55;
      const card = this.add.rectangle(x, y, 320, 220, 0x3d1a06, 1)
        .setStrokeStyle(6, lvl.disabled ? 0x6b6b6b : 0xf4c842)
        .setInteractive({ useHandCursor: !lvl.disabled });
      this.add.text(x, y - 50, lvl.title, {
        fontFamily: 'Bungee, sans-serif', fontSize: '32px',
        color: lvl.disabled ? '#6b6b6b' : '#fef3d4'
      }).setOrigin(0.5);
      this.add.text(x, y + 20, lvl.sub, {
        fontFamily: 'Special Elite, monospace', fontSize: '14px',
        color: lvl.disabled ? '#6b6b6b' : '#d99a1f', wordWrap: { width: 280 }, align: 'center'
      }).setOrigin(0.5);
      if (!lvl.disabled) {
        card.on('pointerdown', () => this.scene.start(lvl.key));
        card.on('pointerover', () => card.setStrokeStyle(8, 0x6dbf47));
        card.on('pointerout',  () => card.setStrokeStyle(6, 0xf4c842));
      }
    });

    // Hint: "Action"-Button auf irgendeinem Handy auch nutzbar
    this.add.text(W / 2, H - 60, '(Tipp: oder Action-Button auf einem Controller drücken)', {
      fontFamily: 'Special Elite, monospace', fontSize: '14px', color: '#6b8a5a'
    }).setOrigin(0.5);

    // Erste Person die Action drückt → Wandern starten (default)
    const onInput = ({ id, input }) => {
      if (input.action) {
        socket.off('player-input', onInput);
        this.scene.start('HikeScene');
      }
    };
    socket.on('player-input', onInput);
    this.events.once('shutdown', () => socket.off('player-input', onInput));
  }
}

// ================================================================
//  PADDLE-SCENE — Top-Down-Fluss
// ================================================================
//  Steuerung:
//   - left/right     → laterale Bewegung
//   - up (Sprung)    → Paddel-Boost (Stamina-Kosten)
//   - drink          → Bier-Pickup verbrauchen (auto bei Berührung)
//   - action         → Spezialfähigkeit
//
//  Welt scrollt vertikal; Strömung schiebt jedes Boot mit konstantem Tempo
//  nach unten. Hindernisse: Felsen, Treibholz.
// ================================================================
class PaddleScene extends Phaser.Scene {
  constructor() { super('PaddleScene'); }

  preload() {
    if (window.MaennertagPixelChars) {
      for (const c of CHARACTERS) {
        window.MaennertagPixelChars.buildPhaserCharTexture(this, 'char-' + c.id, c.id);
      }
    }
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const RIVER_LENGTH = 12000; // Pixel der Fluss-Strecke vertikal

    this.RIVER_LENGTH = RIVER_LENGTH;
    this.scrollY = 0;
    this.currentSpeed = 90; // px/s Strömung

    this.cameras.main.setBackgroundColor('#3a6a7a');
    this.cameras.main.setBounds(0, -RIVER_LENGTH, W, RIVER_LENGTH + H);

    // Wasser-Hintergrund mit horizontalen Wellen
    this.waterStrips = [];
    for (let i = 0; i < 200; i++) {
      const y = -i * 80;
      const strip = this.add.rectangle(W / 2, y, W, 4, i % 2 ? 0x4a8aa8 : 0x3a7a98);
      strip.setAlpha(0.4);
      this.waterStrips.push(strip);
    }

    // Ufer links + rechts (grün, schmaler "Korridor" für die Boote)
    const SHORE_W = 80;
    this.shoreLeft = this.add.rectangle(SHORE_W / 2, -RIVER_LENGTH / 2, SHORE_W, RIVER_LENGTH * 2, 0x4a6a3a);
    this.shoreRight = this.add.rectangle(W - SHORE_W / 2, -RIVER_LENGTH / 2, SHORE_W, RIVER_LENGTH * 2, 0x4a6a3a);

    // Hindernisse: Felsen + Treibholz, zufällig verteilt
    this.obstacles = this.physics.add.group();
    for (let i = 0; i < 80; i++) {
      const ox = SHORE_W + 40 + Math.random() * (W - 2 * SHORE_W - 80);
      const oy = -200 - Math.random() * (RIVER_LENGTH - 400);
      const isLog = Math.random() < 0.4;
      let obj;
      if (isLog) {
        obj = this.add.rectangle(ox, oy, 90, 22, 0x6b4a2a);
        obj.setStrokeStyle(2, 0x3d2a1a);
      } else {
        obj = this.add.ellipse(ox, oy, 60, 44, 0x6b6b6b);
        obj.setStrokeStyle(3, 0x3d3d3d);
      }
      this.physics.add.existing(obj);
      obj.body.setAllowGravity(false);
      obj.body.setImmovable(true);
      this.obstacles.add(obj);
    }

    // Bier-Flaschen die im Wasser treiben
    this.beers = this.physics.add.group();
    for (let i = 0; i < 35; i++) {
      const bx = SHORE_W + 20 + Math.random() * (W - 2 * SHORE_W - 40);
      const by = -300 - Math.random() * (RIVER_LENGTH - 500);
      this.spawnFloatingBeer(bx, by);
    }

    // Ziel-Linie ganz oben (negative y = stromaufwärts, ihr fahrt aber rückwärts auf der Karte
    // → Boote starten oben in unserer Welt, Ziel ist unten am Bildschirm: deshalb invertieren wir
    // einfach den Spawn — see below)
    const goalY = -RIVER_LENGTH + 200;
    this.goalY = goalY;
    this.gameWon = false;
    this.add.rectangle(W / 2, goalY, W - 2 * SHORE_W, 8, 0xc94f4f);
    this.add.text(W / 2, goalY - 30, 'ZIEL — BIERGARTEN', {
      fontFamily: 'Bungee, sans-serif', fontSize: '22px',
      color: '#fef3d4', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5);

    // Spieler erstellen — als Boote
    this.players = new Map();
    let spawnX = W * 0.3;
    for (const [id, data] of playerData) {
      this.spawnPaddler(id, data, spawnX, 0);
      spawnX += 60;
      if (spawnX > W * 0.7) spawnX = W * 0.3;
    }

    // Mid-Game Joins — Listener bei Scene-Wechsel entfernen
    this._onPaddlePlayerJoined = (p) => {
      if (!this.players.has(p.id)) {
        const H = this.scale.height;
        this.spawnPaddler(p.id, p, W * 0.5, this.cameras.main.scrollY + H * 0.55);
      }
    };
    this._onPaddlePlayerLeft = (id) => {
      const p = this.players.get(id);
      if (p) { p.destroy(); this.players.delete(id); }
      this.buildHUD();
    };
    socket.on('player-joined', this._onPaddlePlayerJoined);
    socket.on('player-left', this._onPaddlePlayerLeft);
    this.events.once('shutdown', () => {
      socket.off('player-joined', this._onPaddlePlayerJoined);
      socket.off('player-left', this._onPaddlePlayerLeft);
    });

    // HUD-Container für Stamina-Leisten
    this.hudContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(1000);
    this.buildHUD();

    // "Zurück zur Auswahl"-Button
    const back = this.add.text(20, 20, '← LEVEL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '18px', color: '#fef3d4',
      backgroundColor: '#3d1a06', padding: { x: 12, y: 6 }
    }).setScrollFactor(0).setDepth(1001).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('LevelSelectScene'));
  }

  spawnFloatingBeer(x, y) {
    const beer = this.add.rectangle(x, y, 14, 22, 0xf4c842);
    beer.setStrokeStyle(2, 0x6b2e0c);
    this.physics.add.existing(beer);
    beer.body.setAllowGravity(false);
    beer.body.setImmovable(true);
    this.beers.add(beer);
    this.tweens.add({ targets: beer, x: x + 10, yoyo: true, duration: 1400, repeat: -1, ease: 'Sine.inOut' });
    return beer;
  }

  spawnPaddler(id, data, x, y) {
    const charData = charById(data.characterId);
    const p = new PaddlePlayer(this, x, y, id, charData);
    this.physics.add.overlap(p.sprite, this.beers, (sp, beer) => {
      beer.destroy();
      p.drinkBeer();
    });
    this.physics.add.collider(p.sprite, this.obstacles, () => p.hitObstacle());
    this.players.set(id, p);
    this.buildHUD();
  }

  buildHUD() {
    if (!this.hudContainer) return;
    this.hudContainer.removeAll(true);
    const W = this.scale.width;
    const slots = Array.from(this.players.values());
    const slotWidth = Math.min(180, (W - 40) / Math.max(slots.length, 1));
    slots.forEach((p, i) => {
      const x = 20 + i * slotWidth;
      const y = this.scale.height - 70;
      const bg = this.add.rectangle(x, y, slotWidth - 8, 56, 0x000000, 0.5).setOrigin(0, 0);
      bg.setStrokeStyle(2, p.charData.color);
      const name = this.add.text(x + 8, y + 4, p.charData.name, {
        fontFamily: 'Bungee, sans-serif', fontSize: '14px',
        color: '#' + p.charData.color.toString(16).padStart(6, '0')
      });
      const playerName = this.add.text(x + 8, y + 22, p.playerName || '', {
        fontFamily: 'Special Elite, monospace', fontSize: '11px', color: '#fef3d4'
      });
      p.hudStaminaBg = this.add.rectangle(x + 8, y + 40, slotWidth - 24, 8, 0x1a0f08).setOrigin(0, 0);
      p.hudStaminaFill = this.add.rectangle(x + 8, y + 40, slotWidth - 24, 8, 0x6dbf47).setOrigin(0, 0);
      this.hudContainer.add([bg, name, playerName, p.hudStaminaBg, p.hudStaminaFill]);
    });
  }

  update(time, delta) {
    if (this.players.size === 0) return;
    if (this.gameWon) return;
    const dt = delta / 1000;

    // Strömung — alle Boote kontinuierlich nach "oben" (negative y) bewegen
    let avgY = 0;
    for (const p of this.players.values()) {
      const input = playerInputs.get(p.id) || {};
      p.update(input, dt, this.currentSpeed);
      avgY += p.sprite.y;
      // Ziel: stromaufwärts = y kleiner/gleich goalY (negativer)
      if (!p.atGoal && p.sprite.y <= this.goalY) {
        p.atGoal = true;
        const txt = this.add.text(p.sprite.x, p.sprite.y - 50, '🏁 AM ZIEL!', {
          fontFamily: 'Bungee, sans-serif', fontSize: '18px', color: '#6dbf47',
          stroke: '#000', strokeThickness: 3
        }).setOrigin(0.5);
        this.tweens.add({
          targets: txt, y: txt.y - 40, alpha: 0, duration: 1200,
          onComplete: () => txt.destroy()
        });
      }
    }
    avgY /= this.players.size;

    // Sieg: alle Boote haben die Ziel-Linie passiert
    if (this.players.size > 0) {
      const all = Array.from(this.players.values());
      if (all.every(p => p.atGoal)) this.triggerPaddleWin();
    }

    // Kamera folgt Schwerpunkt vertikal, lateral bleibt fix
    const H = this.scale.height;
    const targetY = avgY - H * 0.55;
    this.cameras.main.scrollY += (targetY - this.cameras.main.scrollY) * 0.06;

    // Wer zu weit zurück (=tiefer) treibt, wird vom Bildrand "geboostet" zurück
    const camBottom = this.cameras.main.scrollY + H;
    for (const p of this.players.values()) {
      if (p.sprite.y > camBottom - 40) p.sprite.y = camBottom - 60;
    }
  }

  triggerPaddleWin() {
    if (this.gameWon) return;
    this.gameWon = true;
    SFX.win();
    for (const p of this.players.values()) p.frozen = true;

    const W = this.scale.width, H = this.scale.height;
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65)
      .setScrollFactor(0).setDepth(2000);
    this.add.text(W / 2, H * 0.35, '🛶  GESCHAFFT!', {
      fontFamily: 'Bungee, sans-serif', fontSize: '56px', color: '#f4c842',
      stroke: '#3d1a06', strokeThickness: 8
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    this.add.text(W / 2, H * 0.5,
      'Alle im Biergarten angekommen — Prost!', {
      fontFamily: 'Special Elite, monospace', fontSize: '22px',
      color: '#fef3d4', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    const back = this.add.text(W / 2, H * 0.7, '↩  ZURÜCK ZUR LEVEL-AUSWAHL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '22px', color: '#1a0f08',
      backgroundColor: '#f4c842', padding: { x: 24, y: 12 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('LevelSelectScene'));

    const onInput = ({ input }) => {
      if (input && input.action) {
        socket.off('player-input', onInput);
        this.scene.start('LevelSelectScene');
      }
    };
    socket.on('player-input', onInput);
    this.events.once('shutdown', () => socket.off('player-input', onInput));
  }
}

// ================================================================
//  PADDLER-PLAYER — eigene Klasse für die Top-Down-Fluss-Steuerung
// ================================================================
class PaddlePlayer {
  constructor(scene, x, y, id, charData) {
    this.scene = scene;
    this.id = id;
    this.charData = charData;
    this.playerName = (playerData.get(id) && playerData.get(id).name) || charData.name;

    // Kajak-Container: Boot + Pixelart-Spieler obendrauf
    this.boat = scene.add.ellipse(0, 12, 60, 22, 0x6b4a2a);
    this.boat.setStrokeStyle(2, 0x3d2a1a);

    let upper;
    const textureKey = 'char-' + charData.id;
    if (scene.textures.exists(textureKey)) {
      upper = scene.add.image(0, -10, textureKey);
      upper.setScale(0.7);
    } else {
      upper = scene.add.rectangle(0, -10, 28, 40, charData.color);
      upper.setStrokeStyle(2, 0x000000);
    }

    this.sprite = scene.add.container(x, y, [this.boat, upper]);
    this.sprite.setSize(60, 60);
    scene.physics.world.enable(this.sprite);
    this.sprite.body.setAllowGravity(false);
    this.sprite.body.setCollideWorldBounds(false);

    // Stats
    this.maxStamina = charData.stats.maxStamina;
    this.stamina = this.maxStamina;
    this.invulnTimer = 0;
    this.abilityCooldown = 0;
    this.staminaRegen = charData.stats.staminaRegen;
    this.lateralSpeed = charData.id === 'jan' ? 240 : 200; // Jan = Paddel-König
    this.boostTimer = 0;
    this.actionLatch = false;
    this.upLatch = false;
    this.atGoal = false;
    this.frozen = false;

    this.label = scene.add.text(x, y - 40, this.playerName, {
      fontFamily: 'Bungee, sans-serif', fontSize: '12px',
      color: '#fef3d4', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);
  }

  update(input, dt, currentSpeed) {
    const body = this.sprite.body;
    if (this.frozen) {
      body.setVelocity(0, 0);
      return;
    }

    // Lateral
    let vx = 0;
    if (input.left) vx -= this.lateralSpeed;
    if (input.right) vx += this.lateralSpeed;
    body.setVelocityX(vx);

    // Vertikal: konstante Strömung nach oben (negative y)
    let vy = -currentSpeed;
    if (this.boostTimer > 0) {
      vy -= 180; // Boost zieht stärker nach vorn
      this.boostTimer -= dt;
    }
    body.setVelocityY(vy);

    // Sprung-Button = Paddel-Boost (Edge-Trigger)
    if (input.up && !this.upLatch && this.stamina > 5) {
      this.upLatch = true;
      this.boostTimer = 0.6;
      this.stamina = Math.max(0, this.stamina - 5);
      // visuelles Feedback
      this.scene.tweens.add({ targets: this.sprite, scaleY: 1.08, yoyo: true, duration: 120 });
    }
    if (!input.up) this.upLatch = false;

    // Action = Special
    if (input.action && !this.actionLatch && this.abilityCooldown <= 0) {
      this.actionLatch = true;
      this.useAbility();
    } else if (!input.action) {
      this.actionLatch = false;
    }

    // Stamina regeneriert leicht (langsamer als bei Hike)
    this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * dt * 2);

    if (this.abilityCooldown > 0) this.abilityCooldown -= dt;
    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    this.label.setPosition(this.sprite.x, this.sprite.y - 40);

    if (this.hudStaminaFill) {
      const ratio = this.stamina / this.maxStamina;
      this.hudStaminaFill.scaleX = ratio;
    }
  }

  drinkBeer() {
    const mult = this.charData.stats.drinkMultiplier || 1;
    this.stamina = Math.min(this.maxStamina, this.stamina + 25 * mult);
    const txt = this.scene.add.text(this.sprite.x, this.sprite.y - 50, '+BIER', {
      fontFamily: 'Bungee, sans-serif', fontSize: '14px', color: '#f4c842',
      stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);
    this.scene.tweens.add({
      targets: txt, y: txt.y - 30, alpha: 0, duration: 700,
      onComplete: () => txt.destroy()
    });
  }

  useAbility() {
    SFX.ability();
    // Im Paddel-Level vereinfacht: Jan hat Angel (Auto-Pull), alle anderen
    // bekommen einen kurzen Speed-Boost
    if (this.charData.id === 'jan') {
      this.scene.beers.children.iterate(beer => {
        if (!beer || !beer.active) return;
        const dx = beer.x - this.sprite.x;
        const dy = beer.y - this.sprite.y;
        if (dx * dx + dy * dy < 350 * 350) {
          this.scene.tweens.add({
            targets: beer, x: this.sprite.x, y: this.sprite.y,
            duration: 500, ease: 'Quad.in',
            onUpdate: () => {
              if (!beer.active) return;
              if (beer.body && beer.body.updateFromGameObject) beer.body.updateFromGameObject();
            },
            onComplete: () => {
              if (!beer.active) return;
              if (beer.body && beer.body.updateFromGameObject) beer.body.updateFromGameObject();
            }
          });
        }
      });
      this.abilityCooldown = 8;
    } else {
      this.boostTimer = 1.5;
      this.abilityCooldown = 10;
    }
  }

  hitObstacle() {
    if (this.invulnTimer > 0) return;
    this.invulnTimer = 1.0;
    SFX.hit();
    this.stamina = Math.max(0, this.stamina - 12);
    this.scene.cameras.main.shake(150, 0.004);
    this.scene.tweens.add({
      targets: this.sprite, alpha: 0.3,
      yoyo: true, repeat: 2, duration: 100,
      onComplete: () => this.sprite.alpha = 1
    });
  }

  destroy() {
    this.sprite.destroy();
    this.label.destroy();
    if (this.hudStaminaFill) this.hudStaminaFill.destroy();
    if (this.hudStaminaBg) this.hudStaminaBg.destroy();
  }
}

// ================================================================
//  TODO — weitere Szenen
// ================================================================
// class WineCellarScene — dunkles Plattformer-Level mit Lichtquellen
//   (PointLight2D), Wein statt Bier, stärkerer Drunkenness-Anstieg.
