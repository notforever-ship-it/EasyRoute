// Plays a starting race through the generated route (Data/Route.lua) from level 1 to 60 in a pretend game and checks it.
// It reads the plan back with the Lua 5.0 reader RouteReader.lua at the repo root (the one the game uses). First the
// file as a whole: version 4 (with the grind field and the plan level pl of the Q lines and the spots field of the leveling visits) and exactly the 8 paths Human Dwarf Gnome NightElf Orc Troll Tauren Scourge. Then each asked race,
// under "== <path key> ==", gets these checks:
//   1. the race has a path, every visit exists, its zone is a known zone, its quest count is right
//   2. no zone is visited twice (unless the later visit says again), short stops are capitals only, no Turtle WoW extra zone
//   3. the first zone is the race's start zone, the path changes continent at most once (the Undead zeppelin), levels never
//      go backwards: starts at 1, ends at 60, each visit starts where the one before ended
//   4. every quest is a real quest (a row of Data/Zones.lua), once, for this race, no class quest, not too high for the visit
//   5. a quest comes after at least one of the quests it needs, when any of them is on the path (pfQuest's whole pre list, from
//      tools/data/quest-pre.tsv: any one of them done is enough; the p of its row in Data/Zones.lua when the file has no row)
//   6. a pretend character plays the quests in order with the same xp rules as the builder (tools/lib/xpmodel.js);
//      where the quests run out it grinds, and the plan must have recorded the gap, not smaller and not bigger (0.15 of a level of
//      room for rounding); the race's total gap must also be inside a band written down in this file (GRIND_BAND)
//   7. short walks: the hop from one area to the next and the whole walk of a visit stay short
//   8. hand-in fields: only a quest marked x names another zone, and that zone is the visit right after (a capital stop) or the
//      next zone (past that stop); never a zone that was visited before or comes later; at most 3 quests per visit are carried on,
//      the ones for the capital stop and for the next zone together
//   9. the start, and RestedXP's quests in every zone: the race's first quest is in the first area, no Turtle goblin quest
//      for Orc and Troll, at least 5 extra quests that RestedXP skips are in below level 20, and in every zone from 1 to 60
//      (not a short stop) at least half of RestedXP's quests of the zone are on the route when RestedXP has at least 4 there
//      (the test builds its own RestedXP index from Data/Guides.lua)
//  10. no zone is thin: every zone (not a short stop) keeps at least the larger of 8 quests and 2 quests per level of its range
//  11. the guide index (tools/data/guide-index.tsv, once per run, after the races): the file is there, every row has 7 fields,
//      TourGuide and VanillaGuide have at least 400 rows per faction, at least 90% of the quest ids are rows of Data/Zones.lua,
//      and every pick-up zone is a zone of Data/ZoneSizes.lua
//  12. what the guides agree on, in every zone (not a short stop): of the quests that at least two of RestedXP, TourGuide and
//      VanillaGuide do and that one of them picks up in the zone, at least half are on the route when there are at least 4;
//      quests that RestedXP (else TourGuide) picks up in a place the race's route never goes to are not counted
//  13. travel between zones: every move from one visit of the path to the next has an entry in the travel table (read with
//      ER.RouteReader.ReadTravel), 1 to 4 legs, words with no digit, tab, semicolon or equals sign, something that ends the leg, a
//      flight with a landing and a place for the arrow, a leg that teaches a flight path (learn) names a flight master of the zone it ends
//      in, and the last leg ends in the zone the move goes to
//  14. grind spots: a short stop has none; a leveling visit has at most GRIND_POOL_MAX lines of nine fields each (name, x, y, lo, hi, n,
//      code, red, elite) in range (a name without a bar, places 0 to 100, levels 1 to 60 with lo not above hi, at least GRIND_MIN_SPAWNS
//      spawns, code y p r or u, red 0 to 99, elite 0 to 63), and no spot is a critter, a totem or a creature of no type (the numbers are
//      read from tools/build-route.js, one source); the route file is at most GRIND_FILE_MAX_KB kilobytes
// It needs only the files in this repo, not the game's AddOns folder.
//  15. the danger flags: each quest of REAL_D that is on the path carries d, none of FALSE_D does, Hogger carries g, and no quest with e, g, d or s
//      has a grind level (at least 3 of the real dungeon quests must be found over the races of a run)
//  16. chains: the data file Data/Chains.lua for the race: every chain has 3 or more own steps that are quests of the path, in path order and
//      linked by the pre lists, the own parts of the race share no quest, no route quest outside a chain needs one of its own steps, xp is a
//      whole number marked r or e, minutes are numbers, zones are zones of the path, the end items are well formed (kind, quality 0-4 or ?,
//      a slot word, class letters, a name only when the quality is not known), no own step has a work or hand-in place in another zone
//      without x, the own steps of chains Casual leaves out on xp alone (tools/lib/chains.js with the route's flags and Steps.lua's
//      LEAVE_OUT) carry no grind level, Casual keeps at least CASUAL_KEEP_MIN of the judged chains, and the dropped quests of the out list
//      are not on the path. Once per run: Data/Chains.lua loads (version 1, credited header, at most CHAINS_FILE_MAX_KB) and
//      tools/data/chain-facts.tsv holds the three known xp rows.
//  0. (once, before the races) the reader RouteReader.lua (checked with every other game file) passes tools/check-lua.js with no error and no warning
// Usage: node tools/test-route.js <Alliance|Horde> [race ...]      (several races: each is played in turn under "== <path key> ==")
//   Alliance races: Human Dwarf Gnome NightElf (default Human). Horde races: Orc Troll Tauren Undead (default Orc).
//   ER_ROUTE_FILE=<file> plays another route file (used to prove that a broken file fails).

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { newLuaVM } = require("./lib/pfdb.js");
const xp = require("./lib/xpmodel.js");
const CH = require("./lib/chains.js");

const ROOT = path.resolve(__dirname, "..");
const ROUTE_FILE = process.env.ER_ROUTE_FILE || path.join(ROOT, "Data", "Route.lua");
const FACTIONS = {
  Alliance: { fallback: "Human", races: ["Human", "Dwarf", "Gnome", "NightElf"] },
  Horde: { fallback: "Orc", races: ["Orc", "Troll", "Tauren", "Undead"] },
};
// The game calls the Undead race Scourge; that is the key in the route file's paths.
const PATH_KEY = { Undead: "Scourge" };
const RACE_BIT = { Human: 1, Orc: 2, Dwarf: 4, NightElf: 8, Scourge: 16, Tauren: 32, Gnome: 64, Troll: 128 };
const CAPITALS = ["Stormwind City", "Ironforge", "Darnassus", "Orgrimmar", "Thunder Bluff", "Undercity"];
const FLAG_LETTERS = "edscfxkgvhu";
// Check 15: quests that really are in a dungeon (they must carry d) and quests that only look like it (they must not): the word "dungeon" in a
// cauldron or a Scourgestone quest, a vulture-meat stew that shares its meat with a dungeon. Written down here, not worked out.
const REAL_D = [1486, 959, 1491, 6626, 3801, 5281, 5282, 5214, 60124];
const FALSE_D = [38, 90, 92, 93, 5404, 5407, 5408, 5218, 5221, 5224, 5227, 6031];
const HOGGER = 176; // a group quest
const MIN_REAL_D_SEEN = 3;
// Check 15: quests friends rated Hard (they carry h) and a quest the safe route skips (it carries v), where they are on a path.
const HARD_QUESTS = [1054, 1034, 55032];
const SKIPPED_QUEST = { id: 176, faction: "Alliance" };
const DANGER_LETTERS = "egdsvhu";
// Check 15 lists the visits that lose more than this share of their quests to v alone (information, not a failure). Research measured at most
// 16% of a visit to v under the literal rule, so 25% only shows a rule that has run away.
const V_VISIT_SHARE = 0.25;
const visitDrops = [];
const realDSeen = new Set();
const DUNGEON_ONLY_FLAGS = "egdsvh"; // the quests the casual model gives no xp and no grind mark
const MAX_VISIT_GAP = 6, MAX_PATH_GAP = 30;
// Check 6, the band each race's total grinding must fall in. These numbers are written down here, not worked out from the xp model, so a
// wrong model (or a plan built with one) cannot agree with itself: they were read off the first good builds (about 26 levels for the
// Eastern Kingdoms and Night Elf paths, about 21 for the Horde ones) with 4 levels of room. Like the guards above, they catch drift.
const GRIND_BAND = { Human: [22, 30], Dwarf: [22, 30], Gnome: [22, 30], NightElf: [22, 30], Orc: [17, 25], Troll: [17, 25], Tauren: [17, 25], Scourge: [16, 24] };
// Check 9: the first quest of RestedXP's 1-6 guide for each race (not a class quest), the Turtle goblin starter quest
// that must not be in the Orc and Troll plans, and the least share of RestedXP's quests a zone must keep.
const FIRST_QUEST = { Human: 783, Dwarf: 179, Gnome: 179, NightElf: 456, Orc: 4641, Troll: 4641, Tauren: 747, Scourge: 363 };
const GOBLIN_QUEST = 41154;
// The paths the file must hold, the first zone of each race, and how often a path may change continent (the Undead take the
// zeppelin once; everyone else stays on the continent they start on).
const ALL_KEYS = ["Human", "Dwarf", "Gnome", "NightElf", "Orc", "Troll", "Tauren", "Scourge"];
const START_ZONE = { Human: "Elwynn Forest", Dwarf: "Dun Morogh", Gnome: "Dun Morogh", NightElf: "Teldrassil", Orc: "Durotar", Troll: "Durotar", Tauren: "Mulgore", Scourge: "Tirisfal Glades" };
const CROSSINGS = { Scourge: 1 };
// Turtle WoW's extra zones, which no path may visit.
const TURTLE_ZONES = ["Northwind", "Grim Reaches", "Gilneas", "Balor", "Hyjal", "Tel'Abim", "Gillijim's Isle", "Lapidis Isle", "Thalassian Highlands", "Alah'Thalas", "Blackstone Island"];
const MIN_SHARE = 50, MIN_EXTRA = 5, EARLY_LEVEL = 20, MIN_QUESTS = 8, MIN_PER_LEVEL = 2;
// Check 7: the longest hop between two areas, as a share of the zone's longer side, and the whole walk of a visit (yards).
// These are guards against the order getting worse, not truths: the builder's own output sets them (see 02-RESEARCH).
const MAX_HOP_SHARE = 0.7, MAX_WALK = 15000;

function usage() {
  console.error("Usage: node tools/test-route.js <Alliance|Horde> [race ...]\n" +
    "  Alliance races: " + FACTIONS.Alliance.races.join(" ") + "\n  Horde races: " + FACTIONS.Horde.races.join(" "));
  process.exit(1);
}
const faction = FACTIONS[process.argv[2]];
if (!faction) usage();
let races = process.argv.slice(3);
if (!races.length) races = [faction.fallback];
for (const r of races) if (faction.races.indexOf(r) < 0) usage();
const keys = races.map((r) => PATH_KEY[r] || r);

// ---- load the data and read the plan back -----------------------------------------------------------------
const vm = newLuaVM();
let data, zoneSizes;
try {
  vm.run(fs.readFileSync(path.join(ROOT, "Data", "ZoneSizes.lua")), "Data/ZoneSizes.lua");
  vm.run(fs.readFileSync(path.join(ROOT, "Data", "Zones.lua")), "Data/Zones.lua");
  vm.run(fs.readFileSync(ROUTE_FILE), path.basename(ROUTE_FILE));
  vm.run(fs.readFileSync(path.join(ROOT, "RouteReader.lua")), "RouteReader.lua");
  vm.run(`
local keys = { ${keys.map((k) => JSON.stringify(k)).join(", ")} }
ER_DATA = { version = EasyRoute_Route and EasyRoute_Route.version, paths = {}, pathKeys = {}, visits = {}, quests = {} }
if EasyRoute_Route and EasyRoute_Route.paths then
  for key in pairs(EasyRoute_Route.paths) do table.insert(ER_DATA.pathKeys, key) end
end
for _, key in ipairs(keys) do
  local p = EasyRoute_Route and EasyRoute_Route.paths and EasyRoute_Route.paths[key]
  if p then
    ER_DATA.paths[key] = p
    for _, no in ipairs(p) do
      local v = EasyRoute_Route.visits and EasyRoute_Route.visits[no]
      if v and not ER_DATA.visits[tostring(no)] then
        local areas, bad = EasyRoute.RouteReader.ReadVisit(v)
        ER_DATA.visits[tostring(no)] = { race = v.race, zone = v.zone, lo = v.lo, hi = v.hi, gap = v.gap,
          stop = v.stop, again = v.again, n = v.n, areas = areas, bad = bad, raw = v.areas,
          spots = EasyRoute.RouteReader.ReadSpots(v), rawSpots = v.spots }
      end
    end
  end
end
for _, z in pairs(EasyRoute_Zones) do
  for _, q in ipairs(z.q) do
    ER_DATA.quests[tostring(q.id)] = { n = q.n, l = q.l, m = q.m, p = q.p, r = q.r, c = q.c, zone = z.name }
  end
end
ER_DATA.travel = {}
ER_DATA.flights = {}
if EasyRoute_Route and type(EasyRoute_Route.flights) == "table" then
  for key, text in pairs(EasyRoute_Route.flights) do ER_DATA.flights[key] = text end
end
if EasyRoute_Route and type(EasyRoute_Route.travel) == "table" then
  for key, text in pairs(EasyRoute_Route.travel) do ER_DATA.travel[key] = EasyRoute.RouteReader.ReadTravel(text) end
end
`, "route test setup");
  data = vm.get("ER_DATA");
  zoneSizes = vm.get("EasyRoute_ZoneSizes");
} catch (e) {
  console.error("FAILED in " + e.message);
  process.exit(1);
}

let failures = 0;
function fail(msg) {
  failures++;
  console.log("  FAIL: " + msg);
}
const visitsOf = (key) => (data.paths[key] || []).map((no) => ({ no, v: data.visits[String(no)] }));
const questLines = (v) => v.areas.reduce((s, a) => s + a.q.length, 0);
// Yards between two map points of one zone, as S.Yards in Steps.lua (4000 x 2667 when the zone has no size).
function zoneSide(zone) {
  const size = zoneSizes[zone];
  if (!size) return { w: 4000, h: 2667 };
  return Array.isArray(size) ? { w: size[0], h: size[1] } : { w: size["1"], h: size["2"] };
}
// The continent of a zone (0 Eastern Kingdoms, 1 Kalimdor), or null when Data/ZoneSizes.lua has none.
function continentOf(zone) {
  const size = zoneSizes[zone];
  return size && !Array.isArray(size) && size.c != null ? Number(size.c) : null;
}
function yards(zone, x1, y1, x2, y2) {
  const { w, h } = zoneSide(zone);
  const dx = (x2 - x1) / 100 * w, dy = (y2 - y1) / 100 * h;
  return Math.sqrt(dx * dx + dy * dy);
}

// RestedXP's quests of the faction, read from Data/Guides.lua here, not taken from the builder: a G line sets the zone,
// an A line records its quest under that zone (the first one wins); every A, T and C line adds to "any".
function restedIndex(factionName) {
  vm.run(fs.readFileSync(path.join(ROOT, "Data", "Guides.lua")), "Data/Guides.lua");
  vm.run("ER_GUIDES = {} for i, g in ipairs(EasyRoute_Guides) do ER_GUIDES[i] = { faction = g.faction, steps = g.steps } end", "guides");
  const index = { zone: {}, any: {}, seen: {} };
  for (const g of vm.get("ER_GUIDES")) {
    if (g.faction !== factionName) continue;
    let zone = null;
    for (const line of String(g.steps).split("\n")) {
      const c = line.split("\t");
      if (c[0] === "G") {
        if (c[2]) zone = c[2];
      } else if (c[0] === "A" || c[0] === "T" || c[0] === "C") {
        const id = Number(c[2]);
        if (!id) continue;
        index.any[id] = true;
        if (c[0] === "A" && zone && !index.seen[id]) {
          index.seen[id] = true;
          (index.zone[zone] = index.zone[zone] || []).push(id);
        }
      }
    }
  }
  return index;
}
const rested = restedIndex(process.argv[2]);

// The visit text parsed here, a second time and with plain JavaScript, against what the Lua reader gave: area places and names, quest
// ids, flags, the grind level, and every hand-in and work place with its numbers; and the spots field line by line, field by field.
// Gives a sentence about the first difference, or null.
function readerDiffers(v) {
  const place = (t) => {
    const m = /^(\S+) (\S+)(?: (.*))?$/.exec(t || "");
    return m ? { x: Number(m[1]), y: Number(m[2]), zone: m[3] || undefined } : null;
  };
  const same = (got, want) => (!got && !want) || (got && want && got.x === want.x && got.y === want.y && got.zone === want.zone);
  const want = [];
  for (const line of String(v.raw).split("\n")) {
    const c = line.split("\t");
    if (c[0] === "A") want.push({ x: Number(c[1]), y: Number(c[2]), who: c[3], q: [] });
    else if (c[0] === "Q" && want.length) want[want.length - 1].q.push({ id: Number(c[1]), flags: c[2], hand: place(c[3]), obj: place(c[4]), grind: c[5] ? Number(c[5]) : null, pl: c[6] ? Number(c[6]) : null });
  }
  if (want.length !== v.areas.length) return `${v.areas.length} areas, the text has ${want.length}`;
  for (let i = 0; i < want.length; i++) {
    const a = v.areas[i], w = want[i];
    if (a.x !== w.x || a.y !== w.y || a.who !== w.who) return `area ${i + 1} is at ${a.x} ${a.y} (${a.who}), the text says ${w.x} ${w.y} (${w.who})`;
    if (a.q.length !== w.q.length) return `area ${i + 1} has ${a.q.length} quests, the text has ${w.q.length}`;
    for (let j = 0; j < w.q.length; j++) {
      const q = a.q[j], t = w.q[j];
      const hand = q.hx != null ? { x: q.hx, y: q.hy, zone: q.hzone } : null, obj = q.ox != null ? { x: q.ox, y: q.oy, zone: q.ozone } : null;
      if (q.id !== t.id || q.flags !== t.flags) return `quest ${j + 1} of area ${i + 1} is ${q.id} ${q.flags}, the text says ${t.id} ${t.flags}`;
      if (!same(hand, t.hand)) return `quest ${t.id}: hand-in place ${JSON.stringify(hand)}, the text says ${JSON.stringify(t.hand)}`;
      if (!same(obj, t.obj)) return `quest ${t.id}: work place ${JSON.stringify(obj)}, the text says ${JSON.stringify(t.obj)}`;
      const grind = q.grind != null ? q.grind : null;
      if (grind !== t.grind) return `quest ${t.id}: grind level ${grind}, the text says ${t.grind}`;
      const pl = q.pl != null ? q.pl : null;
      if (pl !== t.pl) return `quest ${t.id}: plan level ${pl}, the text says ${t.pl}`;
      if (v.stop ? pl !== null : !(pl >= 1 && pl <= 60)) return `quest ${t.id}: plan level ${pl} in a ${v.stop ? "capital stop (it has none)" : "leveling visit (1 to 60 wanted)"}`;
    }
  }
  const wantSpots = String(v.rawSpots == null ? "" : v.rawSpots).split("\n").filter((l) => l !== "").map((l) => l.split("\t"));
  const gotSpots = Array.isArray(v.spots) ? v.spots : Object.values(v.spots || {});
  if (gotSpots.length !== wantSpots.length) return `${gotSpots.length} spots, the text has ${wantSpots.length}`;
  for (let i = 0; i < wantSpots.length; i++) {
    const g = gotSpots[i], t = wantSpots[i];
    const got = [g.name, g.x, g.y, g.lo, g.hi, g.n, g.code, g.red, g.elite];
    if (t.length !== 9) return `spot ${i + 1} has ${t.length} fields in the text, expected 9`;
    for (let k = 0; k < 9; k++) {
      const want = k === 0 || k === 6 ? t[k] : Number(t[k]);
      if (got[k] !== want) return `spot ${i + 1} (${t[0]}): field ${k + 1} is ${got[k]}, the text says ${t[k]}`;
    }
  }
  return null;
}

// Plays one race: checks 1 to 10 and 12 for the path key.
function playRace(raceKey) {
  // 1. shape
  console.log("1. The visits");
  for (const key of [raceKey]) {
    if (!data.paths[key]) { fail(`no path for ${key}`); continue; }
    for (const { no, v } of visitsOf(key)) {
      if (!v) { fail(`${key}: visit ${no} does not exist`); continue; }
      if (!zoneSizes[v.zone]) fail(`${key}: visit ${no} has a zone that is not in Data/ZoneSizes.lua: ${v.zone}`);
      if (questLines(v) !== v.n) fail(`${key}: ${v.zone} says ${v.n} quests but has ${questLines(v)}`);
      if (v.bad) fail(`${key}: ${v.zone}: the reader could not use ${v.bad} lines`);
      const wrong = readerDiffers(v);
      if (wrong) fail(`${key}: ${v.zone}: the reader gives something else than the text of the file says: ${wrong}`);
    }
  }

  // 2. no revisits
  console.log("2. No zone twice, short stops only in capitals, no Turtle WoW extra zone");
  for (const key of [raceKey]) {
    const seen = {};
    for (const { no, v } of visitsOf(key)) {
      if (!v) continue;
      if (seen[v.zone] && v.again !== 1) fail(`${key}: ${v.zone} is visited twice (visit ${no}) and the second one is not marked as a named second visit`);
      seen[v.zone] = true;
      if (TURTLE_ZONES.indexOf(v.zone) >= 0) fail(`${key}: ${v.zone} is one of Turtle WoW's extra zones`);
      if (v.stop && CAPITALS.indexOf(v.zone) < 0) fail(`${key}: ${v.zone} is a short stop but not a capital`);
    }
  }

  // 3. levels
  console.log("3. Start zone, one continent, levels go forward from 1 to 60");
  for (const key of [raceKey]) {
    const list = visitsOf(key).filter((x) => x.v);
    if (!list.length) { fail(`${key}: the path has no visits`); continue; }
    if (list[0].v.lo !== 1) fail(`${key}: the first visit starts at level ${list[0].v.lo}, not 1`);
    if (list[list.length - 1].v.hi !== 60) fail(`${key}: the last visit ends at level ${list[list.length - 1].v.hi}, not 60`);
    if (list[0].v.zone !== START_ZONE[key]) fail(`${key}: the first zone is ${list[0].v.zone}, the start zone of the race is ${START_ZONE[key]}`);
    let crossings = 0;
    list.forEach(({ v }, i) => {
      const c = continentOf(v.zone), before = i > 0 ? continentOf(list[i - 1].v.zone) : c;
      if (c != null && before != null && c !== before) crossings++;
      if (i > 0 && v.lo < list[i - 1].v.hi) fail(`${key}: ${v.zone} starts at ${v.lo}, before ${list[i - 1].v.zone} ends (${list[i - 1].v.hi})`);
      if (v.stop && v.lo !== v.hi) fail(`${key}: the short stop in ${v.zone} goes from ${v.lo} to ${v.hi}`);
    });
    if (crossings > (CROSSINGS[key] || 0)) fail(`${key}: the path changes continent ${crossings} times, at most ${CROSSINGS[key] || 0} wanted`);
  }

  // 4. quests
  console.log("4. Every quest is real, for this race, and not too high");
  for (const key of [raceKey]) {
    const bit = RACE_BIT[key];
    const used = {};
    for (const { v } of visitsOf(key)) {
      if (!v) continue;
      for (const a of v.areas) {
        for (const q of a.q) {
          const row = data.quests[String(q.id)];
          const who = `quest ${q.id} (${v.zone})`;
          if (!row) { fail(`${who} is not a row of Data/Zones.lua`); continue; }
          if (used[q.id]) fail(`${who} is in the ${key} path twice (also in ${used[q.id]})`);
          used[q.id] = v.zone;
          if (row.r && (row.r & bit) === 0) fail(`${who} is not for this race (mask ${row.r})`);
          if (row.c) fail(`${who} is a class quest (mask ${row.c})`);
          if (row.m > v.hi) fail(`${who} needs level ${row.m}, above the end of the visit (${v.hi})`);
          for (const ch of q.flags) if (FLAG_LETTERS.indexOf(ch) < 0) fail(`${who} has an unknown flag letter: ${ch}`);
        }
      }
    }
  }

  // 5. prerequisites
  console.log("5. A quest comes after the quests it needs");
  for (const key of [raceKey]) {
    const at = {};
    let n = 0;
    for (const { v } of visitsOf(key)) {
      if (!v) continue;
      for (const a of v.areas) for (const q of a.q) at[q.id] = n++;
    }
    const pre = preLookup();
    let checked = 0;
    for (const { v } of visitsOf(key)) {
      if (!v) continue;
      for (const a of v.areas) {
        for (const q of a.q) {
          const row = data.quests[String(q.id)];
          const needs = pre.has(q.id) ? pre.get(q.id) : (row && row.p ? [row.p] : []);
          const onPath = needs.filter((p) => at[p] != null);
          if (!onPath.length) continue;
          checked++;
          if (!onPath.some((p) => at[p] < at[q.id])) fail(`${key}: quest ${q.id} (${v.zone}) comes before ${onPath.length > 1 ? "every one of the quests" : "quest"} ${onPath.join(" ")}, which it needs`);
        }
      }
    }
    console.log(`  ${checked} quests have a quest they need on the path, and come after one of them`);
  }

  // 6. the pretend game
  console.log("6. A pretend character plays the plan from 1 to 60");
  for (const key of [raceKey]) {
    const list = visitsOf(key).filter((x) => x.v);
    let total = 0, quests = 0, gapSum = 0;
    list.forEach(({ v }, i) => {
      const plan = [];
      for (const a of v.areas) {
        for (const q of a.q) {
          const row = data.quests[String(q.id)];
          if (row) plan.push({ l: row.l, m: row.m, k: q.flags.indexOf("k") >= 0 });
        }
      }
      const target = i + 1 < list.length ? list[i + 1].v.lo : 60;
      const r = xp.walk(total, plan, target);
      total = r.total;
      quests += v.n;
      gapSum += v.gap;
      if (r.grind > v.gap + 0.05) fail(`stuck in ${v.zone}: needs ${r.grind.toFixed(1)} levels of grinding, the plan says ${v.gap}`);
      if (v.gap > r.grind + 0.15) fail(`${v.zone}: the plan says ${v.gap} levels of grinding, the pretend character needs only ${r.grind.toFixed(1)}`);
      if (v.gap > MAX_VISIT_GAP) fail(`${v.zone}: the gap is ${v.gap} levels, more than ${MAX_VISIT_GAP}`);
      console.log(`  ${v.zone} ${v.lo}-${v.hi}: ${v.areas.length} areas, ${v.n} quests, gap ${v.gap}`);
    });
    if (gapSum > MAX_PATH_GAP) fail(`${key}: the gaps add up to ${gapSum.toFixed(1)} levels, more than ${MAX_PATH_GAP}`);
    const band = GRIND_BAND[key];
    if (band && (gapSum < band[0] || gapSum > band[1])) fail(`${key}: the gaps add up to ${gapSum.toFixed(1)} levels, outside the band ${band[0]} to ${band[1]} written down in this test`);
    if (Math.floor(xp.levelAt(total)) !== 60) fail(`${key}: the character ends at level ${xp.levelAt(total).toFixed(1)}, not 60`);
    console.log(`  ${key}: ${quests} quests, total gap ${gapSum.toFixed(1)} levels`);
  }

  // 7. short walks
  console.log("7. Short walks between the areas of a zone");
  for (const key of [raceKey]) {
    let longest = 0, worst = "";
    for (const { v } of visitsOf(key)) {
      if (!v || v.areas.length < 2) continue;
      const { w, h } = zoneSide(v.zone);
      const limit = MAX_HOP_SHARE * Math.max(w, h);
      let walk = 0;
      for (let i = 1; i < v.areas.length; i++) {
        const a = v.areas[i - 1], b = v.areas[i];
        const hop = yards(v.zone, a.x, a.y, b.x, b.y);
        walk += hop;
        if (hop > limit) fail(`${key}: ${v.zone}: the walk from area ${i} to area ${i + 1} is ${Math.round(hop)} yards, more than ${Math.round(limit)}`);
        if (hop / Math.max(w, h) > longest) { longest = hop / Math.max(w, h); worst = v.zone; }
      }
      if (walk > MAX_WALK) fail(`${key}: ${v.zone}: the walk between the areas is ${Math.round(walk)} yards, more than ${MAX_WALK}`);
      console.log(`  ${v.zone}: ${v.areas.length} areas, ${Math.round(walk)} yards of walking between them`);
    }
    console.log(`  ${key}: the longest hop is ${(longest * 100).toFixed(0)}% of a zone side (${worst})`);
  }

  // 8. hand-in fields
  console.log("8. Hand-in places: another zone only for quests marked x, and only the stop right after or the next zone");
  for (const key of [raceKey]) {
    const list = visitsOf(key).filter((x) => x.v);
    list.forEach(({ v }, i) => {
      let carried = 0;
      const next = list[i + 1] && list[i + 1].v;
      const after = next && next.stop ? list[i + 2] && list[i + 2].v : next;
      for (const a of v.areas) {
        for (const q of a.q) {
          const marked = q.flags.indexOf("x") >= 0;
          const who = `quest ${q.id} (${v.zone})`;
          if (!marked) {
            if (q.hzone) fail(`${key}: ${who} names the zone ${q.hzone} to hand in at, but is not marked x`);
            if (q.ozone) fail(`${key}: ${who} names the zone ${q.ozone} for its work`);
            continue;
          }
          if (!q.hzone) { fail(`${key}: ${who} is marked x but names no zone to hand in at`); continue; }
          carried++;
          const ok = (next && q.hzone === next.zone) || (after && q.hzone === after.zone);
          if (!ok) fail(`${key}: ${who} is handed in at ${q.hzone}, which is not the next visit${next && next.stop ? " (the stop right after) or the zone after it" : ""} (${next ? next.zone : "none"})`);
        }
      }
      if (carried > 3) fail(`${key}: ${v.zone}: ${carried} quests are handed in later, more than 3`);
    });
  }

  // 9. the start, levels 1 to 20
  console.log("9. The start, and RestedXP's quests in every zone");
  for (const key of [raceKey]) {
    const list = visitsOf(key).filter((x) => x.v);
    const bit = RACE_BIT[key];
    const onPath = {};
    for (const { v } of list) for (const a of v.areas) for (const q of a.q) onPath[q.id] = true;
    const first = FIRST_QUEST[key];
    if (first && list.length) {
      const area = list[0].v.areas[0];
      if (!area || !area.q.some((q) => q.id === first)) fail(`${key}: quest ${first}, the first quest of the race, is not in the first area of ${list[0].v.zone}`);
    }
    if ((key === "Orc" || key === "Troll") && onPath[GOBLIN_QUEST]) fail(`${key}: quest ${GOBLIN_QUEST}, a Turtle goblin starter quest, is on the path`);
    let extra = 0;
    for (const { v } of list) {
      if (v.stop) continue;
      const eligible = (rested.zone[v.zone] || []).filter((id) => {
        const row = data.quests[String(id)];
        return row && !(row.r && (row.r & bit) === 0) && !row.c && row.l >= v.lo - 4 && row.l <= v.hi + 2;
      });
      const kept = eligible.filter((id) => onPath[id]).length;
      const share = eligible.length ? Math.round(kept / eligible.length * 100) : 100;
      console.log(`  ${v.zone}: RestedXP has ${eligible.length} here, ${kept} are on the route (${share}%)`);
      if (eligible.length >= 4 && share < MIN_SHARE) {
        const missing = eligible.filter((id) => !onPath[id]).slice(0, 8).join(" ");
        fail(`${key}: ${v.zone}: only ${share}% of RestedXP's quests are on the route (at least ${MIN_SHARE}% wanted); missing, for example: ${missing}`);
      }
      if (v.lo < EARLY_LEVEL) for (const a of v.areas) for (const q of a.q) if (!rested.any[q.id]) extra++;
    }
    console.log(`  1-20: ${extra} extra quests that RestedXP skips`);
    if (extra < MIN_EXTRA) fail(`${key}: only ${extra} extra quests that RestedXP skips in levels 1 to 20, at least ${MIN_EXTRA} wanted`);
  }

  // 10. levels 1 to 20 are not thin
  console.log("10. No zone is thin");
  for (const key of [raceKey]) {
    for (const { v } of visitsOf(key)) {
      if (!v || v.stop) continue;
      const wanted = Math.max(MIN_QUESTS, MIN_PER_LEVEL * (v.hi - v.lo));
      if (v.n < wanted) fail(`${key}: ${v.zone} (level ${v.lo} to ${v.hi}) has only ${v.n} quests, at least ${wanted} wanted`);
      console.log(`  ${v.zone}: ${v.n} quests (at least ${wanted} wanted)`);
    }
  }

  // 12. what the guides agree on: per zone, the share of those quests that are on the route must be at least MIN_SHARE
  console.log("12. What the guides agree on is on the route");
  for (const key of [raceKey]) {
    const list = visitsOf(key).filter((x) => x.v);
    const bit = RACE_BIT[key], word = key === "Scourge" ? "Undead" : key;
    const index = guideLookup();
    const onPath = {};
    for (const { v } of list) for (const a of v.areas) for (const q of a.q) onPath[q.id] = true;
    const doing = (map, id) => {
      const r = map.get(id);
      return r && /[ACT]/.test(r.verbs) && (!r.races || r.races.indexOf(word) >= 0) ? r : null;
    };
    const ids = new Set(Object.keys(rested.any).map(Number));
    for (const g of ["TG", "VG"]) for (const id of index[g][process.argv[2]].keys()) ids.add(id);
    // A quest the guides pick up in a place the race's route never goes to, a city or a zone, can never be offered by this route,
    // so it is not counted: it would test the ladder, not the builder. The place is RestedXP's zone for the quest, else
    // TourGuide's, else the zone of the quest's row in Data/Zones.lua (where its giver stands first).
    const goesTo = {};
    for (const { v } of list) goesTo[v.zone] = true;
    const restedZoneOf = {};
    for (const z of Object.keys(rested.zone)) for (const id of rested.zone[z]) restedZoneOf[id] = z;
    const pickedUpAt = (id, row) => {
      const tg = index.TG[process.argv[2]].get(id);
      return restedZoneOf[id] || (tg && /A/.test(tg.verbs) && tg.zone) || row.zone;
    };
    for (const { v } of list) {
      if (v.stop) continue;
      const restedHere = new Set(rested.zone[v.zone] || []);
      let agree = 0, kept = 0, never = 0;
      const missing = [];
      for (const id of ids) {
        const row = data.quests[String(id)];
        if (!row || row.c || (row.r && (row.r & bit) === 0) || row.l < v.lo - 4 || row.l > v.hi + 2 || row.m > v.hi) continue;
        const tg = doing(index.TG[process.argv[2]], id), vg = doing(index.VG[process.argv[2]], id);
        const guides = (rested.any[id] ? 1 : 0) + (tg ? 1 : 0) + (vg ? 1 : 0);
        if (guides < 2) continue;
        const here = (r) => r && /A/.test(r.verbs) && r.zone === v.zone;
        if (!(restedHere.has(id) || here(tg) || here(vg))) continue;
        if (!goesTo[pickedUpAt(id, row)]) { never++; continue; }
        agree++;
        if (onPath[id]) kept++; else missing.push(id);
      }
      const share = agree ? Math.round(kept / agree * 100) : 100;
      console.log(`  ${v.zone}: the guides agree on ${agree} quests here, ${kept} are on the route (${share}%)${never ? `, ${never} not counted: they start where this race never goes` : ""}`);
      if (agree >= 4 && share < MIN_SHARE) fail(`${key}: ${v.zone}: only ${share}% of the quests the guides agree on are on the route (at least ${MIN_SHARE}% wanted); missing, for example: ${missing.slice(0, 8).join(" ")}`);
    }
  }

  // 13. travel between zones: every move from one visit to the next has 1 to 4 legs the reader gives back, in plain words, with a
  // place for the arrow when you fly, and the last leg ends in the zone the move goes to
  console.log("13. Travel between zones");
  for (const key of [raceKey]) {
    const list = visitsOf(key).filter((x) => x.v);
    let moves = 0, legs = 0;
    for (let i = 0; i + 1 < list.length; i++) {
      const from = list[i].v.zone, to = list[i + 1].v.zone;
      const name = `${process.argv[2]}|${from}>${to}`;
      const entry = data.travel[name];
      moves++;
      if (!Array.isArray(entry) || !entry.length) { fail(`${key}: the move ${name} has no travel legs`); continue; }
      if (entry.length > 4) fail(`${key}: ${name} has ${entry.length} legs, at most 4 wanted`);
      legs += entry.length;
      entry.forEach((leg, n) => {
        const where = `${key}: ${name}, leg ${n + 1}`;
        if (typeof leg.text !== "string" || !leg.text) fail(`${where}: the words are empty`);
        else {
          if (/\d/.test(leg.text)) fail(`${where}: the words have a digit: ${leg.text}`);
          if (/[\t\r\n]/.test(leg.text)) fail(`${where}: the words have a tab or a line break`);
          if (/[;=]/.test(leg.text)) fail(`${where}: the words have a semicolon or an equals sign: ${leg.text}`);
        }
        if (!leg.tick) fail(`${where}: nothing says when the leg is done`);
        if (leg.kind === "fly") {
          if (!leg.to) fail(`${where}: a flight does not say where you land`);
          if (leg.x == null || leg.y == null || !leg.zone) fail(`${where}: a flight has no place for the arrow`);
        }
        if (leg.zone && !zoneSizes[leg.zone]) fail(`${where}: the arrow place is in ${leg.zone}, which is not in Data/ZoneSizes.lua`);
        if (leg.learn) {
          const names = String((data.flights || {})[`${process.argv[2]}|${leg.tick}`] || "").split("\n").map((l) => l.split("\t")[2]);
          if (names.indexOf(leg.learn) < 0) fail(`${where}: it teaches the flight path of ${leg.learn}, who is no flight master of ${leg.tick} in the flights table`);
        }
      });
      if (entry[entry.length - 1].tick !== to) fail(`${key}: ${name}: the last leg ends in ${entry[entry.length - 1].tick}, not in ${to}`);
    }
    console.log(`  ${key}: ${moves} moves, ${legs} legs`);
  }

  // 14. grind spots
  console.log("14. Grind spots");
  for (const key of [raceKey]) {
    const poolMax = grindConst("GRIND_POOL_MAX"), minSpawns = grindConst("GRIND_MIN_SPAWNS");
    let visitsWith = 0, spotCount = 0;
    for (const { no, v } of visitsOf(key)) {
      if (!v) continue;
      const spots = Array.isArray(v.spots) ? v.spots : Object.values(v.spots || {});
      const where = `${key}: ${v.zone} (visit ${no})`;
      if (v.stop) {
        if (spots.length || v.rawSpots) fail(`${where}: a short stop has grind spots`);
        continue;
      }
      if (!spots.length) continue;
      visitsWith++;
      spotCount += spots.length;
      if (spots.length > poolMax) fail(`${where}: ${spots.length} grind spots, at most ${poolMax}`);
      const lines = String(v.rawSpots == null ? "" : v.rawSpots).split("\n").filter((l) => l !== "");
      lines.forEach((line, i) => {
        if (line.split("\t").length !== 9) fail(`${where}: spot line ${i + 1} does not have 9 fields`);
      });
      spots.forEach((s, i) => {
        const w = `${where}, spot ${i + 1} (${s.name})`;
        const whole = (n) => typeof n === "number" && Number.isInteger(n);
        if (typeof s.name !== "string" || !s.name || s.name.indexOf("|") >= 0) fail(`${w}: the name is empty or has a bar`);
        for (const [what, n] of [["x", s.x], ["y", s.y]]) {
          if (typeof n !== "number" || !(n >= 0 && n <= 100)) fail(`${w}: ${what} is ${n}, not a number from 0 to 100`);
        }
        if (!whole(s.lo) || !whole(s.hi) || s.lo < 1 || s.hi > 60 || s.lo > s.hi) fail(`${w}: the levels ${s.lo} to ${s.hi} are not whole numbers with 1 <= lo <= hi <= 60`);
        if (!whole(s.n) || s.n < minSpawns) fail(`${w}: ${s.n} spawns, at least ${minSpawns} wanted`);
        if (["y", "p", "r", "u"].indexOf(s.code) < 0) fail(`${w}: the code is ${s.code}, not y, p, r or u`);
        if (!whole(s.red) || s.red < 0 || s.red > 99) fail(`${w}: red is ${s.red}, not a whole number from 0 to 99`);
        if (!whole(s.elite) || s.elite < 0 || s.elite > 63) fail(`${w}: elite is ${s.elite}, not a whole number from 0 to 63`);
        const types = typesOfName(s.name);
        if (types.length && types.every((ty) => ty === 8 || ty === 10 || ty === 11)) fail(`${w}: every creature of this name is a critter, a totem or of no type`);
      });
    }
    console.log(`  ${key}: ${visitsWith} visits with spots, ${spotCount} spots`);
  }

  // 15. the danger flags
  console.log("15. The danger flags are right, the danger table agrees with them, and a quest left out of the casual model has no grind mark");
  const faction = FACTIONS.Alliance.races.indexOf(raceKey) >= 0 ? "Alliance" : "Horde";
  const table = dangerTables()[faction];
  for (const key of [raceKey]) {
    let looked = 0, listed = 0;
    for (const { v } of visitsOf(key)) {
      if (!v) continue;
      let total = 0;
      const lost = { any: 0, g: 0, d: 0, v: 0, h: 0, vAlone: 0 };
      for (const a of v.areas) {
        for (const q of a.q) {
          total++;
          const who = `${key}: quest ${q.id} (${v.zone})`;
          const has = (ch) => q.flags.indexOf(ch) >= 0;
          if (REAL_D.indexOf(q.id) >= 0) {
            realDSeen.add(q.id);
            if (!has("d")) fail(`${who} is a dungeon quest but has no d (flags "${q.flags}")`);
          }
          if (FALSE_D.indexOf(q.id) >= 0 && has("d")) fail(`${who} is not a dungeon quest but has d`);
          if (q.id === HOGGER && !has("g")) fail(`${who} is a group quest but has no g (flags "${q.flags}")`);
          if (HARD_QUESTS.indexOf(q.id) >= 0 && !has("h")) fail(`${who} was rated Hard by friends but has no h (flags "${q.flags}")`);
          if (q.id === SKIPPED_QUEST.id && faction === SKIPPED_QUEST.faction && !has("v")) fail(`${who} is skipped by the safe route but has no v (flags "${q.flags}")`);
          if (q.grind && DUNGEON_ONLY_FLAGS.split("").some(has)) fail(`${who} (flags "${q.flags}") has a grind level`);
          // the danger table says the same as the flags
          const want = DANGER_LETTERS.split("").filter(has).join("");
          const got = table.get(q.id) || "";
          if (got !== want) fail(`${who}: the danger table says "${got}", the Q line flags say "${want}"`);
          looked++;
          const dropped = ["g", "d", "v", "h"].filter(has);
          if (dropped.length) {
            lost.any++;
            for (const ch of dropped) lost[ch]++;
          }
          if (has("v") && !["e", "g", "d", "s", "h"].some(has)) lost.vAlone++;
        }
      }
      if (lost.any) {
        listed++;
        console.log(`  drops: ${key} ${v.zone}: ${lost.any} of ${total} (g ${lost.g}, d ${lost.d}, v ${lost.v}, h ${lost.h})`);
      }
      if (total && lost.vAlone / total > V_VISIT_SHARE) visitDrops.push(`${key} ${v.zone}: ${lost.vAlone} of ${total} quests lost to v alone`);
    }
    console.log(`  ${key}: ${looked} quests looked at, ${listed} visits lose quests to the new rules`);
  }
  checkChains(raceKey);
}

// 16. Chains. Data/Chains.lua is read here in a machine of its own, once; the rule is tools/lib/chains.js with the leave-out letters of
// Steps.lua (one table with the game).
const CHAINS_FILE = path.join(ROOT, "Data", "Chains.lua");
const FACTS_FILE = path.join(ROOT, "tools", "data", "chain-facts.tsv");
let chainsRead = null;
function chainsData() {
  if (chainsRead) return chainsRead;
  chainsRead = { version: null, chains: {}, races: {}, out: {}, leaveOut: null };
  try {
    const cvm = newLuaVM();
    cvm.run(fs.readFileSync(CHAINS_FILE), "Data/Chains.lua");
    Object.assign(chainsRead, cvm.get("EasyRoute_Chains"));
  } catch (e) {
    fail("Data/Chains.lua did not load: " + e.message);
  }
  try {
    chainsRead.leaveOut = CH.readLeaveOut(fs.readFileSync(path.join(ROOT, "Steps.lua"), "utf8"));
  } catch (e) {
    fail(e.message);
    chainsRead.leaveOut = { casual: "", medium: "", hard: "" };
  }
  return chainsRead;
}
const chainEntry = (cd, n) => Array.isArray(cd.chains) ? cd.chains[n - 1] : (cd.chains || {})[String(n)];
function checkChains(key) {
  console.log("16. Chains: the data file, the rule and the hubs");
  const cd = chainsData();
  const list = visitsOf(key).filter((x) => x.v);
  const at = new Map(), qline = new Map(), zones = new Set();
  let order = 0;
  for (const { v } of list) {
    zones.add(v.zone);
    for (const a of v.areas) for (const q of a.q) if (!at.has(q.id)) { at.set(q.id, order++); qline.set(q.id, q); }
  }
  const pre = preLookup();
  const numbers = cd.races && cd.races[key];
  if (typeof numbers !== "string") { fail(`${key}: Data/Chains.lua has no chain list for this race`); return; }
  const owned = new Map(), own = [];
  let judged = 0, keep = { casual: 0, medium: 0, hard: 0 };
  for (const no of numbers.split(",").filter((s) => s !== "").map(Number)) {
    const entry = chainEntry(cd, no);
    const who = `${key}: chain ${no}`;
    if (!entry) { fail(`${who} is not in Data/Chains.lua`); continue; }
    const parsed = CH.parseChain(entry);
    const sRaw = String(entry.s).split("\n");
    if (parsed.steps.length < CH.N.CHAIN_MIN_STEPS) fail(`${who} has ${parsed.steps.length} steps, at least ${CH.N.CHAIN_MIN_STEPS} wanted`);
    if (sRaw.some((l) => l.split("\t").length !== 5)) fail(`${who}: a step line does not have 5 fields`);
    const ids = parsed.steps.map((s) => s.id);
    parsed.steps.forEach((s, i) => {
      const w = `${who}, quest ${s.id}`;
      if (!at.has(s.id)) { fail(`${w} is not on the path`); return; }
      if (i > 0 && at.has(ids[i - 1]) && at.get(s.id) <= at.get(ids[i - 1])) fail(`${w} does not come after quest ${ids[i - 1]} on the path`);
      if (i > 0 && !(pre.get(s.id) || []).includes(ids[i - 1])) fail(`${w} does not need quest ${ids[i - 1]} (quest-pre.tsv)`);
      if (owned.has(s.id)) fail(`${w} is also a step of chain ${owned.get(s.id)}`);
      owned.set(s.id, no);
      if (!Number.isInteger(s.xp) || s.xp < 0) fail(`${w}: xp ${s.xp} is not a whole number from 0`);
      const mark = sRaw[i].split("\t")[2];
      if (mark !== "r" && mark !== "e") fail(`${w}: xp is marked "${mark}", not r or e`);
      if (!(s.v >= 0) || !(s.w >= 0) || !Number.isFinite(s.v) || !Number.isFinite(s.w)) fail(`${w}: minutes ${s.v} and ${s.w} are not numbers from 0`);
      const q = qline.get(s.id);
      if (q.ozone) fail(`${w}: its work is in ${q.ozone}, another zone`);
      if (q.hzone && q.flags.indexOf("x") < 0) fail(`${w}: it is handed in at ${q.hzone} and is not marked x`);
    });
    for (const zone of parsed.z.split("|")) if (!zones.has(zone)) fail(`${who}: the zone "${zone}" is not on the path`);
    String(entry.e || "").split("\n").filter((l) => l !== "").forEach((line, i) => {
      const f = line.split("\t");
      const w = `${who}, end item ${i + 1}`;
      if (f.length !== 6) { fail(`${w} does not have 6 fields`); return; }
      if (f[0] !== "r" && f[0] !== "c") fail(`${w}: kind "${f[0]}" is not r or c`);
      if (!/^[1-9][0-9]*$/.test(f[1])) fail(`${w}: item id "${f[1]}" is not a number`);
      if (f[2] !== "?" && !/^[0-4]$/.test(f[2])) fail(`${w}: quality "${f[2]}" is not 0 to 4 or ?`);
      if (f[3] !== "" && CH.SLOT_WORDS.indexOf(f[3]) < 0) fail(`${w}: slot "${f[3]}" is not a slot word`);
      if (!/^[WPHRISMLD]*$/.test(f[4])) fail(`${w}: class letters "${f[4]}" are not from WPHRISMLD`);
      if (f[2] !== "?" && f[5] !== "") fail(`${w}: a name is given though the quality is known`);
    });
    // The rule, by xp alone, with the letters of the route file and the game's leave-out table.
    const lettersOf = (i) => (qline.get(parsed.steps[i].id) || { flags: "" }).flags;
    const verdict = (mode) => CH.judge(parsed, mode, "", (i) => CH.leftBy(lettersOf(i), mode, cd.leaveOut));
    judged++;
    for (const mode of ["casual", "medium", "hard"]) if (verdict(mode).worth) keep[mode]++;
    if (!verdict("casual").worth) {
      for (const s of parsed.steps) {
        const q = qline.get(s.id);
        if (q && q.grind) fail(`${who}: quest ${s.id} is a step of a chain Casual leaves out but has the grind level ${q.grind}`);
      }
    }
    own.push({ no, ids });
  }
  // No route quest outside a chain's own part needs one of its own steps.
  for (const c of own) {
    const mine = new Set(c.ids);
    for (const id of at.keys()) {
      if (mine.has(id)) continue;
      const hit = (pre.get(id) || []).filter((p) => mine.has(p));
      if (hit.length) fail(`${key}: quest ${id} needs quest ${hit[0]}, a step of chain ${c.no}, but is not a step of it (a hub inside a chain)`);
    }
  }
  const gone = (cd.out && cd.out[key] ? String(cd.out[key]).split(",").map(Number) : []);
  for (const id of gone) if (at.has(id)) fail(`${key}: quest ${id} is in the out list of Data/Chains.lua but is on the path`);
  if (judged && keep.casual < CH.N.CASUAL_KEEP_MIN * judged) fail(`${key}: Casual keeps only ${keep.casual} of ${judged} chains, at least ${Math.ceil(CH.N.CASUAL_KEEP_MIN * judged)} wanted`);
  console.log(`  chains: ${judged} judged, Casual keeps ${keep.casual}, Medium ${keep.medium}, Hard ${keep.hard} (xp only)`);
}

// 16, once per run: the file as a whole and the facts it was made from.
function checkChainsFile() {
  console.log("16. Chains: Data/Chains.lua as a whole");
  const cd = chainsData();
  if (cd.version !== 1) fail(`Data/Chains.lua has version ${cd.version}, expected 1`);
  const text = fs.readFileSync(CHAINS_FILE, "utf8");
  const head = text.split("\n")[0];
  if (!/Do not edit by hand\.$/.test(head) || head.indexOf("classic-db") < 0 || head.indexOf("pfExtend") < 0) fail("the first line of Data/Chains.lua does not say it is generated and name classic-db and pfExtend");
  const kb = Buffer.byteLength(text) / 1024;
  if (kb > CH.N.CHAINS_FILE_MAX_KB) fail(`Data/Chains.lua is ${kb.toFixed(1)} KB, at most ${CH.N.CHAINS_FILE_MAX_KB} KB wanted`);
  else console.log(`  Data/Chains.lua is ${kb.toFixed(1)} KB (at most ${CH.N.CHAINS_FILE_MAX_KB} KB)`);
  try {
    const facts = CH.readFacts(FACTS_FILE);
    for (const [id, want] of [[845, 900], [208, 5350], [1060, 1550]]) {
      const q = facts.quests.get(id);
      if (!q || q.xp !== want) fail(`tools/data/chain-facts.tsv: quest ${id} should give ${want} xp, it says ${q && q.xp}`);
    }
  } catch (e) {
    fail(e.message);
  }
}

// The danger table of the route file, read as text so its order can be checked: { Alliance: Map id -> letters, Horde: ..., cave: Map id -> word }.
// Read once. A line that is not a row, an id out of order and letters out of order or outside DANGER_LETTERS fail.
let dangerRead = null;
function dangerTables() {
  if (dangerRead) return dangerRead;
  dangerRead = { Alliance: new Map(), Horde: new Map(), cave: new Map() };
  const text = fs.readFileSync(ROUTE_FILE, "utf8");
  const at = text.indexOf("\n  danger = {\n");
  if (at < 0) { fail("the route file has no danger table"); return dangerRead; }
  const lines = text.slice(at + 1).split("\n");
  let section = null, last = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = /^    (Alliance|Horde) = \{$/.exec(line))) { section = m[1]; last = 0; continue; }
    if (line === "    },") { section = null; continue; }
    if (line === "  caveword = {") { section = "cave"; last = 0; continue; }
    if (line === "  },") { if (section === "cave") break; section = null; continue; }
    if (line === "}") break;
    if (!section) continue;
    if (section === "cave") {
      m = /^    \[(\d+)\] = "(mine|crypt)",$/.exec(line);
      if (!m) { fail(`caveword line is not a row: ${line}`); continue; }
    } else {
      m = /^      \[(\d+)\] = "([a-z]+)",$/.exec(line);
      if (!m) { fail(`${section} danger line is not a row: ${line}`); continue; }
      const letters = m[2];
      if (letters.split("").some((ch) => DANGER_LETTERS.indexOf(ch) < 0)) fail(`${section} danger ${m[1]}: letters "${letters}" are not from "${DANGER_LETTERS}"`);
      if (letters.split("").map((ch) => DANGER_LETTERS.indexOf(ch)).some((n, k, all) => k > 0 && n <= all[k - 1])) fail(`${section} danger ${m[1]}: letters "${letters}" are not in the order "${DANGER_LETTERS}"`);
    }
    const id = Number(m[1]);
    if (id <= last) fail(`${section} table: id ${id} is not after ${last}`);
    last = id;
    dangerRead[section].set(id, m[2]);
  }
  for (const f of ["Alliance", "Horde"]) if (!dangerRead[f].size) fail(`the ${f} danger table is empty`);
  for (const [id, word] of dangerRead.cave) {
    const holders = ["Alliance", "Horde"].filter((f) => (dangerRead[f].get(id) || "").indexOf("u") >= 0);
    if (!holders.length) fail(`caveword ${id} (${word}) is not a u quest in either danger table`);
  }
  return dangerRead;
}

// The grind numbers of tools/build-route.js (GRIND_POOL_MAX and the others), read from its text so there is one source for them.
let grindConsts = null;
function grindConst(name) {
  if (!grindConsts) {
    grindConsts = {};
    const text = fs.readFileSync(path.join(ROOT, "tools", "build-route.js"), "utf8");
    for (const m of text.matchAll(/\b(GRIND_[A-Z_]+)\s*=\s*([0-9.]+)\b/g)) grindConsts[m[1]] = Number(m[2]);
  }
  if (!(name in grindConsts)) fail(`tools/build-route.js has no number ${name}`);
  return grindConsts[name];
}

// The creature types of each name in tools/data/creature-react.tsv (a critter is 8, not specified 10, a totem 11). Read once.
let reactTypes = null;
function typesOfName(name) {
  if (!reactTypes) {
    reactTypes = new Map();
    const file = path.join(ROOT, "tools", "data", "creature-react.tsv");
    if (!fs.existsSync(file)) fail("tools/data/creature-react.tsv is missing");
    else {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line || line.charAt(0) === "#") continue;
        const c = line.split("\t");
        if (!reactTypes.has(c[1])) reactTypes.set(c[1], []);
        reactTypes.get(c[1]).push(Number(c[4]));
      }
    }
  }
  return reactTypes.get(name) || [];
}

// The quests each quest needs (any one of them is enough), by quest id, from tools/data/quest-pre.tsv. Read once.
const PRE_FILE = path.join(ROOT, "tools", "data", "quest-pre.tsv");
let preMap = null;
function preLookup() {
  if (!preMap) {
    preMap = new Map();
    if (!fs.existsSync(PRE_FILE)) {
      fail("tools/data/quest-pre.tsv is missing (run node tools/build-route.js)");
      return preMap;
    }
    fs.readFileSync(PRE_FILE, "utf8").split("\n").forEach((line, i) => {
      if (!line || line.charAt(0) === "#") return;
      const c = line.split("\t");
      if (c.length !== 2 || !Number(c[0])) { fail(`quest-pre.tsv line ${i + 1} is not a row`); return; }
      preMap.set(Number(c[0]), c[1].split(",").map(Number));
    });
  }
  return preMap;
}

// The guide index, read here with the test's own small reader (not the builder's): the rows with 7 fields, as arrays.
const GUIDE_INDEX_FILE = path.join(ROOT, "tools", "data", "guide-index.tsv");
function readGuideIndex() {
  if (!fs.existsSync(GUIDE_INDEX_FILE)) return null;
  const rows = [], bad = [];
  fs.readFileSync(GUIDE_INDEX_FILE, "utf8").split("\n").forEach((line, i) => {
    if (!line || line.charAt(0) === "#") return;
    const c = line.split("\t");
    if (c.length !== 7) bad.push(`guide-index.tsv line ${i + 1} has ${c.length} fields, 7 wanted`);
    else rows.push(c);
  });
  return { rows, bad };
}
// The index rows by guide, faction and quest id: { zone, races (a list, or null for everyone), verbs }. Read once.
let guideMaps = null;
function guideLookup() {
  if (!guideMaps) {
    guideMaps = { TG: { Alliance: new Map(), Horde: new Map() }, VG: { Alliance: new Map(), Horde: new Map() } };
    const index = readGuideIndex();
    if (index) {
      for (const c of index.rows) {
        if (guideMaps[c[0]] && guideMaps[c[0]][c[1]]) guideMaps[c[0]][c[1]].set(Number(c[2]), { zone: c[4], races: c[5] === "*" ? null : c[5].split(","), verbs: c[6] });
      }
    }
  }
  return guideMaps;
}
// 11. The guide index.
const MIN_INDEX_ROWS = 400, MIN_INDEX_KNOWN = 90;
function checkGuideIndex() {
  console.log("11. The guide index");
  const index = readGuideIndex();
  if (!index) { fail("tools/data/guide-index.tsv is missing (run node tools/build-guide-index.js)"); return; }
  for (const b of index.bad) fail(b);
  const count = {};
  let known = 0;
  for (const c of index.rows) {
    const key = c[0] + " " + c[1];
    count[key] = (count[key] || 0) + 1;
    if (data.quests[c[2]]) known++;
    if (c[4] && !zoneSizes[c[4]]) fail(`guide-index.tsv: quest ${c[2]}: the pick-up zone "${c[4]}" is not in Data/ZoneSizes.lua`);
  }
  const rows = index.rows.length;
  for (const [g, name] of [["TG", "TourGuide"], ["VG", "VanillaGuide"]]) {
    for (const f of ["Alliance", "Horde"]) {
      const n = count[g + " " + f] || 0;
      console.log(`  ${name} ${f}: ${n} rows`);
      if (n < MIN_INDEX_ROWS) fail(`${name} has only ${n} ${f} rows in guide-index.tsv, at least ${MIN_INDEX_ROWS} wanted`);
    }
  }
  const share = rows ? Math.round(known / rows * 100) : 0;
  console.log(`  ${known} of ${rows} rows are quests of Data/Zones.lua (${share}%)`);
  if (share < MIN_INDEX_KNOWN) fail(`only ${share}% of the guide index quests are rows of Data/Zones.lua, at least ${MIN_INDEX_KNOWN}% wanted`);
}

// The reader is run here in a Lua 5.3 machine with Lua 5.0 names added, which would let a # or a % slip through. The game's own
// grammar check (tools/check-lua.js) is run on the repo root, which holds RouteReader.lua and every other game file: no error and
// no warning allowed.
function checkReaderIsLua50() {
  console.log("0. RouteReader.lua is Lua 5.0 (tools/check-lua.js on the repo root)");
  const r = childProcess.spawnSync(process.execPath, [path.join(__dirname, "check-lua.js"), ROOT], { encoding: "utf8" });
  const text = String(r.stdout || "") + String(r.stderr || "");
  const sum = /Checked (\d+) files?: (\d+) error\(s\), (\d+) warning\(s\)/.exec(text);
  if (r.error || !sum || Number(sum[1]) < 1) { fail("check-lua.js did not check RouteReader.lua" + (r.error ? ": " + r.error.message : "")); return; }
  for (const line of text.split("\n")) if (/^(ERROR|WARN)\b/.test(line)) fail("RouteReader.lua: " + line.trim());
  if (r.status !== 0 || Number(sum[2]) > 0 || Number(sum[3]) > 0) fail(`RouteReader.lua is not clean Lua 5.0 (${sum[2]} errors, ${sum[3]} warnings)`);
  else console.log("  checked, 0 errors, 0 warnings");
}

// ---- the file as a whole, then each asked race in turn ----------------------------------------------------
console.log("== the route file ==");
checkReaderIsLua50();
if (data.version !== 4) fail(`version is ${data.version}, expected 4`);
{
  const head = fs.readFileSync(ROUTE_FILE, "utf8").split("EasyRoute_Route = {")[0];
  if (!/grind = grind to this level/.test(head) || !/version 4/.test(head) || !/spots/.test(head)) fail("the header comment of the route file does not describe the grind field, the spots field and version 4");
}
{
  const kb = fs.statSync(ROUTE_FILE).size / 1024;
  const max = grindConst("GRIND_FILE_MAX_KB");
  if (kb > max) fail(`the route file is ${kb.toFixed(1)} KB, at most ${max} KB wanted`);
  else console.log(`  the route file is ${kb.toFixed(1)} KB (at most ${max} KB)`);
}
const haveKeys = data.pathKeys.slice().sort().join(" ");
const wantKeys = ALL_KEYS.slice().sort().join(" ");
if (haveKeys !== wantKeys) fail(`the paths are [${haveKeys}], expected [${wantKeys}]`);
for (const key of keys) {
  console.log(`== ${key} ==`);
  playRace(key);
}
checkGuideIndex();
checkChainsFile();
console.log(`visits losing more than ${Math.round(V_VISIT_SHARE * 100)}% of their quests to v alone: ${visitDrops.length}`);
for (const line of visitDrops) console.log("  " + line);
console.log(`15. Real dungeon quests found on these paths: ${[...realDSeen].sort((a, b) => a - b).join(" ")}`);
if (realDSeen.size < MIN_REAL_D_SEEN) fail(`only ${realDSeen.size} of the real dungeon quests are on these paths, at least ${MIN_REAL_D_SEEN} wanted`);

if (failures) {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("ALL ROUTE CHECKS PASSED");
