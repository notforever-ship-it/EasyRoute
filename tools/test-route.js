// Plays a starting race through the generated route (Data/Route.lua) from level 1 to 60 in a pretend game and checks it.
// It reads the plan back with the Lua 5.0 reader in tools/lib/route-reader.lua (the one the game will use later), then:
//   1. the file has version 1, every asked race has a path, every visit exists, its zone is a known zone, its quest count is right
//   2. no zone is visited twice (unless the later visit says again), short stops are capitals only
//   3. levels never go backwards: starts at 1, ends at 60, each visit starts where the one before ended
//   4. every quest is a real quest (a row of Data/Zones.lua), once, for this race, no class quest, not too high for the visit
//   5. a quest comes after the quest it needs (the p of its row in Data/Zones.lua) when that one is on the path
//   6. a pretend character plays the quests in order with the same xp rules as the builder (tools/lib/xpmodel.js);
//      where the quests run out it grinds, and the plan must have recorded a gap at least that big
//   7. short walks: the hop from one area to the next and the whole walk of a visit stay short
//   8. hand-in fields: only a quest marked x names another zone, and that zone is the next one (or a capital stop);
//      at most 3 quests per visit are carried on to the next zone
// It needs only the files in this repo, not the game's AddOns folder.
// Usage: node tools/test-route.js <Alliance|Horde> [race ...]
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
ER_DATA = { version = EasyRoute_Route and EasyRoute_Route.version, paths = {}, visits = {}, quests = {} }
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
function yards(zone, x1, y1, x2, y2) {
  const { w, h } = zoneSide(zone);
  const dx = (x2 - x1) / 100 * w, dy = (y2 - y1) / 100 * h;
  return Math.sqrt(dx * dx + dy * dy);
}

// 1. shape
console.log("1. The route file and the visits");
if (data.version !== 1) fail(`version is ${data.version}, expected 1`);
for (const key of keys) {
  if (!data.paths[key]) { fail(`no path for ${key}`); continue; }
  for (const { no, v } of visitsOf(key)) {
    if (!v) { fail(`${key}: visit ${no} does not exist`); continue; }
    if (!zoneSizes[v.zone]) fail(`${key}: visit ${no} has a zone that is not in Data/ZoneSizes.lua: ${v.zone}`);
    if (questLines(v) !== v.n) fail(`${key}: ${v.zone} says ${v.n} quests but has ${questLines(v)}`);
  }
}

// 2. no revisits
console.log("2. No zone twice, short stops only in capitals");
for (const key of keys) {
  const seen = {};
  for (const { no, v } of visitsOf(key)) {
    if (!v) continue;
    if (seen[v.zone] && v.again !== 1) fail(`${key}: ${v.zone} is visited twice (visit ${no}) and the second one is not marked as a named second visit`);
    seen[v.zone] = true;
    if (v.stop && CAPITALS.indexOf(v.zone) < 0) fail(`${key}: ${v.zone} is a short stop but not a capital`);
  }
}

// 3. levels
console.log("3. Levels go forward from 1 to 60");
for (const key of keys) {
  const list = visitsOf(key).filter((x) => x.v);
  if (!list.length) { fail(`${key}: the path has no visits`); continue; }
  if (list[0].v.lo !== 1) fail(`${key}: the first visit starts at level ${list[0].v.lo}, not 1`);
  if (list[list.length - 1].v.hi !== 60) fail(`${key}: the last visit ends at level ${list[list.length - 1].v.hi}, not 60`);
  list.forEach(({ v }, i) => {
    if (i > 0 && v.lo < list[i - 1].v.hi) fail(`${key}: ${v.zone} starts at ${v.lo}, before ${list[i - 1].v.zone} ends (${list[i - 1].v.hi})`);
    if (v.stop && v.lo !== v.hi) fail(`${key}: the short stop in ${v.zone} goes from ${v.lo} to ${v.hi}`);
  });
}

// 4. quests
console.log("4. Every quest is real, for this race, and not too high");
for (const key of keys) {
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
for (const key of keys) {
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
for (const key of keys) {
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
for (const key of keys) {
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
for (const key of keys) {
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

if (failures) {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("ALL ROUTE CHECKS PASSED");
