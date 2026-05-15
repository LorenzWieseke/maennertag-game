// characters.js — gemeinsame Charakter-Liste für Host (game.js) und Controller.
// color = Phaser-Integer (0xRRGGBB), colorHex = CSS für Controller.

(function (root) {
  const MAENNERTAG_CHARACTERS = [
    { id: 'manu',   name: 'Manu',   color: 0x4a90e2, colorHex: '#4a90e2', ability: 'Ausdauer-Bestie',  desc: 'Stamina regeneriert 2× schneller, höhere max. Stamina',
      stats: { maxStamina: 150, baseSpeed: 230, staminaRegen: 2.0 } },
    { id: 'ahln',   name: 'Ahln',   color: 0xc94f4f, colorHex: '#c94f4f', ability: 'Bierschwamm',      desc: '2× Energie pro Schluck, immun gegen Besoffen-Debuff',
      stats: { maxStamina: 110, baseSpeed: 210, staminaRegen: 1.0, drinkMultiplier: 2.0, drunkImmune: true } },
    { id: 'schumi', name: 'Schumi', color: 0x6dbf47, colorHex: '#6dbf47', ability: 'Chillout-Modus',   desc: 'Slow-Motion für 3s (Special-Taste), 15s Cooldown',
      stats: { maxStamina: 100, baseSpeed: 220, staminaRegen: 1.0 } },
    { id: 'lorenz', name: 'Lorenz', color: 0xe8a04e, colorHex: '#e8a04e', ability: 'Glücksgriff',      desc: 'Findet öfter Power-Ups in seiner Nähe',
      stats: { maxStamina: 100, baseSpeed: 220, staminaRegen: 1.0, luckRadius: 200 } },
    { id: 'stefan', name: 'Stefan', color: 0x2c2c2c, colorHex: '#2c2c2c', ability: 'Coolness-Aura',    desc: 'Immun gegen Blendung, Special: Riesensprung mit Extra-Höhe',
      stats: { maxStamina: 100, baseSpeed: 220, staminaRegen: 1.0, hasSunglasses: true } },
    { id: 'jan',    name: 'Jan',    color: 0x4a8a8a, colorHex: '#4a8a8a', ability: 'Paddel-König',     desc: '2× Paddel-Speed, Angel-Special zieht Items aus der Ferne',
      stats: { maxStamina: 110, baseSpeed: 215, staminaRegen: 1.2, paddleBonus: 2.0 } },
    { id: 'sven',   name: 'Sven',   color: 0xb84a9e, colorHex: '#b84a9e', ability: 'Marathon-Mann',    desc: 'Höchstes Grundtempo, Sprint-Boost auf Special-Taste',
      stats: { maxStamina: 130, baseSpeed: 270, staminaRegen: 1.5 } }
  ];

  root.MAENNERTAG_CHARACTERS = MAENNERTAG_CHARACTERS;
})(typeof window !== 'undefined' ? window : globalThis);
