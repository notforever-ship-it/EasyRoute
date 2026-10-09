// Builds the casual zone-by-zone route for levels 1 to 60 for each starting race in tools/route-ladder.js.
//   Data/Route.lua                      the plan the game will read (generated, not in EasyRoute.toc yet)
//   .planning/route-outlines/<Race>.txt the plan in plain words for the owner, plus README.txt
// Sources: the pfQuest, pfQuest-turtle and pfExtend databases in the game's AddOns folder (quests, who gives them, where),
// and RestedXP's quest order (Data/Guides.lua; used from plan 02-02 on). The zone order is NOT worked out here: it comes
// from the hand-kept ladder in tools/route-ladder.js. Levels come from tools/lib/xpmodel.js.
// Needs the Lua VM "fengari" (npm install, in this tools folder) to read pfQuest's Lua data files.
// Usage: node tools/build-route.js [AddOns folder]      (default: E:\Ravencraft\twmoa_1181\Interface\AddOns)

const fs = require("fs");
const path = require("path");
const { newLuaVM, loadPf } = require("./lib/pfdb.js");
const xp = require("./lib/xpmodel.js");
const { CAPITALS, RACES } = require("./route-ladder.js");

const ROOT = process.argv[2] || "E:\\Ravencraft\\twmoa_1181\\Interface\\AddOns";
const REPO = path.resolve(__dirname, "..");
const OUT_FILE = path.join(REPO, "Data", "Route.lua");
const OUT_DIR = path.join(REPO, ".planning", "route-outlines");

// Area rules: single-link clustering radius, the most quests in one area, the smallest radius worth trying, and how
// far a lonely one-quest area may walk to join its nearest neighbour (all in yards).
const AREA_RADIUS = 300, AREA_MAX = 12, AREA_MIN_RADIUS = 40, LONELY_JOIN = 600;

function die(msg) {
  console.error(msg);
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, "pfQuest", "db", "quests.lua"))) {
  die("Usage: node tools/build-route.js [AddOns folder holding pfQuest, pfQuest-turtle and pfExtend]");
}

// ---- sources ---------------------------------------------------------------------------------------------
let pf;
try {
  pf = loadPf(ROOT);
} catch (e) {
  die(e.message);
}
const { db, place } = pf;
console.log(`sources: ${Object.keys(db.quests).length} quests, ${Object.keys(db.units).length} units, ` +
  `${Object.keys(db.objects).length} objects, ${Object.keys(db.items).length} items`);

const sizeVM = newLuaVM();
sizeVM.run(fs.readFileSync(path.join(REPO, "Data", "ZoneSizes.lua")), "Data/ZoneSizes.lua");
const ZONE_SIZES = sizeVM.get("EasyRoute_ZoneSizes");

// ---- helpers ---------------------------------------------------------------------------------------------
// Yards between two map points in one zone, the same maths as S.Yards in Steps.lua (default size 4000 x 2667).
function yards(zone, x1, y1, x2, y2) {
  const size = ZONE_SIZES[zone];
  let w = 4000, h = 2667;
  if (size) {
    if (Array.isArray(size)) { w = size[0]; h = size[1]; } else { w = size["1"]; h = size["2"]; }
  }
  const dx = (x2 - x1) / 100 * w, dy = (y2 - y1) / 100 * h;
  return Math.sqrt(dx * dx + dy * dy);
}
// A string for a Lua file: backslash, quote, tab, newline and carriage return escaped.
const lua = (s) => "\"" + String(s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r") + "\"";
// Names go into tab-separated lines: tabs and newlines inside them become spaces.
const clean = (s) => String(s).replace(/[\t\r\n]+/g, " ").trim();
const round1 = (n) => Math.round(n * 10) / 10;
function num(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) die(`Refusing to write a number that is not a number: ${n}`);
  return String(n);
}
const nonEmpty = (v) => Array.isArray(v) ? v.length > 0 : !!v && typeof v === "object" && Object.keys(v).length > 0;

// ---- check the ladder before building -----------------------------------------------------------------
const zoneNames = new Set(Object.values(db.znames));
for (const race of RACES) {
  const rows = race.rows;
  const bad = (i, what) => die(`Ladder problem for ${race.name}, row ${i + 1} (${rows[i].zone}): ${what}`);
  if (rows[0].lo !== 1) bad(0, "the first row must start at level 1");
  if (rows[rows.length - 1].hi !== 60) bad(rows.length - 1, "the last row must end at level 60");
  if (race.start.zone !== rows[0].zone) bad(0, `the start place is in ${race.start.zone}, not in the first zone`);
  rows.forEach((r, i) => {
    if (i > 0 && r.lo < rows[i - 1].hi) bad(i, `starts at ${r.lo}, before the row above ends (${rows[i - 1].hi})`);
    if (r.hi < r.lo) bad(i, "ends before it starts");
    if (r.stop && (r.lo !== r.hi || CAPITALS.indexOf(r.zone) < 0)) bad(i, "a short stop needs a capital and the same level in and out");
    if (!ZONE_SIZES[r.zone]) bad(i, "the zone is not in Data/ZoneSizes.lua");
    if (!zoneNames.has(r.zone)) bad(i, "the zone is not a pfQuest zone name");
  });
}

// ---- candidates ---------------------------------------------------------------------------------------
// Every quest that could be in a plan: a title, a level, no class, event or profession quest, and the places where its
// giver stands (units first, then objects), each placed in its zone.
const questIds = Object.keys(db.quests).map(Number).sort((a, b) => a - b);
const base = [];
for (const id of questIds) {
  const d = db.quests[id];
  const title = db.qnames[id];
  if (!d || typeof d !== "object" || !title || d.lvl == null || d.lvl < 1) continue;
  if (d.class || d.event || d.skill) continue;
  const start = d.start || {};
  const points = [];
  for (const u of start.U || []) {
    const unit = db.units[u];
    for (const c of (unit && Array.isArray(unit.coords)) ? unit.coords : []) {
      const p = place(c);
      points.push({ zone: db.znames[p[2]], x: p[0], y: p[1], who: db.unames[u] });
    }
  }
  for (const o of start.O || []) {
    const obj = db.objects[o];
    for (const c of (obj && Array.isArray(obj.coords)) ? obj.coords : []) {
      const p = place(c);
      points.push({ zone: db.znames[p[2]], x: p[0], y: p[1], who: db.onames[o] });
    }
  }
  if (!points.length) continue;
  const obj = d.obj || {};
  base.push({ id, title: clean(title), l: d.lvl, m: d.min == null ? 1 : d.min, race: d.race, points, k: nonEmpty(obj.U) || nonEmpty(obj.I) });
}

const raceFits = (q, bit) => q.race == null || q.race === 0 || q.race === 255 || (q.race & bit) !== 0;
const inBox = (p, b) => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;

// ---- areas ---------------------------------------------------------------------------------------------
// Single-link clustering: quests whose giver points chain together within R yards are one area.
function cluster(zone, qs, R) {
  const parent = qs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      if (yards(zone, qs[i].x, qs[i].y, qs[j].x, qs[j].y) <= R) {
        const a = find(i), b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map();
  qs.forEach((q, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(q);
  });
  return [...groups.values()];
}
// An area with too many quests is clustered again at half the radius, until every part is small enough or the radius
// would fall below the minimum.
function refine(zone, qs, R) {
  if (qs.length <= AREA_MAX || R / 2 < AREA_MIN_RADIUS) return [qs];
  const out = [];
  for (const part of cluster(zone, qs, R / 2)) out.push(...refine(zone, part, R / 2));
  return out;
}
const byLevelId = (a, b) => a.l - b.l || a.id - b.id;
const minDist = (zone, a, b) => {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, yards(zone, p.x, p.y, q.x, q.y));
  return best;
};

function buildAreas(zone, quests, startPoint) {
  const sorted = quests.slice().sort(byLevelId);
  let groups = [];
  for (const g of cluster(zone, sorted, AREA_RADIUS)) groups.push(...refine(zone, g, AREA_RADIUS));
  // A lonely one-quest area joins the nearest other area when that one is close.
  const lonely = groups.filter((g) => g.length === 1).sort((a, b) => byLevelId(a[0], b[0]));
  for (const one of lonely) {
    if (one.length !== 1 || groups.indexOf(one) < 0) continue;
    let best = null, bestD = Infinity;
    for (const g of groups) {
      if (g === one || g.length >= AREA_MAX) continue;
      const d = minDist(zone, one, g);
      if (d < bestD) { best = g; bestD = d; }
    }
    if (best && bestD <= LONELY_JOIN) {
      best.push(one[0]);
      groups = groups.filter((g) => g !== one);
    }
  }
  // Each area is named after the giver nearest to the middle of its givers.
  const areas = groups.map((qs) => {
    const cx = qs.reduce((s, q) => s + q.x, 0) / qs.length, cy = qs.reduce((s, q) => s + q.y, 0) / qs.length;
    let near = qs[0], nearD = Infinity;
    for (const q of qs.slice().sort(byLevelId)) {
      const d = yards(zone, cx, cy, q.x, q.y);
      if (d < nearD) { near = q; nearD = d; }
    }
    return { x: near.x, y: near.y, who: clean(near.who || "the quest giver"), qs: qs.slice().sort(byLevelId) };
  });
  areas.sort((a, b) => byLevelId(a.qs[0], b.qs[0]));
  // Order: the first area is the one holding the quest nearest to startPoint, or the lowest-level quest; then the
  // nearest area not yet visited each time.
  let first = 0;
  if (startPoint) {
    let bestD = Infinity;
    areas.forEach((a, i) => {
      for (const q of a.qs) {
        const d = yards(zone, startPoint.x, startPoint.y, q.x, q.y);
        if (d < bestD) { bestD = d; first = i; }
      }
    });
  }
  const left = areas.slice();
  const ordered = [];
  let cur = left.splice(first, 1)[0];
  while (cur) {
    ordered.push(cur);
    let bi = -1, bd = Infinity;
    left.forEach((a, i) => {
      const d = yards(zone, cur.x, cur.y, a.x, a.y);
      if (d < bd) { bd = d; bi = i; }
    });
    cur = bi >= 0 ? left.splice(bi, 1)[0] : null;
  }
  return ordered;
}

// ---- one race ----------------------------------------------------------------------------------------------
function planRace(race) {
  const claimed = new Set();
  const visits = race.rows.map((row, i) => ({ row, index: i, areas: [], quests: [], leftOut: {}, gap: 0 }));
  // Stops claim their quests first, then the other rows in ladder order.
  const order = visits.filter((v) => v.row.stop).concat(visits.filter((v) => !v.row.stop));
  for (const v of order) {
    const { row } = v;
    const found = [];
    for (const q of base) {
      if (claimed.has(q.id) || !raceFits(q, race.bit)) continue;
      if (row.stop) {
        if (q.l < row.lo - 2 || q.l > row.lo + 3 || q.m > row.lo) continue;
      } else if (q.l < row.lo - 4 || q.l > row.hi + 2 || q.m > row.hi) continue;
      const point = q.points.find((p) => p.zone === row.zone);
      if (!point) continue;
      const box = (row.exclude || []).find((b) => inBox(point, b));
      if (box) {
        (v.leftOut[box.why] = v.leftOut[box.why] || []).push(q.id);
        continue;
      }
      claimed.add(q.id);
      found.push({ id: q.id, title: q.title, l: q.l, m: q.m, k: q.k, x: point.x, y: point.y, who: point.who });
    }
    const startPoint = v.index === 0 ? race.start : null;
    v.areas = buildAreas(row.zone, found, startPoint);
    for (const a of v.areas) {
      for (const q of a.qs) q.flags = q.k ? "k" : "";
      v.quests.push(...a.qs);
    }
  }
  // Levels: play the quests in plan order; where they run out before the next zone's level, record the gap.
  let total = 0;
  visits.forEach((v, i) => {
    const target = i + 1 < visits.length ? visits[i + 1].row.lo : 60;
    const result = xp.walk(total, v.quests.map((q) => ({ l: q.l, m: q.m, k: q.k })), target);
    total = result.total;
    v.gap = result.grind < 1e-6 ? 0 : Math.ceil(result.grind * 10) / 10;
  });
  return visits;
}

const plans = RACES.map((race) => ({ race, visits: planRace(race) }));

// ---- Data/Route.lua -------------------------------------------------------------------------------------------
const lines = [
  "-- Generated by tools/build-route.js from the pfQuest, pfQuest-turtle and pfExtend data and RestedXP's quest order. Do not edit by hand.",
  "-- RestedXP's order is used under CC BY-NC-SA 4.0 (https://github.com/RestedXP/RXPGuides).",
  "-- paths: per start race, keyed by the game's race name, the visit numbers in order.",
  "-- visit: race, zone, lo and hi levels, gap = levels to grind at the end, stop = 1 for a capital short stop,",
  "-- again = 1 for a named second visit, n = number of quests, areas = lines split by tabs:",
  "--   A x y who      starts an area (map percent, the giver it is named after)",
  "--   Q id flags hand obj      is a quest; hand and obj are \"x y\" when away from the giver or the area, \"x y Zone\" when in",
  "--   another zone, empty otherwise",
  "-- flags: e elite, d partly in a dungeon, s escort, c chain of 4 or more, f far from its area,",
  "-- x handed in at another zone on the way, k something to kill or collect.",
  "EasyRoute_Route = {",
  "  version = 1,",
  "  paths = {",
];
let visitNo = 0;
const visitLines = [];
let totalQuests = 0;
for (const plan of plans) {
  const numbers = [];
  for (const v of plan.visits) {
    visitNo++;
    v.number = visitNo;
    numbers.push(visitNo);
    const area = [];
    for (const a of v.areas) {
      area.push(["A", num(a.x), num(a.y), clean(a.who)].join("\t"));
      for (const q of a.qs) area.push(["Q", num(q.id), q.flags, "", ""].join("\t"));
    }
    const parts = [`race = ${lua(plan.race.key)}`, `zone = ${lua(v.row.zone)}`, `lo = ${num(v.row.lo)}`, `hi = ${num(v.row.hi)}`, `gap = ${num(v.gap)}`];
    if (v.row.stop) parts.push("stop = 1");
    if (v.row.again) parts.push("again = 1");
    parts.push(`n = ${num(v.quests.length)}`, `areas = ${lua(area.join("\n"))}`);
    visitLines.push(`    [${visitNo}] = { ${parts.join(", ")} },`);
    totalQuests += v.quests.length;
  }
  lines.push(`    ${plan.race.key} = { ${numbers.join(", ")} },`);
}
lines.push("  },", "  visits = {", ...visitLines, "  },", "}", "");
fs.writeFileSync(OUT_FILE, lines.join("\n"));
const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);

// ---- read it back -------------------------------------------------------------------------------------------
const checkVM = newLuaVM();
try {
  checkVM.run(fs.readFileSync(path.join(REPO, "Data", "Zones.lua")), "Data/Zones.lua");
  checkVM.run(fs.readFileSync(OUT_FILE), "Data/Route.lua");
  checkVM.run("ER_IDS = {} for _, z in pairs(EasyRoute_Zones) do for _, q in ipairs(z.q) do ER_IDS[tostring(q.id)] = 1 end end", "ids");
} catch (e) {
  die(`read back FAILED: ${e.message}`);
}
const known = checkVM.get("ER_IDS");
const readVisits = checkVM.get("EasyRoute_Route.visits");
let readQuests = 0, readCount = 0;
for (const plan of plans) {
  for (const v of plan.visits) {
    const rv = Array.isArray(readVisits) ? readVisits[v.number - 1] : readVisits[String(v.number)];
    if (!rv) die(`read back FAILED: visit ${v.number} (${v.row.zone}) is missing`);
    const ids = rv.areas.split("\n").filter((l) => l.charAt(0) === "Q").map((l) => Number(l.split("\t")[1]));
    if (ids.length !== v.quests.length || ids.length !== rv.n) die(`read back FAILED: visit ${v.number} (${v.row.zone}) has ${ids.length} quests, expected ${v.quests.length}`);
    for (const id of ids) if (!known[String(id)]) die(`read back FAILED: quest ${id} in ${v.row.zone} is not in Data/Zones.lua`);
    readQuests += ids.length;
    readCount++;
  }
}
console.log(`read back: ${readQuests} quests in ${readCount} visits, all found in Data/Zones.lua`);

// ---- outlines -----------------------------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
let outlineFiles = 0;
for (const plan of plans) {
  const { race, visits } = plan;
  const areaCount = visits.reduce((s, v) => s + v.areas.length, 0);
  const questCount = visits.reduce((s, v) => s + v.quests.length, 0);
  const gapTotal = round1(visits.reduce((s, v) => s + v.gap, 0));
  const out = [];
  out.push(`Easy Route plan for ${race.name}, levels 1 to 60`);
  out.push("Zones in order: " + visits.map((v) => v.row.stop ? `${v.row.zone} (short stop at ${v.row.lo})` : `${v.row.zone} ${v.row.lo}-${v.row.hi}`).join(", "));
  out.push(`In total: ${questCount} quests in ${areaCount} areas, and about ${gapTotal} levels of grinding where the quests run out.`);
  out.push("");
  visits.forEach((v, i) => {
    const head = v.row.stop ? `${v.row.zone} (short stop at level ${v.row.lo})` : `${v.row.zone} (levels ${v.row.lo} to ${v.row.hi})`;
    out.push(`${head}: ${v.areas.length} areas, ${v.quests.length} quests`);
    let n = 0;
    v.areas.forEach((a, ai) => {
      out.push(`  Area ${ai + 1}: around ${a.who}, ${a.qs.length} ${a.qs.length === 1 ? "quest" : "quests"}`);
      for (const q of a.qs) out.push(`     ${++n}. ${q.title} (level ${q.l})`);
    });
    const left = Object.keys(v.leftOut).sort().map((why) => `${v.leftOut[why].length} ${v.leftOut[why].length === 1 ? "quest" : "quests"} ${why}`);
    if (left.length) out.push(`  Left out: ${left.join("; ")}`);
    if (v.gap >= 0.1) out.push(`  Gap: grind about ${v.gap} levels here.`);
    out.push(i + 1 < visits.length ? `  Next: ${visits[i + 1].row.zone} at level ${visits[i + 1].row.lo}.` : "  That is level 60: the end of the route.");
    out.push("");
  });
  out.push("How the levels are worked out: each quest gives about 90 xp per quest level (less when you are far above it), plus about 6 kills for quests where you kill or collect something. Real numbers vary a little.");
  out.push("");
  fs.writeFileSync(path.join(OUT_DIR, race.file + ".txt"), out.join("\n"));
  outlineFiles++;
  console.log(`${race.name}: ${visits.length} zones, ${questCount} quests, about ${gapTotal} levels to grind`);
}
fs.writeFileSync(path.join(OUT_DIR, "README.txt"), [
  "Each file is the whole plan for one starting race: the zones in order, and inside each zone the areas in the order you walk them.",
  "\"Gap\" means grind about that many levels there; \"Left out\" lists quests the plan skips and why.",
  "",
  "Each race keeps to its own continent after the start, with at most one boat or zeppelin.",
  "The levels come from a simple experience estimate, not from the pfExtend numbers.",
  "",
].join("\n"));
console.log(`Route.lua: ${visitNo} visits for ${plans.length} races, ${totalQuests} quests, ${kb} KB`);
console.log(`outlines: ${outlineFiles + 1} files in .planning/route-outlines`);
