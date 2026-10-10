// Plays a starting race through the generated route (Data/Route.lua) from level 1 to 60 in a pretend game and checks it.
// It reads the plan back with the Lua 5.0 reader RouteReader.lua at the repo root (the one the game uses). First the
// file as a whole: version 3 (with the grind field of the Q lines and the spots field of the leveling visits) and exactly the 8 paths Human Dwarf Gnome NightElf Orc Troll Tauren Scourge. Then each asked race,
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
// It needs only the files in this repo, not the game's AddOns folder.
//  0. (once, before the races) the reader RouteReader.lua (checked with every other game file) passes tools/check-lua.js with no error and no warning
// Usage: node tools/test-route.js <Alliance|Horde> [race ...]      (several races: each is played in turn under "== <path key> ==")
//   Alliance races: Human Dwarf Gnome NightElf (default Human). Horde races: Orc Troll Tauren Undead (default Orc).
//   ER_ROUTE_FILE=<file> plays another route file (used to prove that a broken file fails).

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { newLuaVM } = require("./lib/pfdb.js");
const xp = require("./lib/xpmodel.js");

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
const FLAG_LETTERS = "edscfxk";
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
    else if (c[0] === "Q" && want.length) want[want.length - 1].q.push({ id: Number(c[1]), flags: c[2], hand: place(c[3]), obj: place(c[4]), grind: c[5] ? Number(c[5]) : null });
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
if (data.version !== 3) fail(`version is ${data.version}, expected 3`);
{
  const head = fs.readFileSync(ROUTE_FILE, "utf8").split("EasyRoute_Route = {")[0];
  if (!/grind = grind to this level/.test(head) || !/version 3/.test(head) || !/spots/.test(head)) fail("the header comment of the route file does not describe the grind field, the spots field and version 3");
}
const haveKeys = data.pathKeys.slice().sort().join(" ");
const wantKeys = ALL_KEYS.slice().sort().join(" ");
if (haveKeys !== wantKeys) fail(`the paths are [${haveKeys}], expected [${wantKeys}]`);
for (const key of keys) {
  console.log(`== ${key} ==`);
  playRace(key);
}
checkGuideIndex();

if (failures) {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("ALL ROUTE CHECKS PASSED");
