// game.js — läuft auf dem Host-Bildschirm
// Phaser 3 Side-Scroller mit netzwerk-gesteuerten Spielern.

// ================================================================
//  CHARAKTER-DATEN — Quelle: characters.js (MAENNERTAG_CHARACTERS)
// ================================================================
const CHARACTERS = typeof MAENNERTAG_CHARACTERS !== 'undefined'
  ? MAENNERTAG_CHARACTERS
  : [
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
  ability() { this.beep({ freq: 660, dur: 0.18, slide: 400, type: 'square', vol: 0.15 }); },
  // Zusammenstoß mit besoffenem Biergast (Hike): dumpfer „Uups“ + Glas-Ping
  drunkBump() {
    this.beep({ freq: 155, dur: 0.14, slide: -55, type: 'sine', vol: 0.22 });
    setTimeout(() => this.beep({ freq: 520, dur: 0.07, slide: 80, type: 'triangle', vol: 0.12 }), 45);
    setTimeout(() => this.beep({ freq: 190, dur: 0.09, slide: -35, type: 'sawtooth', vol: 0.10 }), 95);
  }
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
    // GROUND_Y ist der TIEFSTE Punkt im Level (Talboden bei x=0).
    // Ab hier steigt die Welt nach rechts/oben — siehe trendAt(x).
    const GROUND_Y = H - 80;
    const PEAK_Y = Math.max(120, H * 0.18); // höchster Boden (Gipfel) bei x=LEVEL_WIDTH

    this.LEVEL_WIDTH = LEVEL_WIDTH;
    this.GROUND_Y = GROUND_Y;
    this.PEAK_Y = PEAK_Y;

    // --- Aufstiegs-Kurve: smoothstep von GROUND_Y (Tal) zu PEAK_Y (Gipfel) ---
    // Ergebnis: kontinuierliche Boden-Basishöhe pro x. Erste/letzte Plattform
    // jeder Sektion liegt exakt auf dieser Linie, damit Bäche an den
    // Sektionsrändern sauber andocken.
    this.trendAt = (x) => {
      const t = Phaser.Math.Clamp(x / LEVEL_WIDTH, 0, 1);
      const eased = t * t * (3 - 2 * t);
      return GROUND_Y + (PEAK_Y - GROUND_Y) * eased;
    };

    // --- Himmel: Camera-BG-Color wandert per Lerp durch drei Biom-Töne ---
    // Wiese (hell-blau) → Wald (kühler-blau) → Gipfel (warmes Abendrot).
    // Gemischt anhand der Camera-Mitte über die Aufstiegs-Kurve.
    this.cameras.main.setBackgroundColor('#a8d8e8');
    const skyColors = [
      { r: 0xa8, g: 0xd8, b: 0xe8 },  // Wiese
      { r: 0x9a, g: 0xb6, b: 0xcc },  // Wald (etwas kühler)
      { r: 0xd6, g: 0xa8, b: 0x88 }   // Gipfel (warm)
    ];
    const lerpC = (a, b, t) => Math.round(a + (b - a) * t);
    this._updateSky = () => {
      const camMidX = this.cameras.main.scrollX + W / 2;
      const t = Phaser.Math.Clamp(camMidX / LEVEL_WIDTH, 0, 1);
      // 3-Stop-Verlauf: 0..0.4 = Wiese→Wald, 0.4..1 = Wald→Gipfel
      let c1, c2, lt;
      if (t < 0.4) { c1 = skyColors[0]; c2 = skyColors[1]; lt = t / 0.4; }
      else         { c1 = skyColors[1]; c2 = skyColors[2]; lt = (t - 0.4) / 0.6; }
      const r = lerpC(c1.r, c2.r, lt);
      const g = lerpC(c1.g, c2.g, lt);
      const b = lerpC(c1.b, c2.b, lt);
      this.cameras.main.setBackgroundColor(
        Phaser.Display.Color.GetColor(r, g, b)
      );
    };

    // Sonnen-Glow (für Stefan-Bezug) — wandert leicht mit der Tageszeit
    this.sunGlow = this.add.circle(W * 0.7, H * 0.18, 60, 0xfff3a0, 0.85);
    this.sunGlow.setScrollFactor(0).setDepth(-90);
    this.tweens.add({ targets: this.sunGlow, alpha: 0.6, yoyo: true, duration: 3000, repeat: -1 });

    // --- Ferne Bergkette (Parallax 0.15) — schneebedeckte Spitzen am Horizont ---
    // Triangles überlappen stark + variable baseY, damit keine flache Basis-Linie
    // sichtbar wird. Außerdem ein gefüllter Basis-Streifen darunter, der die
    // Triangles in eine durchgehende Bergsilhouette einbettet.
    const farMountains = this.add.graphics();
    farMountains.setDepth(-80);
    const farBaseMid = H * 0.62;
    // Basis-Block — verbirgt Spitzen-Basislinien hinter einem soliden Bergsockel
    farMountains.fillStyle(0x3e4c63, 1);
    farMountains.fillRect(0, farBaseMid, LEVEL_WIDTH, H * 0.5);
    // Spitzen — überlappend, mit variablem baseY und Höhe
    for (let i = 0; i < 90; i++) {
      const baseX = i * 200;
      const peakH = 200 + Math.sin(i * 1.7) * 70;
      const baseY = farBaseMid + Math.sin(i * 0.7) * 22;
      farMountains.fillStyle(0x4a5a72, 1);
      farMountains.fillTriangle(
        baseX - 20, baseY,
        baseX + 160, baseY - peakH,
        baseX + 320, baseY
      );
      // Schneekappe
      farMountains.fillStyle(0xe8edf2, 0.95);
      farMountains.fillTriangle(
        baseX + 100, baseY - peakH * 0.6,
        baseX + 160, baseY - peakH,
        baseX + 220, baseY - peakH * 0.6
      );
    }
    farMountains.setScrollFactor(0.15, 1);

    // --- Mittlere Bergkette (Parallax 0.22) — etwas näher, dunkler ---
    // Versteckt die Basis der fernen Kette und füllt den Bereich zwischen
    // Bergspitzen und grünen Hügeln (vorher klaffte da Sky).
    const midMountains = this.add.graphics();
    midMountains.setDepth(-72);
    const midBaseMid = H * 0.78;
    midMountains.fillStyle(0x33425a, 1);
    midMountains.fillRect(0, midBaseMid, LEVEL_WIDTH, H * 0.5);
    for (let i = 0; i < 60; i++) {
      const baseX = i * 300;
      const peakH = 140 + Math.sin(i * 2.1) * 45;
      const baseY = midBaseMid + Math.sin(i * 0.9) * 18;
      midMountains.fillStyle(0x3a4a64, 1);
      midMountains.fillTriangle(
        baseX - 30, baseY,
        baseX + 180, baseY - peakH,
        baseX + 360, baseY
      );
    }
    midMountains.setScrollFactor(0.22, 1);

    // --- Wolken (Parallax 0.4) — driften langsam horizontal ---
    this.clouds = [];
    for (let i = 0; i < 14; i++) {
      const cx = (i / 14) * LEVEL_WIDTH * 0.45 + Math.random() * 200;
      const cy = 60 + Math.random() * (H * 0.35);
      const cloud = this.add.graphics();
      cloud.fillStyle(0xffffff, 0.85);
      cloud.fillCircle(0, 0, 22);
      cloud.fillCircle(20, -6, 18);
      cloud.fillCircle(40, 0, 24);
      cloud.fillCircle(60, 4, 18);
      cloud.fillCircle(15, 10, 16);
      cloud.fillCircle(50, 12, 18);
      cloud.x = cx;
      cloud.y = cy;
      cloud.setScrollFactor(0.4);
      cloud.setDepth(-70);
      this.clouds.push({ obj: cloud, drift: 6 + Math.random() * 8 });
    }

    // --- Biom-Definition: 5 Sektionen → 3 Biome ---
    // 0 = Wiese (Akt 1, sanft, lehrreich)
    // 1, 2 = Wald (Akt 2, mittlere Höhe, schmaler, Tannen)
    // 3, 4 = Felsgipfel (Akt 3, steil, Schnee, kahl)
    const BIOME_MEADOW = 0;
    const BIOME_FOREST = 1;
    const BIOME_PEAK   = 2;
    this.biomeOfSection = [BIOME_MEADOW, BIOME_FOREST, BIOME_FOREST, BIOME_PEAK, BIOME_PEAK];

    // --- Bäche + Sektionen früh definieren, damit Parallax-Hügel + Plattformen
    // beide auf den gleichen Sektion-Lookup zugreifen können. ---
    const gapW = 140; // Bach-Breite in Pixeln (springbar mit -560 jumpVel)
    const gapCenters = [
      LEVEL_WIDTH * 0.30,
      LEVEL_WIDTH * 0.50,
      LEVEL_WIDTH * 0.70,
      LEVEL_WIDTH * 0.88
    ];
    const gaps = gapCenters.map(c => ({ start: c - gapW / 2, end: c + gapW / 2 }));
    this.gaps = gaps;
    const sectStarts = [0, ...gaps.map(g => g.end)];
    const sectEnds = [...gaps.map(g => g.start), LEVEL_WIDTH];
    this.sectStarts = sectStarts;
    this.sectEnds = sectEnds;
    this._sectionIndexAt = (x) => {
      for (let i = 0; i < sectStarts.length; i++) {
        if (x >= sectStarts[i] && x <= sectEnds[i]) return i;
      }
      return Math.min(sectStarts.length - 1,
        Math.max(0, Math.floor((x / LEVEL_WIDTH) * sectStarts.length)));
    };

    // Hügel-Parallax: PRO BIOM eigene Farbe + Verteilung
    // Wiese: hellgrün. Wald: dunkelgrün/spitzig. Fels: grau-blau.
    const hillsFar = this.add.graphics().setDepth(-60);
    const hillsNear = this.add.graphics().setDepth(-50);
    const biomeHillColors = [
      [0x6b8a5a, 0x4a6a3a],  // Wiese
      [0x3e5a3a, 0x223a26],  // Wald (dunkler, kühler)
      [0x6e7a85, 0x4a525c]   // Fels (grau-blau)
    ];
    // Far-Hügel: alle 400 px, Höhe abhängig vom Biom
    for (let x = 0; x < LEVEL_WIDTH; x += 400) {
      const sectIdx = this._sectionIndexAt(x + 200);
      const biome = this.biomeOfSection[sectIdx] || 0;
      hillsFar.fillStyle(biomeHillColors[biome][0], 1);
      const peakOffset = biome === BIOME_PEAK ? 280 : (biome === BIOME_FOREST ? 230 : 200);
      const yBase = this.trendAt(x + 200) + 60;
      hillsFar.fillTriangle(x, yBase, x + 200, yBase - peakOffset, x + 400, yBase);
    }
    hillsFar.setScrollFactor(0.3, 1);
    // Near-Hügel: alle 280 px, etwas niedriger
    for (let x = 0; x < LEVEL_WIDTH; x += 280) {
      const sectIdx = this._sectionIndexAt(x + 140);
      const biome = this.biomeOfSection[sectIdx] || 0;
      hillsNear.fillStyle(biomeHillColors[biome][1], 1);
      const peakOffset = biome === BIOME_PEAK ? 200 : (biome === BIOME_FOREST ? 170 : 140);
      const yBase = this.trendAt(x + 140) + 30;
      hillsNear.fillTriangle(x, yBase, x + 140, yBase - peakOffset, x + 280, yBase);
    }
    hillsNear.setScrollFactor(0.55, 1);

    // --- Höhenprofil: Plattformen pro Sektion, RELATIV zur globalen Aufstiegs-Kurve ---
    // Eine "Sektion" ist alles zwischen zwei Bächen (oder Start/Ende). Pro
    // Sektion 7 Plattformen mit verschiedenen yOffsets — die ersten/letzten
    // sitzen exakt auf trendAt(x), damit Bäche sauber andocken. Die mittleren
    // bilden lokal einen "Hügel" über dem Trend.
    this.terrain = [];

    // Lokale Hügel-Pattern (relativ zum Trend). Erste & letzte Plattform = 0
    // damit der Trend an Bach-Rändern dominiert. Mittlere Werte = lokale
    // Aufschwünge (kleine Hügelkuppen auf dem Aufstieg).
    const heightPatterns = [
      [0, -35, -70, -100, -70, -35, 0],     // mittelhoher Hügel
      [0, -45, -85, -115, -85, -45, 0],     // hoher Hügel
      [0, -25, -55, -90,  -90, -55, -25],   // Plateau-Schwerpunkt (mitte hochgezogen)
      [0, -50, -95, -130, -95, -50, 0]      // sehr hoher Hügel
    ];
    const flatPattern = [0, 0, -30, -60, -60, -30, 0]; // sanfter Start

    for (let i = 0; i < sectStarts.length; i++) {
      const sStart = sectStarts[i];
      const sEnd = sectEnds[i];
      const sW = sEnd - sStart;
      // Spawn-Sektion (erste): flacherer Hügel, damit der Start nicht zu hart ist
      const pat = i === 0 ? flatPattern : heightPatterns[i % heightPatterns.length];
      const platCount = pat.length;
      const biome = this.biomeOfSection[i] || 0;
      for (let j = 0; j < platCount; j++) {
        const platStart = sStart + (sW * j) / platCount;
        const platEnd = sStart + (sW * (j + 1)) / platCount;
        // Mitte der Plattform → Trend dort sampeln
        const platMid = (platStart + platEnd) / 2;
        // pat[j] ist relative Hügel-Höhe ÜBER dem Trend (negativ = höher).
        // Min-Clamp auf 60 px verhindert, dass Plattformen aus dem Bild laufen.
        const topY = Math.max(60, this.trendAt(platMid) + pat[j]);
        this.terrain.push({
          start: platStart, end: platEnd,
          topY,
          sectionIndex: i,
          biome
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

    // --- Boden: biom-spezifische Visuals + Collider pro Plattform ---
    // Pro Biom eigene Farb-Tabelle für Erde, Top-Streifen (Gras/Schnee),
    // Schatten und Tuft-Akzente.
    const biomeGround = [
      // Wiese
      { earth: 0x4a3520, top: 0x6dbf47, shadow: 0x3a2510, tuft: 0x4a8a3a, tuftHi: 0x9adb6a },
      // Wald (dunkler Boden, dunkleres Grün, Tannenzapfen-Tupfer)
      { earth: 0x3a2812, top: 0x355c2a, shadow: 0x281906, tuft: 0x223a26, tuftHi: 0x4a6a3a },
      // Fels (Granit-Grau + Schnee-Top)
      { earth: 0x5a5862, top: 0xeef2f7, shadow: 0x36343c, tuft: 0x7a7882, tuftHi: 0xb8b6c0 }
    ];
    // --- Berg-Silhouette pro Sektion: eine geschlossene Polygon-Form, die
    // alle Plattform-Tops zu einer durchgehenden Bergmasse verbindet.
    // Eine pro Sektion → die Bäche zwischen Sektionen bleiben offen, dort
    // schimmert das Wasser-Rect durch.
    // Boden-Y muss tief genug sein, dass die Camera (auch wenn sie nach
    // unten scrollt) keinen Sky-Streifen unter dem Berg sieht.
    const EARTH_BOTTOM = GROUND_Y + 320;
    const silhouetteGfx = this.add.graphics().setDepth(-15);
    for (let i = 0; i < sectStarts.length; i++) {
      const sStart = sectStarts[i];
      const sEnd = sectEnds[i];
      const biome = this.biomeOfSection[i] || 0;
      const platsInSect = this.terrain.filter(p => p.sectionIndex === i);
      if (platsInSect.length === 0) continue;
      silhouetteGfx.fillStyle(biomeGround[biome].earth, 1);
      silhouetteGfx.beginPath();
      silhouetteGfx.moveTo(sStart, EARTH_BOTTOM);
      silhouetteGfx.lineTo(sStart, platsInSect[0].topY);
      for (const p of platsInSect) {
        silhouetteGfx.lineTo(p.start, p.topY);
        silhouetteGfx.lineTo(p.end, p.topY);
      }
      silhouetteGfx.lineTo(sEnd, EARTH_BOTTOM);
      silhouetteGfx.closePath();
      silhouetteGfx.fillPath();
    }

    // --- Top-Streifen + Tufts pro Plattform + Collider ---
    this.ground = this.physics.add.staticGroup();
    const groundGfx = this.add.graphics().setDepth(-10);
    // Farbe-Variationen pro Biom [base, lighter, darker]
    const topVariants = [
      [0x6dbf47, 0x7dcb55, 0x5aa83a],
      [0x355c2a, 0x4a7a3e, 0x274520],
      [0xeef2f7, 0xf5f7fa, 0xd0d8e0]
    ];
    // Stein-Farben pro Biom
    const stoneColors = [
      [0x6a6a6a, 0x7a7a7a, 0x5a5a5a],
      [0x4a3a2a, 0x5a4a3a, 0x3d2d1a],
      [0x5a5a62, 0x6e6e76, 0x4a4a54]
    ];
    for (const p of this.terrain) {
      const w = p.end - p.start;
      const g = biomeGround[p.biome];
      const tv = topVariants[p.biome];
      // Top-Streifen
      groundGfx.fillStyle(g.top);
      groundGfx.fillRect(p.start, p.topY, w, 14);
      // Farb-Patches auf dem Top-Streifen für Erdkrümel-Textur
      for (let i = 0; i < Math.floor(w / 18); i++) {
        const px = p.start + Math.random() * w;
        groundGfx.fillStyle(Math.random() < 0.5 ? tv[1] : tv[2], 1);
        groundGfx.fillCircle(px, p.topY + 4 + Math.random() * 6, 1 + Math.random() * 2);
      }
      // Schatten-Akzent unterm Top-Streifen
      groundGfx.fillStyle(g.shadow);
      groundGfx.fillRect(p.start, p.topY + 14, w, 4);
      // Tufts: Gras-Halme / Tannenzapfen / Steinchen
      for (let i = 0; i < Math.floor(w / 25); i++) {
        const gx = p.start + Math.random() * w;
        if (p.biome === 2) {
          groundGfx.fillStyle(g.tuft);
          groundGfx.fillCircle(gx, p.topY - 2, 2 + Math.random() * 2);
        } else {
          groundGfx.fillStyle(g.tuft);
          groundGfx.fillTriangle(gx, p.topY, gx + 4, p.topY - 8, gx + 8, p.topY);
        }
      }
      // Kleine Steine auf Plattformen (rein dekorativ)
      const sc = stoneColors[p.biome];
      for (let i = 0; i < Math.floor(1 + Math.random() * (p.biome === 2 ? 4 : 2)); i++) {
        const sx = p.start + 10 + Math.random() * Math.max(20, w - 20);
        const sr = 2 + Math.random() * 4;
        groundGfx.fillStyle(sc[Math.floor(Math.random() * sc.length)]);
        groundGfx.fillCircle(sx, p.topY - sr * 0.4, sr);
        groundGfx.fillStyle(0xffffff, 0.4);
        groundGfx.fillCircle(sx - sr * 0.25, p.topY - sr * 0.6, sr * 0.35);
      }
      // Biom-spezifische Extras
      if (p.biome === 0 && w > 70) {
        for (let m = 0; m < Math.floor(Math.random() * 2); m++) {
          const mx = p.start + 30 + Math.random() * (w - 60);
          groundGfx.fillStyle(0x5a4430, 1);
          groundGfx.fillCircle(mx, p.topY - 2, 3 + Math.random() * 2);
          groundGfx.fillStyle(0x4a3520);
          groundGfx.fillRect(mx - 2, p.topY - 1, 4, 2);
        }
      } else if (p.biome === 1 && w > 160) {
        for (let r = 0; r < Math.floor(1 + Math.random() * 1.5); r++) {
          const rx = p.start + 20 + Math.random() * (w - 80);
          groundGfx.lineStyle(1.5, 0x3d1a06, 0.7);
          groundGfx.beginPath();
          groundGfx.moveTo(rx, p.topY + 2);
          let cx = rx; let cy = p.topY + 2;
          for (let s = 0; s < 3 + Math.floor(Math.random() * 3); s++) {
            cx += 8 + Math.random() * 12;
            cy += (Math.random() < 0.5 ? 1 : -1);
            groundGfx.lineTo(cx, cy);
          }
          groundGfx.strokePath();
        }
      } else if (p.biome === 2 && w > 80) {
        for (let c = 0; c < 1 + Math.floor(Math.random() * 2); c++) {
          const cxA = p.start + 15 + Math.random() * (w - 30);
          groundGfx.lineStyle(1, 0x4a525c, 0.6);
          groundGfx.beginPath();
          groundGfx.moveTo(cxA, p.topY + 3);
          let cpx = cxA; let cpy = p.topY + 3;
          for (let s = 0; s < 2 + Math.floor(Math.random() * 2); s++) {
            cpx += (Math.random() - 0.5) * 10;
            cpy += 1 + Math.random() * 2;
            groundGfx.lineTo(cpx, cpy);
          }
          groundGfx.strokePath();
        }
      }
      // Statischer Collider — eine Box vom Plattform-Top bis Tal-Boden, damit
      // ein Spieler auch von der Seite nicht durchrutscht.
      const colliderH = (GROUND_Y + 80) - p.topY;
      const body = this.add.rectangle(p.start + w / 2, p.topY + colliderH / 2,
        w, colliderH, 0, 0);
      this.physics.add.existing(body, true);
      this.ground.add(body);
    }

    // --- Foreground-Dekoration pro Biom ---
    // Wiese: Blumen-Tupfer. Wald: Tannen am Plattform-Rand.
    // Fels: Schnee-Häufchen + vereinzelte Steine.
    const decoGfx = this.add.graphics().setDepth(-5);
    for (const p of this.terrain) {
      const w = p.end - p.start;
      if (w < 60) continue;
      if (p.biome === 0) {
        // Wiesen-Blumen (gelbe + rote Tupfer)
        const flowers = Math.floor(w / 80);
        for (let k = 0; k < flowers; k++) {
          const fx = p.start + 20 + Math.random() * (w - 40);
          decoGfx.fillStyle(Math.random() < 0.5 ? 0xf4c842 : 0xc94f4f);
          decoGfx.fillCircle(fx, p.topY - 4, 2);
          decoGfx.fillStyle(0x6dbf47);
          decoGfx.fillRect(fx - 0.5, p.topY - 4, 1, 4);
        }
      } else if (p.biome === 1) {
        // Wald: Tannen (3-5 pro Plattform, je nach Breite)
        const trees = Math.max(2, Math.floor(w / 180));
        for (let k = 0; k < trees; k++) {
          const tx = p.start + 30 + (k + 0.5) * (w / trees) - 30;
          const baseY = p.topY;
          // Stamm
          decoGfx.fillStyle(0x3d1a06);
          decoGfx.fillRect(tx - 4, baseY - 30, 8, 30);
          // Krone in 3 Etagen (Tannen-Look)
          decoGfx.fillStyle(0x1f3a1f);
          decoGfx.fillTriangle(tx - 24, baseY - 30, tx, baseY - 80, tx + 24, baseY - 30);
          decoGfx.fillStyle(0x2a4a28);
          decoGfx.fillTriangle(tx - 20, baseY - 50, tx, baseY - 95, tx + 20, baseY - 50);
          decoGfx.fillStyle(0x355c2a);
          decoGfx.fillTriangle(tx - 16, baseY - 70, tx, baseY - 110, tx + 16, baseY - 70);
        }
      } else {
        // Fels-Gipfel: Schnee-Häufchen + ein bis zwei größere Felsen
        const drifts = Math.floor(w / 90);
        for (let k = 0; k < drifts; k++) {
          const sx = p.start + 30 + Math.random() * (w - 60);
          decoGfx.fillStyle(0xffffff);
          decoGfx.fillCircle(sx, p.topY - 2, 4 + Math.random() * 4);
        }
        if (Math.random() < 0.5 && w > 140) {
          const fx = p.start + w / 2;
          decoGfx.fillStyle(0x4a525c);
          decoGfx.fillCircle(fx, p.topY - 12, 14);
          decoGfx.fillStyle(0x6e7a85);
          decoGfx.fillCircle(fx - 4, p.topY - 16, 8);
          decoGfx.fillStyle(0xffffff);
          decoGfx.fillCircle(fx + 2, p.topY - 22, 4);
        }
      }
    }

    // --- Wasser-Partikel-Texturen ---
    if (!this.textures.exists('splash-particle')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff); g.fillCircle(2, 2, 2);
      g.fillStyle(0xc0e0f0); g.fillCircle(5, 5, 1.5);
      g.fillStyle(0x80c0e0); g.fillCircle(7, 2, 1.5);
      g.fillStyle(0x60a0c0); g.fillCircle(2, 7, 1);
      g.generateTexture('splash-particle', 9, 9);
      g.destroy();
    }
    if (!this.textures.exists('bubble-particle')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x80c8e0); g.fillCircle(2, 2, 2);
      g.fillStyle(0xffffff, 0.6); g.fillCircle(3, 1, 0.5);
      g.generateTexture('bubble-particle', 4, 4);
      g.destroy();
    }

    // Bach-Visuals: Wasserlinie hängt am TIEFER gelegenen Anrainer (größerer Y),
    // damit der Bach nie über der Plattform-Kante schwebt. Pro Bach speichern
    // wir waterTop für die Wasser-Detection in update().
    // Bach-Bett-Erde unter dem Wasser, damit unter dem Bach kein Sky-Loch
    // klafft (zwischen den Sektion-Silhouetten).
    const bedGfx = this.add.graphics().setDepth(-14);
    for (const g of gaps) {
      const gw = g.end - g.start;
      const leftY = this.topYAt(g.start - 1);
      const rightY = this.topYAt(g.end + 1);
      const waterTop = Math.max(leftY, rightY);
      g.waterTop = waterTop;
      // Bach-Bett: dunkle Erde von waterTop bis Welt-Boden
      bedGfx.fillStyle(0x2a1a0d, 1);
      bedGfx.fillRect(g.start, waterTop, gw, EARTH_BOTTOM - waterTop);
      // Erde-Seitenwände — Klippe zwischen Plattform-Kante und Wasserlinie
      // (greift nur, wenn die zwei Anrainer unterschiedlich hoch sind)
      groundGfx.fillStyle(0x2d1f12);
      groundGfx.fillRect(g.start - 4, leftY, 4, Math.max(80, waterTop - leftY + 80));
      groundGfx.fillRect(g.end, rightY, 4, Math.max(80, waterTop - rightY + 80));
      // Wasser
      const water = this.add.rectangle(g.start + gw / 2, waterTop + 40, gw, 80, 0x3a7aa8, 0.95);
      water.setStrokeStyle(2, 0x6da3c8);
      // Schaum-Streifen oben
      const foam = this.add.rectangle(g.start + gw / 2, waterTop + 4, gw, 6, 0xa0d8e8);
      this.tweens.add({
        targets: foam, alpha: 0.5, yoyo: true,
        duration: 700, repeat: -1, ease: 'Sine.inOut'
      });
      // Wellenlinien auf der Wasseroberfläche
      const waterGfx = this.add.graphics().setDepth(-3);
      for (let wl = 0; wl < 3; wl++) {
        const wlY = waterTop + 10 + wl * 18;
        const wlX = g.start + 10 + Math.random() * 20;
        const wlW = gw - 20 - Math.random() * 30;
        waterGfx.lineStyle(1.5, 0xc0e8f0, 0.3 + wl * 0.08);
        waterGfx.beginPath();
        waterGfx.moveTo(wlX, wlY);
        for (let ws = 0; ws < 4; ws++) {
          waterGfx.lineTo(wlX + (ws + 0.5) * (wlW / 4), wlY + (Math.random() < 0.5 ? -3 : 3));
          waterGfx.lineTo(wlX + (ws + 1) * (wlW / 4), wlY);
        }
        waterGfx.strokePath();
        this.tweens.add({
          targets: waterGfx, x: 5 + Math.random() * 3, yoyo: true,
          duration: 1200 + wl * 300, repeat: -1, ease: 'Sine.inOut'
        });
      }
      // Spritzwasser-Partikel am Schaumrand
      this.add.particles(g.start + gw / 2, waterTop + 2, 'splash-particle', {
        speedX: { min: -12, max: 12 },
        speedY: { min: -40, max: -80 },
        lifespan: { min: 600, max: 1000 },
        scale: { start: 0.4, end: 0.15 },
        alpha: { start: 0.7, end: 0 },
        frequency: 90,
        quantity: 2,
      });
      // Aufsteigende Luftbläschen im Wasser
      this.add.particles(g.start + gw / 2, waterTop + 60, 'bubble-particle', {
        speedX: { min: -6, max: 6 },
        speedY: { min: -20, max: -40 },
        lifespan: { min: 1500, max: 2500 },
        scale: { start: 0.5, end: 0.3 },
        alpha: { start: 0.5, end: 0 },
        frequency: 160,
        quantity: 1,
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

    // Power-up: Staminaschutz (Wanderstab-Symbol)
    if (!this.textures.exists('powerup-stamina')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xf4c842); g.fillCircle(16, 16, 15);
      g.fillStyle(0xfff3a0); g.fillCircle(16, 16, 10);
      g.fillStyle(0xe8a04e); g.fillCircle(16, 16, 5);
      g.fillStyle(0x6b3520, 1);
      g.fillRect(11, 8, 3, 17);
      g.fillRect(8, 10, 9, 3);
      g.generateTexture('powerup-stamina', 32, 32);
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
    // Flacher Felsbrocken (Option C): überspringbar, weniger Sichtblock als stone-big
    if (!this.textures.exists('stone-low')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0x2a1c10); g.fillEllipse(44, 21, 86, 24);
      g.fillStyle(0x5a4a3a); g.fillEllipse(44, 18, 80, 18);
      g.fillStyle(0x7a6a5a); g.fillEllipse(28, 14, 22, 8);
      g.fillStyle(0x4a8a3a, 0.85);
      g.fillEllipse(52, 13, 34, 9);
      g.fillStyle(0x3a3a30); g.fillRect(58, 16, 4, 5);
      g.generateTexture('stone-low', 88, 32);
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

    // Brauer-NPC (Wirt vor der Brauerei: Schürze, Hemd, Bierkrug)
    if (!this.textures.exists('brewer-npc')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      // Beine
      g.fillStyle(0x3a2510); g.fillRect(5, 28, 7, 14); g.fillRect(14, 28, 7, 14);
      // Körper (weißes Hemd)
      g.fillStyle(0xfef3d4); g.fillRect(3, 14, 20, 16);
      // Schürze (braun, vorne)
      g.fillStyle(0x8a4a2a); g.fillRect(6, 16, 14, 14);
      // Arme
      g.fillStyle(0xfef3d4); g.fillRect(0, 14, 4, 12); g.fillRect(22, 14, 4, 12);
      // Hand mit Bierkrug rechts
      g.fillStyle(0xf4c842); g.fillRect(22, 10, 8, 10);
      g.fillStyle(0x3d1a06); g.fillRect(23, 9, 6, 2);
      // Kopf
      g.fillStyle(0xf0c090); g.fillCircle(13, 10, 10);
      // Augen
      g.fillStyle(0x3a2510); g.fillCircle(10, 9, 2); g.fillCircle(16, 9, 2);
      // Lächeln
      g.fillStyle(0x8a4a2a); g.fillRect(9, 13, 8, 2);
      // Haare (dunkel oben)
      g.fillStyle(0x3a2510); g.fillRect(4, 2, 18, 5);
      g.generateTexture('brewer-npc', 32, 42);
      g.destroy();
    }

    // Liegender Baumstamm (Wald-Hindernis, muss übersprungen werden)
    if (!this.textures.exists('tree-trunk')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      // Hauptkörper Holz
      g.fillStyle(0x7a4a22); g.fillRect(0, 4, 90, 20);
      // Rinde-Linien (Maserung)
      g.fillStyle(0x5a3212);
      for (let lx = 10; lx < 86; lx += 14) {
        g.fillRect(lx, 5, 2, 18);
      }
      // Aststumpf links (Querschnitt)
      g.fillStyle(0x5a3212); g.fillCircle(5, 14, 8);
      g.fillStyle(0x9a6a42); g.fillCircle(5, 14, 6);
      g.fillStyle(0xb48a62); g.fillCircle(5, 14, 3);
      // Aststumpf rechts
      g.fillStyle(0x5a3212); g.fillCircle(85, 14, 8);
      g.fillStyle(0x9a6a42); g.fillCircle(85, 14, 6);
      g.fillStyle(0xb48a62); g.fillCircle(85, 14, 3);
      // Moos oben
      g.fillStyle(0x3a6a2a, 0.7); g.fillRect(8, 4, 74, 5);
      g.generateTexture('tree-trunk', 90, 28);
      g.destroy();
    }

    // Baum-Blocker (Ende Wald-Sektion 2 — kooperativ umwerfen).
    // RIESIG: 220×640 px. Trampolin-Apex liegt bei vy=-1180 / g=1400 nur
    // ~500 px über der Plattform — der Baum überragt das, also unmöglich
    // einfach drüberzuhüpfen. Origin per setOrigin(0.5, 1) am Fuß.
    if (!this.textures.exists('tree-blocker')) {
      const TW = 220, TH = 640;
      const TRUNK_H = 200;
      const CROWN_BOTTOM = TH - 20;     // unten leicht in den Stamm rein
      const CROWN_TOP_Y = 0;            // ganz oben in der Textur
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      // Stamm
      g.fillStyle(0x3d1a06); g.fillRect(TW / 2 - 36, TH - TRUNK_H, 72, TRUNK_H);
      g.fillStyle(0x5a3010); g.fillRect(TW / 2 - 28, TH - TRUNK_H, 56, TRUNK_H);
      g.fillStyle(0x7a4a20); g.fillRect(TW / 2 - 12, TH - TRUNK_H, 12, TRUNK_H);
      // Krone in 6 überlappenden Tannen-Etagen, von unten breit nach oben schmal
      const tiers = 6;
      const baseW = TW;
      const tipW = 22;
      for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const w = baseW * (1 - t) + tipW * t;
        const yBottom = CROWN_BOTTOM - t * (CROWN_BOTTOM - 80);
        const yTop = yBottom - (CROWN_BOTTOM / tiers) - 80;
        const colors = [0x1c321c, 0x223a22, 0x294a28, 0x325a30, 0x3a6a36, 0x457a3e];
        g.fillStyle(colors[i]);
        g.fillTriangle(TW / 2 - w / 2, yBottom, TW / 2, Math.max(yTop, CROWN_TOP_Y), TW / 2 + w / 2, yBottom);
      }
      // Schnee-Spitze
      g.fillStyle(0xfef3d4);
      g.fillTriangle(TW / 2 - 8, 22, TW / 2, 2, TW / 2 + 8, 22);
      g.generateTexture('tree-blocker', TW, TH);
      g.destroy();
    }

    // Trampolin-Pilz (rote Kappe mit weißen Punkten + heller Stiel)
    if (!this.textures.exists('mushroom-trampoline')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      // Stiel
      g.fillStyle(0xfef3d4); g.fillRect(20, 28, 14, 16);
      g.fillStyle(0xc4b8a0); g.fillRect(20, 40, 14, 4);
      // Kappe (Halbkreis-Look)
      g.fillStyle(0x8a2828); g.fillCircle(27, 25, 24);
      g.fillStyle(0xc94f4f); g.fillCircle(27, 23, 23);
      g.fillStyle(0xe87575); g.fillCircle(20, 16, 8);
      // Weiße Punkte
      g.fillStyle(0xffffff);
      g.fillCircle(14, 22, 3);
      g.fillCircle(34, 22, 3);
      g.fillCircle(28, 11, 2.5);
      g.fillCircle(40, 18, 2);
      // Boden-Streifen unten unter Kappe abdecken
      g.fillStyle(0xfef3d4);
      g.fillRect(0, 28, 54, 2);
      g.generateTexture('mushroom-trampoline', 54, 44);
      g.destroy();
    }
    // Psychedelic-Sammelpilz (lila Kappe, heller Stiel)
    if (!this.textures.exists('mushroom-psy')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xc8a0e8); g.fillRect(10, 22, 12, 12);
      g.fillStyle(0x7a3a9a); g.fillCircle(16, 18, 14);
      g.fillStyle(0xa060c8); g.fillCircle(16, 16, 12);
      g.fillStyle(0xffffff); g.fillCircle(11, 14, 2); g.fillCircle(20, 12, 2); g.fillCircle(18, 19, 1.5);
      g.fillStyle(0xffee88); g.fillCircle(14, 10, 2);
      g.generateTexture('mushroom-psy', 32, 34);
      g.destroy();
    }
    // Kleine Waldboden-/Wiesen-Pilze — nur Deko (kein Pickup, kein Physics-Body)
    if (!this.textures.exists('mushroom-ground-decor')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xe8dcc8);
      g.fillRect(8, 18, 8, 12);
      g.fillStyle(0xc4a882);
      g.fillRect(8, 26, 8, 3);
      g.fillStyle(0x5a3820);
      g.fillEllipse(12, 16, 18, 14);
      g.fillStyle(0x7a5030);
      g.fillEllipse(12, 14, 16, 12);
      g.fillStyle(0xa07050);
      g.fillEllipse(9, 11, 6, 5);
      g.generateTexture('mushroom-ground-decor', 24, 32);
      g.destroy();
    }
    // Killer-Eichhörnchen — große lesbare Silhouette (48×42)
    if (!this.textures.exists('enemy-squirrel')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      // buschiger Schwanz oben-links
      g.fillStyle(0x4a2a0a); g.fillCircle(10, 10, 14);
      g.fillStyle(0x7a4a22); g.fillCircle(12, 8, 11);
      g.fillStyle(0xa07040); g.fillCircle(14, 6, 7);
      // Körper
      g.fillStyle(0x5a3a18); g.fillEllipse(30, 26, 22, 18);
      g.fillStyle(0x9a6a3a); g.fillEllipse(30, 24, 18, 14);
      // Bauch hell
      g.fillStyle(0xc4a878); g.fillEllipse(32, 26, 10, 9);
      // Kopf
      g.fillStyle(0x8a5a2a); g.fillCircle(38, 14, 10);
      g.fillStyle(0x6a4a1a); g.fillCircle(36, 12, 3); g.fillCircle(41, 12, 3);
      // Ohren
      g.fillStyle(0x7a4a22); g.fillTriangle(32, 6, 28, 14, 36, 12);
      g.fillStyle(0x7a4a22); g.fillTriangle(42, 4, 38, 12, 44, 12);
      // böse Augen
      g.fillStyle(0xffffff); g.fillCircle(35, 13, 3); g.fillCircle(41, 13, 3);
      g.fillStyle(0xc00000); g.fillCircle(35, 13, 1.5); g.fillCircle(41, 13, 1.5);
      // Zähne
      g.fillStyle(0xfff8e8); g.fillRect(34, 18, 3, 4); g.fillRect(38, 18, 3, 4);
      g.fillStyle(0x2a1a08); g.fillRect(33, 17, 10, 1);
      // Pfoten
      g.fillStyle(0x5a3a18); g.fillEllipse(22, 38, 8, 5); g.fillEllipse(36, 38, 8, 5);
      g.generateTexture('enemy-squirrel', 48, 42);
      g.destroy();
    }
    // Wildschwein — Wald (56×48), Keiler-Silhouette
    if (!this.textures.exists('enemy-boar')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const bristle = 0x2a1810;
      const body = 0x4a3428;
      const hi = 0x6a5040;
      // Beine / Hufe
      g.fillStyle(0x1a1008);
      g.fillEllipse(16, 44, 9, 6);
      g.fillEllipse(34, 44, 9, 6);
      g.fillStyle(body);
      g.fillRect(13, 34, 7, 12);
      g.fillRect(31, 34, 7, 12);
      // Rumpf
      g.fillStyle(body);
      g.fillEllipse(26, 30, 28, 20);
      g.fillStyle(hi);
      g.fillEllipse(22, 30, 12, 14);
      // Borsten-Rücken
      g.fillStyle(bristle);
      for (let i = 0; i < 7; i++) {
        const bx = 8 + i * 5;
        g.fillTriangle(bx, 16, bx - 2, 26, bx + 2, 24);
      }
      // Kopf / Nacken
      g.fillStyle(body);
      g.fillEllipse(42, 28, 18, 16);
      g.fillStyle(0x3a2820);
      g.fillEllipse(48, 30, 10, 9);
      // Stoßzähne
      g.fillStyle(0xf2e8d8);
      g.fillTriangle(50, 32, 54, 36, 48, 36);
      g.fillTriangle(44, 33, 40, 37, 46, 36);
      // kleines Auge
      g.fillStyle(0x1a1010);
      g.fillCircle(40, 26, 2);
      g.fillStyle(0xff6040);
      g.fillCircle(40, 26, 1);
      g.generateTexture('enemy-boar', 56, 48);
      g.destroy();
    }
    // Alt-Wanderer — Wiese (64×102): eine durchgehende Silhouette (große Überlappungen, keine Lücken)
    if (!this.textures.exists('enemy-hiker')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const skin = 0xe8c4a0;
      const skinHi = 0xf2d8b8;
      const skinLo = 0xc9a080;
      const hat = 0x5a5048;
      const hatHi = 0x6a6058;
      const vest = 0x3a5a42;
      const vestHi = 0x4a6a52;
      const pants = 0x3a4558;
      const pantsHi = 0x4a5568;
      // Stock zuerst (liegt hinter der Figur, Hand klebt drüber)
      g.fillStyle(0x4a3220);
      g.fillTriangle(5, 76, 11, 28, 15, 30);
      g.fillTriangle(11, 28, 15, 30, 13, 76);
      g.fillStyle(0x6a4a30);
      g.fillCircle(11, 27, 4);
      // Eine große Körper-Kapsel: Schulter bis Fuß (überlappt alles)
      g.fillStyle(pants);
      g.fillEllipse(32, 68, 28, 56);
      g.fillStyle(pantsHi);
      g.fillEllipse(28, 72, 10, 36);
      g.fillEllipse(36, 72, 10, 36);
      // Weste legt sich großzügig über den Oberkörper und in die Hose rein (≥12 px Überlappung)
      g.fillStyle(vest);
      g.fillEllipse(32, 50, 30, 42);
      g.fillStyle(vestHi);
      g.fillEllipse(32, 52, 14, 28);
      // Arme: Ellipsen schneiden den Torso (Mittelpunkte nach innen)
      g.fillStyle(vest);
      g.fillEllipse(16, 52, 16, 28);
      g.fillEllipse(48, 52, 16, 28);
      g.fillStyle(skin);
      g.fillCircle(10, 62, 6);
      g.fillCircle(54, 62, 6);
      // Schuhe kleben an der Unterkörper-Kapsel
      g.fillStyle(0x2a1a10);
      g.fillEllipse(24, 98, 13, 7);
      g.fillEllipse(40, 98, 13, 7);
      g.fillStyle(pants);
      g.fillEllipse(24, 94, 10, 8);
      g.fillEllipse(40, 94, 10, 8);
      // Flachmann auf der Seite (auf der Weste)
      g.fillStyle(0x5a5048);
      g.fillEllipse(50, 58, 8, 11);
      g.fillStyle(0x8a7a68);
      g.fillEllipse(50, 56, 4, 6);
      // Kopf groß genug, dass er in die Weste eintaucht (kein Hals-Spalt)
      g.fillStyle(skin);
      g.fillCircle(32, 34, 14);
      g.fillStyle(skinLo);
      g.fillEllipse(32, 38, 18, 10);
      g.fillStyle(skinHi);
      g.fillEllipse(30, 32, 7, 6);
      // Bart verbindet Kinn und Oberkörper
      g.fillStyle(0xc8c4c0);
      g.fillEllipse(32, 46, 18, 12);
      g.fillStyle(0xa8a4a0);
      g.fillEllipse(32, 48, 12, 7);
      // Hut: Krempe ragt weit über den Kopf, Kuppe überlappt die Krempe
      g.fillStyle(hatHi);
      g.fillEllipse(32, 24, 26, 9);
      g.fillStyle(hat);
      g.fillEllipse(32, 17, 24, 14);
      g.fillStyle(0x3a3028);
      g.fillEllipse(32, 22, 22, 5);
      // Augen
      g.fillStyle(0xffffff);
      g.fillCircle(27, 32, 3);
      g.fillCircle(37, 32, 3);
      g.fillStyle(0x2a1a08);
      g.fillCircle(27, 32, 1.5);
      g.fillCircle(37, 32, 1.5);
      g.generateTexture('enemy-hiker', 64, 102);
      g.destroy();
    }
    // Bier-Bär — Gipfel (80×120): eine zusammenhängende Masse, Hose + Rumpf + Kopf stark überlappend
    if (!this.textures.exists('enemy-bear')) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      const fur = 0x5a3a18;
      const furMid = 0x7a5a2a;
      const furHi = 0x9a6a3a;
      const belly = 0xc4a878;
      const furDark = 0x3a2810;
      const hose = 0x4a6b2a;
      const hoseHi = 0x5d8a38;
      // Unterkörper + Hose als eine breite Form, geht weit in den Rumpf hinein
      g.fillStyle(hose);
      g.fillEllipse(40, 100, 38, 28);
      g.fillStyle(hoseHi);
      g.fillEllipse(40, 96, 22, 14);
      // Tatzen (überlappen Hose unten)
      g.fillStyle(furDark);
      g.fillEllipse(26, 116, 15, 9);
      g.fillEllipse(54, 116, 15, 9);
      g.fillStyle(fur);
      g.fillEllipse(26, 112, 11, 7);
      g.fillEllipse(54, 112, 11, 7);
      // Großer Rumpf — Mittelpunkt tiefer, damit er die Hose oben vollständig überdeckt
      g.fillStyle(furDark);
      g.fillEllipse(40, 76, 36, 52);
      g.fillStyle(fur);
      g.fillEllipse(40, 72, 34, 48);
      g.fillStyle(furMid);
      g.fillEllipse(38, 70, 22, 34);
      g.fillStyle(belly);
      g.fillEllipse(40, 74, 20, 28);
      // Hosenträger (kurz, nur im überlappenden Bereich Rumpf–Hose)
      g.fillStyle(0x4a3020);
      g.fillTriangle(36, 78, 32, 96, 40, 96);
      g.fillTriangle(44, 78, 40, 96, 48, 96);
      // Arme: weiter nach innen, damit sie am Körper „kleben“
      g.fillStyle(fur);
      g.fillEllipse(18, 74, 16, 28);
      g.fillEllipse(62, 72, 16, 30);
      g.fillStyle(furHi);
      g.fillEllipse(20, 72, 9, 18);
      g.fillEllipse(60, 70, 9, 20);
      // Krug in der vorderen Tatze (überlappt Arm)
      g.fillStyle(0xc4a04a);
      g.fillEllipse(66, 64, 16, 20);
      g.fillStyle(0xa08040);
      g.fillEllipse(66, 54, 11, 7);
      g.fillStyle(0xf4e8a8);
      g.fillEllipse(66, 62, 9, 11);
      g.fillStyle(furDark);
      g.fillEllipse(70, 72, 9, 8);
      // Kopf taucht weit in den Brust-Blob ein
      g.fillStyle(fur);
      g.fillCircle(40, 40, 18);
      g.fillStyle(furMid);
      g.fillEllipse(50, 42, 15, 13);
      g.fillStyle(furDark);
      g.fillEllipse(54, 44, 9, 8);
      g.fillStyle(0x2a1810);
      g.fillEllipse(56, 44, 4, 3);
      // Ohren (Basis überlappt Kopfkreis)
      g.fillStyle(fur);
      g.fillTriangle(24, 28, 19, 40, 30, 38);
      g.fillTriangle(56, 26, 51, 38, 61, 36);
      g.fillStyle(0x6a4a2a);
      g.fillTriangle(26, 30, 23, 38, 30, 36);
      g.fillTriangle(54, 28, 51, 36, 58, 34);
      // Augen wie Eichhörnchen
      g.fillStyle(0xffffff);
      g.fillCircle(34, 38, 3.5);
      g.fillCircle(46, 38, 3.5);
      g.fillStyle(0xc00000);
      g.fillCircle(34, 38, 1.8);
      g.fillCircle(46, 38, 1.8);
      g.generateTexture('enemy-bear', 80, 120);
      g.destroy();
    }

    // --- Brauerei-Checkpoints: auf dem höchsten Plateau ihrer Sektion ---
    // Jede Brauerei ist eine kompakte Holzhütte mit NPC-Wirt, Schild und Fässern.
    this.breweries = [];
    const brewNames  = ['Klosterbräu', 'Hopfenglück', 'Maibockstube', 'Gerstensaft'];
    const brewColors = [0xc4a05a,      0x6dbf47,      0xe88a3a,       0xf4c842];

    // Helper: zeichnet eine Mini-Brauerei-Hütte (Breite ~110, Höhe ~90)
    const drawBreweryHut = (hx, baseY, accentColor) => {
      const hgfx = this.add.graphics().setDepth(12);
      // Holzwand
      hgfx.fillStyle(0x8a4a2a, 1);
      hgfx.fillRect(hx - 55, baseY - 90, 110, 90);
      // Vertikal-Balken
      hgfx.fillStyle(0x6b3520, 1);
      for (let lx = -45; lx <= 45; lx += 22) {
        hgfx.fillRect(hx + lx, baseY - 90, 2, 90);
      }
      // Tür
      hgfx.fillStyle(0x3d1a06, 1);
      hgfx.fillRect(hx - 12, baseY - 50, 24, 50);
      hgfx.fillStyle(accentColor, 1);
      hgfx.fillCircle(hx + 6, baseY - 25, 2);
      // Fenster links
      hgfx.fillStyle(0x3d1a06, 1);
      hgfx.fillRect(hx - 44, baseY - 76, 22, 20);
      hgfx.fillStyle(0xfde4a0, 1);
      hgfx.fillRect(hx - 42, baseY - 74, 18, 16);
      hgfx.fillStyle(0x3d1a06, 1);
      hgfx.fillRect(hx - 43, baseY - 67, 20, 2);
      hgfx.fillRect(hx - 34, baseY - 75, 2, 18);
      // Dach (Spitzgiebel)
      hgfx.fillStyle(0x4a2510, 1);
      hgfx.fillTriangle(hx - 70, baseY - 90, hx, baseY - 155, hx + 70, baseY - 90);
      hgfx.fillStyle(0x3d1a06, 1);
      hgfx.fillRect(hx - 72, baseY - 93, 144, 6);
      // Kleiner Schornstein
      hgfx.fillStyle(0x6b6b6b, 1);
      hgfx.fillRect(hx + 28, baseY - 145, 14, 40);
      hgfx.fillStyle(0x4a4a4a, 1);
      hgfx.fillRect(hx + 25, baseY - 148, 20, 6);
      // 2 statische Rauch-Wölkchen
      const s1 = this.add.circle(hx + 35, baseY - 155, 5, 0xe8e2d4, 0.6).setDepth(13);
      const s2 = this.add.circle(hx + 40, baseY - 168, 7, 0xe8e2d4, 0.5).setDepth(13);
      // Mini-Fässer am Eingang
      const drawSmallBarrel = (bx) => {
        hgfx.fillStyle(0x6b3520, 1); hgfx.fillRect(bx - 10, baseY - 34, 20, 34);
        hgfx.fillStyle(0x3d1a06, 1);
        hgfx.fillRect(bx - 11, baseY - 34, 22, 3);
        hgfx.fillRect(bx - 11, baseY - 20, 22, 2);
        hgfx.fillRect(bx - 11, baseY - 6, 22, 3);
        hgfx.fillStyle(accentColor, 1); hgfx.fillRect(bx - 7, baseY - 26, 14, 6);
      };
      drawSmallBarrel(hx - 75);
      drawSmallBarrel(hx + 75);

      return { smoke1: s1, smoke2: s2 };
    };

    // Sektionen 0..3 bekommen je eine Brauerei (Sektion 4 endet im Ziel)
    for (let i = 0; i < 4; i++) {
      // Höchstes Plateau in dieser Sektion finden
      const inSection = this.terrain.filter(p => p.sectionIndex === i);
      let highest = inSection[0];
      for (const p of inSection) if (p.topY < highest.topY) highest = p;
      // Brauerei-X in der Mitte des höchsten Plateaus
      const x = (highest.start + highest.end) / 2;
      const baseY = highest.topY;
      const accent = brewColors[i];

      // Hütte zeichnen
      drawBreweryHut(x, baseY, accent);

      // NPC-Wirt vor der Hütte
      const npc = this.add.image(x + 65, baseY - 21, 'brewer-npc').setDepth(13);
      // Sanftes Idle-Bobbing
      this.tweens.add({
        targets: npc, y: npc.y - 2, yoyo: true,
        duration: 1400, repeat: -1, ease: 'Sine.inOut'
      });

      // Pfosten zuerst: von unter dem Schild bis zur Plateau-Kante (baseY)
      const signCenterY = baseY - 100;
      const signHalfH = 19;
      const postTop = signCenterY + signHalfH;
      const postH = Math.max(8, baseY - postTop);
      const postCy = postTop + postH / 2;
      this.add.rectangle(x + 110, postCy, 6, postH, 0x3d1a06).setDepth(11);
      // Schild rechts neben der Hütte
      const signBg = this.add.rectangle(x + 110, signCenterY, 110, 38, 0x6b2e0c).setDepth(13);
      signBg.setStrokeStyle(3, accent);
      const signLabel = this.add.text(x + 110, signCenterY, '🍺 ' + brewNames[i], {
        fontFamily: 'Bungee, sans-serif', fontSize: '14px',
        color: '#' + accent.toString(16).padStart(6, '0')
      }).setOrigin(0.5).setDepth(14);

      this.breweries.push({
        x, name: brewNames[i],
        plateau: highest,
        accent,
        npc,
        signObjects: [signBg, signLabel]
      });
    }

    // --- Gipfelbräu (Ziel) — richtige Holzhütte mit Bühne, Schornstein, Fässern ---
    const goalX = LEVEL_WIDTH - 200;
    this.goalX = goalX;
    // Szene-Instanz wird bei scene.start wiederverwendet — beide Flags
    // zurücksetzen, sonst blockiert z. B. spawnRollingStone nach Game Over.
    this.gameWon = false;
    this.gameLost = false;
    // Startzeit fürs Highscore-Panel — Phaser-internes ms-Clock
    this.levelStartTime = this.time.now;
    const goalBaseY = this.topYAt(goalX);

    // Bühne (Holzdielen quer vor der Hütte)
    const hutGfx = this.add.graphics().setDepth(15);
    hutGfx.fillStyle(0x6b3520, 1);
    hutGfx.fillRect(goalX - 200, goalBaseY - 10, 400, 12);
    hutGfx.fillStyle(0x4a2510, 1);
    for (let dx = -195; dx <= 195; dx += 30) {
      hutGfx.fillRect(goalX + dx, goalBaseY - 9, 2, 10);
    }

    // Hütten-Wand (Holzbalken-Optik)
    hutGfx.fillStyle(0x8a4a2a, 1);
    hutGfx.fillRect(goalX - 100, goalBaseY - 145, 200, 145);
    hutGfx.fillStyle(0x6b3520, 1);
    for (let lx = -90; lx <= 90; lx += 30) {
      hutGfx.fillRect(goalX + lx, goalBaseY - 145, 2, 145);
    }
    // Tür
    hutGfx.fillStyle(0x3d1a06, 1);
    hutGfx.fillRect(goalX - 14, goalBaseY - 60, 28, 60);
    hutGfx.fillStyle(0xf4c842, 1);
    hutGfx.fillCircle(goalX + 8, goalBaseY - 30, 2);
    // Fenster (warm leuchtend, mit Sprosse)
    hutGfx.fillStyle(0x3d1a06, 1);
    hutGfx.fillRect(goalX - 65, goalBaseY - 115, 26, 26);
    hutGfx.fillRect(goalX + 39, goalBaseY - 115, 26, 26);
    hutGfx.fillStyle(0xfde4a0, 1);
    hutGfx.fillRect(goalX - 62, goalBaseY - 112, 20, 20);
    hutGfx.fillRect(goalX + 42, goalBaseY - 112, 20, 20);
    hutGfx.fillStyle(0x3d1a06, 1);
    hutGfx.fillRect(goalX - 63, goalBaseY - 103, 22, 2);
    hutGfx.fillRect(goalX - 53, goalBaseY - 113, 2, 22);
    hutGfx.fillRect(goalX + 41, goalBaseY - 103, 22, 2);
    hutGfx.fillRect(goalX + 51, goalBaseY - 113, 2, 22);

    // Dach (zwei Triangles ergeben ein Trapez/Spitzgiebel)
    hutGfx.fillStyle(0x4a2510, 1);
    hutGfx.fillTriangle(
      goalX - 130, goalBaseY - 145,
      goalX, goalBaseY - 230,
      goalX + 130, goalBaseY - 145
    );
    hutGfx.fillStyle(0x3d1a06, 1);
    hutGfx.fillRect(goalX - 132, goalBaseY - 148, 264, 6);

    // Schornstein
    hutGfx.fillStyle(0x6b6b6b, 1);
    hutGfx.fillRect(goalX + 50, goalBaseY - 210, 18, 50);
    hutGfx.fillStyle(0x4a4a4a, 1);
    hutGfx.fillRect(goalX + 46, goalBaseY - 215, 26, 7);
    // Stein-Akzente am Schornstein
    hutGfx.fillStyle(0x4a4a4a, 1);
    hutGfx.fillRect(goalX + 53, goalBaseY - 195, 6, 4);
    hutGfx.fillRect(goalX + 60, goalBaseY - 180, 6, 4);

    // Bierfässer (links und rechts der Tür auf der Bühne)
    const drawBarrel = (bx) => {
      hutGfx.fillStyle(0x6b3520, 1);
      hutGfx.fillRect(bx - 16, goalBaseY - 50, 32, 50);
      hutGfx.fillStyle(0x3d1a06, 1);
      hutGfx.fillRect(bx - 17, goalBaseY - 50, 34, 4);
      hutGfx.fillRect(bx - 17, goalBaseY - 30, 34, 3);
      hutGfx.fillRect(bx - 17, goalBaseY - 10, 34, 4);
      hutGfx.fillStyle(0xf4c842, 1);
      hutGfx.fillRect(bx - 12, goalBaseY - 38, 24, 8);
    };
    drawBarrel(goalX - 145);
    drawBarrel(goalX - 110);
    drawBarrel(goalX + 110);
    drawBarrel(goalX + 145);

    // Schornstein-Rauch — vier Wölkchen mit gestaffeltem Tween
    const smokeStartY = goalBaseY - 218;
    for (let i = 0; i < 4; i++) {
      const smoke = this.add.circle(goalX + 59, smokeStartY, 7 + i * 1.5, 0xe8e2d4, 0.7);
      smoke.setDepth(16);
      const startX = smoke.x;
      const startY = smoke.y;
      this.tweens.add({
        targets: smoke,
        y: smokeStartY - 110,
        x: startX + 18,
        alpha: 0,
        scale: 1.8,
        duration: 2600,
        delay: i * 650,
        repeat: -1,
        ease: 'Sine.out',
        onRepeat: () => {
          smoke.x = startX;
          smoke.y = startY;
          smoke.alpha = 0.7;
          smoke.setScale(1);
        }
      });
    }

    // GIPFELBRÄU-Schild + ZIEL-Indikator (über dem Dach)
    const goalSign = this.add.text(goalX, goalBaseY - 270, '🍺  GIPFELBRÄU  🍺', {
      fontFamily: 'Bungee, sans-serif', fontSize: '34px', color: '#f4c842',
      stroke: '#3d1a06', strokeThickness: 8
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({
      targets: goalSign, scale: 1.05, yoyo: true, duration: 1400,
      repeat: -1, ease: 'Sine.inOut'
    });
    this.add.text(goalX, goalBaseY - 230, '🚩 ZIEL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '18px', color: '#c94f4f',
      stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(50);

    // --- Bier-Pickups — entlang des Höhenprofils ---
    // Pro Plattform: 3 Biere am Boden, plus 18 Sprung-Belohnungen in der Luft.
    // Mehr Biere als vorher, damit Wiederbelebungs-Würfe immer verfügbar sind.
    this.beers = this.physics.add.staticGroup();
    this.powerups = this.physics.add.staticGroup();
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

    // --- Hindernisse: Steine + Baumstämme auf den Plattformen ---
    // STATIC group: Hindernisse bewegen sich nie. Vorher waren sie dynamic
    // mit setAllowGravity(false) — aber das Group.add() hat den Body-Status
    // teilweise zurückgesetzt → Steine fielen mit Welt-Gravity durch den Boden.
    this.obstacles = this.physics.add.staticGroup();
    const isNearBrewery = (x) => this.breweries.some(b => Math.abs(b.x - x) < 130);
    const isNearGoal = (x) => Math.abs(x - this.goalX) < 220;
    // Spawn-Schutzzone: keine Hindernisse in der ersten 500 px (Spieler
    // spawnt bei x=150-360, soll nicht sofort drin stehen)
    const SPAWN_GUARD_X = 500;
    // Mindestabstand zwischen zwei Hindernissen — wir tracken die belegten
    // X-Positionen pro Plattform und werfen Kandidaten zu nah dran weg.
    const MIN_GAP = 110;
    const occupied = new Map(); // platformIndex -> [xPositions]
    const isFree = (platIdx, x) => {
      const list = occupied.get(platIdx) || [];
      return list.every(ox => Math.abs(ox - x) >= MIN_GAP);
    };
    const reserve = (platIdx, x) => {
      const list = occupied.get(platIdx) || [];
      list.push(x);
      occupied.set(platIdx, list);
    };

    // Helper: versucht max N mal eine freie Stelle zu finden
    const tryPlace = (platIdx, p, w, edgeMargin) => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const x = p.start + edgeMargin + Math.random() * (w - 2 * edgeMargin);
        if (x < SPAWN_GUARD_X) continue;
        if (isNearBrewery(x) || isNearGoal(x)) continue;
        if (!isFree(platIdx, x)) continue;
        reserve(platIdx, x);
        return x;
      }
      return null;
    };

    this.terrain.forEach((p, idx) => {
      const w = p.end - p.start;
      if (w < 240) return;

      // Steine — biom-abhängig: Wiese spärlicher (max 1), Felsen dicht (density 240).
      const stoneDensity = { 0: 360, 1: 320, 2: 240 }[p.biome] ?? 320;
      const maxByBiome = { 0: 1, 1: 3, 2: 3 }[p.biome] ?? 3;
      const numStones = Math.max(0, Math.min(maxByBiome, Math.floor(w / stoneDensity)));
      for (let i = 0; i < numStones; i++) {
        const x = tryPlace(idx, p, w, 80);
        if (x === null) continue;
        const useLow = Math.random() < 0.3;
        const tex = useLow ? 'stone-low' : 'stone-small';
        const texH = useLow ? 32 : 36;
        const offset = texH / 2;
        const stone = this.obstacles.create(x, p.topY - offset, tex);
        stone.body.setSize(useLow ? 76 : 44, useLow ? 20 : 28);
        stone.body.updateFromGameObject();
        stone.isLowRock = useLow;
      }

      // Baumstämme: Wiese (häufiger) + Wald (dichter), überspringbar, keine Stamina-Strafe
      if (p.biome === 0 || p.biome === 1) {
        const trunkChance = p.biome === 1 ? 0.55 : 0.45;
        const maxTrunks = p.biome === 1 ? 2 : 1;
        for (let t = 0; t < maxTrunks; t++) {
          if (Math.random() > trunkChance) break;
          const x = tryPlace(idx, p, w, 80);
          if (x === null) break;
          const trunk = this.obstacles.create(x, p.topY - 14, 'tree-trunk');
          trunk.body.setSize(80, 22);
          trunk.body.updateFromGameObject();
          trunk.isTrunk = true;
        }
      }
    });

    // --- Trampolin-Pilze + Schweb-Plattformen (Wald, Sektion 1+2) ---
    // Idee: Pilz auf der hohen Plattform katapultiert hoch zur Schweb-
    // Plattform mit 3 Bier-Belohnungen → Anreiz, das Trampolin zu nehmen.
    this.trampolines = this.physics.add.staticGroup();
    this.floatingPlatforms = this.physics.add.staticGroup();
    this.psycheMushrooms = this.physics.add.staticGroup();
    // Sektion 2 hat den Baum-Blocker am Ende — würde es dort ein Trampolin
    // geben, könnte man den Baum einfach überspringen. Deshalb nur Sektion 1.
    for (let _trampSection = 0; _trampSection < 1; _trampSection++) {
      const sectIdx = 1;
      const inSection = this.terrain.filter(p => p.sectionIndex === sectIdx);
      // Höchstes Plateau (kleinster topY) finden, aber nicht das mit der
      // Brauerei (sonst klebt das Trampolin am Schild)
      let highest = inSection[0];
      for (const p of inSection) {
        if (p.topY < highest.topY) highest = p;
      }
      // Falls Brauerei-Plateau: nimm das zweithöchste
      const breweryX = (highest.start + highest.end) / 2;
      const isBrew = this.breweries.some(b => Math.abs(b.x - breweryX) < 50);
      if (isBrew) {
        const others = inSection.filter(p => p !== highest);
        if (others.length > 0) {
          let h2 = others[0];
          for (const p of others) if (p.topY < h2.topY) h2 = p;
          highest = h2;
        }
      }
      const mid = (highest.start + highest.end) / 2;
      const floatMid = Phaser.Math.Clamp(mid, highest.start + 52, highest.end - 52);
      // Pilz seitlich versetzen — nicht exakt unter der Schweb-Plattform, damit
      // man seitlich hochspringen kann; Ziel-X für leichte Horizont-Korrektur beim Boing.
      // Wald-Sektion 1: etwas weiter rechts (weniger Links-Offset + Fix), damit der Sprung
      // nicht so oft an der Unterkante der ersten Schweb-Inseln hängen bleibt.
      const side = sectIdx === 1 ? -1 : 1;
      const lateral = sectIdx === 1 ? 52 : 108;
      const trampX = Phaser.Math.Clamp(
        floatMid + side * lateral + (sectIdx === 1 ? 64 : 0),
        highest.start + 40,
        highest.end - 40
      );
      const ty = highest.topY;

      // Trampolin-Pilz
      const tramp = this.trampolines.create(trampX, ty - 22, 'mushroom-trampoline');
      tramp.setOrigin(0.5, 0.5);
      tramp.body.setSize(46, 24).setOffset(4, 16);
      tramp.refreshBody();
      tramp.setData('floatTargetX', floatMid);

      // Pulsierender Glow am Pilz — auffällige Aura damit er als Sprung-Ziel erkannt wird
      const glow = this.add.circle(trampX, ty - 14, 32, 0xfff3a0, 0.35).setDepth(-1);
      this.tweens.add({
        targets: glow, scale: 1.25, alpha: 0.15,
        yoyo: true, duration: 800, repeat: -1, ease: 'Sine.inOut'
      });
      this.tweens.add({
        targets: tramp, scaleY: 1.05, yoyo: true,
        duration: 800, repeat: -1, ease: 'Sine.inOut'
      });

      // Schweb-Plattformen: 6 Inseln gleichmäßig über die gesamte Sektionsbreite
      // → alternativer Weg oben, erreichbar per Trampolin
      const platY = Math.max(80, ty - 220);
      const addFloatPlat = (cx, cy, w) => {
        const fp = this.add.rectangle(cx, cy, w, 14, 0x6b3520).setOrigin(0.5);
        fp.setStrokeStyle(2, 0x3d1a06);
        this.physics.add.existing(fp, true);
        this.floatingPlatforms.add(fp);
        for (let dx = -w / 2 + 12; dx <= w / 2 - 12; dx += 22) {
          this.add.rectangle(cx + dx, cy, 1.5, 12, 0x3d1a06).setOrigin(0.5);
        }
        return fp;
      };
      const NUM_FLOATS = 6;
      const FLOAT_W = 85;
      const sectStart = this.sectStarts[sectIdx];
      const sectEnd   = this.sectEnds[sectIdx];
      const sectionUsable = sectEnd - sectStart - 120; // 60 px Buffer je Seite
      const gapBetween = (sectionUsable - NUM_FLOATS * FLOAT_W) / (NUM_FLOATS - 1);
      // Nächste Platform zum Trampolin als Sprung-Ziel merken
      let nearestDist = Infinity;
      let nearestX = floatMid;
      for (let fi = 0; fi < NUM_FLOATS; fi++) {
        const cx = sectStart + 60 + fi * (FLOAT_W + gapBetween) + FLOAT_W / 2;
        addFloatPlat(cx, platY, FLOAT_W);
        if (fi === 0) {
          const pu = this.powerups.create(cx, platY - 22, 'powerup-stamina');
          pu.body.setSize(28, 28);
          pu.body.updateFromGameObject();
          this.tweens.add({
            targets: pu, scaleX: 1.15, scaleY: 1.15,
            yoyo: true, duration: 700, repeat: -1, ease: 'Sine.inOut'
          });
        }
        if (Math.abs(cx - trampX) < nearestDist) {
          nearestDist = Math.abs(cx - trampX);
          nearestX = cx;
        }
        // Bier auf erster, letzter und Mitte-Platform; sonst 50 % Chance
        if (fi === 0 || fi === NUM_FLOATS - 1 || fi === Math.floor(NUM_FLOATS / 2)) {
          this.spawnBeer(cx, platY - 28);
        } else if (Math.random() < 0.5) {
          this.spawnBeer(cx, platY - 28);
        }
        // Psy-Pilz auf einer der mittleren Platforms
        if (fi === Math.floor(NUM_FLOATS / 2) - 1 && Math.random() < 0.65) {
          const m = this.psycheMushrooms.create(cx, platY - 7, 'mushroom-psy');
          m.setOrigin(0.5, 1);
          m.body.setSize(20, 14).setOffset(6, 14);
          m.refreshBody();
        }
      }
      // Trampolin-Ziel auf nächste Platform korrigieren (ersetzt floatMid von oben)
      tramp.setData('floatTargetX', nearestX);
    }

    // --- Psychedelic-Sammelpilze (Wald): wenige, mit Mindestabstand ---
    const PSY_GUARD_X = 600;
    const PSY_MIN_DIST = 160;
    const PSY_MAX = 9;
    const placedPsyX = [];
    const tryPlacePsy = (x) => {
      if (x < PSY_GUARD_X) return false;
      if (placedPsyX.length >= PSY_MAX) return false;
      if (placedPsyX.some(px => Math.abs(px - x) < PSY_MIN_DIST)) return false;
      placedPsyX.push(x);
      return true;
    };
    const forestPlats = this.terrain.filter(p => p.biome === 1 && (p.end - p.start) >= 280);
    forestPlats.sort((a, b) => a.start - b.start);
    for (const p of forestPlats) {
      if (placedPsyX.length >= PSY_MAX) break;
      const w = p.end - p.start;
      for (let attempt = 0; attempt < 6; attempt++) {
        const x = p.start + 80 + Math.random() * (w - 160);
        if (tryPlacePsy(x)) {
          const m = this.psycheMushrooms.create(x, p.topY - 2, 'mushroom-psy');
          m.setOrigin(0.5, 1);
          m.body.setSize(20, 14).setOffset(6, 14);
          m.refreshBody();
          break;
        }
      }
    }

    // --- Boden-Pilze (Deko): wenige auf tieferen Plattformen — nicht nur Hochplateau/Schwebe ---
    {
      const tops = this.terrain.map(p => p.topY).sort((a, b) => a - b);
      const medianTopY = tops[Math.floor(tops.length / 2)] ?? this.GROUND_Y;
      const nearBrew = (x) => this.breweries.some(b => Math.abs(b.x - x) < 140);
      const lowPlats = this.terrain
        .filter(p => {
          const w = p.end - p.start;
          if (w < 220) return false;
          if (p.biome === 2) return false; // Schnee-Gipfel: ohne klassische Pilz-Deko
          if (p.topY < medianTopY) return false; // nur untere Höhenhälfte (Tal / sanfte Hänge)
          return true;
        })
        .sort((a, b) => a.start - b.start);
      const placedDecorX = [];
      const minSep = 380;
      const maxDecor = 3;
      for (const p of lowPlats) {
        if (placedDecorX.length >= maxDecor) break;
        const w = p.end - p.start;
        for (let attempt = 0; attempt < 5; attempt++) {
          const x = p.start + 70 + Math.random() * (w - 140);
          if (x < 520) continue;
          if (nearBrew(x)) continue;
          if (placedDecorX.some(px => Math.abs(px - x) < minSep)) continue;
          placedDecorX.push(x);
          const sc = 0.85 + Math.random() * 0.2;
          this.add.image(x, p.topY - 1, 'mushroom-ground-decor')
            .setOrigin(0.5, 1)
            .setScale(sc)
            .setDepth(4)
            .setFlipX(Math.random() < 0.5);
          break;
        }
      }
      if (placedDecorX.length < 2) {
        const fallback = this.terrain
          .filter(p => (p.end - p.start) >= 200 && p.biome !== 2)
          .sort((a, b) => b.topY - a.topY);
        for (const p of fallback) {
          if (placedDecorX.length >= maxDecor) break;
          const w = p.end - p.start;
          const x = p.start + 60 + Math.random() * (w - 120);
          if (x < 480) continue;
          if (nearBrew(x)) continue;
          if (placedDecorX.some(px => Math.abs(px - x) < minSep * 0.75)) continue;
          placedDecorX.push(x);
          const sc = 0.85 + Math.random() * 0.2;
          this.add.image(x, p.topY - 1, 'mushroom-ground-decor')
            .setOrigin(0.5, 1)
            .setScale(sc)
            .setDepth(4)
            .setFlipX(Math.random() < 0.5);
        }
      }
    }

    // --- Wander-Gegner: Wald = Eichhörnchen + Wildschwein, Wiese = Wanderer, Gipfel = Bier-Bär ---
    this.hikeEnemies = this.physics.add.group();
    const enemyNearBrewery = (x) => this.breweries.some(b => Math.abs(b.x - x) < 130);
    const spawnPatrolEnemy = (p, texKey, speed) => {
      const w = p.end - p.start;
      if (w < 200) return false;
      const cx = (p.start + p.end) / 2;
      if (cx < 500 || enemyNearBrewery(cx)) return false;
      const x = p.start + 40 + Math.random() * (w - 80);
      if (enemyNearBrewery(x)) return false;
      const y = p.topY;
      const e = this.physics.add.sprite(x, y, texKey);
      e.setOrigin(0.5, 1);
      e.body.setGravityY(1400);
      if (texKey === 'enemy-squirrel') {
        e.body.setSize(34, 34);
        e.body.setOffset(7, 8);
      } else if (texKey === 'enemy-boar') {
        e.setScale(1);
        e.body.setSize(40, 28);
        e.body.setOffset(8, 20);
      } else if (texKey === 'enemy-hiker') {
        e.setScale(1);
        e.body.setSize(30, 86);
        e.body.setOffset(17, 10);
      } else if (texKey === 'enemy-bear') {
        e.setScale(1);
        e.body.setSize(38, 100);
        e.body.setOffset(21, 12);
      } else {
        e.setScale(1.25);
        e.body.setSize(28, 44);
        e.body.setOffset(6, 6);
      }
      e.body.setBounce(0, 0);
      e.patrolDir = Math.random() < 0.5 ? 1 : -1;
      e.patrolMin = p.start + 24;
      e.patrolMax = p.end - 24;
      e.patrolSpeed = speed;
      e.enemyTex = texKey;
      this.physics.add.collider(e, this.ground);
      this.hikeEnemies.add(e);
      const bobBase = e.scaleY;
      this.tweens.add({
        targets: e,
        scaleY: bobBase * 1.04,
        yoyo: true,
        duration: 600,
        repeat: -1,
        ease: 'Sine.inOut'
      });
      return true;
    };
    // Eichhörnchen: max 6, Mindestabstand 700 px, ~45 % Chance pro Plateau
    let sq = 0;
    const placedSqX = [];
    const SQ_MIN_DIST = 700;
    for (const p of this.terrain) {
      if (p.biome !== 1 || sq >= 6) continue;
      if (Math.random() > 0.55) continue;
      const sqCx = (p.start + p.end) / 2;
      if (placedSqX.some(px => Math.abs(px - sqCx) < SQ_MIN_DIST)) continue;
      if (spawnPatrolEnemy(p, 'enemy-squirrel', 120 + Math.random() * 40)) {
        sq++;
        placedSqX.push(sqCx);
      }
    }
    // Wildschwein: Wald, max 4, ≥300 px zu Eichhörnchen-Platzmitte, Wildschwein-zu-Wildschwein 400 px
    const BOAR_SQUIRREL_DIST = 300;
    const BOAR_MIN_DIST = 400;
    let br = 0;
    const placedBrX = [];
    for (const p of this.terrain) {
      if (p.biome !== 1 || br >= 4) continue;
      if (Math.random() > 0.48) continue;
      const brCx = (p.start + p.end) / 2;
      if (placedSqX.some(px => Math.abs(px - brCx) < BOAR_SQUIRREL_DIST)) continue;
      if (placedBrX.some(px => Math.abs(px - brCx) < BOAR_MIN_DIST)) continue;
      if (spawnPatrolEnemy(p, 'enemy-boar', 80 + Math.random() * 40)) {
        br++;
        placedBrX.push(brCx);
      }
    }
    // Wiese: Alt-Wanderer, max 3, ~35 % Chance, Mindestabstand 700 px
    const PATROL_MIN_DIST = 700;
    let pr = 0;
    const placedPrX = [];
    for (const p of this.terrain) {
      if (p.biome !== 0 || pr >= 3) continue;
      if (Math.random() > 0.65) continue;
      const prCx = (p.start + p.end) / 2;
      if (placedPrX.some(px => Math.abs(px - prCx) < PATROL_MIN_DIST)) continue;
      if (spawnPatrolEnemy(p, 'enemy-hiker', 56 + Math.random() * 26)) {
        pr++;
        placedPrX.push(prCx);
      }
    }
    // Gipfel: Bier-Bär, max 3, ~40 % Chance, Mindestabstand 700 px
    let pk = 0;
    const placedPkX = [];
    for (const p of this.terrain) {
      if (p.biome !== 2 || pk >= 3) continue;
      if (Math.random() > 0.60) continue;
      const pkCx = (p.start + p.end) / 2;
      if (placedPkX.some(px => Math.abs(px - pkCx) < PATROL_MIN_DIST)) continue;
      if (spawnPatrolEnemy(p, 'enemy-bear', 50 + Math.random() * 24)) {
        pk++;
        placedPkX.push(pkCx);
      }
    }

    // Baum am Ende von Wald-Sektion 2 — kooperativ umhauen.
    // Mittig auf der LETZTEN Plattform der Sektion (statt blind sectEnds-200),
    // damit topY garantiert greift und der Baum nicht halb über der Klippe hängt.
    const lastForestPlat = this.terrain
      .filter(p => p.sectionIndex === 2)
      .sort((a, b) => a.start - b.start)
      .pop();
    const treeX = lastForestPlat
      ? (lastForestPlat.start + lastForestPlat.end) / 2
      : this.sectEnds[2] - 200;
    const treeGroundY = lastForestPlat ? lastForestPlat.topY : this.topYAt(treeX);
    this._treeBlockerX = treeX;
    this._treeBlockerY = treeGroundY;

    // Sichtbarer Baum: 640 px hoch, Origin am Fuß.
    this._treeObj = this.add.image(treeX, treeGroundY, 'tree-blocker')
      .setOrigin(0.5, 1).setDepth(15);

    // Hitbox: praktisch volle Baumhöhe (600 px), 80 px breit. Da steht
    // niemand mehr drüber — Trampolin-Apex liegt nur ~500 px über der Platte.
    const bodyW = 80, bodyH = 600;
    const treeBody = this.add.rectangle(treeX, treeGroundY - bodyH / 2, bodyW, bodyH, 0, 0);
    this.physics.add.existing(treeBody, true);
    treeBody.body.updateFromGameObject();
    treeBody._isTreeBlocker = true;
    this._treeBodyObj = treeBody;
    this.ground.add(treeBody);

    this._treeEventActive = false;
    this._treeEventDone = false;
    // Per-Spieler-Tap-Counter — fairer Beitrag, gleiche Anzahl pro Person.
    // Ziel pro Spieler = TARGET_PER_PLAYER (30), Gesamt = N * 30.
    this._treeChopPerPlayer = new Map();
    this._treeChopTaps = 0;
    this._treeChopTarget = 30;        // wird beim Aktivieren auf N*30 gesetzt
    this._treeChopPlayerCount = 0;     // wird beim Aktivieren eingefroren
    this._treeLastActionByPlayer = new Map();
    this._treeProgressBar = null;
    this._treeProgressBg = null;
    this._treeInstructionText = null;
    this._treeCounterText = null;

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

    // Welt + Kamera — nach oben erweitert, damit der Gipfel-Aufstieg
    // (Hütten-Schornstein, Schild, Sprünge auf hohe Plateaus) ins Bild passen.
    const TOP_BOUND = -420;
    this.physics.world.setBounds(0, TOP_BOUND, LEVEL_WIDTH, H + 200 - TOP_BOUND);
    this.cameras.main.setBounds(0, TOP_BOUND, LEVEL_WIDTH, H + 200 - TOP_BOUND);

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

    // --- Zurück-Button zur Level-Auswahl (oben links unter dem Fortschrittsbalken) ---
    const backBtn = this.add.text(16, 42, '← LEVEL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '14px', color: '#fef3d4',
      backgroundColor: '#3d1a06', padding: { x: 10, y: 5 }
    }).setScrollFactor(0).setDepth(1001).setInteractive({ useHandCursor: true });
    backBtn.on('pointerover', () => backBtn.setBackgroundColor('#6b2e0c'));
    backBtn.on('pointerout',  () => backBtn.setBackgroundColor('#3d1a06'));
    backBtn.on('pointerdown', () => this.scene.start('LevelSelectScene'));

    // --- Mission-Banner (verschwindet nach 4s) ---
    this.showMissionBanner();

    // Resize-Handler
    this.scale.on('resize', this.handleResize, this);
  }

  showMissionBanner() {
    const W = this.scale.width, H = this.scale.height;
    const allObjs = [];

    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.82)
      .setScrollFactor(0).setDepth(2500);
    allObjs.push(overlay);

    // Titel
    const t1 = this.add.text(W / 2, H * 0.11, '🥾  BRAUEREI-WANDERUNG', {
      fontFamily: 'Bungee, sans-serif', fontSize: '56px', color: '#f4c842',
      stroke: '#3d1a06', strokeThickness: 10
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);
    allObjs.push(t1);

    // Regeln — je eine Icon-Zeile
    const rules = [
      { icon: '🚩', text: 'Gemeinsam zur Flagge — erst wenn alle da sind, ist gewonnen' },
      { icon: '🍺', text: 'K.O.? Nah dran → TRINKEN zum Aufwecken. Wasser? Ans Ufer stellen + ★ zieht raus' },
      { icon: '🐿️', text: 'Gegner (Eichhörnchen, Keiler, Wanderer, Bär): von oben draufspringen wie Mario → erledigt' },
      { icon: '🪨', text: 'Rollende Steine legen euch mit einem Treffer K.O.' },
    ];
    let ry = H * 0.25;
    for (const r of rules) {
      const rt = this.add.text(W / 2, ry, r.icon + '  ' + r.text, {
        fontFamily: 'Special Elite, monospace', fontSize: '20px',
        color: '#fef3d4', align: 'center', stroke: '#000', strokeThickness: 2
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);
      allObjs.push(rt);
      ry += 36;
    }

    // Trennlinie + Specials-Überschrift
    const divLine = this.add.rectangle(W / 2, H * 0.43, W * 0.65, 2, 0xf4c842, 0.55)
      .setScrollFactor(0).setDepth(2501);
    allObjs.push(divLine);

    const specHeader = this.add.text(W / 2, H * 0.47, '★  EURE SPECIALS  (★-TASTE)', {
      fontFamily: 'Bungee, sans-serif', fontSize: '18px', color: '#f4c842',
      stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);
    allObjs.push(specHeader);

    // Pro Spieler eine Zeile: Sprite · Name · ★ Special · — Beschreibung
    const players = Array.from(this.players.values());
    const rowH = 36;
    let py = H * 0.52;
    for (const p of players) {
      const info = HikePlayer.ABILITY_INFO[p.charData.id];
      if (!info) { py += rowH; continue; }
      const colorHex = '#' + p.charData.color.toString(16).padStart(6, '0');

      // Charakter-Sprite-Thumbnail (bereits als Phaser-Textur geladen)
      const texKey = 'char-' + p.charData.id;
      if (this.textures.exists(texKey)) {
        const spr = this.add.image(W * 0.20, py, texKey)
          .setScale(0.28).setOrigin(0.5, 0.5).setScrollFactor(0).setDepth(2501);
        allObjs.push(spr);
      }

      // Spielername (farbig, rechtsbündig zur Mittelspalte)
      const nameT = this.add.text(W * 0.285, py,
        p.playerName.toUpperCase(), {
          fontFamily: 'Bungee, sans-serif', fontSize: '17px', color: colorHex,
          stroke: '#000', strokeThickness: 3
        }).setOrigin(1, 0.5).setScrollFactor(0).setDepth(2501);
      allObjs.push(nameT);

      // Special-Name (gold)
      const specT = this.add.text(W * 0.30, py,
        '★ ' + info.name, {
          fontFamily: 'Bungee, sans-serif', fontSize: '17px', color: '#f4c842',
          stroke: '#000', strokeThickness: 3
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2501);
      allObjs.push(specT);

      // Special-Beschreibung (hellgrau, direkt rechts neben dem Namen)
      const descT = this.add.text(W * 0.30 + specT.width + 12, py,
        '— ' + info.desc, {
          fontFamily: 'Special Elite, monospace', fontSize: '15px', color: '#c0b898',
          stroke: '#000', strokeThickness: 2
        }).setOrigin(0, 0.5).setScrollFactor(0).setDepth(2501);
      allObjs.push(descT);

      py += rowH;
    }

    // Start-Hinweis (pulsierend)
    const t3 = this.add.text(W / 2, H * 0.91,
      '▶  DRÜCKE  ★ SPECIAL  ZUM STARTEN  ◀', {
        fontFamily: 'Bungee, sans-serif', fontSize: '24px',
        color: '#6dbf47', stroke: '#000', strokeThickness: 4
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2501);
    allObjs.push(t3);
    this.tweens.add({
      targets: t3, scale: 1.08, yoyo: true,
      duration: 600, repeat: -1, ease: 'Sine.inOut'
    });

    const dismiss = () => {
      // actionLatch setzen, damit Special nicht sofort nach Banner-Dismiss feuert
      for (const p of this.players.values()) p.actionLatch = true;
      this.tweens.killTweensOf(t3);
      this.tweens.add({
        targets: allObjs, alpha: 0, duration: 400,
        onComplete: () => {
          allObjs.forEach(o => o.destroy());
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
    // Pro Brauerei einen unabhängigen Spawner. Längeres Intervall +
    // gestaffelter Erst-Tick (delayedCall vor loop), damit nicht alle
    // Plateaus gleichzeitig feuern. Steine spawnen sowieso nur, wenn
    // ein Spieler in <1100 px der Plattform ist (siehe spawnRollingStone).
    this.breweries.forEach((b, idx) => {
      if (!b.plateau) return;
      const isMeadow = b.plateau.sectionIndex === 0;
      // Wiese: sanfterer Einstieg (9 s Wartezeit, alle 7–9 s ein Stein, kein Doppelschuss)
      const firstDelay = (isMeadow ? 9000 : 5500) + idx * 1800 + Math.random() * 1500;
      this.time.delayedCall(firstDelay, () => {
        this.spawnRollingStone(b.plateau);
        this.time.addEvent({
          delay: (isMeadow ? 7000 : 4200) + Math.random() * 2200,
          loop: true,
          callback: () => {
            this.spawnRollingStone(b.plateau);
            if (!isMeadow && Math.random() < 0.3) {
              this.time.delayedCall(650 + Math.random() * 250, () => {
                if (!this.gameWon && !this.gameLost) {
                  this.spawnRollingStone(b.plateau);
                }
              });
            }
          }
        });
      });
    });
    // Geröll-Lawine in Akt 3–4 (Felsgipfel): Sektion 4 = schwerster Teil, mehr + schneller
    for (const i of [3, 4]) {
      if (this.sectStarts[i] === undefined) continue;
      const isPeak = i === 4;
      const firstDelay = isPeak ? 5200 + Math.random() * 2200 : 6800 + Math.random() * 2800;
      this.time.delayedCall(firstDelay, () => {
        this.spawnAvalancheRock(i);
        this.time.addEvent({
          delay: isPeak ? (2600 + Math.random() * 1600) : (4200 + Math.random() * 2400),
          loop: true,
          callback: () => {
            this.spawnAvalancheRock(i);
            if (isPeak && !this.gameWon && !this.gameLost && Math.random() < 0.42) {
              this.time.delayedCall(450 + Math.random() * 350, () => {
                if (!this.gameWon && !this.gameLost) this.spawnAvalancheRock(i);
              });
            }
          }
        });
      });
    }
  }

  /** Liegt eine Welt-Position im sichtbaren Camera-Ausschnitt (mit Padding)? */
  _isInCameraView(x, y, padX = 200, padY = 200) {
    const v = this.cameras && this.cameras.main && this.cameras.main.worldView;
    if (!v) return true;
    return x >= v.x - padX && x <= v.x + v.width + padX &&
           y >= v.y - padY && y <= v.y + v.height + padY;
  }

  /** Helper: gibt es einen aktiven Spieler in der Nähe der Spawn-X? */
  _hasActivePlayerNear(x, range = 1500) {
    if (this.gameWon || this.gameLost) return false;
    if (!this.players || this.players.size === 0) return false;
    for (const p of this.players.values()) {
      if (p.knockedOut || p.inWater || p.frozen) continue;
      if (Math.abs(p.sprite.x - x) <= range) return true;
    }
    return false;
  }

  /** Geröll-Lawine: Stein fällt aus dem oberen Bildrand, mit Vorwarn-Indikator */
  spawnAvalancheRock(sectionIndex) {
    if (!this.rollingStones) return;
    const sStart = this.sectStarts[sectionIndex];
    const sEnd = this.sectEnds[sectionIndex];
    // Im inneren 80% der Sektion spawnen — nicht direkt am Bach-Rand
    const x = sStart + (sEnd - sStart) * (0.1 + Math.random() * 0.8);

    // Warn-Indikator: am Bildschirm-Top, X folgt der Welt mit
    const warn = this.add.text(x, 30, '⚠ LAWINE!', {
      fontFamily: 'Bungee, sans-serif', fontSize: '22px',
      color: '#c94f4f', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(1, 0).setDepth(950);
    // Pfeil nach unten unter dem Text
    const arrow = this.add.text(x, 56, '▼', {
      fontFamily: 'Bungee, sans-serif', fontSize: '20px',
      color: '#c94f4f', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(1, 0).setDepth(950);
    this.tweens.add({
      targets: [warn, arrow], alpha: 0.3, yoyo: true,
      duration: 200, repeat: 6
    });

    // Nach 1.5 s: Stein fällt aus dem oberen Welt-Rand
    this.time.delayedCall(1500, () => {
      warn.destroy();
      arrow.destroy();
      // Depth > Brauerei-Hütte (12–16), sonst rollt der Stein unsichtbar hinter Holz/NPC
      const stone = this.physics.add.image(x, -380, 'stone-roller').setDepth(28);
      stone.body.setAllowGravity(true);
      stone.body.setGravityY(1200);
      // setCircle(radius, offsetX, offsetY) — Offsets zentrieren den 36×36-Kreis
      // im 44×44-Texturframe, sonst sitzt der Body um (-4,-4) verschoben.
      stone.body.setCircle(18, 4, 4);
      stone.body.setBounce(0.35, 0.18);
      stone.body.reset(x, -380);
      const rollDir = Math.random() < 0.5 ? -1 : 1;
      const rollSpeed = 230 + Math.random() * 95;
      stone.targetVX = rollDir * rollSpeed;
      stone.body.setVelocityX(rollDir * (55 + Math.random() * 45));
      stone.rotateSpeed = -11 * rollDir;
      stone.isAvalanche = true;
      this.rollingStones.add(stone);
      // Tree-Blocker (Wald-Sektion) wird gefiltert — Steine sollen nicht
      // an dem unsichtbaren Hindernis kleben
      this.physics.add.collider(stone, this.ground, null, (s, g) => !g._isTreeBlocker);
      this.time.delayedCall(12000, () => stone.active && stone.destroy());
      // Nur Sound geben, wenn Spawnort im Sichtfeld — sonst hört man's
      // unangenehm aus weit entfernten Sektionen.
      if (this._isInCameraView(stone.x, stone.y)) {
        SFX.hit && SFX.hit();
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
    if (this.powerups) {
      this.physics.add.overlap(player.sprite, this.powerups, (sp, pu) => {
        if (player.knockedOut || player.inWater) return;
        pu.destroy();
        player.activateStaminaShield();
      });
    }
    this.physics.add.collider(player.sprite, this.obstacles, (sp, obstacle) => {
      if (obstacle && obstacle.isTrunk) {
        if (sp.body.touching.left || sp.body.touching.right) {
          const now = this.time.now;
          if (player._lastTrunkHint == null || now - player._lastTrunkHint > 1000) {
            player._lastTrunkHint = now;
            player.popText('🪵 SPRUNG!', '#9adb6a');
          }
        }
        return;
      }
      player.hitObstacle();
    });
    if (this.rollingStones) {
      this.physics.add.collider(
        player.sprite,
        this.rollingStones,
        (sp, stone) => {
          if (stone.isAvalanche) {
            player.hitObstacle();
          } else {
            player.becomeKnockedOut('stone');
          }
          stone.body.setVelocityX(stone.body.velocity.x * -0.4);
        },
        () => !player.knockedOut
      );
    }
    if (this.psycheMushrooms) {
      this.physics.add.overlap(player.sprite, this.psycheMushrooms, (sp, mush) => {
        if (!mush || !mush.active) return;
        if (player.knockedOut || player.inWater || player.frozen) return;
        mush.destroy();
        this.startPsycheTrip(player);
      });
    }
    if (this.hikeEnemies) {
      this.physics.add.overlap(player.sprite, this.hikeEnemies, (sp, en) => {
        if (!en || !en.active || en._stompDead || player.knockedOut || player.inWater || player.frozen) return;
        const pb = sp.body;
        const eb = en.body;
        const vx = pb.velocity.x;
        const vy = pb.velocity.y;
        const falling = vy > 30;
        const fromAbove = pb.bottom <= eb.top + 30;
        const angleOk = Math.abs(vx) <= vy * 1.0 + 80;
        const xOverlap = pb.right > eb.left + 2 && pb.left < eb.right - 2;
        const stomp = falling && fromAbove && angleOk && xOverlap;
        if (stomp) {
          en._stompDead = true;
          pb.setVelocityY(-400);
          player.invulnTimer = Math.max(player.invulnTimer || 0, 0.35);
          player.popText('💥 STOMP!', '#fef3d4');
          SFX.jump && SFX.jump();
          eb.enable = false;
          this.tweens.add({
            targets: en,
            y: en.y + 10,
            angle: en.flipX ? -0.5 : 0.5,
            alpha: 0,
            scaleY: 0.15,
            duration: 220,
            ease: 'Quad.in',
            onComplete: () => { if (en.active) en.destroy(); }
          });
          return;
        }
        const t = this.time.now;
        if (en._lastHitPlayer != null && t - en._lastHitPlayer < 1200) return;
        en._lastHitPlayer = t;
        player.hitEnemy(en.enemyTex);
      });
    }
    if (this.floatingPlatforms) {
      this.physics.add.collider(player.sprite, this.floatingPlatforms);
    }
    if (this.trampolines) {
      // Overlap statt Collider — Spieler bounct ohne stehen zu bleiben.
      // Nur wenn er von oben kommt (vy > 0) wird hochkatapultiert.
      this.physics.add.overlap(player.sprite, this.trampolines, (sp, tramp) => {
        if (player.knockedOut || player.inWater || player.frozen) return;
        if (sp.body.velocity.y > -50) {
          const targetX = tramp.getData('floatTargetX');
          if (targetX != null) {
            const push = Phaser.Math.Clamp((targetX - sp.x) * 0.22, -160, 160);
            sp.body.setVelocityX(sp.body.velocity.x + push);
          }
          sp.body.setVelocityY(-1180);
          // Squash-Tween — Pilz drückt sich kurz zusammen
          this.tweens.killTweensOf(tramp);
          tramp.scaleY = 0.5;
          this.tweens.add({
            targets: tramp, scaleY: 1.0, duration: 220, ease: 'Back.out',
            onComplete: () => {
              this.tweens.add({
                targets: tramp, scaleY: 1.05, yoyo: true,
                duration: 800, repeat: -1, ease: 'Sine.inOut'
              });
            }
          });
          SFX.jump && SFX.jump();
          player.popText('🍄 BOING!', '#c94f4f');
        }
      });
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

    // Warnzeichen ZUERST — Stein spawnt erst nach der Vorwarnung.
    // Das Warnzeichen sitzt am oberen Bildschirm-Rand bei der Spawn-X-Welt-
    // Position (scrollFactor 1, 0 = horizontal welt-locked, vertikal fix)
    // damit der Spieler es auch sieht wenn er weit von der Plattform weg ist.
    const warn = this.add.text(startX, 90, '⚠ STEIN ROLLT!', {
      fontFamily: 'Bungee, sans-serif', fontSize: '20px',
      color: '#c94f4f', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(1, 0).setDepth(950);
    const arrow = this.add.text(startX, 116, dir === -1 ? '◀' : '▶', {
      fontFamily: 'Bungee, sans-serif', fontSize: '22px',
      color: '#c94f4f', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(1, 0).setDepth(950);
    this.tweens.add({
      targets: [warn, arrow], alpha: 0.4, yoyo: true,
      duration: 200, repeat: 4
    });

    // Erst nach 1.2 s rollt der Stein wirklich los — Spieler hat Zeit
    this.time.delayedCall(1200, () => {
      warn.destroy();
      arrow.destroy();
      if (this.gameWon || this.gameLost) return;
      // Spawn deutlich über der Plattform → Stein fällt frei und landet sauber,
      // statt am Spawnort in einem Body-Overlap stecken zu bleiben.
      const spawnY = platform.topY - 80;
      // Depth > Brauerei-Deko (11–16), sonst liegt der Stein visuell hinter der Hütte
      const stone = this.physics.add.image(
        startX, spawnY, 'stone-roller'
      ).setDepth(28);
      stone.body.setAllowGravity(true);
      stone.body.setGravityY(900);
      // setCircle(radius, offsetX, offsetY) — Offsets zentrieren den Body
      stone.body.setCircle(18, 4, 4);
      stone.body.setBounce(0.35, 0.1);
      stone.body.reset(startX, spawnY);
      stone.body.setVelocityX(targetVX);
      stone.targetVX = targetVX;
      stone.rotateSpeed = -10 * dir;
      stone.isAvalanche = false;
      this.rollingStones.add(stone);
      // Tree-Blocker im Wald nicht mit Roll-Steinen kollidieren lassen,
      // sonst „verschluckt“ er die Brauerei-Steine in Sektion 2.
      this.physics.add.collider(stone, this.ground, null, (s, g) => !g._isTreeBlocker);
      this.time.delayedCall(14000, () => stone.active && stone.destroy());
      // Nur Sound, wenn Spawnort im Sichtfeld — sonst dröhnt's aus
      // weit entfernten Brauereien rein.
      if (this._isInCameraView(stone.x, stone.y)) {
        SFX.hit && SFX.hit();
      }
      // Falls der Stein nach 0.5 s noch fast steht (Edge-Case Body-Overlap):
      // einmal kräftig anschubsen.
      this.time.delayedCall(500, () => {
        if (!stone.active || !stone.body) return;
        if (Math.abs(stone.body.velocity.x) < 60) {
          stone.body.setVelocityX(targetVX);
          stone.body.setVelocityY(Math.min(stone.body.velocity.y, -120));
        }
      });
    });
  }

  /** Kurzer Psychedelic-Effekt nach Sammelpilz (Wald). */
  startPsycheTrip(player) {
    if (!player || !player.sprite || !player.sprite.active) return;
    if (player._psycheActive) return;
    player._psycheActive = true;
    SFX.beep && SFX.beep({ freq: 330, dur: 0.08, type: 'sine', vol: 0.12 });
    SFX.beep && SFX.beep({ freq: 495, dur: 0.08, type: 'sine', vol: 0.12 });
    player.popText('🍄 WHOAA…', '#d060ff');
    const colors = [0xff66ee, 0x66eeff, 0xeeff66, 0xffaa44, 0xaa66ff];
    let step = 0;
    const tintEv = this.time.addEvent({
      delay: 220,
      loop: true,
      callback: () => {
        if (!player.sprite.active) return;
        player.sprite.setTint(colors[step % colors.length]);
        step++;
      }
    });
    const cam = this.cameras.main;
    const prevZoom = cam.zoom;
    const zoomTw = this.tweens.add({
      targets: cam,
      zoom: Math.min(1.06, prevZoom * 1.05),
      duration: 380,
      yoyo: true,
      repeat: 6,
      ease: 'Sine.inOut'
    });
    this.time.delayedCall(5200, () => {
      tintEv.remove(false);
      if (zoomTw) zoomTw.stop();
      cam.setZoom(prevZoom);
      if (player.sprite && player.sprite.active) player.sprite.clearTint();
      player._psycheActive = false;
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
      // Wasserlinie ist pro Bach lokal (waterTop), weil die Bäche auf
      // unterschiedlichen Berghöhen liegen.
      if (!p.inWater && !p.frozen && !p.knockedOut) {
        const inGap = this.gaps && this.gaps.find(g =>
          p.sprite.x > g.start && p.sprite.x < g.end);
        if (inGap && p.sprite.y > inGap.waterTop + 5) {
          p.enterWater(inGap);
        }
      }
      // Notfall: Spieler unter dem Welt-Boden (sollte praktisch nie passieren)
      if (p.sprite.y > this.GROUND_Y + 200 && !p.frozen && !p.knockedOut && !p.inWater) {
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
    // Camera-Y folgt dem Spieler, mit Bias zum Boden (60% von oben), damit
    // beim Aufstieg kein leerer Himmel die Plattformen ans Bildende drückt.
    const groundAtCamX = this.trendAt(this.cameras.main.scrollX + W / 2);
    const camYFromGround = groundAtCamX - H * 0.62;
    const camYFromPlayer = cy - H / 2;
    // Mische — leichter Pull zum Boden, aber Spieler nie aus dem Bild
    const targetY = camYFromGround * 0.6 + camYFromPlayer * 0.4;
    this.cameras.main.scrollX += (targetX - this.cameras.main.scrollX) * 0.06;
    this.cameras.main.scrollY += (targetY - this.cameras.main.scrollY) * 0.06;

    // --- Sky-Tageszeit + Wolken-Drift ---
    if (this._updateSky) this._updateSky();
    if (this.clouds) {
      for (const c of this.clouds) {
        c.obj.x += c.drift * (delta / 1000);
        if (c.obj.x > this.LEVEL_WIDTH + 200) c.obj.x = -200;
      }
    }

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

    if (this.hikeEnemies) {
      const camL = this.cameras.main.scrollX;
      this.hikeEnemies.children.iterate((e) => {
        if (!e || !e.active || !e.body) return;
        if (e._stompDead) return;
        if (e.patrolMin != null && e.patrolMax != null) {
          let spd = e.patrolSpeed != null ? e.patrolSpeed : Math.max(60, Math.abs(e.body.velocity.x) || 80);
          if (e.enemyTex === 'enemy-hiker' || e.enemyTex === 'enemy-bear') {
            spd *= 0.78 + 0.22 * Math.sin(this.time.now * 0.0035 + e.x * 0.012);
          }
          if (e.patrolDir == null) e.patrolDir = e.body.velocity.x >= 0 ? 1 : -1;
          if (e.x < e.patrolMin) e.patrolDir = 1;
          else if (e.x > e.patrolMax) e.patrolDir = -1;
          if (e.body.blocked.left) e.patrolDir = 1;
          if (e.body.blocked.right) e.patrolDir = -1;
          e.body.setVelocityX(spd * e.patrolDir);
        }
        if (e.patrolDir != null) e.setFlipX(e.patrolDir < 0);
        else e.setFlipX(e.body.velocity.x < 0);
        if (e.x < camL - 450) e.destroy();
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

    this._updateTreeEvent();
  }

  _updateTreeEvent() {
    if (this._treeEventDone || !this._treeObj) return;
    const treeX = this._treeBlockerX != null ? this._treeBlockerX : this.sectEnds[2] - 200;
    const RANGE = 180;

    const eligible = [];
    for (const p of this.players.values()) {
      if (p.knockedOut || p.inWater || p.frozen) continue;
      if (p.sprite.x > this.sectStarts[2]) eligible.push(p);
    }
    if (eligible.length === 0) return;

    const allAtTree = eligible.every(p => Math.abs(p.sprite.x - treeX) < RANGE);

    if (allAtTree && !this._treeEventActive) {
      this._treeEventActive = true;
      this._treeChopTaps = 0;
      // Anzahl Spieler beim Aktivieren einfrieren — Mid-Event-Joins sollen
      // nicht plötzlich das Ziel hochziehen (sonst wird's frustrierend).
      this._treeChopPlayerCount = eligible.length;
      const TARGET_PER_PLAYER = 30;
      this._treeChopTarget = eligible.length * TARGET_PER_PLAYER;
      this._treeChopPerPlayer = new Map();
      for (const p of eligible) this._treeChopPerPlayer.set(p.id, 0);

      const bgY = (this._treeBlockerY != null ? this._treeBlockerY : this.topYAt(treeX)) - 360;
      this._treeProgressBg = this.add.rectangle(treeX, bgY, 180, 20, 0x3d1a06)
        .setStrokeStyle(2, 0xf4c842).setDepth(100);
      this._treeProgressBar = this.add.rectangle(treeX - 88, bgY, 2, 16, 0x6dbf47)
        .setOrigin(0, 0.5).setDepth(101);
      this._treeInstructionText = this.add.text(treeX, bgY - 28,
        `${TARGET_PER_PLAYER}× ACTION PRO SPIELER!`, {
        fontFamily: 'Bungee, sans-serif', fontSize: '14px', color: '#f4c842',
        stroke: '#000', strokeThickness: 4
      }).setOrigin(0.5).setDepth(101);
      this._treeCounterText = this.add.text(treeX, bgY,
        `0 / ${this._treeChopTarget}`, {
        fontFamily: 'Bungee, sans-serif', fontSize: '12px', color: '#fef3d4',
        stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5).setDepth(102);
      socket.emit('broadcast-controllers', 'tree-event-start');
    }

    if (!allAtTree && this._treeEventActive) {
      // Wer wegrennt, bricht das Event nicht ab — Fortschritt bleibt erhalten.
      // Action-Map leeren und sofort mit aktuellem Tastenzustand neu befüllen,
      // damit ein gehaltener ACTION-Knopf bei Rückkehr nicht als neuer Tap zählt.
      this._treeLastActionByPlayer.clear();
      for (const p of this.players.values()) {
        if (!this._treeChopPerPlayer || !this._treeChopPerPlayer.has(p.id)) continue;
        const inp = playerInputs.get(p.id) || {};
        this._treeLastActionByPlayer.set(p.id, !!inp.action);
      }
      return;
    }

    if (this._treeEventActive) {
      const TARGET = this._treeChopTarget;
      for (const p of eligible) {
        // Nur Spieler aus dem ursprünglichen Cast tracken (Mid-Joiner schauen zu)
        if (!this._treeChopPerPlayer.has(p.id)) continue;
        const inRange = Math.abs(p.sprite.x - treeX) < RANGE;
        const inp = playerInputs.get(p.id) || {};
        const wasDown = this._treeLastActionByPlayer.get(p.id) || false;
        const isDown = !!inp.action;
        if (inRange && isDown && !wasDown) {
          this._treeChopPerPlayer.set(p.id, (this._treeChopPerPlayer.get(p.id) || 0) + 1);
          this._treeChopTaps = Math.min(TARGET, this._treeChopTaps + 1);
          if (this._treeObj) {
            const dir = (this._treeChopTaps % 2 === 0) ? -1 : 1;
            this.tweens.add({
              targets: this._treeObj,
              angle: { from: 0, to: 4 * dir },
              duration: 70, yoyo: true, ease: 'Sine.easeInOut'
            });
          }
          this.cameras.main.shake(70, 0.004);
          SFX.hit && SFX.hit();
        }
        this._treeLastActionByPlayer.set(p.id, isDown);
      }
      if (this._treeProgressBar) {
        this._treeProgressBar.width = (this._treeChopTaps / TARGET) * 176;
      }
      if (this._treeCounterText) {
        this._treeCounterText.setText(`${this._treeChopTaps} / ${TARGET}`);
      }
      if (this._treeChopTaps >= TARGET) {
        this._felTree(eligible);
      }
    }
  }

  _felTree(eligible) {
    this._treeEventDone = true;
    if (this._treeProgressBar) {
      this._treeProgressBar.destroy();
      this._treeProgressBar = null;
    }
    if (this._treeProgressBg) {
      this._treeProgressBg.destroy();
      this._treeProgressBg = null;
    }
    if (this._treeInstructionText) {
      this._treeInstructionText.destroy();
      this._treeInstructionText = null;
    }
    if (this._treeCounterText) {
      this._treeCounterText.destroy();
      this._treeCounterText = null;
    }

    if (this._treeObj) {
      this.tweens.add({
        targets: this._treeObj,
        angle: 90,
        x: this._treeObj.x + 120,
        y: this._treeObj.y + 20,
        duration: 1200,
        ease: 'Cubic.in',
        onComplete: () => {
          if (this._treeObj) {
            this._treeObj.destroy();
            this._treeObj = null;
          }
        }
      });
    }
    if (this._treeBodyObj) {
      this.ground.remove(this._treeBodyObj, true, true);
      this._treeBodyObj = null;
    }

    for (const p of eligible) {
      p.stamina = p.maxStamina;
      p.beerInventory += 2;
      p.drunkenness = Math.max(0, p.drunkenness - 30);
      p.popText('TIMBER! +VOLL +2 BIER', '#6dbf47');
    }
    this.cameras.main.shake(400, 0.012);
    SFX.hit && SFX.hit();
    socket.emit('broadcast-controllers', 'tree-event-end');
  }

  respawnAtLastCheckpoint(player, opts = {}) {
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
    player.knockedOut = false;
    player.inWater = false;
    player.waterGap = null;
    player.koTimer = 0;
    player.sprite.body.setAllowGravity(true);
    player.sprite.body.setSize(34, 90);
    player.sprite.body.setOffset(18, 18);
    player.sprite.body.reset(player.sprite.x, player.sprite.y);
    if (player.sprite.setRotation) player.sprite.setRotation(0);
    if (player.label) {
      player.label.setText(player.charData.name);
      player.label.setPosition(player.sprite.x, player.sprite.y - 70);
    }
    const msg = opts.message != null ? opts.message : '💦 INS WASSER!';
    player.popText(msg, '#3a7aa8');
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

    // NPC-Encounter: "Prost!"-Sprechblase + Bier-Wurf-Animation
    if (brewery.npc) {
      // Sprechblase über dem NPC für 1.2s
      const accentHex = '#' + (brewery.accent || 0xf4c842).toString(16).padStart(6, '0');
      const bubble = this.add.text(brewery.npc.x, brewery.npc.y - 36, '🍻 PROST!', {
        fontFamily: 'Bungee, sans-serif', fontSize: '14px', color: accentHex,
        backgroundColor: '#1a0f08', padding: { x: 6, y: 4 },
        stroke: '#000', strokeThickness: 2
      }).setOrigin(0.5).setDepth(920);
      this.tweens.add({
        targets: bubble, y: bubble.y - 8, alpha: 0,
        duration: 1200, delay: 200,
        onComplete: () => bubble.destroy()
      });

      // Bier-Wurf: Dose fliegt vom NPC zum Spieler
      const proj = this.add.image(brewery.npc.x, brewery.npc.y - 20, 'beer-can')
        .setDepth(950);
      this.tweens.add({
        targets: proj,
        x: player.sprite.x,
        y: player.sprite.y - 20,
        duration: 350,
        ease: 'Quad.in',
        onUpdate: () => { proj.rotation += 0.25; },
        onComplete: () => proj.destroy()
      });
    }

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

      // Qualm-Textur einmalig generieren (kleines weiches Wölkchen).
      // Wir bauen sie hier on-demand statt im preload(), damit auch dynamisch
      // joinende Schumis sie kriegen, ohne die Scene umbauen zu müssen.
      if (!scene.textures.exists('smoke-puff')) {
        const g = scene.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 0.55); g.fillCircle(8, 8, 8);
        g.fillStyle(0xffffff, 0.85); g.fillCircle(8, 8, 5);
        g.fillStyle(0xffffff, 1.00); g.fillCircle(8, 8, 3);
        g.generateTexture('smoke-puff', 16, 16);
        g.destroy();
      }

      // Partikel-Qualm steigt aus dem Glut-Punkt des Joints auf.
      // Position wird in update() jeden Frame an den Mundwinkel nachgezogen
      // und beim Sprite-Flip mitgespiegelt.
      this.smokeEmitter = scene.add.particles(x, y, 'smoke-puff', {
        lifespan:  { min: 900, max: 1500 },
        speedX:    { min: -18, max: 18 },
        speedY:    { min: -65, max: -35 },
        scale:     { start: 0.35, end: 1.1 },
        alpha:     { start: 0.55, end: 0 },
        tint:      [0xeeeeee, 0xc8c8c8, 0xa8a8a8],
        rotate:    { min: 0, max: 360 },
        frequency: 220
      });
      this.smokeEmitter.setDepth((this.sprite.depth || 0) + 1);
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
    // Highscore-Counter — werden in triggerWin() ausgelesen
    this.enemyKills = 0;
    this.mushroomsEaten = 0;
    this.beersDrunk = 0;
    // K.O. / Wasser
    this.knockedOut = false;        // liegt ohnmächtig — nur Bier-Wurf weckt auf
    this.koTimer = 0;
    this.inWater = false;           // treibt im Bach — nur Mitspieler kann ziehen
    this.waterGap = null;           // gemerkter Bach für sichere Ufer-Rettung

    this.staminaShield = false;
    this.staminaShieldTimer = 0;
    this._shieldAura = null;

    // Input-Latches
    this.drinkLatch = false;
    this.actionLatch = false;
    this.upLatch = false;
    // true während Tween/Ability das Sprite skaliert — sonst überschreibt update() die Skala
    this._isAbilityScaling = false;
  }

  update(input, delta) {
    const dt = delta / 1000;
    const body = this.sprite.body;

    if (this.staminaShieldTimer > 0) {
      this.staminaShieldTimer -= dt;
      if (this.staminaShieldTimer <= 0) {
        this.staminaShield = false;
        if (this._shieldAura) {
          this._shieldAura.destroy();
          this._shieldAura = null;
        }
        this.popText('SCHUTZ ABGELAUFEN', '#c94f4f');
      } else if (this._shieldAura && this.sprite.active) {
        this._shieldAura.setPosition(this.sprite.x, this.sprite.y - 20);
      }
    }

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
        this.stamina = Math.max(0, this.stamina - (this.staminaShield ? 0 : 8));
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
    if ((left || right) && !this.staminaShield) {
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

    // Schumis Qualm zieht aus dem Glut-Punkt am Mundwinkel.
    // Im 14×22-Grid (5 px/cell) sitzt die Glut bei (col=13, row=9), Origin
    // mittig — also Offset ≈ (+32, -8) vom Sprite-Center, bei Flip gespiegelt.
    if (this.smokeEmitter) {
      const dirX = this.sprite.flipX ? -1 : 1;
      this.smokeEmitter.setPosition(
        this.sprite.x + 32 * dirX,
        this.sprite.y - 8
      );
      // Im KO-Zustand qualmt der Joint nicht weiter
      this.smokeEmitter.emitting = !this.knockedOut && !this.frozen;
    }
    // Wenn besoffen: Sprite kippt sichtbar hin und her
    if (isDrunk && this.sprite.setRotation) {
      this.sprite.setRotation(Math.sin(this.scene.time.now / 130) * 0.18);
    } else if (this.sprite.setRotation) {
      this.sprite.setRotation(0);
    }
    // Kleines "Wackeln" beim Laufen — leicht verkippte Skala
    if ((left || right) && body.blocked.down && this.sprite.setScale && !this._isAbilityScaling) {
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

  activateStaminaShield() {
    this.staminaShield = true;
    this.staminaShieldTimer = 120;
    this.popText('STAMINASCHUTZ 2 MIN!', '#f4c842');
    SFX.brewery && SFX.brewery();
    if (!this._shieldAura) {
      this._shieldAura = this.scene.add.circle(0, 0, 28, 0xf4c842, 0.25).setDepth(5);
    }
  }

  // Trinken-Knopf: drei Modi.
  // 1) K.O.-Mitspieler in der Nähe → wirf Bier auf ihn → er wacht auf
  // 2) Lebend + nah + hat weniger Dosen als du → eine Bierdose abgeben (kein Promille)
  // 3) Sonst → selbst trinken (Stamina rauf, Promille rauf)
  manualDrink() {
    if (this.beerInventory <= 0) {
      this.popText('LEER!', '#c94f4f');
      return;
    }

    // Koop: K.O.-Mitspieler wiederbeleben. Im Wasser zählt primär
    // horizontale Ufer-Nähe, weil der Höhenunterschied sonst den Bierwurf blockt.
    let koTarget = null;
    let bestRescueScore = Infinity;
    for (const other of this.scene.players.values()) {
      if (other === this) continue;
      if (!other.knockedOut) continue;
      let score = Infinity;
      if (other.inWater) {
        if (!this.canReachWaterRescueTarget(other, 220)) continue;
        score = Math.abs(other.sprite.x - this.sprite.x) / 220;
      } else {
        const dx = other.sprite.x - this.sprite.x;
        const dy = other.sprite.y - this.sprite.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 140) continue;
        score = d / 140;
      }
      if (score < bestRescueScore) { bestRescueScore = score; koTarget = other; }
    }
    if (koTarget) {
      this.beerInventory--;
      this.throwReviveBeer(koTarget);
      this.popText('🍻 → ' + koTarget.charData.name.toUpperCase(), '#6dbf47');
      return;
    }

    // Koop: Mitspieler mit weniger Bier im Inventar eine Dose reichen
    let giveTarget = null;
    let bestGive = 125;
    for (const other of this.scene.players.values()) {
      if (other === this) continue;
      if (other.knockedOut || other.frozen) continue;
      if (other.beerInventory >= this.beerInventory) continue;
      const dx = other.sprite.x - this.sprite.x;
      const dy = other.sprite.y - this.sprite.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestGive) { bestGive = d; giveTarget = other; }
    }
    if (giveTarget) {
      this.beerInventory--;
      giveTarget.beerInventory++;
      this.popText('🍺 → ' + giveTarget.charData.name.toUpperCase(), '#6dbf47');
      giveTarget.popText('🍺 +1', '#f4c842');
      SFX.pickup();
      return;
    }

    // Selbst trinken
    this.beerInventory--;
    const mult = this.charData.stats.drinkMultiplier || 1;
    const gain = 25 * mult;
    this.stamina = Math.min(this.maxStamina, this.stamina + gain);
    this.drunkenness = Math.min(100, this.drunkenness + (this.charData.stats.drunkImmune ? 4 : 18));
    this._isAbilityScaling = true;
    this.scene.tweens.add({
      targets: this.sprite, scaleY: 1.2, yoyo: true, duration: 150,
      onComplete: () => { this._isAbilityScaling = false; }
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
    this.sprite.body.setVelocity(0, 0);
    this.sprite.body.reset(this.sprite.x, this.sprite.y);
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

  canReachWaterRescueTarget(other, maxDx = 180) {
    if (!other || !other.inWater) return false;
    const dx = Math.abs(other.sprite.x - this.sprite.x);
    const victimBelow = other.sprite.y - this.sprite.y;
    return dx <= maxDx && victimBelow >= -20 && victimBelow <= 360;
  }

  // Helfer ruft das auf: ziehe einen Mitspieler aus dem Bach.
  // Bedingung: Helfer nicht im Wasser, Ziel im Wasser, nah genug am Ufer.
  tryPullFromWater() {
    if (this.inWater) return false;
    if (this.stamina < 8) return false;
    let target = null;
    let bestDist = 180;
    for (const other of this.scene.players.values()) {
      if (other === this) continue;
      const dx = Math.abs(other.sprite.x - this.sprite.x);
      if (!this.canReachWaterRescueTarget(other, bestDist)) continue;
      if (dx < bestDist) { bestDist = dx; target = other; }
    }
    if (!target) return false;
    // Ziel direkt auf die Uferseite des Helfers ziehen, nicht zurück ins Gap.
    target.exitWater({ rescuerX: this.sprite.x });
    if (target.knockedOut) {
      target.knockedOut = false;
      target.drunkenness = 30;
      target.stamina = Math.max(target.stamina, 50);
      target.sprite.body.setAllowGravity(true);
      target.sprite.body.setVelocity(0, 0);
      target.sprite.body.setSize(34, 90);
      target.sprite.body.setOffset(18, 18);
      target.sprite.body.reset(target.sprite.x, target.sprite.y);
      this.scene.tweens.add({
        targets: target.sprite, rotation: 0, duration: 300
      });
      if (target.label) {
        target.label.setText(target.charData.name);
        target.label.setPosition(target.sprite.x, target.sprite.y - 70);
      }
      target.popText('🤝 GERETTET & WACH!', '#6dbf47');
    } else {
      target.popText('🤝 GERETTET!', '#6dbf47');
    }
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
        target.reviveByBeer(this.sprite.x);
      }
    });
    this.scene.cameras.main.flash(120, 200, 220, 100);
  }

  // Wird durch Bier-Wurf eines Mitspielers ausgelöst — der einzige Weg
  // aus dem K.O. heraus.
  reviveByBeer(rescuerX = null) {
    if (!this.knockedOut) return;
    this.knockedOut = false;
    this.drunkenness = 30;
    this.stamina = Math.max(this.stamina, 50);
    // Aus Wasser-Modus auch raus (falls dort K.O. gegangen) — exitWater() setzt
    // sprite.y bereits korrekt; ansonsten müssen wir das selbst tun.
    if (this.inWater) {
      this.exitWater({ rescuerX });
    } else {
      // K.O.-Body war (70x34, offset 0/58) → Bottom auf Plattform.
      // Stehender Body ist (34x90, offset 18/18). Würden wir den nur umstellen,
      // läge er ~16 px IM Boden (Tunneling → Spieler fällt durch).
      // → sprite.y vorab so hochziehen, dass der stehende Body sicher über
      //   der Plattform-Oberkante sitzt.
      const top = this.scene.topYAt ? this.scene.topYAt(this.sprite.x) : this.scene.GROUND_Y;
      this.sprite.y = top - 60;
    }
    this.sprite.body.setAllowGravity(true);
    this.sprite.body.setVelocity(0, 0);
    // Hitbox auf "stehend" zurücksetzen
    this.sprite.body.setSize(34, 90);
    this.sprite.body.setOffset(18, 18);
    // Body-Position muss nach Größenänderung explizit re-syncen (sonst hängt
    // sie noch in der K.O.-Liegeposition fest)
    this.sprite.body.reset(this.sprite.x, this.sprite.y);
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
    this.waterGap = gap || null;
    this.sprite.body.setAllowGravity(false);
    this.popText('💦 INS WASSER!', '#3a7aa8');
    // Solo: dauerhafte Rettung gibt's nur per Action-Knopf — Hinweis sofort zeigen
    if (this.scene.players && this.scene.players.size === 1) {
      this.scene.time.delayedCall(550, () => {
        if (this.inWater && this.sprite.active) {
          this.popText('★ = RESPAWN', '#f4c842');
        }
      });
    }
    this.scene.cameras.main.flash(150, 60, 120, 200);
    SFX.splash();
  }

  getWaterRescueX(rescuerX = null) {
    const gaps = this.scene.gaps || [];
    const gap = gaps.find(g => this.sprite.x > g.start && this.sprite.x < g.end) || this.waterGap;
    if (!gap) return this.sprite.x;
    const mid = (gap.start + gap.end) / 2;
    const side = rescuerX != null
      ? (rescuerX < mid ? -1 : 1)
      : (this.sprite.x < mid ? -1 : 1);
    const margin = 42;
    const x = side < 0 ? gap.start - margin : gap.end + margin;
    return Phaser.Math.Clamp(x, 20, (this.scene.LEVEL_WIDTH || x + 20) - 20);
  }

  exitWater({ rescuerX = null } = {}) {
    const rescueX = this.getWaterRescueX(rescuerX);
    this.inWater = false;
    this.waterGap = null;
    this.sprite.body.setAllowGravity(true);
    // Auf lokale Terrain-Höhe setzen (Bäche können zwischen erhöhten Sektionen liegen)
    this.sprite.x = rescueX;
    const top = this.scene.topYAt ? this.scene.topYAt(this.sprite.x) : this.scene.GROUND_Y;
    this.sprite.y = top - 80;
    this.sprite.body.setVelocity(0, 0);
    this.sprite.body.reset(this.sprite.x, this.sprite.y);
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

    // Schwimm-Höhe: Spieler treibt mit Schultern an der Wasseroberfläche.
    // Wasserlinie ist pro Bach lokal (waterTop), weil Bäche an verschiedenen
    // Berghöhen liegen.
    const waterTop = (gap.waterTop !== undefined) ? gap.waterTop : this.scene.GROUND_Y;
    const targetY = waterTop + 35;
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

    const isSolo = this.scene.players && this.scene.players.size === 1;

    // Solo: Action-Knopf löst sofortigen Respawn an der letzten Brauerei aus.
    // Im Koop bleibt es beim Mitspieler-Pull — Action macht nichts im Wasser.
    if (isSolo && input.action && !this.actionLatch) {
      this.actionLatch = true;
      this.exitWater();
      this.scene.respawnAtLastCheckpoint(this, { message: '💦 ALLEINE — RESPAWN!' });
      return;
    }
    if (!input.action) this.actionLatch = false;

    // Bei Stamina 0 im Wasser → Koop: K.O.; Solo: Auto-Respawn (Sicherheitsnetz)
    if (this.stamina <= 0 && !this.knockedOut) {
      if (isSolo) {
        this.exitWater();
        this.scene.respawnAtLastCheckpoint(this, { message: '💦 ALLEINE — RESPAWN!' });
        return;
      }
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
    this._isAbilityScaling = false;
  }

  // Stein-Treffer = Stamina-Kosten + Knockback + Flash (statische Steine,
  // Lawinen-Geröll). Brauerei-Rollsteine lösen separat becomeKnockedOut('stone').
  hitObstacle() {
    if (this.knockedOut) return;
    if (this.invulnTimer > 0) return;
    this.invulnTimer = 1.0;
    SFX.hit();
    // Stamina-Kosten — bei niedriger Stamina wird's hart (kann nicht mehr springen)
    const dmg = 22;
    this.stamina = Math.max(0, this.stamina - dmg);
    // Knockback gegen die aktuelle Bewegungsrichtung
    const vx = this.sprite.body.velocity.x;
    const knockDir = vx > 0 ? -1 : (vx < 0 ? 1 : (Math.random() < 0.5 ? -1 : 1));
    this.sprite.body.setVelocityX(knockDir * 220);
    this.sprite.body.setVelocityY(-260);
    // Visuelles Feedback: Flash-Tween + Pop-Text + Camera-Shake
    this.popText('AUA! -' + dmg, '#c94f4f');
    this.scene.tweens.add({
      targets: this.sprite, alpha: 0.35,
      yoyo: true, repeat: 4, duration: 80,
      onComplete: () => { this.sprite.alpha = 1; }
    });
    this.scene.cameras.main.shake(140, 0.005);
  }

  // Wander-Gegner: spürbarer als Hindernis — Promille, Bier-Verlust, stärkerer Knockback
  hitEnemy(enemyTex) {
    if (this.knockedOut) return;
    if (this.invulnTimer > 0) return;
    this.invulnTimer = 1.2;
    if (enemyTex === 'enemy-hiker' || enemyTex === 'enemy-bear') SFX.drunkBump();
    else SFX.hit();
    const dmg = 25;
    this.stamina = Math.max(0, this.stamina - dmg);
    const drunkAdd = this.charData.stats.drunkImmune ? 4 : 12;
    this.drunkenness = Math.min(100, this.drunkenness + drunkAdd);
    let beerLost = false;
    if (this.beerInventory > 0) {
      this.beerInventory--;
      beerLost = true;
    }
    const vx = this.sprite.body.velocity.x;
    const knockDir = vx > 0 ? -1 : (vx < 0 ? 1 : (Math.random() < 0.5 ? -1 : 1));
    this.sprite.body.setVelocityX(knockDir * 280);
    this.sprite.body.setVelocityY(-320);
    let msg = 'HALT! -' + dmg;
    if (enemyTex === 'enemy-squirrel') msg = 'BISS! -' + dmg;
    else if (enemyTex === 'enemy-boar') msg = 'KEILER! -' + dmg;
    else if (enemyTex === 'enemy-hiker') msg = 'STOCK! -' + dmg;
    else if (enemyTex === 'enemy-bear') msg = 'BRUMM! -' + dmg;
    if (beerLost) msg += '  🍺-1';
    this.popText(msg, '#c94f4f');
    this.scene.tweens.add({
      targets: this.sprite, alpha: 0.35,
      yoyo: true, repeat: 5, duration: 70,
      onComplete: () => { this.sprite.alpha = 1; }
    });
    this.scene.cameras.main.shake(200, 0.008);
  }

  destroy() {
    this.sprite.destroy();
    this.label.destroy();
    if (this.aura) this.aura.destroy();
    if (this.smokeEmitter) this.smokeEmitter.destroy();
    if (this._shieldAura) this._shieldAura.destroy();
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
//  Steuerung (Handy-Controller):
//   - left/right     → seitlich steuern
//   - action (★)     → NITRO verbrauchen (Bier lädt auf)
//   - Krokodile / Fluss-Kram (Trabi, Moped, Einkaufswagen) → Berührung = Kentern / eliminiert
//
//  Welt-Y nimmt nach oben ab (stromaufwärts = negative Y). Die Strömung
//  zieht alle Boote stromaufwärts (negative vy). Ziel-Linie liegt bei
//  kleinem Y (weit oben in der Welt). Hindernisse: Felsen, Treibholz.
//  Wettkampf: wer zuerst die Ziellinie passiert, gewinnt (Rangliste).
//  Todeszonen: Berührung = sofort ausgeschieden.
// ================================================================
class PaddleScene extends Phaser.Scene {
  constructor() { super('PaddleScene'); }

  // Generiert eine wiederverwendbare Textur für Krokodile
  generateCrocTexture() {
    if (this.textures.exists('dead-croc-tex')) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });

    // Krokodil aus der Draufsicht, zentriert um (0,0) in der 150x50-Textur
    g.fillStyle(0x2d5a38, 1);
    g.fillTriangle(10, 18, 48, 25, 10, 32);   // Schwanz
    g.fillStyle(0x3d7a4a, 1);
    g.fillEllipse(75, 25, 80, 34);             // Rumpf
    g.fillStyle(0x4a9060, 1);
    g.fillEllipse(75, 25, 66, 26);             // Bauch heller
    g.fillStyle(0x2a4a32, 0.75);
    g.fillEllipse(62, 13, 22, 6);              // Rücken-Streifen
    g.fillEllipse(78, 12, 24, 6);
    g.fillEllipse(94, 13, 20, 5);
    g.fillStyle(0x458a58, 1);
    g.fillEllipse(114, 22, 34, 26);            // Kopf
    g.fillStyle(0x356648, 1);
    g.fillTriangle(130, 13, 148, 25, 130, 37); // Schnauze
    // Zähne
    g.fillStyle(0xf5f0e6, 1);
    for (let z = 0; z < 4; z++) {
      g.fillTriangle(134 + z * 4, 19, 134 + z * 4, 23, 137 + z * 4, 21);
    }
    g.fillStyle(0x356040, 1);
    g.fillEllipse(80, 40, 10, 8);              // Beine
    g.fillEllipse(96, 40, 10, 8);
    g.fillEllipse(110, 40, 9, 7);
    g.fillStyle(0xfff8dc, 1);
    g.fillCircle(118, 12, 4);                  // Augen
    g.fillCircle(118, 37, 4);
    g.fillStyle(0x1a1a1a, 1);
    g.fillCircle(119, 12, 2);
    g.fillCircle(119, 37, 2);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(120, 11.5, 1);
    g.fillCircle(120, 37.5, 1);

    g.generateTexture('dead-croc-tex', 150, 50);
    g.destroy();
  }

  // Tödliche „Ost-Zone“-Wracks — Draufsicht, stromlinienförmig wie das Krokodil
  generatePaddleJunkTextures() {
    if (this.textures.exists('paddle-junk-trabi')) return;

    const tr = this.make.graphics({ x: 0, y: 0, add: false });
    tr.fillStyle(0x6a5a4a, 1);
    tr.fillEllipse(60, 34, 102, 44);
    tr.fillStyle(0xc4a882, 1);
    tr.fillEllipse(58, 36, 88, 36);
    tr.fillStyle(0x8a7a6a, 1);
    tr.fillRoundedRect(28, 14, 56, 22, 4);
    tr.fillStyle(0xa8c8e8, 0.55);
    tr.fillRect(36, 18, 18, 10);
    tr.fillStyle(0x5a4a3a, 1);
    tr.fillEllipse(22, 40, 14, 10);
    tr.fillEllipse(96, 38, 16, 11);
    tr.fillStyle(0x8b4513, 0.85);
    tr.fillCircle(44, 42, 5);
    tr.fillCircle(72, 44, 4);
    tr.lineStyle(2, 0x3a3028, 0.9);
    tr.strokeEllipse(58, 36, 88, 36);
    tr.generateTexture('paddle-junk-trabi', 120, 64);
    tr.destroy();

    const mp = this.make.graphics({ x: 0, y: 0, add: false });
    mp.fillStyle(0x2a2a2a, 1);
    mp.fillCircle(18, 38, 12);
    mp.fillCircle(54, 38, 12);
    mp.fillStyle(0x6a5a50, 1);
    mp.fillRoundedRect(22, 22, 32, 18, 5);
    mp.fillStyle(0x4a4038, 1);
    mp.fillRoundedRect(26, 14, 22, 14, 3);
    mp.fillStyle(0x3a3530, 1);
    mp.fillRect(34, 8, 4, 12);
    mp.lineStyle(1.5, 0x1a1a1a, 0.8);
    mp.strokeRoundedRect(22, 22, 32, 18, 5);
    mp.generateTexture('paddle-junk-moped', 72, 48);
    mp.destroy();

    const ct = this.make.graphics({ x: 0, y: 0, add: false });
    ct.fillStyle(0x8899aa, 1);
    ct.fillRoundedRect(18, 12, 62, 28, 3);
    ct.lineStyle(2, 0x4a5560, 1);
    ct.strokeRoundedRect(18, 12, 62, 28, 3);
    for (let i = 0; i < 4; i++) {
      ct.beginPath();
      ct.moveTo(24 + i * 14, 16);
      ct.lineTo(24 + i * 14, 36);
      ct.strokePath();
    }
    ct.fillStyle(0x2a2a2a, 1);
    ct.fillCircle(28, 46, 9);
    ct.fillCircle(70, 46, 9);
    ct.fillStyle(0xd4dce4, 0.35);
    ct.fillRect(22, 18, 52, 6);
    ct.generateTexture('paddle-junk-cart', 96, 56);
    ct.destroy();
  }

  /** Krokodil oder Fluss-Wrack — gleiche tödliche Gruppe + Warnpunkte */
  spawnPaddleDeadlyHazard(ox, oy, textureKey) {
    const isCroc = textureKey === 'dead-croc-tex';
    const prof = isCroc
      ? { bw: 110, bh: 36, ox: 20, oy: 7, baseAngle: -90, wobble: 8, scale: 0.95, warnDx: 46, warnDy: 25 }
      : textureKey === 'paddle-junk-trabi'
        ? { bw: 100, bh: 40, ox: 10, oy: 12, baseAngle: -88, wobble: 14, scale: 0.9, warnDx: 40, warnDy: 22 }
        : textureKey === 'paddle-junk-moped'
          ? { bw: 56, bh: 34, ox: 8, oy: 7, baseAngle: -90, wobble: 20, scale: 1, warnDx: 30, warnDy: 18 }
          : { bw: 80, bh: 38, ox: 8, oy: 9, baseAngle: -92, wobble: 12, scale: 0.88, warnDx: 36, warnDy: 20 };

    const spr = this.deadlyZones.create(ox, oy, textureKey);
    spr.setOrigin(0.5, 0.5);
    const flip = Math.random() < 0.5;
    spr.setFlipX(flip);
    spr.angle = prof.baseAngle + (isCroc ? 0 : (Math.random() - 0.5) * 26);
    spr.setScale(prof.scale * (0.96 + Math.random() * 0.08));
    if (spr.body && spr.body.setSize) {
      spr.body.setSize(prof.bw, prof.bh);
      spr.body.setOffset(prof.ox, prof.oy);
    }

    const wdx = prof.warnDx;
    const wdy = prof.warnDy;
    const warnTop = this.add.circle(ox + (flip ? -wdx : wdx), oy - wdy, 4, 0xff5522, 0.62);
    const warnBot = this.add.circle(ox + (flip ? -wdx : wdx), oy + wdy, 4, 0xff5522, 0.62);
    spr.setData({ warnTop, warnBot, flip, warnDx: wdx, warnDy: wdy });
    this.tweens.add({
      targets: [warnTop, warnBot],
      alpha: { from: 0.62, to: 0.18 },
      yoyo: true, repeat: -1, duration: 580
    });

    this.tweens.add({
      targets: spr,
      y: oy + (Math.random() < 0.5 ? 16 : -16),
      x: ox + (Math.random() - 0.5) * (isCroc ? 24 : 18),
      yoyo: true, repeat: -1,
      duration: 2400 + Math.random() * 1400,
      ease: 'Sine.easeInOut'
    });
    this.tweens.add({
      targets: spr,
      angle: spr.angle + (Math.random() < 0.5 ? prof.wobble : -prof.wobble),
      yoyo: true, repeat: -1,
      duration: 1700 + Math.random() * 900,
      ease: 'Sine.easeInOut'
    });
  }

  spawnPaddleObstacle(ox, oy) {
    const addStatic = (go) => {
      this.physics.add.existing(go, true);
      if (go.body && go.body.refreshBody) go.body.refreshBody();
      this.obstacles.add(go);
    };
    const r = Math.random();
    if (r < 0.12) {
      // Treibender Baumstamm (Tween bewegt Grafik — Body wird in update nachgezogen)
      const obj = this.add.rectangle(ox, oy, 60 + Math.random() * 40, 14, 0x7a5a3a);
      obj.setStrokeStyle(2, 0x3d2a1a);
      obj.setRotation((Math.random() - 0.5) * 0.35);
      this.physics.add.existing(obj, true);
      if (obj.body && obj.body.refreshBody) obj.body.refreshBody();
      obj._paddleDriftLog = true;
      this.obstacles.add(obj);
      const dx = (Math.random() > 0.5 ? 1 : -1) * (42 + Math.random() * 36);
      this.tweens.add({
        targets: obj,
        x: ox + dx,
        yoyo: true,
        repeat: -1,
        duration: 2800 + Math.random() * 2200,
        ease: 'Sine.inOut'
      });
      return;
    }
    if (r < 0.40) {
      // kleiner Fels
      const obj = this.add.ellipse(ox, oy, 50 + Math.random() * 20, 36 + Math.random() * 14, 0x6b6b6b);
      obj.setStrokeStyle(3, 0x3d3d3d);
      addStatic(obj);
    } else if (r < 0.65) {
      // großer Fels
      const obj = this.add.ellipse(ox, oy, 75 + Math.random() * 30, 50 + Math.random() * 20, 0x555555);
      obj.setStrokeStyle(4, 0x2a2a2a);
      addStatic(obj);
    } else if (r < 0.86) {
      // kurzes Treibholz
      const obj = this.add.rectangle(ox, oy, 55 + Math.random() * 30, 16 + Math.random() * 6, 0x6b4a2a);
      obj.setStrokeStyle(2, 0x3d2a1a);
      obj.setRotation((Math.random() - 0.5) * 0.5);
      addStatic(obj);
    } else {
      // langes Treibholz
      const obj = this.add.rectangle(ox, oy, 100 + Math.random() * 40, 18 + Math.random() * 6, 0x5a3a1a);
      obj.setStrokeStyle(2, 0x2d1a0a);
      obj.setRotation((Math.random() - 0.5) * 0.4);
      addStatic(obj);
    }
  }

  spawnDeadlyZones(W, SHORE_W, RIVER_LENGTH, goalY) {
    this.deadlyZones = this.physics.add.staticGroup();
    const riverInnerL = SHORE_W + 80;
    const riverInnerR = W - SHORE_W - 80;
    // Weniger Krokodile, dafür tödliche Wracks (Trabi / Moped / Einkaufswagen)
    const crocCount = Math.max(6, Math.min(11, Math.floor(RIVER_LENGTH / 720)));
    const junkCount = Math.max(14, Math.min(26, Math.floor(RIVER_LENGTH / 260)));
    const junkKeys = ['paddle-junk-trabi', 'paddle-junk-moped', 'paddle-junk-cart'];

    this.generateCrocTexture();
    this.generatePaddleJunkTextures();

    const pickOy = () => {
      let oy;
      let guard = 0;
      const minOy = goalY + 500;
      const maxOy = -200;
      do {
        oy = minOy + Math.random() * (maxOy - minOy);
        guard++;
      } while (oy < goalY + 300 && guard < 16);
      return oy;
    };

    for (let i = 0; i < crocCount; i++) {
      const ox = riverInnerL + Math.random() * (riverInnerR - riverInnerL);
      this.spawnPaddleDeadlyHazard(ox, pickOy(), 'dead-croc-tex');
    }
    for (let j = 0; j < junkCount; j++) {
      const ox = riverInnerL + Math.random() * (riverInnerR - riverInnerL);
      const key = junkKeys[Math.floor(Math.random() * junkKeys.length)];
      this.spawnPaddleDeadlyHazard(ox, pickOy(), key);
    }
  }

  spawnRapidsZones(W, SHORE_W, RIVER_LENGTH, goalY) {
    this.rapidsZones = [];
    const numZones = Math.max(3, Math.floor(RIVER_LENGTH / 2000));
    for (let i = 0; i < numZones; i++) {
      const yTop = goalY + 450 + (RIVER_LENGTH - 1100) * (i + 0.4) / (numZones + 0.3);
      const zoneHeight = 280 + Math.random() * 220;
      const yBot = yTop + zoneHeight;
      const speedMult = 1.35 + Math.random() * 0.55;
      this.rapidsZones.push({ yTop, yBot, speedMult });

      this.add.rectangle(W / 2, (yTop + yBot) / 2, W - 2 * SHORE_W - 36, zoneHeight, 0xaaccee, 0.08);
      for (let w = 0; w < 7; w++) {
        const lx = SHORE_W + 28 + Math.random() * (W - 2 * SHORE_W - 56);
        const ly = yTop + 24 + Math.random() * (zoneHeight - 48);
        const wave = this.add.rectangle(lx, ly, 28 + Math.random() * 44, 2, 0xffffff, 0.32);
        this.tweens.add({
          targets: wave,
          x: lx + 22,
          alpha: { from: 0.32, to: 0.12 },
          yoyo: true,
          duration: 700 + Math.random() * 700,
          repeat: -1
        });
      }
      this.add.text(W / 2, yTop - 14, '⚡ STROMSCHNELLE ⚡', {
        fontFamily: 'Bungee, sans-serif', fontSize: '14px',
        color: '#aaddff', stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5);
    }
  }

  spawnRiverFork(W, SHORE_W, RIVER_LENGTH, goalY) {
    const forkY = goalY + RIVER_LENGTH * 0.45;
    const mergeY = goalY + RIVER_LENGTH * 0.15;
    this.forkY = forkY;
    this.mergeY = mergeY;

    const islandH = Math.max(120, forkY - mergeY);
    const island = this.add.rectangle(W / 2, mergeY + islandH / 2, 44, islandH, 0x3d5a2a);
    island.setStrokeStyle(3, 0x2a3a1a);
    this.physics.add.existing(island, true);
    if (island.body && island.body.refreshBody) island.body.refreshBody();
    this.obstacles.add(island);

    this.add.text(W / 2 - 100, forkY - 70, '⚡ Wildwasser', {
      fontFamily: 'Bungee, sans-serif', fontSize: '15px',
      color: '#ff8866', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);
    this.add.text(W / 2 + 100, forkY - 70, '🌊 Ruhig', {
      fontFamily: 'Bungee, sans-serif', fontSize: '15px',
      color: '#66bbff', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);

    this.rapidsZones.push({
      yTop: mergeY + 80,
      yBot: forkY - 60,
      speedMult: 1.52
    });

    const riverW = W - 2 * SHORE_W;
    for (let j = 0; j < 15; j++) {
      const ox = SHORE_W + 36 + Math.random() * (riverW * 0.34);
      const oy = mergeY + 70 + Math.random() * (forkY - mergeY - 140);
      this.spawnPaddleObstacle(ox, oy);
    }
    this.generateCrocTexture();
    this.generatePaddleJunkTextures();
    const junkKeys = ['paddle-junk-trabi', 'paddle-junk-moped', 'paddle-junk-cart'];
    for (let j = 0; j < 2; j++) {
      const ox = SHORE_W + 50 + Math.random() * (riverW * 0.28);
      const oy = mergeY + 50 + Math.random() * (forkY - mergeY - 100);
      this.spawnPaddleDeadlyHazard(ox, oy, 'dead-croc-tex');
    }
    for (let j = 0; j < 5; j++) {
      const ox = SHORE_W + 50 + Math.random() * (riverW * 0.28);
      const oy = mergeY + 50 + Math.random() * (forkY - mergeY - 100);
      const key = junkKeys[Math.floor(Math.random() * junkKeys.length)];
      this.spawnPaddleDeadlyHazard(ox, oy, key);
    }
    for (let j = 0; j < 6; j++) {
      const bx = SHORE_W + riverW * 0.58 + Math.random() * (riverW * 0.36);
      const by = mergeY + 45 + Math.random() * (forkY - mergeY - 90);
      this.spawnFloatingBeer(bx, by);
    }
  }

  spawnShoreDecor(x, y) {
    const tree = this.add.circle(x, y, 7 + Math.random() * 7, 0x3a5a2a);
    tree.setStrokeStyle(1, 0x2a4a1a);
    this.tweens.add({
      targets: tree,
      scaleX: 1.04,
      scaleY: 1.04,
      yoyo: true, repeat: -1,
      duration: 1800 + Math.random() * 1600
    });
  }

  spawnWhirlpool(ox, oy) {
    const whirlpool = this.add.graphics();
    whirlpool.setPosition(ox, oy);
    const ev = this.time.addEvent({
      delay: 55,
      callback: () => {
        if (!whirlpool.active) return;
        whirlpool.clear();
        const t = this.time.now * 0.0025;
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2 + t;
          const radius = 8 + i * 3.2;
          const px = Math.cos(angle) * radius;
          const py = Math.sin(angle) * radius;
          whirlpool.fillStyle(0x88ccdd, 0.45);
          whirlpool.fillCircle(px, py, 3.5);
        }
      },
      loop: true
    });
    whirlpool.setData('spinEvent', ev);

    const hitbox = this.add.circle(ox, oy, 34, 0x000000, 0.001);
    hitbox.setVisible(false);
    this.physics.add.existing(hitbox, true);
    if (hitbox.body && hitbox.body.refreshBody) hitbox.body.refreshBody();
    this.whirlpoolHitboxes.add(hitbox);

    this.add.text(ox, oy - 38, '🌀', { fontSize: '26px' }).setOrigin(0.5);
  }

  spawnJumpingFish(ox, oy) {
    const fish = this.add.ellipse(ox, oy, 12, 6, 0xc8b070);
    fish.setStrokeStyle(1, 0x887755);
    fish.setVisible(false);
    this.time.addEvent({
      delay: 2500 + Math.random() * 5500,
      callback: () => {
        if (!fish.active) return;
        fish.setVisible(true);
        fish.setAlpha(1);
        fish.y = oy;
        this.tweens.add({
          targets: fish,
          y: oy - 38,
          alpha: { from: 1, to: 0 },
          duration: 480,
          onComplete: () => { fish.setVisible(false); }
        });
      },
      loop: true
    });
  }

  getRapidsMultiplier(worldY) {
    if (!this.rapidsZones || !this.rapidsZones.length) return 1;
    for (const z of this.rapidsZones) {
      if (worldY >= z.yTop && worldY <= z.yBot) return z.speedMult;
    }
    return 1;
  }

  onPlayerEliminated(p) {
    if (!this.eliminationOrder) this.eliminationOrder = [];
    if (this.eliminationOrder.includes(p)) return;
    this.eliminationOrder.push(p);
  }

  preload() {
    if (window.MaennertagPixelChars) {
      for (const c of CHARACTERS) {
        window.MaennertagPixelChars.buildPhaserCharTexture(this, 'char-' + c.id, c.id);
      }
    }
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    // Kürzere Strecke + etwas schnellere Strömung ≈ 50–70 s bis zum Ziel
    const RIVER_LENGTH = 6400;

    this.RIVER_LENGTH = RIVER_LENGTH;
    this.scrollY = 0;
    this.currentSpeed = 112; // px/s Strömung (stromaufwärts)

    const goalY = -RIVER_LENGTH + 200;
    this.goalY = goalY;
    const forkY = goalY + RIVER_LENGTH * 0.45;
    const mergeY = goalY + RIVER_LENGTH * 0.15;
    this.forkY = forkY;
    this.mergeY = mergeY;

    this.cameras.main.setBackgroundColor('#3a6a7a');
    this.cameras.main.setBounds(0, -RIVER_LENGTH, W, RIVER_LENGTH + H);

    // Wasser: leicht variierende Blautöne + sanfte Wellenbewegung
    const stripCount = Math.ceil(RIVER_LENGTH / 80) + 50;
    this.waterStrips = [];
    for (let i = 0; i < stripCount; i++) {
      const y = -i * 80;
      const hueShift = (i * 7) % 40;
      const color = 0x2a5a6a + hueShift * 0x001122;
      const strip = this.add.rectangle(W / 2, y, W, 3, color, 0.32);
      this.waterStrips.push(strip);
      this.tweens.add({
        targets: strip,
        x: W / 2 + (Math.random() - 0.5) * 10,
        yoyo: true, repeat: -1,
        duration: 1900 + Math.random() * 2100,
        ease: 'Sine.inOut'
      });
    }

    // Ufer links + rechts (grün, schmaler "Korridor" für die Boote)
    const SHORE_W = 80;
    this.shoreLeft = this.add.rectangle(SHORE_W / 2, -RIVER_LENGTH / 2, SHORE_W, RIVER_LENGTH * 2, 0x4a6a3a);
    this.shoreRight = this.add.rectangle(W - SHORE_W / 2, -RIVER_LENGTH / 2, SHORE_W, RIVER_LENGTH * 2, 0x4a6a3a);
    this.physics.add.existing(this.shoreLeft, true);
    if (this.shoreLeft.body && this.shoreLeft.body.refreshBody) this.shoreLeft.body.refreshBody();
    this.physics.add.existing(this.shoreRight, true);
    if (this.shoreRight.body && this.shoreRight.body.refreshBody) this.shoreRight.body.refreshBody();

    for (let sy = -120; sy > -RIVER_LENGTH + 80; sy -= 200) {
      this.spawnShoreDecor(SHORE_W * 0.35 + Math.random() * 18, sy + Math.random() * 40);
      this.spawnShoreDecor(W - SHORE_W * 0.35 - Math.random() * 18, sy + Math.random() * 40);
    }

    this.whirlpoolHitboxes = this.physics.add.staticGroup();

    // Hindernisse: statische Bodies. Gruppe als plain add.group() —
    // staticGroup würde beim group.add() nochmals einen Body zuweisen und crashen.
    // Mehr Dichte + ~40 % der Hindernisse gezielt in der Flussmitte.
    const riverW = W - 2 * SHORE_W;
    const obstacleCount = Math.max(55, Math.floor(RIVER_LENGTH / 90));
    this.obstacles = this.add.group();
    for (let i = 0; i < obstacleCount; i++) {
      let ox;
      let oy;
      let placed = false;
      for (let t = 0; t < 10 && !placed; t++) {
        if (Math.random() < 0.4) {
          ox = SHORE_W + riverW * 0.25 + Math.random() * riverW * 0.5;
        } else {
          ox = SHORE_W + 40 + Math.random() * (riverW - 80);
        }
        oy = -200 - Math.random() * (RIVER_LENGTH - 400);
        if (oy > mergeY && oy < forkY && Math.abs(ox - W / 2) < 72) continue;
        this.spawnPaddleObstacle(ox, oy);
        placed = true;
      }
      if (!placed) {
        ox = SHORE_W + 50 + Math.random() * (riverW - 100);
        oy = -200 - Math.random() * (RIVER_LENGTH - 400);
        this.spawnPaddleObstacle(ox, oy);
      }
    }

    // Bier-Flaschen die im Wasser treiben (statisch; Position per Tween → Body in update nachziehen)
    const beerCount = Math.max(16, Math.floor(RIVER_LENGTH / 320));
    this.beers = this.add.group();
    for (let i = 0; i < beerCount; i++) {
      const bx = SHORE_W + 20 + Math.random() * (W - 2 * SHORE_W - 40);
      const by = -300 - Math.random() * (RIVER_LENGTH - 500);
      this.spawnFloatingBeer(bx, by);
    }

    // Ziel-Linie (stromaufwärts = kleines world-Y)
    this.gameWon = false;
    this.gameLost = false; // alle ausgeschieden, niemand am Ziel
    this.finishOrder = []; // Reihenfolge beim Ziel — Wettkampf
    this.eliminationOrder = []; // chronologisch: zuerst raus = schlechteste DNF
    this.spawnDeadlyZones(W, SHORE_W, RIVER_LENGTH, goalY);
    this.spawnRapidsZones(W, SHORE_W, RIVER_LENGTH, goalY);
    this.spawnRiverFork(W, SHORE_W, RIVER_LENGTH, goalY);

    for (let w = 0; w < 5; w++) {
      let ox = W / 2;
      let oy = -2000;
      for (let t = 0; t < 14; t++) {
        ox = SHORE_W + 50 + Math.random() * (riverW - 100);
        oy = goalY + 400 + Math.random() * (RIVER_LENGTH - 700);
        if (oy > mergeY && oy < forkY && Math.abs(ox - W / 2) < 78) continue;
        break;
      }
      this.spawnWhirlpool(ox, oy);
    }
    for (let f = 0; f < 14; f++) {
      const fx = SHORE_W + 30 + Math.random() * (riverW - 60);
      const fy = -250 - Math.random() * (RIVER_LENGTH - 500);
      this.spawnJumpingFish(fx, fy);
    }

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

    const hintBanner = this.add.text(W / 2, 88,
      'Handy: ◀ ▶ steuern · ★ = NITRO · Stromschnellen · 🌀 Strudel · Krokodil & Wrack (Trabi …) = KENTERN!',
      {
        fontFamily: 'Special Elite, monospace', fontSize: '14px', color: '#fef3d4',
        stroke: '#000', strokeThickness: 3, align: 'center',
        wordWrap: { width: W - 40 }
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1002).setAlpha(1);

    // Nach 5–10 s ausblenden, sobald das Rennen läuft
    const hintHideMs = 5000 + Math.random() * 5000;
    this.time.delayedCall(hintHideMs, () => {
      if (!hintBanner || !hintBanner.active) return;
      this.tweens.add({
        targets: hintBanner,
        alpha: 0,
        duration: 650,
        ease: 'Sine.inOut',
        onComplete: () => { if (hintBanner.active) hintBanner.destroy(); }
      });
    });

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
    this.physics.add.existing(beer, true);
    if (beer.body && beer.body.refreshBody) beer.body.refreshBody();
    this.beers.add(beer);
    this.tweens.add({ targets: beer, x: x + 10, yoyo: true, duration: 1400, repeat: -1, ease: 'Sine.inOut' });
    return beer;
  }

  spawnPaddler(id, data, x, y) {
    const charData = charById(data.characterId);
    const p = new PaddlePlayer(this, x, y, id, charData);
    this.physics.add.overlap(p.sprite, this.beers, (sp, beer) => {
      if (p.eliminated) return;
      beer.destroy();
      p.drinkBeer();
    });
    this.physics.add.overlap(p.sprite, this.deadlyZones, (_sp, _croc) => {
      if (!p.eliminated && !p.atGoal) p.eliminate();
    });
    if (this.whirlpoolHitboxes) {
      this.physics.add.overlap(p.sprite, this.whirlpoolHitboxes, () => {
        p.applyWhirlpool();
      });
    }
    this.physics.add.collider(
      p.sprite,
      this.obstacles,
      (sprite, obstacle) => { p.hitObstacle(obstacle); }
    );
    this.physics.add.collider(p.sprite, this.shoreLeft);
    this.physics.add.collider(p.sprite, this.shoreRight);
    this.players.set(id, p);
    this.buildHUD();
  }

  buildHUD() {
    if (!this.hudContainer) return;
    this.hudContainer.removeAll(true);
    const W = this.scale.width;
    const slots = Array.from(this.players.values());
    const slotWidth = Math.max(100, Math.min(180, (W - 40) / Math.max(slots.length, 1)));
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
      const nitroLabel = this.add.text(x + 8, y + 36, '⚡ NITRO', {
        fontFamily: 'Bungee, sans-serif', fontSize: '9px', color: '#f4c842'
      });
      p.hudStaminaBg = this.add.rectangle(x + 8, y + 46, slotWidth - 24, 8, 0x1a0f08).setOrigin(0, 0);
      p.hudStaminaFill = this.add.rectangle(x + 8, y + 46, slotWidth - 24, 8, 0xf4c842).setOrigin(0, 0);
      this.hudContainer.add([bg, name, playerName, nitroLabel, p.hudStaminaBg, p.hudStaminaFill]);
    });
  }

  update(time, delta) {
    if (this.players.size === 0) return;
    if (this.gameWon) return;
    if (this.gameLost) return;
    const dt = delta / 1000;

    // Tweens verschieben Bier-Grafik — Physik-Body nachziehen
    this.beers.children.iterate(beer => {
      if (beer && beer.active && beer.body && beer.body.updateFromGameObject) {
        beer.body.updateFromGameObject();
      }
    });

    this.deadlyZones.children.iterate(croc => {
      if (croc && croc.active && croc.body && croc.body.updateFromGameObject) {
        croc.body.updateFromGameObject();
      }
      if (croc && croc.getData) {
        const wt = croc.getData('warnTop');
        const wb = croc.getData('warnBot');
        const flip = !!croc.getData('flip');
        const wdx = croc.getData('warnDx');
        const wdy = croc.getData('warnDy');
        const dxOff = wdx != null ? wdx : 45;
        const dyOff = wdy != null ? wdy : 25;
        if (wt && wb) {
          const dx = flip ? -dxOff : dxOff;
          wt.setPosition(croc.x + dx, croc.y - dyOff);
          wb.setPosition(croc.x + dx, croc.y + dyOff);
        }
      }
    });

    this.obstacles.children.iterate(ob => {
      if (ob && ob.active && ob._paddleDriftLog && ob.body && ob.body.updateFromGameObject) {
        ob.body.updateFromGameObject();
      }
    });

    // Strömung — alle Boote kontinuierlich stromaufwärts (negative vy)
    const activeForCam = Array.from(this.players.values()).filter(p => !p.eliminated);
    let avgY = 0;
    const justFinished = [];
    for (const p of this.players.values()) {
      const input = playerInputs.get(p.id) || {};
      const rapMult = p.eliminated ? 1 : this.getRapidsMultiplier(p.sprite.y);
      if (!p.eliminated && rapMult > 1.02 && !p._rapidsShakeLatch) {
        this.cameras.main.shake(160, 0.003);
        p._rapidsShakeLatch = true;
        this.time.delayedCall(420, () => { p._rapidsShakeLatch = false; });
      }
      if (!p.eliminated && rapMult > 1.02 && Math.random() < 0.12) {
        const splash = this.add.circle(
          p.sprite.x + (Math.random() - 0.5) * 22,
          p.sprite.y - 28,
          3, 0xffffff, 0.65
        );
        this.tweens.add({
          targets: splash,
          y: splash.y - 18 - Math.random() * 14,
          alpha: 0,
          duration: 420,
          onComplete: () => splash.destroy()
        });
      }
      p.update(input, dt, this.currentSpeed * rapMult);
      if (!p.eliminated) avgY += p.sprite.y;
      if (!p.eliminated && !p.atGoal && p.sprite.y <= this.goalY) {
        p.atGoal = true;
        justFinished.push(p);
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
    const nCam = Math.max(1, activeForCam.length);
    avgY /= nCam;

    // Wettkampf: mindestens ein Finisher → Sieg (bei Gleichstand im Frame: wer weiter oben)
    if (!this.gameWon && justFinished.length > 0) {
      justFinished.sort((a, b) => a.sprite.y - b.sprite.y);
      for (const p of justFinished) this.finishOrder.push(p);
      this.triggerPaddleWin();
    }

    // Kamera folgt Schwerpunkt vertikal, lateral bleibt fix
    const H = this.scale.height;
    const targetY = avgY - H * 0.55;
    this.cameras.main.scrollY += (targetY - this.cameras.main.scrollY) * 0.06;

    // Wer zu weit zurück (=tiefer) treibt, wird vom Bildrand "geboostet" zurück
    const camBottom = this.cameras.main.scrollY + H;
    for (const p of this.players.values()) {
      if (!p.eliminated && p.sprite.y > camBottom - 40) p.sprite.y = camBottom - 60;
    }

    // Niemand am Ziel, aber alle tot → Rückfrage Neustart
    if (!this.gameWon && !this.gameLost && this.finishOrder.length === 0) {
      let allElim = true;
      for (const pl of this.players.values()) {
        if (!pl.eliminated) { allElim = false; break; }
      }
      if (allElim) this.triggerPaddleAllEliminated();
    }
  }

  triggerPaddleAllEliminated() {
    if (this.gameWon || this.gameLost) return;
    this.gameLost = true;
    SFX.gameOver();
    for (const p of this.players.values()) p.frozen = true;

    const W = this.scale.width, H = this.scale.height;
    this.add.rectangle(W / 2, H / 2, W, H, 0x1a0508, 0.82)
      .setScrollFactor(0).setDepth(2000);

    this.add.text(W / 2, H * 0.22, '💀  ALLE RAUS', {
      fontFamily: 'Bungee, sans-serif', fontSize: '40px', color: '#c94f4f',
      stroke: '#1a0204', strokeThickness: 8
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    this.add.text(W / 2, H * 0.38, 'Niemand hat’s bis zum Biergarten geschafft.\nNoch eine Runde paddeln?', {
      fontFamily: 'Special Elite, monospace', fontSize: '20px', color: '#fef3d4',
      stroke: '#000', strokeThickness: 3, align: 'center', lineSpacing: 8,
      wordWrap: { width: W - 48 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    const again = this.add.text(W / 2, H * 0.58, '🛶  NOCH MAL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '24px', color: '#1a0f08',
      backgroundColor: '#6dbf47', padding: { x: 28, y: 14 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001)
      .setInteractive({ useHandCursor: true });
    again.on('pointerdown', () => this.scene.start('PaddleScene'));

    const back = this.add.text(W / 2, H * 0.72, '↩  LEVEL-AUSWAHL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '20px', color: '#fef3d4',
      backgroundColor: '#3d1a06', padding: { x: 24, y: 12 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001)
      .setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('LevelSelectScene'));

    const onInput = ({ input }) => {
      if (input && input.action) {
        socket.off('player-input', onInput);
        this.scene.start('PaddleScene');
      }
    };
    socket.on('player-input', onInput);
    this.events.once('shutdown', () => socket.off('player-input', onInput));
  }

  triggerPaddleWin() {
    if (this.gameWon) return;
    this.gameWon = true;
    SFX.win();
    for (const p of this.players.values()) p.frozen = true;

    const W = this.scale.width, H = this.scale.height;
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65)
      .setScrollFactor(0).setDepth(2000);

    const winner = this.finishOrder[0];
    const winnerLabel = winner
      ? (winner.playerName || winner.charData.name).toUpperCase()
      : '—';
    this.add.text(W / 2, H * 0.22, '🏁  RENNEN!', {
      fontFamily: 'Bungee, sans-serif', fontSize: '42px', color: '#f4c842',
      stroke: '#3d1a06', strokeThickness: 8
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    this.add.text(W / 2, H * 0.32, `GEWINN: ${winnerLabel}`, {
      fontFamily: 'Bungee, sans-serif', fontSize: '28px', color: '#6dbf47',
      stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);

    const rankLines = this.finishOrder.map((p, i) =>
      `${i + 1}. ${p.playerName || p.charData.name} (${p.charData.name})`
    );
    const dnf = (this.eliminationOrder || []).slice().reverse();
    const stillRacing = Array.from(this.players.values()).filter(
      pl => !pl.atGoal && !pl.eliminated
    );
    let bodyText = rankLines.join('\n');
    if (dnf.length) {
      bodyText += '\n\nAusgeschieden (zuletzt zuerst):\n' + dnf.map(pl =>
        `  · ${pl.playerName || pl.charData.name}`
      ).join('\n');
    }
    if (stillRacing.length) {
      bodyText += '\n\nNoch im Rennen:\n' + stillRacing.map(pl =>
        `  · ${pl.playerName || pl.charData.name}`
      ).join('\n');
    }
    this.add.text(W / 2, H * 0.5, bodyText, {
      fontFamily: 'Special Elite, monospace', fontSize: '18px',
      color: '#fef3d4', stroke: '#000', strokeThickness: 2,
      align: 'center', lineSpacing: 4, wordWrap: { width: W - 48 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2001);
    const back = this.add.text(W / 2, H * 0.88, '↩  ZURÜCK ZUR LEVEL-AUSWAHL', {
      fontFamily: 'Bungee, sans-serif', fontSize: '20px', color: '#1a0f08',
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

    // Kajak-Draufsicht: spitzer Bug (stromaufwärts = -Y), Cockpit, Doppelblatt-Paddel quer
    this.boat = scene.add.container(0, 14, []);
    const hullGfx = scene.add.graphics();
    const rim = 0x3d2818;
    const planking = 0x9a7048;
    const plankingHi = 0xb8926a;
    const cockpit = 0x4a3224;
    const paddleBlade = 0xe2d2bc;
    const paddleEdge = 0x7a6048;
    const shaftCol = 0x5c4838;

    hullGfx.fillStyle(planking, 1);
    hullGfx.lineStyle(2.5, rim, 1);
    hullGfx.beginPath();
    hullGfx.moveTo(0, -38);
    hullGfx.lineTo(16, -24);
    hullGfx.lineTo(18, 2);
    hullGfx.lineTo(14, 32);
    hullGfx.lineTo(0, 40);
    hullGfx.lineTo(-14, 32);
    hullGfx.lineTo(-18, 2);
    hullGfx.lineTo(-16, -24);
    hullGfx.closePath();
    hullGfx.fillPath();
    hullGfx.strokePath();

    hullGfx.lineStyle(1.2, plankingHi, 0.9);
    hullGfx.beginPath();
    hullGfx.moveTo(0, -32);
    hullGfx.lineTo(0, 28);
    hullGfx.strokePath();

    hullGfx.fillStyle(cockpit, 0.92);
    hullGfx.lineStyle(1.5, rim, 0.85);
    hullGfx.beginPath();
    hullGfx.moveTo(0, -18);
    hullGfx.lineTo(10, -10);
    hullGfx.lineTo(11, 8);
    hullGfx.lineTo(8, 22);
    hullGfx.lineTo(0, 26);
    hullGfx.lineTo(-8, 22);
    hullGfx.lineTo(-11, 8);
    hullGfx.lineTo(-10, -10);
    hullGfx.closePath();
    hullGfx.fillPath();
    hullGfx.strokePath();

    hullGfx.fillStyle(0x3d2a1c, 0.9);
    hullGfx.fillRoundedRect(-9, -4, 18, 7, 2);

    const py = 10;
    this.paddlePhase = Math.random() * Math.PI * 2;
    this._paddlePy = py;
    this._paddleShaft = shaftCol;
    this._paddleBlade = paddleBlade;
    this._paddleEdge = paddleEdge;
    this.paddleGfx = scene.add.graphics();
    this.paddleGfx.setPosition(0, py);
    this.redrawPaddle(0);
    this.boat.add([hullGfx, this.paddleGfx]);

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
    this.sprite.setSize(50, 50);
    scene.physics.world.enable(this.sprite);
    this.sprite.body.setAllowGravity(false);
    this.sprite.body.setCollideWorldBounds(false);
    if (this.sprite.body.refreshBody) this.sprite.body.refreshBody();

    // Stats
    this.paddleBonus = charData.stats.paddleBonus || 1;
    this.maxNitro = 100;
    this.nitro = 0;
    this.invulnTimer = 0;
    this.lateralSpeed = Math.round(200 * this.paddleBonus);
    this.boostExtraVy = Math.round(220 * Math.min(this.paddleBonus, 2));
    this.boostTimer = 0;
    this.knockbackTimer = 0;
    this.knockVx = 0;
    this.knockVy = 0;
    this.actionLatch = false;
    this.atGoal = false;
    this.frozen = false;
    this.eliminated = false;
    this.whirlpoolSlowTimer = 0;
    this._lastWhirlHit = 0;

    this.label = scene.add.text(x, y - 40, this.playerName, {
      fontFamily: 'Bungee, sans-serif', fontSize: '12px',
      color: '#fef3d4', stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);
  }

  update(input, dt, currentSpeed) {
    const body = this.sprite.body;
    if (this.eliminated) {
      body.setVelocity(0, 0);
      return;
    }
    if (this.frozen) {
      body.setVelocity(0, 0);
      return;
    }

    if (this.whirlpoolSlowTimer > 0) this.whirlpoolSlowTimer -= dt;
    const whirlFac = this.whirlpoolSlowTimer > 0 ? 0.58 : 1;
    const flowSpeed = currentSpeed * whirlFac;

    const dampKnock = Math.exp(-dt * 9);

    // Boost-Geschwindigkeit (aktiv wenn boostTimer > 0)
    const boosting = this.boostTimer > 0;
    if (boosting) this.boostTimer -= dt;

    if (this.knockbackTimer > 0) {
      this.knockbackTimer -= dt;
      this.knockVx *= dampKnock;
      this.knockVy *= dampKnock;
      let vx = this.knockVx;
      if (input.left) vx -= this.lateralSpeed * 0.4;
      if (input.right) vx += this.lateralSpeed * 0.4;
      body.setVelocityX(vx);
      let vy = -flowSpeed + this.knockVy;
      if (boosting) vy -= this.boostExtraVy;
      body.setVelocityY(vy);
      if (this.knockbackTimer <= 0) {
        this.knockVx = 0;
        this.knockVy = 0;
      }
    } else {
      let vx = 0;
      if (input.left) vx -= this.lateralSpeed;
      if (input.right) vx += this.lateralSpeed;
      body.setVelocityX(vx);

      let vy = -flowSpeed;
      if (boosting) vy -= this.boostExtraVy;
      body.setVelocityY(vy);
    }

    // ★ (Action) = Nitro verbrauchen → Boost
    if (input.action && !this.actionLatch && this.nitro > 0) {
      this.actionLatch = true;
      this.useNitro();
    } else if (!input.action) {
      this.actionLatch = false;
    }

    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    this.label.setPosition(this.sprite.x, this.sprite.y - 40);

    if (this.hudStaminaFill) {
      this.hudStaminaFill.scaleX = this.nitro / this.maxNitro;
    }

    // Doppelblatt-Paddel: seitliches „Rudern“; schneller bei Nitro (Graphics — kein Container.setOrigin)
    if (this.paddleGfx) {
      const boostRow = this.boostTimer > 0;
      const bonus = 0.88 + 0.12 * (this.paddleBonus || 1);
      this.paddlePhase += dt * (boostRow ? 11.5 : 4.0) * bonus;
      const amp = boostRow ? 0.74 : 0.52;
      this.redrawPaddle(Math.sin(this.paddlePhase) * amp);
    }

  }

  redrawPaddle(angle) {
    const g = this.paddleGfx;
    if (!g) return;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const R = (x, y) => ({ x: x * c - y * s, y: x * s + y * c });
    const shaft = this._paddleShaft;
    const blade = this._paddleBlade;
    const edge = this._paddleEdge;

    g.clear();
    const p0 = R(-44, 0);
    const p1 = R(44, 0);
    g.lineStyle(3.5, shaft, 1);
    g.beginPath();
    g.moveTo(p0.x, p0.y);
    g.lineTo(p1.x, p1.y);
    g.strokePath();

    g.fillStyle(blade, 1);
    g.lineStyle(1.2, edge, 1);
    const L0 = R(-46, 0);
    const L1 = R(-58, -5);
    const L2 = R(-58, 5);
    g.beginPath();
    g.moveTo(L0.x, L0.y);
    g.lineTo(L1.x, L1.y);
    g.lineTo(L2.x, L2.y);
    g.closePath();
    g.fillPath();
    g.strokePath();

    const R0 = R(46, 0);
    const R1 = R(58, -5);
    const R2 = R(58, 5);
    g.beginPath();
    g.moveTo(R0.x, R0.y);
    g.lineTo(R1.x, R1.y);
    g.lineTo(R2.x, R2.y);
    g.closePath();
    g.fillPath();
    g.strokePath();
  }

  drinkBeer() {
    if (this.eliminated) return;
    const mult = this.charData.stats.drinkMultiplier || 1;
    // Bier = Nitro aufladen (35 Punkte; Jan/Ahln mit drinkMultiplier kriegen mehr)
    const gain = Math.round(35 * mult);
    this.nitro = Math.min(this.maxNitro, this.nitro + gain);
    SFX.pickup();
    const txt = this.scene.add.text(this.sprite.x, this.sprite.y - 50, `⚡+${gain}`, {
      fontFamily: 'Bungee, sans-serif', fontSize: '16px', color: '#f4c842',
      stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);
    this.scene.tweens.add({
      targets: txt, y: txt.y - 35, alpha: 0, duration: 700,
      onComplete: () => txt.destroy()
    });
  }

  useNitro() {
    if (this.eliminated || this.nitro <= 0) return;
    SFX.jump();
    // Gesamtes Nitro wird verbraucht → Boost-Dauer proportional zum Tank
    const pct = this.nitro / this.maxNitro;
    this.boostTimer = 0.6 + pct * 1.8; // 0.6 s bei fast leer, bis 2.4 s bei voll
    this.nitro = 0;
    this.scene.tweens.add({ targets: this.sprite, scaleY: 1.15, yoyo: true, duration: 180 });
    const fx = this.scene.add.text(this.sprite.x, this.sprite.y - 45, '⚡ NITRO!', {
      fontFamily: 'Bungee, sans-serif', fontSize: '18px', color: '#f4c842',
      stroke: '#000', strokeThickness: 3
    }).setOrigin(0.5);
    this.scene.tweens.add({
      targets: fx, y: fx.y - 50, alpha: 0, duration: 800,
      onComplete: () => fx.destroy()
    });
  }

  applyWhirlpool() {
    if (this.eliminated || this.frozen) return;
    const now = this.scene.time.now;
    if (now - this._lastWhirlHit < 480) return;
    this._lastWhirlHit = now;
    this.whirlpoolSlowTimer = Math.max(this.whirlpoolSlowTimer, 0.85);
    this.nitro = Math.max(0, this.nitro - 8);
    SFX.hit();
    this.scene.tweens.add({
      targets: this.boat,
      angle: (this.boat.angle || 0) + 26,
      duration: 260,
      yoyo: true,
      ease: 'Sine.inOut'
    });
  }

  hitObstacle(obstacle) {
    if (this.eliminated) return;
    if (this.invulnTimer > 0) return;
    this.invulnTimer = 0.9;
    SFX.hit();
    this.nitro = Math.max(0, this.nitro - 20); // Aufprall kostet Nitro
    this.scene.cameras.main.shake(150, 0.004);

    const body = this.sprite.body;
    if (obstacle && obstacle.body) {
      const dx = this.sprite.x - obstacle.x;
      const dy = this.sprite.y - obstacle.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      this.knockbackTimer = 0.32;
      this.knockVx = nx * 360;
      this.knockVy = ny * 260 - 160;
      this.sprite.x += nx * 6;
      this.sprite.y += ny * 6;
      if (body && body.updateFromGameObject) body.updateFromGameObject();
    }

    this.scene.tweens.add({
      targets: this.sprite, alpha: 0.3,
      yoyo: true, repeat: 2, duration: 100,
      onComplete: () => { this.sprite.alpha = 1; }
    });
  }

  eliminate() {
    if (this.eliminated) return;
    this.eliminated = true;
    this.frozen = true;
    this.scene.onPlayerEliminated(this);
    const body = this.sprite.body;
    if (body) body.setVelocity(0, 0);
    SFX.gameOver();
    this.label.setText('💀 RAUS');
    this.label.setStyle({ fill: '#c94f4f' });
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0.35,
      scale: 0.55,
      angle: this.sprite.angle + 0.5,
      duration: 500,
      ease: 'Quad.in'
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
