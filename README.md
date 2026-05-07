# 🍻 Männertag-Game

Ein webbasierter Multiplayer-Side-Scroller für sieben Freunde. Smartphones werden via QR-Code zu Controllern, ein Laptop/Fernseher zeigt das Spiel.

## 🎮 Features

- **Phaser 3** als 2D-Engine — robust, performant, Arcade-Physics
- **Socket.IO** für Echtzeit-Multiplayer im lokalen Netz
- **QR-Code-Verbindung** der Handys ohne App-Installation
- **Sieben Charaktere** mit individuellen Spezialfähigkeiten
- **Mobiler Touch-Controller** mit haptischem Feedback und Multi-Touch-Support
- **Stamina + Drunkenness-Mechanik**: Trinken füllt Energie, aber zu viel kehrt die Steuerung um (außer für Ahln)

## 🚀 Quickstart

```bash
npm install
npm start
```

Nach dem Start zeigt der Server zwei URLs an:

```
🍻  MÄNNERTAG-GAME-SERVER

   Spiel-Bildschirm:  http://192.168.x.x:3000/
   Controller-URL:    http://192.168.x.x:3000/controller.html
```

1. Den **Spiel-Bildschirm** auf einem großen Display öffnen (Laptop am Beamer/TV)
2. Die Handys mit dem QR-Code aus der Lobby verbinden
3. Jeder gibt seinen Namen ein, wählt einen Charakter
4. Wenn alle drin sind → "SPIEL STARTEN" auf dem Host

> **Wichtig:** Alle Geräte müssen im gleichen WLAN sein. Im Notfall kann das Host-Notebook ein Hotspot aufmachen.

## 🧠 Architektur

```
┌──────────────────────────────────────┐
│  Host-Bildschirm  (Laptop / TV)      │
│  ──────────────                       │
│  • index.html — Lobby + QR-Code       │
│  • game.js    — Phaser-Spielelogik    │
│  • Empfängt Inputs als Socket-Events  │
└─────────┬────────────────────────────┘
          │   Socket.IO (im LAN)
          │
┌─────────┴────────────────────────────┐
│  server.js (Node + Express)          │
│  • Statisches Hosting (public/)       │
│  • /qr-Endpoint generiert QR-Code     │
│  • Socket.IO-Hub: forwarded Inputs    │
└─────────┬────────────────────────────┘
          │   Socket.IO
          │
┌─────────┴────────────────────────────┐
│  7× Smartphone-Controller             │
│  ──────────────                       │
│  • controller.html — Touch-UI         │
│  • controller.js   — sendet Inputs    │
└──────────────────────────────────────┘
```

Spielzustand lebt **ausschließlich auf dem Host-Browser** — der Server ist nur ein dummer Eingabe-Hub. Das macht die Entwicklung deutlich einfacher (kein State-Sync nötig, keine Latenz-Korrektur).

## 🎭 Charaktere

| Char    | Fähigkeit                | Special-Knopf-Effekt                          |
|---------|--------------------------|-----------------------------------------------|
| Manu    | Ausdauer-Bestie          | Stamina sofort voll (18s CD)                  |
| Ahln    | Bierschwamm              | Mega-Schluck: Stamina voll + Drunk reset (12s)|
| Schumi  | Chillout-Modus           | Slow-Motion 3s (15s CD)                       |
| Lorenz  | Glücksgriff              | Spawnt 5 Biere um sich (25s CD)               |
| Stefan  | Coolness-Aura            | Gruppen-Speed-Boost +20% für 4s (20s CD)     |
| Jan     | Paddel-König             | Angel: zieht Items im Umkreis an (8s CD)     |
| Sven    | Marathon-Mann            | Sprint: 1.7× Speed für 2.5s (10s CD)         |

## 🗺️ Level

**Level 1 — Paddeln** (TODO): Top-Down Fluss, alternierende Paddelschläge, Hindernisse: Felsen + Treibholz.

**Level 2 — Wanderung von Brauerei zu Brauerei** (✅ implementiert): Side-Scroller, springen über Steine, vier Brauerei-Checkpoints füllen die Stamina, Bier-Pickups unterwegs.

**Level 3 — Weinkeller** (TODO): Plattformer mit Lichtquellen, Wein wirkt stärker als Bier.

## 🔧 Erweitern

- **Neue Szene:** Klasse von `Phaser.Scene` ableiten, in der `scene`-Liste in `game.js` ergänzen.
- **Neue Spielmechanik pro Charakter:** in `useAbility()` einen neuen `case` für die Charakter-ID hinzufügen.
- **Eigene Sprites/Sounds:** in `preload()` der Szene laden, derzeit wird mit Phaser-Geometry gearbeitet damit alles ohne Assets läuft.
- **Lobby-Reconnect:** Bei Verbindungsverlust verbindet sich das Handy automatisch wieder — wenn du das Spiel pausierbar machen willst, müssen Eingaben am Host angehalten werden.

## 📝 Bekannte Limitierungen

- Phaser wird via CDN geladen — falls ihr offline spielen wollt, lokal bundeln.
- Die Charaktere sind aktuell farbige Rechtecke. Für richtige Pixelart-Sprites empfehle ich [Aseprite](https://www.aseprite.org/) oder OpenGameArt-Assets.
- Kein Server-side Anti-Cheat. Aber wer cheatet bei sich selbst? 🤷

## 📄 Lizenz

Privat / Männertag-internal. Bedien dich.
