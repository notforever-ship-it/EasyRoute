// Builds the casual zone-by-zone route for levels 1 to 60 for each starting race in tools/route-ladder.js.
//   Data/Route.lua                      the plan the game will read (generated, not in EasyRoute.toc yet)
//   .planning/route-outlines/<Race>.txt the plan in plain words for the owner, plus README.txt
// Sources: the pfQuest, pfQuest-turtle and pfExtend databases in the game's AddOns folder (quests, who gives them, where,
// where they are handed in, where the work is), and RestedXP's quest order and zones (Data/Guides.lua). The zone order is
// NOT worked out here: it comes from the hand-kept ladder in tools/route-ladder.js. Levels come from tools/lib/xpmodel.js.
// Needs the Lua VM "fengari" (npm install, in this tools folder) to read pfQuest's Lua data files.
// Usage: node tools/build-route.js [AddOns folder]      (default: E:\Ravencraft\twmoa_1181\Interface\AddOns)
//
// What happens to the quests of one zone (in this order):
//   candidates     giver in the zone, race and level fit (a chain's first quests may sit below the level window);
//                  RestedXP doing the quest in another zone is a veto
//   stay in zone   the work must be in the zone, a hand-in elsewhere only at a capital stop or at the next zone
//   areas          givers close together are one area; areas are walked nearest first from where you come in
//   far and long   work far from its area: moved to a later area close to it, marked as a long walk, or left out
//   order          inside an area RestedXP's order first, then the others by level
//   flags          e d s c f x k, for the game to filter on later
//   whole path     a quest comes after the quests it needs (quests only other races do are not needed); of an either-or pair
//                  only the first stays
//   outline        zones that start below level 20 name every left-out quest with its level and reason
//   --suggest      (see below) prints the level range the quest data suggests next to each ladder row; writes nothing

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
// Work this far from its area is a long walk (FAR: moved to a later area near it, else marked) or too far (LONG: left out).
const FAR = 900, LONG = 1800, NEAR_WORK = 450;
// A hand-in or an objective closer than this to the giver or the area needs no place of its own in the file.
const HAND_MIN = 50, OBJ_MIN = 150;
// Most quests carried to the next zone for a hand-in there.
const CARRY_MAX = 3;
// A quest that starts a chain may sit this many levels below the zone's window when the chain is in the window.
const PULL_BELOW = 8;
// Passes of the prerequisite repair before whatever still moves is left out.
const REPAIR_PASSES = 20;

// Why quests are left out, in the words of the outline.
const WHY = {
  rxZone: "that RestedXP does in another zone",
  elsewhere: "that need you in another zone",
  dungeon: "inside a dungeon",
  battleground: "battleground quest",
  carryCap: `more to hand in at the next zone than the ${CARRY_MAX} kept`,
  tooFar: "too far from everything else in the zone",
  noPre: "that need a quest that is not on this route",
  latePre: "that need a quest that comes later on the route",
  pair: "where only one of a pair can be done",
};
// The same reasons, worded for one named quest in the outline.
const WHY_ONE = {
  [WHY.rxZone]: "RestedXP does it in another zone",
  [WHY.elsewhere]: "needs you in another zone",
  [WHY.dungeon]: "inside a dungeon",
  [WHY.battleground]: "battleground quest",
  [WHY.carryCap]: `more to hand in at the next zone than the ${CARRY_MAX} kept`,
  [WHY.tooFar]: "too far from everything else in the zone",
  [WHY.noPre]: "needs a quest that is not on this route",
  [WHY.latePre]: "needs a quest that comes later on the route",
  [WHY.pair]: "only one of a pair can be done",
};
// Zones that start below this level get their left-out quests named one by one.
const EARLY_LEVEL = 20;

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

// RestedXP's quests per faction: pos = the place of a quest in the faction's guides (A, T and C lines, first one wins),
// zone = the zone its first Accept step is in (the veto). The guides are read from Data/Guides.lua, as the game has them.
// The race names a guide's defaultFor can hold.
const RACE_WORDS = ["Human", "Dwarf", "Gnome", "NightElf", "Tauren", "Troll", "Orc", "Undead"];
function loadRestedXP() {
  const vm = newLuaVM();
  let guides;
  try {
    vm.run(fs.readFileSync(path.join(REPO, "Data", "Guides.lua")), "Data/Guides.lua");
    vm.run("ER_G = {} for i, g in ipairs(EasyRoute_Guides) do ER_G[i] = { name = g.name, faction = g.faction, steps = g.steps, who = tostring(g.defaultFor or \"\") } end", "guides");
    guides = vm.get("ER_G");
  } catch (e) {
    die(`source looks incomplete: Data/Guides.lua (${e.message})`);
  }
  if (!Array.isArray(guides) || guides.length < 90) die("source looks incomplete: Data/Guides.lua");
  const index = {};
  for (const f of ["Alliance", "Horde"]) index[f] = { pos: new Map(), zone: new Map(), owners: new Map(), n: 0 };
  for (const g of guides) {
    const f = index[g.faction];
    if (!f) continue;
    // A guide made for particular races (defaultFor names them) is theirs; every other guide is for everyone.
    const who = String(g.who || "");
    const races = who && who.indexOf("!") < 0 ? RACE_WORDS.filter((w) => who.indexOf(w) >= 0) : [];
    let zone = null;
    for (const line of String(g.steps).split("\n")) {
      const c = line.split("\t");
      if (c[0] === "G") {
        if (c[2]) zone = c[2];
      } else if (c[0] === "A" || c[0] === "T" || c[0] === "C") {
        const id = Number(c[2]);
        if (!id) continue;
        if (!f.owners.has(id)) f.owners.set(id, { everyone: false, races: new Set() });
        const own = f.owners.get(id);
        if (races.length) races.forEach((w) => own.races.add(w)); else own.everyone = true;
        f.n++;
        if (!f.pos.has(id)) f.pos.set(id, f.n);
        if (c[0] === "A" && zone && !f.zone.has(id)) f.zone.set(id, zone);
      }
    }
  }
  return index;
}
const RX = loadRestedXP();
console.log(`RestedXP: ${RX.Alliance.pos.size} quests for Alliance, ${RX.Horde.pos.size} for Horde`);
for (const f of ["Alliance", "Horde"]) if (RX[f].pos.size < 900) die(`source looks incomplete: Data/Guides.lua (only ${RX[f].pos.size} ${f} quests)`);

// ---- helpers ---------------------------------------------------------------------------------------------
function sizeOf(zone) {
  const size = ZONE_SIZES[zone];
  let w = 4000, h = 2667;
  if (size) {
    if (Array.isArray(size)) { w = size[0]; h = size[1]; } else { w = size["1"]; h = size["2"]; }
  }
  return { w, h };
}
// Yards between two map points in one zone, the same maths as S.Yards in Steps.lua (default size 4000 x 2667).
function yards(zone, x1, y1, x2, y2) {
  const { w, h } = sizeOf(zone);
  const dx = (x2 - x1) / 100 * w, dy = (y2 - y1) / 100 * h;
  return Math.sqrt(dx * dx + dy * dy);
}
// A map point of a zone as a point of the world (continent c, X from the top edge t, Y from the left edge l), or null
// when the zone has no place in the world table.
function toWorld(zone, x, y) {
  const s = ZONE_SIZES[zone];
  if (!s || Array.isArray(s) || s.c == null || s.l == null || s.t == null) return null;
  return { c: s.c, X: s.t - y / 100 * s["2"], Y: s.l - x / 100 * s["1"] };
}
const worldYards = (a, b) => Math.sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));
// A zone with no continent in Data/ZoneSizes.lua is a dungeon or an unused map.
const isDungeon = (zone) => {
  const s = ZONE_SIZES[zone];
  return !s || Array.isArray(s) || s.c == null;
};
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
const list = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);

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

// ---- places of quests ---------------------------------------------------------------------------------------
// Map points { zone, x, y, who } of units and of objects, each placed in its zone.
function pointsOf(unitIds, objectIds) {
  const out = [];
  for (const u of unitIds) {
    const unit = db.units[u];
    for (const c of (unit && Array.isArray(unit.coords)) ? unit.coords : []) {
      const p = place(c);
      out.push({ zone: db.znames[p[2]], x: p[0], y: p[1], who: db.unames[u] });
    }
  }
  for (const o of objectIds) {
    const obj = db.objects[o];
    for (const c of (obj && Array.isArray(obj.coords)) ? obj.coords : []) {
      const p = place(c);
      out.push({ zone: db.znames[p[2]], x: p[0], y: p[1], who: db.onames[o], thing: true });
    }
  }
  return out;
}
// The best places an item drops or lies: in every zone where it is found, the three best by chance (ties by id, units before
// objects). Three over the whole world would miss a zone whose boars drop less often than another zone's boars, and a quest
// would then look as if its work were somewhere else.
const sourceZones = new Map();
function zonesOfSource(kind, id) {
  const key = kind + id;
  if (!sourceZones.has(key)) sourceZones.set(key, new Set((kind === "U" ? pointsOf([id], []) : pointsOf([], [id])).map((p) => p.zone)));
  return sourceZones.get(key);
}
function itemSources(itemId) {
  const it = db.items[itemId];
  if (!it) return { U: [], O: [] };
  const all = [];
  for (const [id, ch] of Object.entries(it.U || {})) all.push({ kind: "U", id: Number(id), ch: Number(ch) || 0 });
  for (const [id, ch] of Object.entries(it.O || {})) all.push({ kind: "O", id: Number(id), ch: Number(ch) || 0 });
  all.sort((a, b) => b.ch - a.ch || a.id - b.id || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  const perZone = new Map();
  const top = [];
  for (const src of all) {
    let used = false;
    for (const z of zonesOfSource(src.kind, src.id)) {
      const n = perZone.get(z) || 0;
      if (n < 3) { perZone.set(z, n + 1); used = true; }
    }
    if (used) top.push(src);
  }
  return { U: top.filter((s) => s.kind === "U").map((s) => s.id), O: top.filter((s) => s.kind === "O").map((s) => s.id) };
}
// Where the quest is handed in, and where its work is. Worked out when first asked for, as most quests are never asked.
function endPoints(q) {
  if (!q.endMemo) {
    const end = q.raw.end || {};
    q.endMemo = pointsOf(list(end.U), list(end.O));
  }
  return q.endMemo;
}
function objPoints(q) {
  if (!q.objMemo) {
    const obj = q.raw.obj || {};
    const units = list(obj.U).slice(), objects = list(obj.O).slice();
    for (const item of list(obj.I)) {
      const s = itemSources(item);
      units.push(...s.U);
      objects.push(...s.O);
    }
    q.objMemo = pointsOf(units, objects);
  }
  return q.objMemo;
}

// Length of the quest chain a quest is in: the quests before it (first pre only), itself, the longest line after it.
const children = new Map();
for (const id of Object.keys(db.quests)) {
  const d = db.quests[id];
  for (const p of list(d && d.pre)) {
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(Number(id));
  }
}
const upMemo = new Map(), downMemo = new Map();
function chainUp(id, seen) {
  if (upMemo.has(id)) return upMemo.get(id);
  if (seen.has(id) || !db.quests[id]) return 0;
  seen.add(id);
  const pre = list(db.quests[id].pre);
  const r = 1 + (pre.length ? chainUp(pre[0], seen) : 0);
  seen.delete(id);
  upMemo.set(id, r);
  return r;
}
function chainDown(id, seen) {
  if (downMemo.has(id)) return downMemo.get(id);
  if (seen.has(id) || !db.quests[id]) return 0;
  seen.add(id);
  let best = 0;
  for (const c of children.get(id) || []) best = Math.max(best, chainDown(c, seen));
  seen.delete(id);
  downMemo.set(id, 1 + best);
  return 1 + best;
}
const chainLength = (id) => chainUp(id, new Set()) + chainDown(id, new Set()) - 1;

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
  const points = pointsOf(list(start.U), list(start.O));
  if (!points.length) continue;
  const obj = d.obj || {};
  const elite = list(obj.U).some((u) => {
    const unit = db.units[u];
    const r = unit ? Number(unit.rnk) : 0;
    return r >= 1 && r <= 3;
  });
  base.push({
    id, raw: d, title: clean(title), l: d.lvl, m: d.min == null ? 1 : d.min, race: d.race, points,
    k: nonEmpty(obj.U) || nonEmpty(obj.I), e: elite, s: String(db.qtext[id] || "").indexOf("escort") >= 0,
    pre: list(d.pre).filter((p) => p !== id), close: list(d.close).filter((c) => c !== id),
  });
}

// Battleground quests (Warsong Gulch, Arathi Basin, Alterac Valley) are PvP, not casual questing (D-08b): a quest is one when
// its title names a battleground, when it follows such a quest, or when its work or hand-in is inside one.
const BATTLEGROUNDS = ["Warsong Gulch", "Arathi Basin", "Alterac Valley"];
const BG_TITLE = /warsong gulch|arathi basin|alterac valley|silverwing usurpers/i;
const bgMemo = new Map();
function bgByTitle(id, seen) {
  if (bgMemo.has(id)) return bgMemo.get(id);
  if (seen.has(id) || !db.quests[id]) return false;
  seen.add(id);
  const r = BG_TITLE.test(String(db.qnames[id] || "")) || list(db.quests[id].pre).some((p) => bgByTitle(p, seen));
  seen.delete(id);
  bgMemo.set(id, r);
  return r;
}
const isBattleground = (q) => bgByTitle(q.id, new Set()) ||
  endPoints(q).concat(objPoints(q)).some((p) => BATTLEGROUNDS.indexOf(p.zone) >= 0);

const baseById = new Map(base.map((q) => [q.id, q]));
const raceFits = (q, bit) => q.race == null || q.race === 0 || q.race === 255 || (q.race & bit) !== 0;
const inBox = (p, b) => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;

// The stay-in-the-zone rule for one quest of one visit (D-07, D-07a, D-09a). point is where the giver stands in the zone.
// Gives { why } when the quest is left out, else { d, carry, hand }:
//   d      part of the work is inside a dungeon
//   carry  "capital" or "next": handed in at a capital stop, or carried on to the next zone
//   hand   { x, y, zone } where to hand in when that is away from the giver (zone only when it is another zone)
function stayInZone(q, point, row, nextZone, stopZones) {
  const here = (p) => p.zone === row.zone;
  const work = objPoints(q);
  let d = false;
  if (work.length) {
    if (!work.some(here)) return { why: work.every((p) => isDungeon(p.zone)) ? WHY.dungeon : WHY.elsewhere };
    if (work.some((p) => isDungeon(p.zone))) d = true;
  }
  const end = endPoints(q);
  if (!end.length) return { d, carry: null, hand: null };
  const inZone = end.filter(here);
  if (inZone.length) {
    let best = null, bd = Infinity;
    for (const p of inZone) {
      const dist = yards(row.zone, point.x, point.y, p.x, p.y);
      if (dist < bd) { bd = dist; best = p; }
    }
    return { d, carry: null, hand: bd > HAND_MIN ? { x: round1(best.x), y: round1(best.y) } : null };
  }
  const cap = end.find((p) => stopZones.has(p.zone));
  if (cap) return { d, carry: "capital", hand: { x: round1(cap.x), y: round1(cap.y), zone: cap.zone } };
  const next = nextZone ? end.find((p) => p.zone === nextZone) : null;
  if (next) return { d, carry: "next", hand: { x: round1(next.x), y: round1(next.y), zone: next.zone } };
  return { why: WHY.elsewhere };
}

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
// Inside an area: the quests RestedXP has, in RestedXP's order; then the others by level.
const inAreaOrder = (a, b) => {
  if (a.rx != null && b.rx != null) return a.rx - b.rx;
  if (a.rx != null) return -1;
  if (b.rx != null) return 1;
  return byLevelId(a, b);
};
// The quests of one area in the order they are done, for a pretend character who has this much experience when it gets
// there: the order of inAreaOrder, except that a quest the character is too low for waits until the ones it can do are
// done (the giver stands in the same area), and a quest never comes before a quest of the area that it needs.
// Gives { qs, total } with total the experience afterwards.
function orderArea(qs, total) {
  const pending = qs.slice().sort(inAreaOrder);
  const out = [];
  while (pending.length) {
    const level = Math.floor(xp.levelAt(total));
    const free = (q) => !q.base.pre.some((p) => pending.some((x) => x.id === p));
    let pick = pending.findIndex((q) => (q.m || 1) <= level && free(q));
    if (pick < 0) {
      let low = Infinity;
      pending.forEach((q, i) => { if (free(q) && (q.m || 1) < low) { low = q.m || 1; pick = i; } });
      if (pick < 0) pick = 0;
    }
    const q = pending.splice(pick, 1)[0];
    out.push(q);
    if (Math.floor(xp.levelAt(total)) < (q.m || 1)) total = xp.xpAt(q.m || 1);
    const at = Math.floor(xp.levelAt(total));
    total += xp.questXP(q.l, at) + (q.k ? xp.K * xp.killXP(at, q.l) : 0);
  }
  return { qs: out, total };
}
const minDist = (zone, a, b) => {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, yards(zone, p.x, p.y, q.x, q.y));
  return best;
};

// Nearest-first can leave one long walk at the end. When a hop is longer than HOP_REPAIR of the zone's longer side, or the
// whole walk is longer than WALK_REPAIR yards, the order after the first area is improved with 2-opt (reversing stretches
// while the walk gets shorter). Short tours are left as nearest-first made them.
const HOP_REPAIR = 0.5, WALK_REPAIR = 12000;
function twoOpt(zone, ordered) {
  const hop = (a, b) => yards(zone, a.x, a.y, b.x, b.y);
  const total = (list) => { let t = 0; for (let i = 1; i < list.length; i++) t += hop(list[i - 1], list[i]); return t; };
  const longest = (list) => { let m = 0; for (let i = 1; i < list.length; i++) m = Math.max(m, hop(list[i - 1], list[i])); return m; };
  const { w, h } = sizeOf(zone);
  if (ordered.length < 3 || (longest(ordered) <= HOP_REPAIR * Math.max(w, h) && total(ordered) <= WALK_REPAIR)) return ordered;
  const n = ordered.length;
  for (let improved = true; improved;) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const before = hop(ordered[i - 1], ordered[i]) + (j + 1 < n ? hop(ordered[j], ordered[j + 1]) : 0);
        const after = hop(ordered[i - 1], ordered[j]) + (j + 1 < n ? hop(ordered[i], ordered[j + 1]) : 0);
        if (after < before - 1e-6) {
          const part = ordered.slice(i, j + 1).reverse();
          ordered.splice(i, part.length, ...part);
          improved = true;
        }
      }
    }
  }
  return ordered;
}

// Areas of one visit in walking order. pickFirst(areas) gives the index of the area to start with.
function buildAreas(zone, quests, pickFirst, startLevel, endLevel) {
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
  // Each area is named after the giver nearest to the middle of its givers; a person is preferred to a board or a chest.
  const areas = groups.map((qs) => {
    const cx = qs.reduce((s, q) => s + q.x, 0) / qs.length, cy = qs.reduce((s, q) => s + q.y, 0) / qs.length;
    let near = qs[0], nearD = Infinity;
    const people = qs.some((q) => !q.thing);
    for (const q of qs.slice().sort(byLevelId)) {
      if (people && q.thing) continue;
      const d = yards(zone, cx, cy, q.x, q.y);
      if (d < nearD) { near = q; nearD = d; }
    }
    return { x: near.x, y: near.y, who: clean(near.who || "the quest giver"), qs: qs.slice().sort(byLevelId) };
  });
  areas.sort((a, b) => byLevelId(a.qs[0], b.qs[0]));
  if (!areas.length) return [];
  // Order. The area pickFirst names comes first. Two ways to go on are tried and the one that leaves the smaller gap wins
  // (a tie goes to the shorter walk): always the nearest area not yet visited, or the nearest area that the pretend
  // character is high enough for (when none is, the one with the lowest level wall).
  const first = pickFirst(areas);
  const wall = (a) => a.qs.reduce((m, q) => Math.max(m, q.m || 1), 1);
  const plan = (list) => {
    let t = xp.xpAt(startLevel);
    const flat = [];
    for (const a of list) {
      const r = orderArea(a.qs, t);
      t = r.total;
      flat.push(...r.qs);
    }
    return flat.map((q) => ({ l: q.l, m: q.m, k: q.k }));
  };
  function tour(ready) {
    const left = areas.slice();
    const ordered = [];
    let total = xp.xpAt(startLevel);
    let cur = left.splice(first, 1)[0];
    while (cur) {
      ordered.push(cur);
      if (ready) total = orderArea(cur.qs, total).total;
      const level = Math.floor(xp.levelAt(total));
      let pool = left.map((a, i) => i);
      if (ready) {
        const open = pool.filter((i) => wall(left[i]) <= level);
        if (open.length) pool = open;
        else if (pool.length) {
          const low = Math.min(...left.map(wall));
          pool = pool.filter((i) => wall(left[i]) === low);
        }
      }
      let bi = -1, bd = Infinity;
      for (const i of pool) {
        const d = yards(zone, cur.x, cur.y, left[i].x, left[i].y);
        if (d < bd) { bd = d; bi = i; }
      }
      cur = bi >= 0 ? left.splice(bi, 1)[0] : null;
    }
    return twoOpt(zone, ordered);
  }
  const walkOf = (list) => { let t = 0; for (let i = 1; i < list.length; i++) t += yards(zone, list[i - 1].x, list[i - 1].y, list[i].x, list[i].y); return t; };
  let best = null;
  for (const ready of [false, true]) {
    const ordered = tour(ready);
    const grind = xp.walk(xp.xpAt(startLevel), plan(ordered), endLevel).grind;
    const walk = walkOf(ordered);
    if (!best || grind < best.grind - 1e-6 || (Math.abs(grind - best.grind) <= 1e-6 && walk < best.walk)) best = { ordered, grind, walk };
  }
  return best.ordered;
}

// The area to start a visit with. The first visit starts at the race's start place. Later ones start where the last
// visit ended: in world yards when both zones are on the same continent, else at the row's own entry point, else at the
// lowest-level quest. "The area holds the giver nearest to that place."
function pickFirstFor(row, index, race, exit) {
  const zone = row.zone;
  return (areas) => {
    const nearest = (dist) => {
      let best = 0, bd = Infinity;
      areas.forEach((a, i) => {
        for (const q of a.qs) {
          const d = dist(q);
          if (d < bd) { bd = d; best = i; }
        }
      });
      return best;
    };
    if (index === 0) return nearest((q) => yards(zone, race.start.x, race.start.y, q.x, q.y));
    const from = exit ? toWorld(exit.zone, exit.x, exit.y) : null;
    const probe = toWorld(zone, 50, 50);
    if (from && probe && probe.c === from.c) return nearest((q) => worldYards(from, toWorld(zone, q.x, q.y)));
    if (row.entry) return nearest((q) => yards(zone, row.entry.x, row.entry.y, q.x, q.y));
    let best = 0, low = null;
    areas.forEach((a, i) => {
      for (const q of a.qs) {
        if (!low || q.l < low.l || (q.l === low.l && q.id < low.id)) { low = q; best = i; }
      }
    });
    return best;
  };
}

// Work far from its area. Beyond LONG the quest is left out (unless RestedXP does it: then it stays, marked); beyond FAR
// it moves to the nearest later area within NEAR_WORK of the work, else it stays, marked as a long walk.
function farAndLong(v) {
  const zone = v.row.zone;
  v.areas.forEach((a, ai) => {
    for (const q of a.qs.slice()) {
      if (q.homed || !q.work.length) continue;
      let near = null, nd = Infinity;
      for (const p of q.work) {
        const d = yards(zone, a.x, a.y, p.x, p.y);
        if (d < nd) { nd = d; near = p; }
      }
      if (nd <= FAR) continue;
      if (nd > LONG) {
        if (q.rx != null) { q.f = true; continue; }
        a.qs.splice(a.qs.indexOf(q), 1);
        (v.leftOut[WHY.tooFar] = v.leftOut[WHY.tooFar] || []).push(q.id);
        continue;
      }
      let target = -1, td = Infinity;
      for (let j = ai; j < v.areas.length; j++) {
        const d = yards(zone, v.areas[j].x, v.areas[j].y, near.x, near.y);
        if (d <= NEAR_WORK && d < td) { td = d; target = j; }
      }
      if (target < 0 || target === ai) { q.f = true; continue; }
      a.qs.splice(a.qs.indexOf(q), 1);
      v.areas[target].qs.push(q);
      q.homed = true;
    }
  });
}

const dropEmpty = (v) => { v.areas = v.areas.filter((a) => a.qs.length > 0); };
const flatten = (v) => { v.quests = []; for (const a of v.areas) v.quests.push(...a.qs); };

// The quests below the level window of a visit that the chains inside the window need: the quests of the zone before them
// in a chain (pfQuest's pre lists, all of them), their giver in the zone, at most PULL_BELOW levels under the window.
function pullBelow(row, race, claimed) {
  const inZone = (q) => q.points.some((p) => p.zone === row.zone);
  const out = new Set();
  const climb = (q, seen) => {
    for (const p of q.pre) {
      const pq = baseById.get(p);
      if (!pq || seen.has(p) || claimed.has(p) || !raceFits(pq, race.bit) || !inZone(pq)) continue;
      seen.add(p);
      if (pq.l < row.lo - 4 && pq.l >= row.lo - 4 - PULL_BELOW) out.add(p);
      climb(pq, seen);
    }
  };
  for (const q of base) {
    if (claimed.has(q.id) || q.l < row.lo - 4 || q.l > row.hi + 2 || q.m > row.hi || !raceFits(q, race.bit) || !inZone(q)) continue;
    climb(q, new Set());
  }
  return out;
}

// ---- one race ----------------------------------------------------------------------------------------------
function planRace(race) {
  const rxi = RX[race.faction];
  const rows = race.rows;
  const stopZones = new Set(rows.filter((r) => r.stop).map((r) => r.zone));
  const claimed = new Set();
  const visits = rows.map((row, i) => ({ row, index: i, areas: [], quests: [], leftOut: {}, gap: 0, found: [] }));
  const leave = (v, why, id) => { (v.leftOut[why] = v.leftOut[why] || []).push(id); };

  // Stops claim their quests first, then the other rows in ladder order.
  const order = visits.filter((v) => v.row.stop).concat(visits.filter((v) => !v.row.stop));
  for (const v of order) {
    const { row, index } = v;
    const after = rows[index + 1];
    const pulled = row.stop ? new Set() : pullBelow(row, race, claimed);
    const nextZone = after ? (after.stop ? (rows[index + 2] ? rows[index + 2].zone : null) : after.zone) : null;
    for (const q of base) {
      if (claimed.has(q.id) || !raceFits(q, race.bit)) continue;
      if (row.stop) {
        if (q.l < row.lo - 2 || q.l > row.lo + 3 || q.m > row.lo) continue;
      } else if (q.l > row.hi + 2 || q.m > row.hi || (q.l < row.lo - 4 && !pulled.has(q.id))) continue;
      const point = q.points.find((p) => p.zone === row.zone);
      if (!point) continue;
      const box = (row.exclude || []).find((b) => inBox(point, b));
      if (box) { leave(v, box.why, q.id); continue; }
      if (isBattleground(q)) { claimed.add(q.id); leave(v, WHY.battleground, q.id); continue; }
      const rz = rxi.zone.get(q.id);
      if (rz && rz !== row.zone) { leave(v, WHY.rxZone, q.id); continue; }
      const st = stayInZone(q, point, row, nextZone, stopZones);
      if (st.why) { leave(v, st.why, q.id); continue; }
      claimed.add(q.id);
      v.found.push({
        id: q.id, base: q, title: q.title, l: q.l, m: q.m, k: q.k, x: point.x, y: point.y, who: point.who, thing: !!point.thing,
        rx: rxi.pos.get(q.id), e: q.e, s: q.s, d: st.d, f: false, carry: st.carry, hand: st.hand,
        work: objPoints(q).filter((p) => p.zone === row.zone), obj: null, chain: 0, homed: false,
      });
    }
  }

  // The visits in path order: areas, far and long, order inside the areas, flags, the carry cap.
  let exit = null, runTotal = 0;
  for (const v of visits) {
    const { row } = v;
    v.areas = buildAreas(row.zone, v.found, pickFirstFor(row, v.index, race, exit), row.lo, row.hi);
    farAndLong(v);
    let at = Math.max(runTotal, xp.xpAt(row.lo));
    for (const a of v.areas) {
      const r = orderArea(a.qs, at);
      a.qs = r.qs;
      at = r.total;
    }
    runTotal = xp.walk(runTotal, v.areas.reduce((all, a) => all.concat(a.qs), []).map((q) => ({ l: q.l, m: q.m, k: q.k })), v.index + 1 < visits.length ? visits[v.index + 1].row.lo : 60).total;
    for (const q of v.found) {
      q.chain = chainLength(q.id);
    }
    let carried = 0;
    for (const a of v.areas) {
      for (const q of a.qs.slice()) {
        if (q.carry === "next" && ++carried > CARRY_MAX) {
          a.qs.splice(a.qs.indexOf(q), 1);
          leave(v, WHY.carryCap, q.id);
        }
      }
    }
    dropEmpty(v);
    flatten(v);
    if (v.areas.length) {
      const last = v.areas[v.areas.length - 1];
      exit = { zone: row.zone, x: last.x, y: last.y };
    }
  }

  repairPath(visits, leave, race);
  for (const v of visits) {
    dropEmpty(v);
    flatten(v);
    // The place of the work, when it is away from the area the quest is in.
    for (const a of v.areas) {
      for (const q of a.qs) {
        let best = null, bd = Infinity;
        for (const p of q.work) {
          const d = yards(v.row.zone, a.x, a.y, p.x, p.y);
          if (d < bd) { bd = d; best = p; }
        }
        q.obj = best && bd > OBJ_MIN ? { x: round1(best.x), y: round1(best.y) } : null;
      }
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

// RestedXP does a quest only in guides made for other races (the Tauren guide takes "Sergra Darkthorn" before "Plainstrider Menace"
// and the Orc guide takes Plainstrider Menace without it): then this race does not need it, pfQuest's pre list notwithstanding.
function foreignToRace(id, race) {
  const own = RX[race.faction].owners.get(id);
  if (!own || own.everyone) return false;
  return !own.races.has(race.key === "Scourge" ? "Undead" : race.key);
}

// Over the whole path of a race: a quest comes after the quests it needs, and of an either-or pair only the first stays.
// pfQuest's "pre" list is read like this: the quests of it that are on the route all come earlier; with none on the
// route the quest cannot be done here. Repeats until nothing moves (REPAIR_PASSES at most).
function repairPath(visits, leave, race) {
  function locate() {
    const at = new Map();
    let pos = 0;
    visits.forEach((v, vi) => v.areas.forEach((a, ai) => a.qs.forEach((q) => at.set(q.id, { vi, ai, pos: pos++, area: a }))));
    return at;
  }
  const remove = (q, why) => {
    for (const v of visits) {
      for (const a of v.areas) {
        const i = a.qs.indexOf(q);
        if (i >= 0) { a.qs.splice(i, 1); leave(v, why, q.id); return; }
      }
    }
  };
  // What is wrong with the place of quest q right now, as { why } to leave it out or { after } to move it after a quest.
  function problem(q, at) {
    const me = at.get(q.id);
    if (!q.base.pre.length) return null;
    const need = q.base.pre.filter((p) => at.has(p));
    if (!need.length) {
      // None of the quests it needs is on the route. Quests this race does not do (a Tauren-only quest before a Barrens chain)
      // are not needed by this race: when only those are left, the quest stands on its own.
      const open = q.base.pre.filter((p) => { const pq = baseById.get(p); return !pq || (raceFits(pq, race.bit) && !foreignToRace(p, race)); });
      return open.length ? { why: WHY.noPre } : null;
    }
    let after = null;
    for (const p of need) {
      const there = at.get(p);
      if (there.vi > me.vi) return { why: WHY.latePre };
      if (there.vi === me.vi && there.pos > me.pos && (!after || there.pos > at.get(after).pos)) after = p;
    }
    return after != null ? { after } : null;
  }
  let changed = true;
  for (let pass = 0; pass < REPAIR_PASSES && changed; pass++) {
    changed = false;
    let at = locate();
    const everyone = [];
    visits.forEach((v) => v.areas.forEach((a) => a.qs.forEach((q) => everyone.push(q))));
    for (const q of everyone) {
      if (!at.has(q.id)) continue;
      // Either-or: the quest that comes later is left out.
      for (const c of q.base.close) {
        const other = at.get(c);
        if (other && other.pos > at.get(q.id).pos) {
          const victim = everyone.find((x) => x.id === c);
          remove(victim, WHY.pair);
          at = locate();
          changed = true;
        }
      }
      if (!at.has(q.id)) continue;
      const p = problem(q, at);
      if (!p) continue;
      changed = true;
      if (p.why) {
        remove(q, p.why);
      } else {
        const target = at.get(p.after);
        const from = at.get(q.id).area;
        from.qs.splice(from.qs.indexOf(q), 1);
        target.area.qs.splice(target.area.qs.indexOf(everyone.find((x) => x.id === p.after)) + 1, 0, q);
      }
      at = locate();
    }
  }
  // Whatever still moves after the last pass cannot be put in order: leave it out.
  for (let again = true; again;) {
    again = false;
    const at = locate();
    for (const v of visits) {
      for (const a of v.areas) {
        for (const q of a.qs.slice()) {
          if (problem(q, at)) { remove(q, WHY.noPre); again = true; }
        }
      }
    }
  }
}

const plans = RACES.map((race) => ({ race, visits: planRace(race) }));
// ER_LEFTOUT_FILE=<file> also writes every left-out quest id with its reason, for checking by hand.
if (process.env.ER_LEFTOUT_FILE) {
  const notes = {};
  for (const plan of plans) notes[plan.race.key] = plan.visits.map((v) => ({ zone: v.row.zone, left: v.leftOut }));
  fs.writeFileSync(process.env.ER_LEFTOUT_FILE, JSON.stringify(notes));
}

// ---- Data/Route.lua -------------------------------------------------------------------------------------------
const flagsOf = (q) => (q.e ? "e" : "") + (q.d ? "d" : "") + (q.s ? "s" : "") + (q.chain >= 4 ? "c" : "") + (q.f ? "f" : "") + (q.carry ? "x" : "") + (q.k ? "k" : "");
const handOf = (q) => q.hand ? `${num(q.hand.x)} ${num(q.hand.y)}${q.hand.zone ? " " + q.hand.zone : ""}` : "";
const objOf = (q) => q.obj ? `${num(q.obj.x)} ${num(q.obj.y)}` : "";
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
      for (const q of a.qs) area.push(["Q", num(q.id), flagsOf(q), handOf(q), objOf(q)].join("\t"));
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
const earlyLeft = {};
for (const plan of plans) {
  const { race, visits } = plan;
  const rxi = RX[race.faction];
  const marks = (q) => {
    const m = [];
    if (q.e) m.push("elite");
    if (q.s) m.push("escort");
    if (q.d) m.push("part in a dungeon");
    if (q.chain >= 4) m.push(`chain of ${q.chain}`);
    if (q.f) m.push("long walk");
    if (q.carry) m.push(`hand in at ${q.hand.zone}`);
    if (!rxi.pos.has(q.id)) m.push("extra, RestedXP skips it");
    return m.map((x) => ` (${x})`).join("");
  };
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
    const extra = v.quests.filter((q) => !rxi.pos.has(q.id)).length;
    out.push(`${head}: ${v.areas.length} areas, ${v.quests.length} quests${extra > 0 ? `, ${extra} extra that RestedXP skips` : ""}`);
    let n = 0;
    v.areas.forEach((a, ai) => {
      out.push(`  Area ${ai + 1}: around ${a.who}, ${a.qs.length} ${a.qs.length === 1 ? "quest" : "quests"}`);
      for (const q of a.qs) out.push(`     ${++n}. ${q.title} (level ${q.l})${marks(q)}`);
    });
    if (v.row.lo < EARLY_LEVEL) {
      // Levels below 20 are checked quest by quest (ROUTE-03): every left-out quest is named with its level and reason.
      const named = [];
      for (const why of Object.keys(v.leftOut).sort()) {
        const qs = v.leftOut[why].map((id) => baseById.get(id)).filter(Boolean).sort(byLevelId);
        for (const q of qs) named.push(`     - ${q.title} (level ${q.l}): ${WHY_ONE[why] || why}`);
      }
      if (named.length) out.push("  Left out:", ...named);
      earlyLeft[race.key] = (earlyLeft[race.key] || 0) + named.length;
    } else {
      const left = Object.keys(v.leftOut).sort().map((why) => {
        const n = v.leftOut[why].length;
        if (why === WHY.battleground) return `${n} ${n === 1 ? "battleground quest" : "battleground quests"}`;
        return `${n} ${n === 1 ? "quest" : "quests"} ${n === 1 ? why.replace(/^that need /, "that needs ") : why}`;
      });
      if (left.length) out.push(`  Left out: ${left.join("; ")}.`);
    }
    if (v.gap >= 0.1) out.push(`  Gap: grind about ${v.gap} levels here.`);
    out.push(i + 1 < visits.length ? `  Next: ${visits[i + 1].row.zone} at level ${visits[i + 1].row.lo}.` : "  That is level 60: the end of the route.");
    out.push("");
  });
  out.push("How the levels are worked out: each quest gives about 90 xp per quest level (less when you are far above it), plus about 6 kills for quests where you kill or collect something. Real numbers vary a little.");
  out.push("");
  fs.writeFileSync(path.join(OUT_DIR, race.file + ".txt"), out.join("\n"));
  outlineFiles++;
  console.log(`1-20 left out: ${race.name}: ${earlyLeft[race.key] || 0} quests`);
  console.log(`${race.name}: ${visits.length} zones, ${questCount} quests, about ${gapTotal} levels to grind`);
  const lost = {};
  for (const v of visits) for (const why of Object.keys(v.leftOut)) lost[why] = (lost[why] || 0) + v.leftOut[why].length;
  console.log("  left out, all zones: " + Object.keys(lost).sort().map((why) => `${lost[why]} ${why}`).join("; "));
}
fs.writeFileSync(path.join(OUT_DIR, "README.txt"), [
  "Each file is the whole plan for one starting race: the zones in order, and inside each zone the areas in the order you walk them.",
  "\"Gap\" means grind about that many levels there; \"Left out\" lists quests the plan skips and why.",
  "A quest marked \"extra, RestedXP skips it\" is a fun quest of the zone that RestedXP's own guide does not do.",
  "",
  "Each race keeps to its own continent after the start, with at most one boat or zeppelin.",
  "The levels come from a simple experience estimate, not from the pfExtend numbers.",
  "Dwarf and Gnome share one plan (same zones, same order), and so do Orc and Troll; only the quests of their own race differ.",
  "Battleground quests (Warsong Gulch, Arathi Basin, Alterac Valley) are left out: they are PvP, not casual questing.",
  "",
].join("\n"));
console.log(`Route.lua: ${visitNo} visits for ${plans.length} races, ${totalQuests} quests, ${kb} KB`);
console.log(`outlines: ${outlineFiles + 1} files in .planning/route-outlines`);
