// The hand-kept travel words for the route builder (tools/build-route.js): how a player gets from one zone of a race's path to the
// next one. This is the one file the owner's travel corrections touch; the builder checks it and writes it into Data/Route.lua
// (a travel table), and the game turns each entry into the first steps of the next zone. Nothing here is game code.
//
// Per move, one entry. The key is "<Faction>|<From zone>><To zone>" (the faction is in the key because the same two zones can
// need different words for the Alliance and the Horde, for example Desolace to Dustwallow Marsh). The value:
//   check  true: not confirmed in the game yet. The builder counts these and lists them in .planning/route-outlines/TRAVEL.txt.
//   legs   1 to 4 legs, in the order you do them. A leg:
//     kind  walk, fly, boat, zeppelin, tram or portal
//     text  what the player reads: one plain instruction in English. It starts with a verb (Walk, Follow, Take, Fly, Leave, Ride,
//           Go, Head, Talk, Cross, Run), says the kind of transport in its first words (Fly ..., Take the boat ...), names only
//           towns, NPCs, gates and zones a player sees, has no digits, no ";" or "=" and no "or" (never two ways), and is at
//           most 140 characters long.
//     tick  the zone (or a sub-zone, a town name) the player has reached when the leg is done. It is never the zone the leg
//           starts in. The last leg may leave it out: it is then the zone the move goes to.
//     at    only when tick is a sub-zone: the zone that sub-zone is in. A leg always ends in a zone of Data/ZoneSizes.lua.
//     via   where the arrow points while the leg is current: "x y Zone" (map percent), in the zone the leg starts in: a gate, a
//           dock, a road out. Leave it out when no place is known (the arrow then points at the next zone's first area).
//           A fly leg has no via: its place is the flight master it leaves from (fm).
//     fm    fly legs only: the flight master you leave from (exact NPC name as RestedXP's guides write it in Data/Guides.lua).
//     to    fly legs only: the flight master you land at.
// The zone a leg starts in is the From zone for the first leg, else the zone the leg before ended in. Zone names are written
// exactly as the keys of Data/ZoneSizes.lua. In the game a zone starts with its travel steps; when you already stand in the
// zone the step leads to (or in a later stop of the entry), they are skipped at once.

const TRAVEL = {
  // ---- Horde ----
  // Orc and Troll
  "Horde|Durotar>Orgrimmar": { legs: [
    { kind: "walk", text: "Follow the road north from Razor Hill to Orgrimmar.", tick: "Orgrimmar", via: "43.56 15.08 Durotar" },
  ] },
};

module.exports = { TRAVEL };
