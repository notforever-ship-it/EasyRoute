// The hand-kept zone ladder for the route builder (tools/build-route.js): which zones a starting race walks through,
// in which order, and from which level to which. This is the one file the owner's corrections touch; the tool never
// invents the order, it only fills each visit with the zone's quests and works out the levels.
//
// Per race:
//   key      the game's race name (the second value of UnitRace): Human, Dwarf, Gnome, NightElf, Orc, Troll, Tauren, Scourge
//   name     plain name for the outline          file     outline file name
//   faction  Alliance or Horde                   bit      race mask bit: Human 1, Orc 2, Dwarf 4, NightElf 8, Scourge 16, Tauren 32, Gnome 64, Troll 128
//   start    zone, x, y: the first place of RestedXP's 1-6 guide for the race (the first quest giver is nearest to it)
//   rows     the visits in order
// Per row:
//   zone     exact key of Data/ZoneSizes.lua       lo, hi   level in, level out
//   stop     true: a capital short stop (lo equals hi, only quests that start in the city)
//   again    true: a named second visit of a zone (none is used)
//   exclude  boxes { x1, y1, x2, y2, why } in map percent; a quest whose giver stands inside is left out, with that reason
//   entry    { x, y } where you come in when the zone before is on the other continent

const CAPITALS = ["Stormwind City", "Ironforge", "Darnassus", "Orgrimmar", "Thunder Bluff", "Undercity"];

// Where every Horde race goes after the Barrens (all on Kalimdor).
const HORDE_TAIL = [
  { zone: "Stonetalon Mountains", lo: 24, hi: 27 },
  { zone: "Ashenvale", lo: 27, hi: 30 },
  { zone: "Thousand Needles", lo: 30, hi: 33 },
  { zone: "Desolace", lo: 33, hi: 37 },
  { zone: "Dustwallow Marsh", lo: 37, hi: 41 },
  { zone: "Tanaris", lo: 41, hi: 48 },
  { zone: "Azshara", lo: 48, hi: 51 },
  { zone: "Un'Goro Crater", lo: 51, hi: 54 },
  { zone: "Felwood", lo: 54, hi: 57 },
  { zone: "Silithus", lo: 57, hi: 60 },
];

const RACES = [
  {
    key: "Orc", name: "Orc", file: "Orc", faction: "Horde", bit: 2,
    start: { zone: "Durotar", x: 43.29, y: 68.53 },
    rows: [
      { zone: "Durotar", lo: 1, hi: 10, exclude: [{ x1: 85, y1: 0, x2: 100, y2: 100, why: "in Bilgewater, a Turtle goblin start" }] },
      { zone: "Orgrimmar", lo: 10, hi: 10, stop: true },
      { zone: "The Barrens", lo: 10, hi: 24 },
      ...HORDE_TAIL,
    ],
  },
];

module.exports = { CAPITALS, HORDE_TAIL, RACES };
