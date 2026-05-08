// pixelchars.js
// Procedural pixel-art generator für die sieben Männertag-Charaktere.
// Wird sowohl vom Host (Phaser-Texturen) als auch vom Controller (HTML-Canvas)
// benutzt — eine Quelle der Wahrheit, damit Avatare in Lobby + Spiel identisch
// aussehen.
//
// Design: 14 × 22 Pixel-Grid, jeder Pixel wird im Spiel als 5×5 px gerendert
// (= ca. 70 × 110 Game-Units, vergleichbar mit einem Broforce-Sprite).

(function (root) {
  const SPRITE_W = 14;
  const SPRITE_H = 22;
  const PIXEL_SIZE = 5;

  // -------------------------------------------------------------
  //  CHARAKTER-SPECS — direkt aus den realen Eigenschaften
  // -------------------------------------------------------------
  // skin/hair/body/pants: 0xRRGGBB
  // hat: 'cap' | undefined
  // glasses: 'clear' (Brille) | 'round' (Nickelbrille) | 'sun' (Sonnenbrille) | undefined
  // beard: Farbe (truthy = Bart vorhanden)
  // joint, fishingRod: bool — Accessoires
  const CHAR_SPECS = {
    // Manu — Vollbart, dunkle Haare, klare Brille, sportliches Trikot
    manu: {
      skin: 0xf2c890, hair: 0x2a1a08, beard: 0x2a1a08, glasses: 'clear',
      body: 0x8a1a1a, bodyAccent: 0xffffff, pants: 0x1a1a1a,
      tagColor: 0x8a1a1a
    },
    // Ahln — dunkles Cappy, tief blaue Jacke, Sling-Bag quer über die Brust
    ahln: {
      skin: 0xf2c890, hair: 0x2a1a08, hat: 'cap', hatColor: 0x1a1a1a,
      body: 0x0c2c5e, bodyAccent: 0x051a3c, pants: 0x3a5a8a,
      slingBag: true,             // Brusttasche diagonal über die Schulter
      slingStrap: 0x2a1a08, slingPouch: 0x4a2a08,
      tagColor: 0x0c2c5e
    },
    // Schumi — rote Jacke, dunkle Jeans, graues Cap mit Schirm vorn,
    // einfache Augen, langer Joint
    schumi: {
      skin: 0xf2c890, hair: 0x2a1a08,
      hat: 'cap', hatColor: 0x6a6a6a,    // grau (war grün)
      // glasses entfernt — einfache Augen sind klarer als die Mini-Brille
      body: 0xc94f4f,                    // rote Jacke
      pants: 0x1f3a6a,                   // dunkle Jeans
      joint: true,
      tagColor: 0xc94f4f
    },
    // Lorenz — Glatze (rund), schwarzer Pulli, lange blaue Hose
    lorenz: {
      skin: 0xf2c890, bald: true,
      body: 0x1a1a1a, bodyAccent: 0x0a0a0a,
      pants: 0x2a4a8a,            // dunkleres Blau, lange Hose
      tagColor: 0x3a6aaa
    },
    // Stefan — Sonnenbrille, dunkelblondes Haar (kein Matrix-Schwarz mehr)
    stefan: {
      skin: 0xf2c890, hair: 0xb88848, glasses: 'sun',
      body: 0x2c2c2c, bodyAccent: 0x1a1a1a, pants: 0x2c2c2c,
      tagColor: 0x6a6a6a
    },
    // Jan — ruhiger Angler, Bart, Outdoor-Weste
    jan: {
      skin: 0xe6b878, hair: 0x6a4a2a, beard: 0x6a4a2a,
      body: 0x4a6a4a, bodyAccent: 0x2a4a2a, pants: 0x8a6a3a,
      fishingRod: true, tagColor: 0x4a8a8a
    },
    // Sven — rote Haare (Ginger), Ginger-Bart, blau-weiß gestreiftes Hemd
    sven: {
      skin: 0xf8d8a8, hair: 0xd86a1a, beard: 0xd86a1a,
      body: 0xeeeeee,                  // weiß als Hauptfarbe
      bodyAccent: 0x2858a8,            // blau für Streifen
      stripes: 'horizontal',           // alternierende Streifen
      pants: 0x1a1a1a,
      tagColor: 0x2858a8
    }
  };

  // -------------------------------------------------------------
  //  BUILD GRID — die eigentliche "Zeichnung" als 14×22 Farbgitter
  // -------------------------------------------------------------
  function buildCharCells(spec) {
    const cells = Array.from({ length: SPRITE_H }, () => new Array(SPRITE_W).fill(null));

    // ===== Schuhe =====
    for (let x = 3; x < 6; x++) cells[21][x] = 0x1a0f08;
    for (let x = 8; x < 11; x++) cells[21][x] = 0x1a0f08;

    // ===== Hose / Shorts (Rows 16-20) =====
    if (spec.shortPants) {
      // Kurze Hose: oben Hose-Farbe, unten nackte Beine (Skin)
      for (let y = 16; y < 18; y++) {
        for (let x = 4; x < 10; x++) cells[y][x] = spec.pants;
      }
      for (let y = 18; y < 21; y++) {
        for (let x = 4; x < 10; x++) cells[y][x] = spec.skin;
      }
    } else {
      for (let y = 16; y < 21; y++) {
        for (let x = 4; x < 10; x++) cells[y][x] = spec.pants;
      }
    }
    // Beinlücke unten (immer)
    for (let y = 18; y < 21; y++) cells[y][6] = 0x1a0f08;

    // ===== Gürtel =====
    for (let x = 3; x < 11; x++) cells[15][x] = 0x1a0f08;
    cells[15][7] = 0xc4a04a; // Schnalle

    // ===== Torso (Rows 10-14) =====
    for (let y = 10; y < 15; y++) {
      for (let x = 3; x < 11; x++) cells[y][x] = spec.body;
    }
    // Akzent-Streifen (z.B. Trikot-Linie) — überschreibt Body
    if (spec.bodyAccent && !spec.stripes) {
      for (let x = 3; x < 11; x++) cells[12][x] = spec.bodyAccent;
    }

    // Horizontal gestreiftes Hemd (alternierende Reihen body / bodyAccent)
    if (spec.stripes === 'horizontal' && spec.bodyAccent) {
      for (let y = 10; y < 15; y++) {
        const stripe = ((y - 10) % 2) === 1;
        for (let x = 3; x < 11; x++) cells[y][x] = stripe ? spec.bodyAccent : spec.body;
      }
    }

    // ===== Sling-Bag (Brusttasche quer über die Schulter, z.B. Ahln) =====
    if (spec.slingBag) {
      const strap = spec.slingStrap || 0x2a1a08;
      const pouch = spec.slingPouch || 0x4a2a08;
      // Riemen diagonal von linker Schulter zur rechten Hüfte
      cells[10][4] = strap;
      cells[11][5] = strap;
      cells[12][6] = strap;
      cells[13][7] = strap;
      // Tasche unten rechts auf der Hüfte
      cells[13][8] = pouch;
      cells[13][9] = pouch;
      cells[14][8] = pouch;
      cells[14][9] = 0xc4a04a;  // Schnallen-Highlight
    }

    // ===== Arme + Hände =====
    for (let y = 11; y < 14; y++) {
      cells[y][2] = spec.body;
      cells[y][11] = spec.body;
    }
    cells[14][2] = spec.skin;
    cells[14][11] = spec.skin;

    // ===== Hals =====
    cells[10][6] = spec.skin;
    cells[10][7] = spec.skin;

    // ===== Kopf (Rows 5-9, 4-9) =====
    for (let y = 5; y < 10; y++) {
      for (let x = 4; x < 10; x++) cells[y][x] = spec.skin;
    }
    // Ohren
    cells[7][3] = spec.skin;
    cells[7][10] = spec.skin;

    // ===== Haare / Glatze / Cappy-Schatten =====
    if (spec.bald && !spec.hat) {
      // Glatze: komplett hautfarben, obere Ecken ausgespart → runder Schädel
      for (let x = 4; x < 10; x++) cells[3][x] = spec.skin;
      for (let x = 4; x < 10; x++) cells[4][x] = spec.skin;
      // Obere Ecken aussparen, damit der Kopf nicht viereckig ("Frankenstein") aussieht
      cells[3][4] = null;
      cells[3][9] = null;
    } else if (spec.hair && !spec.hat) {
      for (let x = 3; x < 11; x++) cells[3][x] = spec.hair;
      for (let x = 3; x < 11; x++) cells[4][x] = spec.hair;
      cells[5][3] = spec.hair;
      cells[5][10] = spec.hair;
      cells[6][3] = spec.hair;
      cells[6][10] = spec.hair;
    } else if (spec.hair && spec.hat === 'cap') {
      cells[5][3] = spec.hair;
      cells[5][10] = spec.hair;
      cells[6][3] = spec.hair;
      cells[6][10] = spec.hair;
    }

    // ===== Cappy =====
    if (spec.hat === 'cap') {
      // Cap-Hauptfläche
      if (spec.hatPattern === 'rainbow') {
        // Buntes Cappy — vier Farben in Streifen
        const palette = [0xe83a3a, 0xf4c842, 0x4ab8e8, 0xe88a3a];
        for (let x = 3; x < 11; x++) {
          cells[3][x] = palette[(x - 3) % 4];
          cells[4][x] = palette[(x - 3) % 4];
        }
      } else {
        for (let x = 3; x < 11; x++) cells[3][x] = spec.hatColor;
        for (let x = 3; x < 11; x++) cells[4][x] = spec.hatColor;
      }
      // Schirm — entweder nach vorn (Standard) oder hochgeklappt (Rad-Cap-Style)
      const peak = spec.hatColor || 0x1a1a1a;
      if (spec.hatStyle === 'flipped-bill') {
        // Schirm zeigt nach oben/hinten — eine Reihe oberhalb der Cap
        for (let x = 4; x < 10; x++) cells[2][x] = peak;
        cells[2][3] = 0x1a1a1a; cells[2][10] = 0x1a1a1a; // Kanten-Akzent
      } else {
        // Schirm nach vorn (rechts)
        for (let x = 7; x < 12; x++) cells[5][x] = peak;
      }
    }

    // ===== Augen / Brille =====
    if (spec.glasses === 'clear') {
      // klare Brille — schwarze Rahmen, weiße Linsen
      cells[6][4] = 0x1a1a1a; cells[6][5] = 0x1a1a1a;
      cells[6][8] = 0x1a1a1a; cells[6][9] = 0x1a1a1a;
      cells[7][4] = 0x1a1a1a; cells[7][5] = 0xffffff;
      cells[7][8] = 0xffffff; cells[7][9] = 0x1a1a1a;
      cells[7][6] = 0x1a1a1a; cells[7][7] = 0x1a1a1a; // Brücke
    } else if (spec.glasses === 'round') {
      // runde Nickelbrille
      cells[6][5] = 0x1a1a1a; cells[6][8] = 0x1a1a1a;
      cells[7][5] = 0x1a1a1a; cells[7][8] = 0x1a1a1a;
      cells[7][6] = 0x1a1a1a; cells[7][7] = 0x1a1a1a;
    } else if (spec.glasses === 'sun') {
      // dicke Sonnenbrille
      for (let x = 4; x < 10; x++) cells[7][x] = 0x000000;
      cells[6][4] = 0x000000; cells[6][5] = 0x000000;
      cells[6][8] = 0x000000; cells[6][9] = 0x000000;
    } else {
      // einfache Augen
      cells[7][5] = 0x1a1a1a;
      cells[7][8] = 0x1a1a1a;
    }

    // ===== Bart =====
    if (spec.beard) {
      cells[8][4] = spec.beard;
      cells[8][9] = spec.beard;
      for (let x = 4; x < 10; x++) cells[9][x] = spec.beard;
    } else {
      // Mund
      cells[9][6] = 0x8a4a2a;
      cells[9][7] = 0x8a4a2a;
    }

    // ===== Accessoire: Joint / lange Zigarette (Schumi) =====
    // Hängt im rechten Mundwinkel und ragt waagerecht nach rechts raus.
    // Weißer Schaft + Glut an der Spitze. Der Qualm bleibt im Spiel
    // animiert (siehe HikePlayer), damit der statische Avatar sauber aussieht.
    // Mund liegt bei (row 9, x=6/7) — der Joint setzt rechts daneben an.
    if (spec.joint) {
      // Filter / Mundstück am Mundwinkel
      cells[9][8]  = 0xf2e6b8;
      // Langer dünner Papier-Schaft (4 px) waagerecht
      cells[9][9]  = 0xfafafa;
      cells[9][10] = 0xfafafa;
      cells[9][11] = 0xfafafa;
      cells[9][12] = 0xfafafa;
      // Glut an der Spitze
      cells[9][13] = 0xff5018;  // heißer Glutkern
      cells[8][13] = 0xff8a2a;  // warmer Glut-Halo darüber
    }

    // ===== Accessoire: Angel (Jan) — Rute geht diagonal hoch =====
    if (spec.fishingRod) {
      cells[5][12] = 0x6b4a2a;
      cells[6][12] = 0x6b4a2a;
      cells[7][12] = 0x6b4a2a;
      cells[8][12] = 0x6b4a2a;
      cells[9][13] = 0x6b4a2a;
      cells[10][13] = 0x6b4a2a;
      cells[11][13] = 0x6b4a2a;
      cells[4][12] = 0xc4c4c4; // Spule oben
    }

    return cells;
  }

  // -------------------------------------------------------------
  //  CANVAS-RENDERER — für HTML-DOM (Lobby, Char-Auswahl, Banner)
  // -------------------------------------------------------------
  function buildCharCanvas(specOrId, scale) {
    if (scale == null) scale = 4;
    const spec = typeof specOrId === 'string' ? CHAR_SPECS[specOrId] : specOrId;
    const c = document.createElement('canvas');
    c.width = SPRITE_W * scale;
    c.height = SPRITE_H * scale;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const cells = buildCharCells(spec);
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) {
        const col = cells[y][x];
        if (col === null) continue;
        ctx.fillStyle = '#' + col.toString(16).padStart(6, '0');
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return c;
  }

  function buildCharDataURL(specOrId, scale) {
    return buildCharCanvas(specOrId, scale).toDataURL('image/png');
  }

  // -------------------------------------------------------------
  //  PHASER-TEXTUR — wird in scene.preload() aufgerufen
  // -------------------------------------------------------------
  function buildPhaserCharTexture(scene, key, specOrId) {
    const spec = typeof specOrId === 'string' ? CHAR_SPECS[specOrId] : specOrId;
    if (scene.textures.exists(key)) return;
    const cells = buildCharCells(spec);
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) {
        const col = cells[y][x];
        if (col === null) continue;
        g.fillStyle(col, 1);
        g.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
      }
    }
    g.generateTexture(key, SPRITE_W * PIXEL_SIZE, SPRITE_H * PIXEL_SIZE);
    g.destroy();
  }

  root.MaennertagPixelChars = {
    SPRITE_W, SPRITE_H, PIXEL_SIZE,
    CHAR_SPECS,
    buildCharCells,
    buildCharCanvas,
    buildCharDataURL,
    buildPhaserCharTexture
  };
})(typeof window !== 'undefined' ? window : globalThis);
