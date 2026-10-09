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
//   again    true: a named second visit of a zone (the second capital stops of Human, Dwarf and Gnome)
//   exclude  boxes { x1, y1, x2, y2, why } in map percent; a quest whose giver stands inside is left out, with that reason
//   entry    { x, y } where you come in when the zone before is on the other continent

const CAPITALS = ["Stormwind City", "Ironforge", "Darnassus", "Orgrimmar", "Thunder Bluff", "Undercity"];

// Where every Alliance race goes after Duskwood (all on the Eastern Kingdoms). Duskwood runs to 28 and Wetlands starts there;
// Arathi Highlands is thin in the data and ends at 35, Stranglethorn Vale starts there. Each boundary sits two levels from the
// plain 26 / 31 / 37 split, which left Human, Dwarf and Gnome with more than 30 levels of grinding.
const ALLIANCE_TAIL = [
  { zone: "Wetlands", lo: 28, hi: 31 },
  { zone: "Arathi Highlands", lo: 31, hi: 35 },
  { zone: "Stranglethorn Vale", lo: 35, hi: 44 },
  { zone: "The Hinterlands", lo: 44, hi: 49 },
  { zone: "Burning Steppes", lo: 49, hi: 54 },
  { zone: "Western Plaguelands", lo: 54, hi: 57 },
  { zone: "Eastern Plaguelands", lo: 57, hi: 60 },
];

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

// Rows shared by two races are written once; the builder never changes a row.
// Dwarf and Gnome stop in Ironforge a second time at 54, between Burning Steppes and Western Plaguelands: the flights between the
// two go through Ironforge, and the guides give quests there at levels 52 to 54 (Passing the Burden, An Easy Pickup,
// Signal for Pickup, A Little Slime Goes a Long Way, The Smoldering Ruins of Thaurissan) that the stop at 10 cannot take.
const DWARF_ROWS = [
  { zone: "Dun Morogh", lo: 1, hi: 10 },
  { zone: "Ironforge", lo: 10, hi: 10, stop: true },
  { zone: "Loch Modan", lo: 10, hi: 14 },
  { zone: "Westfall", lo: 14, hi: 18 },
  { zone: "Redridge Mountains", lo: 18, hi: 22 },
  { zone: "Duskwood", lo: 22, hi: 28 },
  ...ALLIANCE_TAIL.filter((r) => r.lo < 54),
  { zone: "Ironforge", lo: 54, hi: 54, stop: true, again: true },
  ...ALLIANCE_TAIL.filter((r) => r.lo >= 54),
];
const ORC_ROWS = [
  { zone: "Durotar", lo: 1, hi: 10, exclude: [{ x1: 85, y1: 0, x2: 100, y2: 100, why: "in Bilgewater, a Turtle goblin start" }] },
  { zone: "Orgrimmar", lo: 10, hi: 10, stop: true },
  { zone: "The Barrens", lo: 10, hi: 24 },
  ...HORDE_TAIL,
];

// The order of RACES is the order of the paths in Data/Route.lua and of the visit numbers.
const RACES = [
  {
    key: "Human", name: "Human", file: "Human", faction: "Alliance", bit: 1,
    start: { zone: "Elwynn Forest", x: 50.05, y: 42.69 },
    rows: [
      { zone: "Elwynn Forest", lo: 1, hi: 10 },
      { zone: "Stormwind City", lo: 10, hi: 10, stop: true },
      { zone: "Westfall", lo: 10, hi: 15 },
      { zone: "Redridge Mountains", lo: 15, hi: 20 },
      { zone: "Duskwood", lo: 20, hi: 28 },
      // A second Stormwind stop at 28: the way from Duskwood to the Wetlands goes through Stormwind (then the tram to Ironforge and
      // Loch Modan), and the guides give the Missing Diplomat, Legend of Stalvan and Doomed Fleet quests there at 28 and 29.
      { zone: "Stormwind City", lo: 28, hi: 28, stop: true, again: true },
      ...ALLIANCE_TAIL,
    ],
  },
  {
    key: "Dwarf", name: "Dwarf", file: "Dwarf", faction: "Alliance", bit: 4,
    start: { zone: "Dun Morogh", x: 29.93, y: 71.2 },
    rows: DWARF_ROWS,
  },
  {
    key: "Gnome", name: "Gnome", file: "Gnome", faction: "Alliance", bit: 64,
    start: { zone: "Dun Morogh", x: 29.93, y: 71.2 },
    rows: DWARF_ROWS,
  },
  {
    key: "NightElf", name: "Night Elf", file: "NightElf", faction: "Alliance", bit: 8,
    start: { zone: "Teldrassil", x: 58.7, y: 44.27 },
    rows: [
      { zone: "Teldrassil", lo: 1, hi: 10 },
      { zone: "Darnassus", lo: 10, hi: 10, stop: true },
      { zone: "Darkshore", lo: 10, hi: 20 },
      { zone: "Ashenvale", lo: 20, hi: 28 },
      { zone: "Stonetalon Mountains", lo: 28, hi: 31 },
      { zone: "Desolace", lo: 31, hi: 37 },
      { zone: "Dustwallow Marsh", lo: 37, hi: 41 },
      { zone: "Feralas", lo: 41, hi: 47 },
      { zone: "Tanaris", lo: 47, hi: 51 },
      { zone: "Azshara", lo: 51, hi: 54 },
      { zone: "Felwood", lo: 54, hi: 57 },
      { zone: "Winterspring", lo: 57, hi: 60 },
    ],
  },
  {
    key: "Orc", name: "Orc", file: "Orc", faction: "Horde", bit: 2,
    start: { zone: "Durotar", x: 43.29, y: 68.53 },
    rows: ORC_ROWS,
  },
  {
    key: "Troll", name: "Troll", file: "Troll", faction: "Horde", bit: 128,
    start: { zone: "Durotar", x: 43.29, y: 68.53 },
    rows: ORC_ROWS,
  },
  {
    key: "Tauren", name: "Tauren", file: "Tauren", faction: "Horde", bit: 32,
    start: { zone: "Mulgore", x: 44.92, y: 77.12 },
    rows: [
      { zone: "Mulgore", lo: 1, hi: 10 },
      { zone: "Thunder Bluff", lo: 10, hi: 10, stop: true },
      { zone: "The Barrens", lo: 10, hi: 24 },
      ...HORDE_TAIL,
    ],
  },
  {
    key: "Scourge", name: "Undead", file: "Undead", faction: "Horde", bit: 16,
    start: { zone: "Tirisfal Glades", x: 30.04, y: 72.78 },
    rows: [
      { zone: "Tirisfal Glades", lo: 1, hi: 10 },
      { zone: "Silverpine Forest", lo: 10, hi: 15 },
      { zone: "Undercity", lo: 15, hi: 15, stop: true },
      { zone: "The Barrens", lo: 15, hi: 24, entry: { x: 52, y: 30 } },
      ...HORDE_TAIL,
    ],
  },
];

module.exports = { CAPITALS, ALLIANCE_TAIL, HORDE_TAIL, RACES };
