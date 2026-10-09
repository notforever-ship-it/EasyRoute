// Plays a starting race through the generated route (Data/Route.lua) from level 1 to 60 in a pretend game and checks it.
// It reads the plan back with the Lua 5.0 reader in tools/lib/route-reader.lua (the one the game will use later). First the
// file as a whole: version 1 and exactly the 8 paths Human Dwarf Gnome NightElf Orc Troll Tauren Scourge. Then each asked race,
// under "== <path key> ==", gets these checks:
//   1. the race has a path, every visit exists, its zone is a known zone, its quest count is right
//   2. no zone is visited twice (unless the later visit says again), short stops are capitals only, no Turtle WoW extra zone
//   3. the first zone is the race's start zone, the path changes continent at most once (the Undead zeppelin), levels never
//      go backwards: starts at 1, ends at 60, each visit starts where the one before ended
//   4. every quest is a real quest (a row of Data/Zones.lua), once, for this race, no class quest, not too high for the visit
//   5. a quest comes after the quest it needs (the p of its row in Data/Zones.lua) when that one is on the path
//   6. a pretend character plays the quests in order with the same xp rules as the builder (tools/lib/xpmodel.js);
//      where the quests run out it grinds, and the plan must have recorded a gap at least that big
//   7. short walks: the hop from one area to the next and the whole walk of a visit stay short
//   8. hand-in fields: only a quest marked x names another zone, and that zone is the next one (or a capital stop);
//      at most 3 quests per visit are carried on to the next zone
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
// It needs only the files in this repo, not the game's AddOns folder.
// Usage: node tools/test-route.js <Alliance|Horde> [race ...]      (several races: each is played in turn under "== <path key> ==")
//   Alliance races: Human Dwarf Gnome NightElf (default Human). Horde races: Orc Troll Tauren Undead (default Orc).
//   ER_ROUTE_FILE=<file> plays another route file (used to prove that a broken file fails).

const fs = require("fs");
const path = require("path");
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
  vm.run(fs.readFileSync(path.join(__dirname, "lib", "route-reader.lua")), "tools/lib/route-reader.lua");
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
        ER_DATA.visits[tostring(no)] = { race = v.race, zone = v.zone, lo = v.lo, hi = v.hi, gap = v.gap,
          stop = v.stop, again = v.again, n = v.n, areas = ReadVisit(v) }
      end
    end
  end
end
for _, z in pairs(EasyRoute_Zones) do
  for _, q in ipairs(z.q) do
    ER_DATA.quests[tostring(q.id)] = { n = q.n, l = q.l, m = q.m, p = q.p, r = q.r, c = q.c, zone = z.name }
  end
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
  console.log("5. A quest comes after the quest it needs");
  for (const key of [raceKey]) {
    const at = {};
    let n = 0;
    for (const { v } of visitsOf(key)) {
      if (!v) continue;
      for (const a of v.areas) for (const q of a.q) at[q.id] = n++;
    }
    for (const { v } of visitsOf(key)) {
      if (!v) continue;
      for (const a of v.areas) {
        for (const q of a.q) {
          const row = data.quests[String(q.id)];
          if (row && row.p && at[row.p] != null && at[row.p] > at[q.id]) fail(`${key}: quest ${q.id} (${v.zone}) comes before quest ${row.p}, which it needs`);
        }
      }
    }
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
      if (v.gap > MAX_VISIT_GAP) fail(`${v.zone}: the gap is ${v.gap} levels, more than ${MAX_VISIT_GAP}`);
      console.log(`  ${v.zone} ${v.lo}-${v.hi}: ${v.areas.length} areas, ${v.n} quests, gap ${v.gap}`);
    });
    if (gapSum > MAX_PATH_GAP) fail(`${key}: the gaps add up to ${gapSum.toFixed(1)} levels, more than ${MAX_PATH_GAP}`);
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
  console.log("8. Hand-in places: another zone only for quests marked x, and only the next zone or a capital stop");
  for (const key of [raceKey]) {
    const list = visitsOf(key).filter((x) => x.v);
    const stops = {};
    for (const { v } of list) if (v.stop) stops[v.zone] = true;
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
          if (stops[q.hzone]) continue;
          if (!after || q.hzone !== after.zone) fail(`${key}: ${who} is handed in at ${q.hzone}, which is not the next zone`);
          carried++;
        }
      }
      if (carried > 3) fail(`${key}: ${v.zone}: ${carried} quests are carried on to the next zone, more than 3`);
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

  // 12. what the guides agree on: counts per zone, printed only (a later plan turns them into a pass or fail)
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

// ---- the file as a whole, then each asked race in turn ----------------------------------------------------
console.log("== the route file ==");
if (data.version !== 1) fail(`version is ${data.version}, expected 1`);
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
