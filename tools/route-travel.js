// The hand-kept travel words for the route builder (tools/build-route.js): how a player gets from one zone of a race's path to the
// next one. This is the one file the owner's travel corrections touch; the builder checks it and writes it into Data/Route.lua
// (a travel table), and the game turns each entry into the first steps of the next zone. Nothing here is game code.
//
// Per move, one entry. The key is "<Faction>|<From zone>><To zone>" (the faction is in the key because the same two zones can
// need different words for the Alliance and the Horde, for example Desolace to Dustwallow Marsh). The value:
//   check  true: not confirmed in the game yet ("please check in the game"). The builder counts these and lists them in
//          .planning/route-outlines/TRAVEL.txt. Their words are simple and safe: "Head to <Zone>: ..." and a plain direction.
//   legs   1 to 4 legs, in the order you do them. A leg:
//     kind  walk, fly, boat, zeppelin, tram or portal
//     text  what the player reads: one plain instruction in English. It starts with a verb (Walk, Follow, Take, Fly, Leave, Ride,
//           Go, Head, Talk, Cross, Run), says the kind of transport in its first words (Fly ..., Take the boat ...), names only
//           towns, NPCs, gates and zones a player sees, has no digits, no ";" or "=" and no "or" (never two ways), and is at
//           most 140 characters long.
//     tick  the zone (or a sub-zone, a town name) the player has reached when the leg is done. It is never the zone the leg
//           starts in. The last leg may leave it out: it is then the zone the move goes to. Zones are safer than town names:
//           the game compares the name it shows, and a wrong town name never ticks.
//     at    only when tick is a sub-zone: the zone that sub-zone is in. A leg always ends in a zone of Data/ZoneSizes.lua.
//     via   where the arrow points while the leg is current: "x y Zone" (map percent), in the zone the leg starts in: a gate, a
//           dock, a road out. Leave it out when no place is known (the arrow then points at the next zone's first area).
//           A fly leg has no via: its place is the flight master it leaves from (fm).
//     fm    fly legs only: the flight master you leave from (the NPC name as RestedXP's guides write it in Data/Guides.lua).
//     to    fly legs only: the flight master you land at.
// The zone a leg starts in is the From zone for the first leg, else the zone the leg before ended in. Zone names are written
// exactly as the keys of Data/ZoneSizes.lua. In the game a zone starts with its travel steps; when you already stand in a zone
// the move leads to (or a later stop of the entry), the steps before it are skipped at once.
// Sources: places of gates, docks and roads are RestedXP's own steps (Data/Guides.lua); the words are mine from vanilla 1.12 and
// Turtle WoW. Moves with check: true have no data behind them; please confirm them in the game and send me the right words.

const TRAVEL = {
  // ---- Alliance ----
  // Human
  "Alliance|Elwynn Forest>Stormwind City": { legs: [
    { kind: "walk", text: "Follow the road north from Goldshire to Stormwind." },
  ] },
  "Alliance|Stormwind City>Westfall": { legs: [
    { kind: "walk", text: "Leave Stormwind by the main gate, follow the road to Goldshire, then the road west to Sentinel Hill.", via: "71.19 89.1 Stormwind City" },
  ] },
  "Alliance|Westfall>Redridge Mountains": { legs: [
    { kind: "fly", text: "Fly from Sentinel Hill to Stormwind.", fm: "Thor", to: "Dungar Longdrink", tick: "Stormwind City" },
    { kind: "walk", text: "Leave Stormwind by the main gate and follow the road east through Elwynn Forest to Lakeshire.", via: "71.19 89.1 Stormwind City" },
  ] },
  "Alliance|Redridge Mountains>Duskwood": { legs: [
    { kind: "walk", text: "Follow the road south from Lakeshire to Darkshire in Duskwood." },
  ] },
  "Alliance|Duskwood>Stormwind City": { legs: [
    { kind: "fly", text: "Fly from Darkshire to Stormwind.", fm: "Felicia Maline", to: "Dungar Longdrink" },
  ] },
  "Alliance|Stormwind City>Wetlands": { legs: [
    { kind: "tram", text: "Take the Deeprun Tram from the Dwarven District to Ironforge.", via: "63.73 8.43 Stormwind City", tick: "Ironforge" },
    { kind: "walk", text: "Leave Ironforge, follow the road east through Loch Modan, then north into Wetlands to Menethil Harbor." },
  ] },
  "Alliance|Wetlands>Hillsbrad Foothills": { check: true, legs: [
    { kind: "walk", text: "Head to Hillsbrad Foothills: cross the Thandol Span and follow the road north-west to Southshore." },
  ] },
  "Alliance|Hillsbrad Foothills>Arathi Highlands": { legs: [
    { kind: "walk", text: "Follow the road east from Southshore into Arathi Highlands to Refuge Pointe." },
  ] },
  "Alliance|Arathi Highlands>Stranglethorn Vale": { check: true, legs: [
    { kind: "fly", text: "Fly from Refuge Pointe to Darkshire.", fm: "Cedrik Prose", to: "Felicia Maline", tick: "Duskwood" },
    { kind: "walk", text: "Follow the road south from Darkshire into Stranglethorn Vale.", via: "44.6 87.56 Duskwood" },
  ] },
  "Alliance|Stranglethorn Vale>Stormwind City": { legs: [
    { kind: "fly", text: "Fly from Booty Bay to Stormwind.", fm: "Gyll", to: "Dungar Longdrink" },
  ] },
  "Alliance|Stormwind City>The Hinterlands": { check: true, legs: [
    { kind: "tram", text: "Take the Deeprun Tram from the Dwarven District to Ironforge.", via: "63.73 8.43 Stormwind City", tick: "Ironforge" },
    { kind: "fly", text: "Fly from Ironforge to Refuge Pointe.", fm: "Gryth Thurden", to: "Cedrik Prose", tick: "Arathi Highlands" },
    { kind: "walk", text: "Head north-east from Refuge Pointe into The Hinterlands to Aerie Peak." },
  ] },
  "Alliance|The Hinterlands>Burning Steppes": { check: true, legs: [
    { kind: "fly", text: "Fly from Aerie Peak to Lakeshire.", fm: "Guthrum Thunderfist", to: "Ariena Stormfeather", tick: "Redridge Mountains" },
    { kind: "walk", text: "Follow the road east from Lakeshire into Burning Steppes to Morgan's Vigil.", via: "78.12 75.48 Redridge Mountains" },
  ] },
  "Alliance|Burning Steppes>Ironforge": { legs: [
    { kind: "fly", text: "Fly from Morgan's Vigil to Ironforge.", fm: "Borgus Stoutarm", to: "Gryth Thurden" },
  ] },
  "Alliance|Ironforge>Western Plaguelands": { check: true, legs: [
    { kind: "fly", text: "Fly from Ironforge to Southshore.", fm: "Gryth Thurden", to: "Darla Harris", tick: "Hillsbrad Foothills" },
    { kind: "walk", text: "Walk north from Southshore to Chillwind Camp in Western Plaguelands." },
  ] },
  "Alliance|Western Plaguelands>Eastern Plaguelands": { legs: [
    { kind: "walk", text: "Walk east from Chillwind Camp across the border into Eastern Plaguelands.", via: "53.73 64.66 Western Plaguelands" },
  ] },
  // Dwarf and Gnome
  "Alliance|Dun Morogh>Ironforge": { legs: [
    { kind: "walk", text: "Follow the road north-east from Kharanos to Ironforge.", via: "55.13 34.91 Dun Morogh" },
  ] },
  "Alliance|Ironforge>Loch Modan": { legs: [
    { kind: "walk", text: "Leave Ironforge by the main gate.", tick: "Dun Morogh" },
    { kind: "walk", text: "Follow the road east to the tunnel into Loch Modan.", via: "84.26 51.37 Dun Morogh" },
  ] },
  "Alliance|Loch Modan>Westfall": { legs: [
    { kind: "fly", text: "Fly from Thelsamar to Ironforge.", fm: "Thorgrum Borrelson", to: "Gryth Thurden", tick: "Ironforge" },
    { kind: "tram", text: "Take the Deeprun Tram from Ironforge to Stormwind.", via: "76.61 51.28 Ironforge", tick: "Stormwind City" },
    { kind: "walk", text: "Leave Stormwind by the main gate, follow the road to Goldshire, then the road west to Sentinel Hill.", via: "71.19 89.1 Stormwind City" },
  ] },
  "Alliance|Duskwood>Wetlands": { legs: [
    { kind: "fly", text: "Fly from Darkshire to Stormwind.", fm: "Felicia Maline", to: "Dungar Longdrink", tick: "Stormwind City" },
    { kind: "tram", text: "Take the Deeprun Tram from the Dwarven District to Ironforge.", via: "63.73 8.43 Stormwind City", tick: "Ironforge" },
    { kind: "fly", text: "Fly from Ironforge to Thelsamar.", fm: "Gryth Thurden", to: "Thorgrum Borrelson", tick: "Loch Modan" },
    { kind: "walk", text: "Follow the road north out of Loch Modan into Wetlands to Menethil Harbor.", via: "25.4 10.6 Loch Modan" },
  ] },
  // Night Elf
  "Alliance|Teldrassil>Darnassus": { legs: [
    { kind: "portal", text: "Take the portal at Rut'theran Village up into Darnassus.", via: "55.95 89.88 Teldrassil" },
  ] },
  "Alliance|Darnassus>Darkshore": { legs: [
    { kind: "portal", text: "Take the portal in Darnassus down to Rut'theran Village.", via: "29.47 41.41 Darnassus", tick: "Teldrassil" },
    { kind: "boat", text: "Take the boat from the dock at Rut'theran Village to Auberdine." },
  ] },
  "Alliance|Darkshore>Ashenvale": { legs: [
    { kind: "walk", text: "Follow the road south out of Darkshore into Ashenvale.", via: "44.38 76.3 Darkshore" },
  ] },
  "Alliance|Ashenvale>Stonetalon Mountains": { legs: [
    { kind: "walk", text: "Take the road south from Astranaar into Stonetalon Mountains.", via: "42.5 71.7 Ashenvale" },
  ] },
  "Alliance|Stonetalon Mountains>Desolace": { legs: [
    { kind: "walk", text: "Follow the road south from Stonetalon Peak into Desolace to Nijel's Point.", via: "29.29 79.69 Stonetalon Mountains" },
  ] },
  "Alliance|Desolace>Dustwallow Marsh": { check: true, legs: [
    { kind: "walk", text: "Head to Dustwallow Marsh: go back through Stonetalon Mountains and The Barrens to Ratchet, then take the road south." },
  ] },
  "Alliance|Dustwallow Marsh>Feralas": { check: true, legs: [
    { kind: "walk", text: "Head to Feralas: go back through The Barrens and Thousand Needles, then west to Feathermoon Stronghold." },
  ] },
  "Alliance|Feralas>Tanaris": { check: true, legs: [
    { kind: "walk", text: "Head to Tanaris: go east through Thousand Needles, then south to Gadgetzan." },
  ] },
  "Alliance|Tanaris>Azshara": { check: true, legs: [
    { kind: "walk", text: "Head to Azshara: go back north to Ashenvale, then take the road east into Azshara." },
  ] },
  "Alliance|Azshara>Felwood": { check: true, legs: [
    { kind: "walk", text: "Head to Felwood: go back west to Ashenvale, then take the road north into Felwood." },
  ] },
  "Alliance|Felwood>Winterspring": { legs: [
    { kind: "walk", text: "Walk to the Timbermaw tunnel at the north end of Felwood and go through it into Winterspring.", via: "65.28 7.51 Felwood" },
  ] },

  // ---- Horde ----
  // Orc and Troll
  "Horde|Durotar>Orgrimmar": { legs: [
    { kind: "walk", text: "Follow the road north from Razor Hill to Orgrimmar.", tick: "Orgrimmar", via: "43.56 15.08 Durotar" },
  ] },
  "Horde|Orgrimmar>The Barrens": { legs: [
    { kind: "walk", text: "Leave Orgrimmar by the west gate and follow the road to the Crossroads.", via: "15.66 63.33 Orgrimmar" },
  ] },
  // All Horde races from here, except where a race has its own row
  "Horde|The Barrens>Stonetalon Mountains": { legs: [
    { kind: "walk", text: "Take the road west from the Crossroads into Stonetalon Mountains to Sun Rock Retreat.", via: "35.19 27.79 The Barrens" },
  ] },
  "Horde|Stonetalon Mountains>Ashenvale": { check: true, legs: [
    { kind: "walk", text: "Head to Ashenvale: take the road north out of Stonetalon Mountains." },
  ] },
  "Horde|Ashenvale>Thousand Needles": { check: true, legs: [
    { kind: "fly", text: "Fly from Splintertree Post to Camp Taurajo.", fm: "Vhulgra", to: "Omusa", tick: "The Barrens" },
    { kind: "walk", text: "Walk south from Camp Taurajo into Thousand Needles to Freewind Post.", via: "44.21 91.22 The Barrens" },
  ] },
  "Horde|Thousand Needles>Desolace": { check: true, legs: [
    { kind: "fly", text: "Fly from Freewind Post to Sun Rock Retreat.", fm: "Nyse", to: "Tharm", tick: "Stonetalon Mountains" },
    { kind: "walk", text: "Walk south from Sun Rock Retreat into Desolace to Shadowprey Village.", via: "29.29 79.69 Stonetalon Mountains" },
  ] },
  "Horde|Desolace>Dustwallow Marsh": { check: true, legs: [
    { kind: "fly", text: "Fly from Shadowprey Village to Ratchet.", fm: "Thalon", to: "Bragok", tick: "The Barrens" },
    { kind: "walk", text: "Walk south from Ratchet into Dustwallow Marsh to Brackenwall Village." },
  ] },
  "Horde|Dustwallow Marsh>Tanaris": { legs: [
    { kind: "fly", text: "Fly from Brackenwall Village to Freewind Post.", fm: "Shardi", to: "Nyse", tick: "Thousand Needles" },
    { kind: "walk", text: "Walk south through Thousand Needles into Tanaris to Gadgetzan.", via: "75.49 97.58 Thousand Needles" },
  ] },
  "Horde|Tanaris>Azshara": { check: true, legs: [
    { kind: "fly", text: "Fly from Gadgetzan to Splintertree Post.", fm: "Bulkrek", to: "Vhulgra", tick: "Ashenvale" },
    { kind: "walk", text: "Take the road east from Splintertree Post into Azshara.", via: "95.33 48.38 Ashenvale" },
  ] },
  "Horde|Azshara>Un'Goro Crater": { legs: [
    { kind: "fly", text: "Fly from Valormok to Gadgetzan.", fm: "Kroum", to: "Bulkrek", tick: "Tanaris" },
    { kind: "walk", text: "Walk west from Gadgetzan into Un'Goro Crater to Marshal's Refuge.", via: "26.98 56.09 Tanaris" },
  ] },
  "Horde|Un'Goro Crater>Felwood": { check: true, legs: [
    { kind: "fly", text: "Fly from Marshal's Refuge to Splintertree Post.", fm: "Gryfe", to: "Vhulgra", tick: "Ashenvale" },
    { kind: "walk", text: "Walk north through Ashenvale into Felwood to Bloodvenom Post.", via: "55.78 28.12 Ashenvale" },
  ] },
  "Horde|Felwood>Silithus": { check: true, legs: [
    { kind: "fly", text: "Fly from Bloodvenom Post to Marshal's Refuge.", fm: "Brakkar", to: "Gryfe", tick: "Un'Goro Crater" },
    { kind: "walk", text: "Walk west from Marshal's Refuge into Silithus." },
  ] },
  // Tauren
  "Horde|Mulgore>Thunder Bluff": { legs: [
    { kind: "walk", text: "Take the road to Thunder Bluff and ride the lift up." },
  ] },
  "Horde|Thunder Bluff>The Barrens": { legs: [
    { kind: "walk", text: "Ride the lift down to Mulgore.", tick: "Mulgore" },
    { kind: "walk", text: "Follow the road east through Mulgore into The Barrens to Camp Taurajo.", via: "69.6 60.4 Mulgore" },
  ] },
  // Undead
  "Horde|Tirisfal Glades>Silverpine Forest": { legs: [
    { kind: "walk", text: "Follow the road south from Brill into Silverpine Forest to the Sepulcher.", via: "53.2 75.82 Tirisfal Glades" },
  ] },
  "Horde|Silverpine Forest>Undercity": { legs: [
    { kind: "fly", text: "Fly from the Sepulcher to Undercity.", fm: "Karos", to: "Michael" },
  ] },
  "Horde|Undercity>The Barrens": { legs: [
    { kind: "zeppelin", text: "Take the zeppelin from the tower outside Undercity to Orgrimmar.", tick: "Durotar" },
    { kind: "walk", text: "Walk into Orgrimmar, leave by the west gate and follow the road to the Crossroads." },
  ] },
};

module.exports = { TRAVEL };
