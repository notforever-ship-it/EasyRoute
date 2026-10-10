// Builds the casual zone-by-zone route for levels 1 to 60 for each starting race in tools/route-ladder.js.
//   Data/Route.lua                      the plan the game will read (generated, not in EasyRoute.toc yet), with the travel words
//                                       between the zones of each path (hand-kept in tools/route-travel.js, checked here)
//   .planning/route-outlines/<Race>.txt the plan in plain words for the owner, plus README.txt
// Sources: the pfQuest, pfQuest-turtle and pfExtend databases in the game's AddOns folder (quests, who gives them, where,
// where they are handed in, where the work is), and three guides: RestedXP's quest order and zones (Data/Guides.lua), and TourGuide's
// and VanillaGuide's quests (tools/data/guide-index.tsv, made by tools/build-guide-index.js from the owner's archives; credits:
// TourGuideVanilla by cralor, Tekkub, Road-block, rsheep; VanillaGuide by mrmr, lanjelin; both follow Joana's and Brian Kopp's guides).
// The zone order is NOT worked out here: it comes from the hand-kept ladder in tools/route-ladder.js. Levels come from
// tools/lib/xpmodel.js.
// Danger facts (flags g d s, and more): classic-db's quest table through tools/data/quest-kinds.tsv (tools/build-quest-kinds.js), RestedXP's
// Survival Guide through Data/Survival.lua and the friends' ratings through Data/Ratings.lua.
// Needs the Lua VM "fengari" (npm install, in this tools folder) to read pfQuest's Lua data files.
// Usage: node tools/build-route.js [--suggest] [AddOns folder]      (default: E:\Ravencraft\twmoa_1181\Interface\AddOns)
//   --suggest  advice only: for each race and zone of the ladder, prints the level range the quest data suggests next to the
//              ladder's own range, and writes nothing (the ladder stays hand-kept).
//
// What happens to the quests of one zone (in this order):
//   candidates     giver in the zone, race and level fit (a chain's first quests may sit below the level window);
//                  RestedXP doing the quest in another zone keeps it out, unless TourGuide or VanillaGuide picks it up in this
//                  zone and RestedXP's zone is not a later row of the ladder, or RestedXP's zone is a later row whose visit cannot
//                  take the quest (then it is back in)
//   stay in zone   the work must be in the zone, a hand-in elsewhere only at the capital stop right after this visit or at the next zone
//                  (at most CARRY_MAX such quests per visit); a hand-in in any other city leaves the quest out
//   areas          givers close together are one area; areas are walked nearest first from where you come in
//   far and long   work far from its area: moved to a later area close to it, marked as a long walk, or left out
//   order          inside an area RestedXP's order first, then the others by level
//   flags          e d s c f x k g (and more), for the game to filter on later
//   whole path     a quest comes after the quests it needs (quests only other races do are not needed, nor a quest with no giver
//                  on the map, nor a go-and-talk-to quest that no guide, or fewer guides than do the quest itself, does); of an
//                  either-or pair only the first stays
//   outline        every zone names each left-out quest with its level, the reason and how many guides do it
//   --suggest      (see below) prints the level range the quest data suggests next to each ladder row; writes nothing

const fs = require("fs");
const path = require("path");
const { newLuaVM, loadPf } = require("./lib/pfdb.js");
const xp = require("./lib/xpmodel.js");
const { caveIn, caveWordFor } = require("./lib/danger-words.js");
const { CAPITALS, RACES } = require("./route-ladder.js");
const { TRAVEL } = require("./route-travel.js");

const ARGS = process.argv.slice(2);
const SUGGEST = ARGS.indexOf("--suggest") >= 0;
const ROOT = ARGS.filter((a) => a !== "--suggest")[0] || "E:\\Ravencraft\\twmoa_1181\\Interface\\AddOns";
const REPO = path.resolve(__dirname, "..");
const OUT_FILE = path.join(REPO, "Data", "Route.lua");
// The prerequisites of every quest on a route (the full pfQuest list), for the route test to check the order against.
const PRE_FILE = path.join(REPO, "tools", "data", "quest-pre.tsv");
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
  capital: "handed in at a city the route does not visit then",
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
  [WHY.capital]: "handed in at a city the route does not visit then",
  [WHY.tooFar]: "too far from everything else in the zone",
  [WHY.noPre]: "needs a quest that is not on this route",
  [WHY.latePre]: "needs a quest that comes later on the route",
  [WHY.pair]: "only one of a pair can be done",
};

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
// zone = the zone its first Accept step is in (the veto), owners = who the guides doing it are for. The guides are read from
// Data/Guides.lua, as the game has them.
// The race names a guide's defaultFor can hold. defaultFor is a list split by "/": a part that is a bare race word ("Undead") makes the
// guide a race guide for that race; a part with more words ("Dwarf Hunter", "Orc Rogue") is made for one class of that race.
const RACE_WORDS = ["Human", "Dwarf", "Gnome", "NightElf", "Tauren", "Troll", "Orc", "Undead"];
// Dwarves and Gnomes start in the same zone and share one plan, and a Gnome cannot be a Hunter: a guide made for Dwarf Hunters is the
// guide of Dun Morogh for both.
const SIBLING = { Dwarf: "Gnome", Gnome: "Dwarf" };
// What a defaultFor says: { everyone } for a guide with no race ("" or a "!" exclusion), else { races, classRaces }.
function parseWho(who) {
  const text = String(who || "").trim();
  if (!text || text.indexOf("!") >= 0) return { everyone: true, races: [], classRaces: [] };
  const races = [], classRaces = [];
  for (const part of text.split("/")) {
    const words = part.trim().split(/\s+/);
    if (RACE_WORDS.indexOf(words[0]) < 0) continue;
    if (words.length === 1) races.push(words[0]);
    else { classRaces.push(words[0]); if (SIBLING[words[0]]) classRaces.push(SIBLING[words[0]]); }
  }
  return races.length || classRaces.length ? { everyone: false, races, classRaces } : { everyone: true, races: [], classRaces: [] };
}
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
  const stepLines = (g) => String(g.steps).split("\n").map((line) => line.split("\t"));
  const isQuestLine = (c) => (c[0] === "A" || c[0] === "T" || c[0] === "C") && Number(c[2]);
  // A guide made for particular races is theirs; every other guide is for everyone. A class guide (Dwarf Hunters only) counts for
  // the race it names, but it never sets the order or the zone of a quest that a guide for the whole race, or for everyone, has.
  const raceGuide = (g) => { const w = parseWho(g.who); return w.everyone || w.races.length > 0; };
  const inRaceGuide = { Alliance: new Set(), Horde: new Set() };
  for (const g of guides) {
    if (!index[g.faction] || !raceGuide(g)) continue;
    for (const c of stepLines(g)) if (isQuestLine(c)) inRaceGuide[g.faction].add(Number(c[2]));
  }
  for (const g of guides) {
    const f = index[g.faction];
    if (!f) continue;
    const who = parseWho(g.who), classOnly = !raceGuide(g);
    let zone = null;
    for (const c of stepLines(g)) {
      if (c[0] === "G") {
        if (c[2]) zone = c[2];
      } else if (isQuestLine(c)) {
        const id = Number(c[2]);
        if (!f.owners.has(id)) f.owners.set(id, { everyone: false, races: new Set(), classRaces: new Set() });
        const own = f.owners.get(id);
        if (who.everyone) own.everyone = true;
        who.races.forEach((w) => own.races.add(w));
        who.classRaces.forEach((w) => own.classRaces.add(w));
        f.n++;
        if (classOnly && inRaceGuide[g.faction].has(id)) continue;
        if (!f.pos.has(id)) f.pos.set(id, f.n);
        if (c[0] === "A" && zone && !f.zone.has(id)) f.zone.set(id, zone);
      }
    }
  }
  return index;
}
const RX = loadRestedXP();

// RestedXP's flight masters, from its own steps in Data/Guides.lua: a step (an S line and the lines after it) that has an F or a P line names
// its NPC in an I line "Talk to |cff00ff25<name>|r" and its place in the step's last G line (zone, x, y). The guide's faction says whose flight
// master it is. A line only for some classes (its condition field is not empty) goes with the G line that has the same condition; a step that
// names two people (for example "Talk to A or B", or one for each class) and has no place with the condition of a name says nothing about
// that name. The first one seen wins for each faction, zone and name. A name that is only the first part of another name in the same zone
// ("Gryth" and "Gryth Thurden") is the same person: the longer name stays. Returns { Alliance: Map zone -> [ { name, x, y } ], Horde: ... },
// the names of each zone sorted.
function loadFlightMasters() {
  const vm = newLuaVM();
  let guides;
  try {
    vm.run(fs.readFileSync(path.join(REPO, "Data", "Guides.lua")), "Data/Guides.lua");
    vm.run("ER_FG = {} for i, g in ipairs(EasyRoute_Guides) do ER_FG[i] = { faction = g.faction, steps = g.steps } end", "flight guides");
    guides = vm.get("ER_FG");
  } catch (e) {
    die(`source looks incomplete: Data/Guides.lua (${e.message})`);
  }
  const found = { Alliance: new Map(), Horde: new Map() };
  for (const g of guides) {
    if (!found[g.faction]) continue;
    const steps = [];
    let step = null;
    for (const line of String(g.steps).split("\n")) {
      const c = line.split("\t");
      if (c[0] === "S") {
        step = { flies: false, names: [], everyone: new Set(), places: [] };
        steps.push(step);
      } else if (step) {
        if (c[0] === "F" || c[0] === "P") step.flies = true;
        if (c[0] === "I") {
          const named = [];
          const re = /Talk to \|cff00ff25([^|]+)\|r|\bor \|cff00ff25([^|]+)\|r/g;
          let m;
          while ((m = re.exec(c[2] || ""))) named.push((m[1] || m[2]).trim());
          for (const name of named) step.everyone.add(name);
          if (named.length === 1) step.names.push({ cond: c[1] || "", name: named[0] });
        }
        if (c[0] === "G" && c[2] && Number.isFinite(Number(c[3])) && Number.isFinite(Number(c[4]))) {
          step.places.push({ cond: c[1] || "", zone: c[2], x: Number(c[3]), y: Number(c[4]) });
        }
      }
    }
    for (const st of steps) {
      if (!st.flies) continue;
      for (const n of st.names) {
        let near = st.places.filter((p) => p.cond === n.cond);
        if (!near.length && st.everyone.size === 1) near = st.places;
        if (!near.length) continue;
        const at = near[near.length - 1];
        const key = `${at.zone}|${n.name}`;
        if (!found[g.faction].has(key)) found[g.faction].set(key, { zone: at.zone, name: n.name, x: at.x, y: at.y });
      }
    }
  }
  const out = {};
  for (const f of Object.keys(found)) {
    out[f] = new Map();
    const all = [...found[f].values()];
    for (const fm of all) {
      if (all.some((o) => o !== fm && o.zone === fm.zone && o.name.length > fm.name.length && o.name.indexOf(fm.name + " ") === 0)) continue;
      if (!out[f].has(fm.zone)) out[f].set(fm.zone, []);
      out[f].get(fm.zone).push({ name: fm.name, x: fm.x, y: fm.y });
    }
    for (const list of out[f].values()) list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  return out;
}
const FLIGHT = loadFlightMasters();
console.log(`flight masters: ${[...FLIGHT.Alliance.values()].reduce((n, l) => n + l.length, 0)} Alliance and ${[...FLIGHT.Horde.values()].reduce((n, l) => n + l.length, 0)} Horde in RestedXP's steps`);
console.log(`RestedXP: ${RX.Alliance.pos.size} quests for Alliance, ${RX.Horde.pos.size} for Horde`);
for (const f of ["Alliance", "Horde"]) if (RX[f].pos.size < 900) die(`source looks incomplete: Data/Guides.lua (only ${RX[f].pos.size} ${f} quests)`);

// TourGuide's and VanillaGuide's quests per faction, from the committed index tools/data/guide-index.tsv (made by
// tools/build-guide-index.js from the owner's archives; no build needs the archives). A row: pos = the place in the guide, zone =
// where the guide picks the quest up ("" when unknown), races = null for everyone or a set of race words, verbs = what it does.
const GUIDE_INDEX_FILE = path.join(REPO, "tools", "data", "guide-index.tsv");
const GUIDE_NAME = { TG: "TourGuide", VG: "VanillaGuide" };
function loadGuideIndex() {
  const bad = (why) => die(`source looks incomplete: tools/data/guide-index.tsv (${why}; run node tools/build-guide-index.js)`);
  if (!fs.existsSync(GUIDE_INDEX_FILE)) bad("the file is missing");
  const index = { TG: { Alliance: new Map(), Horde: new Map() }, VG: { Alliance: new Map(), Horde: new Map() } };
  fs.readFileSync(GUIDE_INDEX_FILE, "utf8").split("\n").forEach((line, i) => {
    if (!line || line.charAt(0) === "#") return;
    const c = line.split("\t");
    if (c.length !== 7 || !index[c[0]] || !index[c[0]][c[1]] || !Number(c[2])) bad(`line ${i + 1} is not a row`);
    index[c[0]][c[1]].set(Number(c[2]), { pos: Number(c[3]), zone: c[4], races: c[5] === "*" ? null : new Set(c[5].split(",")), verbs: c[6] });
  });
  for (const g of Object.keys(index)) {
    const n = FACTIONS.map((f) => index[g][f].size);
    if (n.some((x) => x < 400)) bad(`${GUIDE_NAME[g]} has only ${n.join(" and ")} rows (Alliance and Horde); all three guides are needed`);
  }
  return index;
}
const FACTIONS = ["Alliance", "Horde"];
const GI = loadGuideIndex();
console.log(`guide index: TourGuide ${GI.TG.Alliance.size} + ${GI.TG.Horde.size}, VanillaGuide ${GI.VG.Alliance.size} + ${GI.VG.Horde.size} quests (Alliance + Horde)`);
const raceWord = (race) => race.key === "Scourge" ? "Undead" : race.key;
// RestedXP has a guide that does the quest for this race: a guide for everyone, for the race, or for a class of the race.
function rxDoes(id, race) {
  const own = RX[race.faction].owners.get(id);
  return !!own && (own.everyone || own.races.has(raceWord(race)) || own.classRaces.has(raceWord(race)));
}
// The rows of TourGuide and VanillaGuide that do quest id for this race, in that order, as { name, row }.
function guideRows(id, race, wantVerbs) {
  const out = [];
  for (const g of ["TG", "VG"]) {
    const row = GI[g][race.faction].get(id);
    if (row && wantVerbs.test(row.verbs) && (!row.races || row.races.has(raceWord(race)))) out.push({ name: GUIDE_NAME[g], row });
  }
  return out;
}
// The names of the guides that do the quest for this race, in the order RestedXP, TourGuide, VanillaGuide.
function guidesFor(id, race) {
  const out = [];
  if (rxDoes(id, race)) out.push("RestedXP");
  for (const g of guideRows(id, race, /[ACT]/)) out.push(g.name);
  return out;
}
// Where a guide does the quest in its own order (1e9 when it does not, so a comparison stays a number).
const guidePos = (id, race, name) => { const g = guideRows(id, race, /[ACT]/).find((x) => x.name === name); return g ? g.row.pos : 1e9; };
// The names of TourGuide and VanillaGuide when they pick the quest up in this zone.
const pickedUpHere = (id, race, zone) => guideRows(id, race, /A/).filter((g) => g.row.zone === zone).map((g) => g.name);
// The zone rule for a quest RestedXP picks up in another zone (replaces the plain RestedXP veto of D-05a). laterZones holds the zones
// of the rows below this one in the race's ladder. The quest stays out when RestedXP's zone is a later row (that visit takes it) or
// when no other guide picks it up here; else it joins this zone and remembers { rz, by }. TourGuide and VanillaGuide come from the
// same two authors, so a majority vote would count one opinion twice; a guide that sends players to pick a quest up in this zone
// shows it can be done from here. The level window, stay-in-zone and first-row-wins rules still apply, and RestedXP keeps its
// quests where the route goes there later, so no quest leaves the zone it is in today. laterTakes(rz), when given, says whether the
// later visit of that zone can take the quest at all (its work and hand-in fit that visit); when it cannot, RestedXP's zone does not
// keep the quest out of this one, and the quest is judged here like any other.
function zoneVerdict(id, race, zone, laterZones, laterTakes) {
  const rz = RX[race.faction].zone.get(id);
  if (!rz || rz === zone) return { out: false, back: null };
  if (laterZones.has(rz) && (!laterTakes || laterTakes(rz))) return { out: true, back: null };
  const by = laterZones.has(rz) ? [] : pickedUpHere(id, race, zone);
  return laterZones.has(rz) || by.length ? { out: false, back: { rz, by } } : { out: true, back: null };
}

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

// Length of the quest chain a quest is in: the longest line of quests before it (pfQuest's pre list is "any one of these"), itself,
// the longest line after it.
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
  let before = 0;
  for (const p of pre) before = Math.max(before, chainUp(p, seen));
  const r = 1 + before;
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
// Escorts: a quest whose text says "escort", and these, which classic-db marks with the party-accept flag or whose accept starts an event the
// player has to see through (found by hand; each one is checked against classic-db when the danger facts are loaded).
const ESCORT_EXTRA = [994, 945, 1222, 2969, 1560, 660, 863, 6641, 1273, 4491, 4506, 4966, 1090];
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
    k: nonEmpty(obj.U) || nonEmpty(obj.I), e: elite, s: String(db.qtext[id] || "").indexOf("escort") >= 0 || ESCORT_EXTRA.indexOf(id) >= 0,
    pre: list(d.pre).filter((p) => p !== id), close: list(d.close).filter((c) => c !== id),
  });
}

// Battleground quests (Warsong Gulch, Arathi Basin, Alterac Valley) are PvP, not casual questing (D-08b): a quest is one when
// its title names a battleground, when it follows such a quest, or when all of its hand-in places or all of its work places are
// inside battlegrounds. An item that drops in a battleground and also in the open world (Runecloth) does not make a quest one.
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
const inBattleground = (p) => BATTLEGROUNDS.indexOf(p.zone) >= 0;
const isBattleground = (q) => bgByTitle(q.id, new Set()) || (endPoints(q).length > 0 && endPoints(q).every(inBattleground)) ||
  (objPoints(q).length > 0 && objPoints(q).every(inBattleground));

const baseById = new Map(base.map((q) => [q.id, q]));
const raceFits = (q, bit) => q.race == null || q.race === 0 || q.race === 255 || (q.race & bit) !== 0;
const inBox = (p, b) => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;

// ---- danger facts ----------------------------------------------------------------------------------------------
// Which quests the casual player should not be sent to, by quest id, for the route's flags and the danger table (D-01 to D-03, D-12).
// Sources: classic-db's quest_template (tools/data/quest-kinds.tsv, made by tools/build-quest-kinds.js), RestedXP's Survival Guide
// (Data/Survival.lua), the friends' ratings (Data/Ratings.lua), RestedXP's normal guides (Data/Guides.lua) and pfQuest's objective text.
// Never a quest's description or story text: words like "group" and "party" are everywhere in them.
const QUEST_KINDS_FILE = path.join(REPO, "tools", "data", "quest-kinds.tsv");
const QUEST_KINDS_MIN = 4000;
function loadQuestKinds() {
  const bad = (why) => die(`source looks incomplete: tools/data/quest-kinds.tsv (${why}; run node tools/build-quest-kinds.js first)`);
  if (!fs.existsSync(QUEST_KINDS_FILE)) bad("the file is missing");
  const kinds = new Map();
  for (const line of fs.readFileSync(QUEST_KINDS_FILE, "utf8").split("\n")) {
    if (!line || line.charAt(0) === "#") continue;
    const c = line.split("\t").map(Number);
    if (c.length !== 5 || c.some((n) => !Number.isFinite(n))) bad("a line is not a row");
    kinds.set(c[0], { type: c[1], players: c[2], flags: c[3], zone: c[4] });
  }
  if (kinds.size < QUEST_KINDS_MIN) bad(`only ${kinds.size} rows`);
  return kinds;
}
const QK = loadQuestKinds();
function loadDangerData() {
  const vm = newLuaVM();
  try {
    vm.run(fs.readFileSync(path.join(REPO, "Data", "Survival.lua")), "Data/Survival.lua");
  } catch (e) {
    die(`source looks incomplete: Data/Survival.lua (${e.message}; run node tools/build-guides.js first)`);
  }
  try {
    vm.run(fs.readFileSync(path.join(REPO, "Data", "Ratings.lua")), "Data/Ratings.lua");
  } catch (e) {
    die(`source looks incomplete: Data/Ratings.lua (${e.message}; run node tools/build-ratings.js first)`);
  }
  const surv = vm.get("EasyRoute_Survival"), ratings = vm.get("EasyRoute_Ratings");
  if (!surv || !surv.Alliance || !surv.Horde || !ratings || !ratings.hard) die("source looks incomplete: Data/Survival.lua or Data/Ratings.lua (run node tools/build-guides.js / build-ratings.js first)");
  const ids = (t) => new Set(Object.keys(t || {}).map(Number));
  const out = { hard: ids(ratings.hard) };
  for (const f of FACTIONS) {
    const s = surv[f];
    out[f] = { skip: new Map(Object.entries(s.skip || {}).map(([id, how]) => [Number(id), how])), absent: ids(s.absent), warn: ids(s.warn), group: ids(s.group), dungeon: ids(s.dungeon), cave: ids(s.cave) };
  }
  return out;
}
const DANGER_DATA = loadDangerData();
// RestedXP's normal guides: the quests named by an A, C or T line of a group step (a step with the flag group), and the text of the
// C and K lines that name each quest (the words of what to do; for the cave rule).
function loadRxFacts() {
  const vm = newLuaVM();
  let guides;
  try {
    vm.run(fs.readFileSync(path.join(REPO, "Data", "Guides.lua")), "Data/Guides.lua");
    vm.run("ER_FX = {} for i, g in ipairs(EasyRoute_Guides) do ER_FX[i] = { faction = g.faction, steps = g.steps } end", "facts guides");
    guides = vm.get("ER_FX");
  } catch (e) {
    die(`source looks incomplete: Data/Guides.lua (${e.message})`);
  }
  const out = {};
  for (const f of FACTIONS) out[f] = { group: new Set(), text: new Map() };
  for (const g of guides) {
    const o = out[g.faction];
    if (!o) continue;
    let inGroup = false;
    for (const line of String(g.steps).split("\n")) {
      const c = line.split("\t");
      if (c[0] === "S") inGroup = /(^|;)group=/.test(c[3] || "");
      else if (inGroup && (c[0] === "A" || c[0] === "C" || c[0] === "T") && Number(c[2])) o.group.add(Number(c[2]));
      const said = c[0] === "C" ? { id: Number(c[2]), text: c[4] } : c[0] === "K" ? { id: Number(c[4]), text: c[5] } : null;
      if (said && said.id && said.text) o.text.set(said.id, (o.text.get(said.id) || "") + " " + said.text);
    }
  }
  return out;
}
const RXF = loadRxFacts();

// The zones of classic-db's dungeons (ZoneOrSort above 0 is a zone id).
const DUNGEON_AREAS = {
  718: "Wailing Caverns", 1581: "The Deadmines", 209: "Shadowfang Keep", 719: "Blackfathom Deeps", 717: "The Stockade",
  721: "Gnomeregan", 491: "Razorfen Kraul", 796: "Scarlet Monastery", 722: "Razorfen Downs", 1337: "Uldaman", 1176: "Zul'Farrak",
  2100: "Maraudon", 1477: "The Temple of Atal'Hakkar", 1584: "Blackrock Depths", 1583: "Blackrock Spire", 2557: "Dire Maul",
  2017: "Stratholme", 2057: "Scholomance",
};
// Dungeon names, for the objective text of Turtle WoW's own quests (ids 40000 and up, which classic-db does not know).
const TURTLE_FIRST_ID = 40000;
const DUNGEON_NAMES = [
  "Wailing Caverns", "Deadmines", "Shadowfang Keep", "Blackfathom Deeps", "The Stockade", "Gnomeregan", "Razorfen Kraul",
  "Scarlet Monastery", "Razorfen Downs", "Uldaman", "Zul'Farrak", "Maraudon", "Sunken Temple", "The Temple of Atal'Hakkar",
  "Blackrock Depths", "Blackrock Spire", "Dire Maul", "Stratholme", "Scholomance",
  "Crescent Grove", "Karazhan Crypt", "Gilneas City", "Hateforge Quarry", "Stormwind Vault", "Dragonmaw Retreat", "Black Morass",
].map((n) => n.toLowerCase());
const QUEST_TYPE_GROUP = 1, QUEST_TYPE_RAID = 62, QUEST_TYPE_DUNGEON = 81, SUGGESTED_PLAYERS_GROUP = 2;
const QUEST_FLAG_PARTY_ACCEPT = 2;
for (const id of ESCORT_EXTRA) {
  const k = QK.get(id);
  if (k && !(k.flags & QUEST_FLAG_PARTY_ACCEPT)) console.log(`escort list: ${id} has no party-accept flag in classic-db`);
}

// d: an objective whose places are all inside dungeons, or classic-db's dungeon type or zone, or the Survival Guide's dungeon-only list,
// or (a Turtle quest) an objective text that names a dungeon. One objective at a time: a quest that kills in a dungeon and also collects in
// the open world is not a dungeon quest.
function dungeonObjective(q) {
  const obj = q.raw.obj || {};
  const allIn = (zones) => zones.size > 0 && [...zones].every((z) => typeof z === "string" && isDungeon(z));
  for (const u of list(obj.U)) if (allIn(zonesOfSource("U", u))) return true;
  for (const o of list(obj.O)) if (allIn(zonesOfSource("O", o))) return true;
  for (const item of list(obj.I)) {
    const s = itemSources(item);
    const zones = new Set();
    for (const u of s.U) for (const z of zonesOfSource("U", u)) zones.add(z);
    for (const o of s.O) for (const z of zonesOfSource("O", o)) zones.add(z);
    if (allIn(zones)) return true;
  }
  return false;
}
function dungeonQuest(id, q, faction) {
  if (q && dungeonObjective(q)) return true;
  const k = QK.get(id);
  if (k && (k.type === QUEST_TYPE_DUNGEON || (k.zone > 0 && DUNGEON_AREAS[k.zone]))) return true;
  if (DANGER_DATA[faction].dungeon.has(id)) return true;
  if (id >= TURTLE_FIRST_ID) {
    const text = String(db.qobj[id] || "").toLowerCase();
    if (text && DUNGEON_NAMES.some((n) => text.indexOf(n) >= 0)) return true;
  }
  return false;
}
// g: a group or raid quest in classic-db, or one that suggests two or more players, or one that RestedXP does in a group step, or one
// the Survival Guide does only in a group step.
function groupQuest(id, faction) {
  const k = QK.get(id);
  if (k && (k.type === QUEST_TYPE_GROUP || k.type === QUEST_TYPE_RAID || k.players >= SUGGESTED_PLAYERS_GROUP)) return true;
  return RXF[faction].group.has(id) || DANGER_DATA[faction].group.has(id);
}
// v: the safe route (the Survival Guide) abandons the quest or calls it very difficult or fatal; or the normal guides do it, the Survival
// Guide never does, and the quest already has a danger sign (elite, escort, dungeon, or a danger line of the Survival Guide). The second kind
// is forgiven when TourGuide and VanillaGuide both do the quest for that faction (it keeps its warning). A quest no normal guide does is
// never v.
const GUIDE_VERBS = /[ACT]/;
const bothOtherGuidesDo = (id, faction) => ["TG", "VG"].every((g) => {
  const row = GI[g][faction].get(id);
  return !!row && GUIDE_VERBS.test(row.verbs);
});
function survivalSkip(id, faction, hasSign) {
  const s = DANGER_DATA[faction];
  if (s.skip.has(id)) return true;
  return s.absent.has(id) && (hasSign || s.warn.has(id)) && !bothOtherGuidesDo(id, faction);
}
// u: the quest goes into a cave, a mine or a crypt: the Survival Guide says so, or the words of pfQuest's objective text, or of the text
// of a normal guide step that finishes the quest, name one. Never pfQuest's description. Gives the word as the game shows it (cave, mine or
// crypt), or null.
function caveQuestWord(id, faction) {
  const found = caveIn(db.qobj[id]) || caveIn(RXF[faction].text.get(id));
  if (found) return caveWordFor(found);
  return DANGER_DATA[faction].cave.has(id) ? "cave" : null;
}
// The letters of one quest for one faction, memoised. The base record (when the quest has one) gives the elite mark; a quest with no base
// record (RestedXP does it, the route does not) has only the letters that come from its id.
const kindMemo = new Map();
function kindsOf(id, faction) {
  const key = faction + ":" + id;
  if (!kindMemo.has(key)) {
    const q = baseById.get(id) || null;
    const e = !!(q && q.e), s = (q ? q.s : false) || ESCORT_EXTRA.indexOf(id) >= 0;
    const d = dungeonQuest(id, q, faction), g = groupQuest(id, faction);
    const v = survivalSkip(id, faction, e || s || d);
    const caveWord = caveQuestWord(id, faction);
    kindMemo.set(key, { e, g, d, s, v, h: DANGER_DATA.hard.has(id), u: !!caveWord, caveWord });
  }
  return kindMemo.get(key);
}
// The danger letters in the order the danger table writes them.
const DANGER_LETTERS = "egdsvhu";
const dangerOf = (k) => DANGER_LETTERS.split("").filter((ch) => k[ch]).join("");

// The stay-in-the-zone rule for one quest of one visit (D-07, D-07a, D-09a). point is where the giver stands in the zone.
// Gives { why } when the quest is left out, else { carry, hand }:
//   carry  "capital" or "next": handed in at the capital stop that comes straight after this visit, or carried on to the next zone
//   hand   { x, y, zone } where to hand in when that is away from the giver (zone only when it is another zone)
// stopNow is the zone of the capital stop in the row right after this visit (null when that row is no stop): a hand-in in any other
// capital is a visit the route does not make then, and the quest is left out with a note that says which city.
function stayInZone(q, point, row, nextZone, stopNow) {
  const here = (p) => p.zone === row.zone;
  const work = objPoints(q);
  if (work.length && !work.some(here)) return { why: work.every((p) => isDungeon(p.zone)) ? WHY.dungeon : WHY.elsewhere };
  const end = endPoints(q);
  if (!end.length) return { carry: null, hand: null };
  const inZone = end.filter(here);
  if (inZone.length) {
    let best = null, bd = Infinity;
    for (const p of inZone) {
      const dist = yards(row.zone, point.x, point.y, p.x, p.y);
      if (dist < bd) { bd = dist; best = p; }
    }
    return { carry: null, hand: bd > HAND_MIN ? { x: round1(best.x), y: round1(best.y) } : null };
  }
  const cap = stopNow ? end.find((p) => p.zone === stopNow) : null;
  if (cap) return { carry: "capital", hand: { x: round1(cap.x), y: round1(cap.y), zone: cap.zone } };
  const next = nextZone ? end.find((p) => p.zone === nextZone) : null;
  if (next) return { carry: "next", hand: { x: round1(next.x), y: round1(next.y), zone: next.zone } };
  const city = end.find((p) => CAPITALS.indexOf(p.zone) >= 0);
  if (city) return { why: WHY.capital, note: `hand in at ${city.zone}, which the route does not visit then` };
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
// Inside an area: the quests RestedXP has, in RestedXP's order; then the others by level, then more guides first.
const inAreaOrder = (a, b) => {
  if (a.rx != null && b.rx != null) return a.rx - b.rx;
  if (a.rx != null) return -1;
  if (b.rx != null) return 1;
  // Same level: the quest more guides do comes first, then TourGuide's and VanillaGuide's own order (a guide without it counts as 1e9).
  return a.l - b.l || b.guides - a.guides || a.tgPos - b.tgPos || a.vgPos - b.vgPos || a.id - b.id;
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

// Work far from its area. Beyond LONG the quest is left out (unless a guide does it: then it stays, marked); beyond FAR
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
        // A guide sends players on this long walk, so it is worth it (D-06a).
        if (q.rx != null || q.guides > 0) { q.f = true; continue; }
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
  // The capital stop that comes straight after row i (its zone), or null.
  const stopAfter = (i) => rows[i + 1] && rows[i + 1].stop ? rows[i + 1].zone : null;
  const claimed = new Set();
  const visits = rows.map((row, i) => ({ row, index: i, areas: [], quests: [], leftOut: {}, notes: {}, gap: 0, found: [] }));
  const leave = (v, why, id, note) => {
    (v.leftOut[why] = v.leftOut[why] || []).push(id);
    if (note) v.notes[id] = note;
  };

  // Stops claim their quests first, then the other rows in ladder order.
  const order = visits.filter((v) => v.row.stop).concat(visits.filter((v) => !v.row.stop));
  for (const v of order) {
    const { row, index } = v;
    const after = rows[index + 1];
    const pulled = row.stop ? new Set() : pullBelow(row, race, claimed);
    const nextZone = after ? (after.stop ? (rows[index + 2] ? rows[index + 2].zone : null) : after.zone) : null;
    const laterZones = new Set(rows.slice(index + 1).map((r) => r.zone));
    // Can the first later visit of zone rz take the quest (it has a giver there, and its work and hand-in fit that visit)?
    const laterTakes = (q) => (rz) => {
      const at = rows.findIndex((r, i) => i > index && r.zone === rz);
      const point = q.points.find((p) => p.zone === rz);
      if (at < 0 || !point) return false;
      const next = rows[at + 1] ? (rows[at + 1].stop ? (rows[at + 2] ? rows[at + 2].zone : null) : rows[at + 1].zone) : null;
      return !stayInZone(q, point, rows[at], next, stopAfter(at)).why;
    };
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
      const zv = zoneVerdict(q.id, race, row.zone, laterZones, laterTakes(q));
      if (zv.out) { leave(v, WHY.rxZone, q.id); continue; }
      const st = stayInZone(q, point, row, nextZone, stopAfter(index));
      if (st.why) { leave(v, st.why, q.id, st.note); continue; }
      claimed.add(q.id);
      v.found.push({
        id: q.id, base: q, title: q.title, l: q.l, m: q.m, k: q.k, x: point.x, y: point.y, who: point.who, thing: !!point.thing,
        rx: rxi.pos.get(q.id), ...kindsOf(q.id, race.faction), f: false, carry: st.carry, hand: st.hand, back: zv.back,
        guides: guidesFor(q.id, race).length, tgPos: guidePos(q.id, race, "TourGuide"), vgPos: guidePos(q.id, race, "VanillaGuide"),
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
    // More than CARRY_MAX quests handed in later (at the capital stop right after, or in the next zone): the ones more guides do stay
    // (a tie goes to the walk order), the rest are left out (D-07a).
    const carriedOn = [];
    for (const a of v.areas) for (const q of a.qs) if (q.carry) carriedOn.push(q);
    if (carriedOn.length > CARRY_MAX) {
      const keep = new Set(carriedOn.map((q, i) => ({ q, i })).sort((a, b) => b.q.guides - a.q.guides || a.i - b.i).slice(0, CARRY_MAX).map((x) => x.q));
      for (const a of v.areas) {
        for (const q of a.qs.slice()) {
          if (q.carry && !keep.has(q)) {
            a.qs.splice(a.qs.indexOf(q), 1);
            leave(v, WHY.carryCap, q.id);
          }
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
  return !rxDoes(id, race);
}

// A go-and-talk-to quest: pfQuest lists no monster, object, item or area to work on.
function talkOnly(pq) {
  const obj = pq.raw.obj || {};
  return !nonEmpty(obj.U) && !nonEmpty(obj.O) && !nonEmpty(obj.I) && !nonEmpty(obj.A);
}
// A quest with no giver place on the map: an item or a drop starts it, or the quest before it hands it out. Data/Zones.lua has no row
// for it, so it can never be on the route.
function foundQuest(id) {
  const d = db.quests[id];
  if (!d || typeof d !== "object" || !db.qnames[id] || d.class || d.event || d.skill) return false;
  const start = d.start || {};
  return !pointsOf(list(start.U), list(start.O)).length;
}
// Some guide does the quest (any race of the faction).
const inAnyGuide = (id, faction) => RX[faction].pos.has(id) || ["TG", "VG"].some((g) => { const r = GI[g][faction].get(id); return r && /[ACT]/.test(r.verbs); });

// Over the whole path of a race: a quest comes after the quests it needs, and of an either-or pair only the first stays.
// pfQuest's "pre" list is read as pfQuest reads it: any ONE of them done is enough. So the quest is fine when one of its quests
// that are on the route comes before it; when they all come after it, it moves behind the earliest one in its own zone, or is left
// out when they all come in a later zone; with none on the route the quest cannot be done here. Repeats until nothing moves
// (REPAIR_PASSES at most).
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
  // The quests it needs that still hold it back when none of them is on the route. A prerequisite does not when this race does not do
  // it, or (with the guide rule) when a guide does the quest itself for this race and either the prerequisite is a quest with no
  // giver on the map (an item or the quest before it starts it, so it cannot be on a route), or it is a go-and-talk-to quest that no
  // guide of the faction ever does or that at least two of the guides doing the quest do without: the guide authors played it
  // without that step.
  const skipped = (q, p) => { const withP = guidesFor(p, race); return guidesFor(q.id, race).filter((g) => withP.indexOf(g) < 0).length >= 2; };
  function openPre(q, guideRule) {
    return q.base.pre.filter((p) => {
      const pq = baseById.get(p);
      if (!pq) return !(guideRule && q.guides > 0 && foundQuest(p));
      if (!raceFits(pq, race.bit) || foreignToRace(p, race)) return false;
      return !(guideRule && q.guides > 0 && talkOnly(pq) && (!inAnyGuide(p, race.faction) || skipped(q, p)));
    });
  }
  // What is wrong with the place of quest q right now, as { why } to leave it out or { after } to move it after a quest.
  function problem(q, at) {
    const me = at.get(q.id);
    if (!q.base.pre.length) return null;
    const need = q.base.pre.filter((p) => at.has(p));
    if (!need.length) {
      // None of the quests it needs is on the route. Quests this race does not do (a Tauren-only quest before a Barrens chain)
      // are not needed by this race: when only those are left, the quest stands on its own.
      return openPre(q, true).length ? { why: WHY.noPre } : null;
    }
    let after = null;
    for (const p of need) {
      const there = at.get(p);
      if (there.vi < me.vi || (there.vi === me.vi && there.pos < me.pos)) return null;
      if (there.vi === me.vi && (!after || there.pos < at.get(after).pos)) after = p;
    }
    return after != null ? { after } : { why: WHY.latePre };
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
  // The quests that now stand on their own only because of the guide rule.
  const finalAt = locate();
  for (const v of visits) {
    for (const a of v.areas) {
      for (const q of a.qs) {
        q.freed = q.base.pre.length > 0 && !q.base.pre.some((p) => finalAt.has(p)) && openPre(q, false).length > 0 && openPre(q, true).length === 0;
      }
    }
  }
}

// ---- --suggest: the level ranges the quest data suggests ----------------------------------------------------------
// For a race, the zone rows of its ladder in order (short stops left out). A zone's quests are the candidates of the builder
// (giver in the zone, race, class, event, skill, RestedXP veto, exclude boxes, battleground), without the first-row-wins and
// stay-in-zone rules: this is advice. covered(zone, lo, hi) is the experience the zone's quests with a level from lo-4 to hi+2
// and a lowest level of at most hi give (90 per quest level, plus about 6 kills for kill and collect quests), but never more
// than the experience needed to go from lo to hi. A dynamic programme picks boundaries between level 1 and 60, every used zone
// at least 3 levels long and any zone allowed to be skipped, so that the covered experience is as large as it can be.
const SUGGEST_MIN_STAY = 3;
function suggestFor(race) {
  const rows = race.rows.filter((r) => !r.stop);
  const worth = rows.map((row) => {
    const laterZones = new Set(race.rows.slice(race.rows.indexOf(row) + 1).map((r) => r.zone));
    const out = [];
    for (const q of base) {
      if (!raceFits(q, race.bit)) continue;
      const point = q.points.find((p) => p.zone === row.zone);
      if (!point) continue;
      if ((row.exclude || []).some((b) => inBox(point, b))) continue;
      if (isBattleground(q)) continue;
      if (zoneVerdict(q.id, race, row.zone, laterZones).out) continue;
      out.push({ l: q.l, m: q.m, xp: xp.QUEST_XP_PER_LEVEL * q.l + (q.k ? xp.K * xp.killXP(q.l, q.l) : 0) });
    }
    return out;
  });
  const covered = (i, lo, hi) => {
    let sum = 0;
    for (const q of worth[i]) if (q.l >= lo - 4 && q.l <= hi + 2 && q.m <= hi) sum += q.xp;
    return Math.min(xp.xpAt(hi) - xp.xpAt(lo), sum);
  };
  // best[i][L]: the most experience covered by the first i zones when the last used range ends at level L (level 1 = nothing used yet).
  const NONE = -Infinity;
  const best = [], from = [];
  for (let i = 0; i <= rows.length; i++) {
    best.push(new Array(61).fill(NONE));
    from.push(new Array(61).fill(null));
  }
  best[0][1] = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let L = 1; L <= 60; L++) {
      if (best[i][L] > best[i + 1][L]) { best[i + 1][L] = best[i][L]; from[i + 1][L] = { skip: true, at: L }; }
    }
    for (let hi = 1 + SUGGEST_MIN_STAY; hi <= 60; hi++) {
      for (let lo = 1; lo <= hi - SUGGEST_MIN_STAY; lo++) {
        if (best[i][lo] === NONE) continue;
        const total = best[i][lo] + covered(i, lo, hi);
        if (total > best[i + 1][hi] + 1e-9) { best[i + 1][hi] = total; from[i + 1][hi] = { skip: false, at: lo }; }
      }
    }
  }
  const pick = new Array(rows.length).fill(null);
  let level = 60;
  for (let i = rows.length; i > 0; i--) {
    const step = from[i][level];
    if (!step) break;
    if (!step.skip) pick[i - 1] = { lo: step.at, hi: level };
    level = step.at;
  }
  rows.forEach((row, i) => {
    const head = `suggest: ${race.name}: ${row.zone} ladder ${row.lo}-${row.hi}, `;
    if (!pick[i]) { console.log(head + "data: skip"); return; }
    const need = xp.xpAt(pick[i].hi) - xp.xpAt(pick[i].lo);
    const share = need > 0 ? Math.round(covered(i, pick[i].lo, pick[i].hi) / need * 100) : 100;
    console.log(head + `data ${pick[i].lo}-${pick[i].hi} (${share}% covered)`);
  });
}
if (SUGGEST) {
  console.log("suggest: advice only, nothing is written; the ladder in tools/route-ladder.js stays hand-kept");
  for (const race of RACES) suggestFor(race);
  process.exit(0);
}

const plans = RACES.map((race) => ({ race, visits: planRace(race) }));
// ER_LEFTOUT_FILE=<file> also writes every left-out quest id with its reason, for checking by hand.
if (process.env.ER_LEFTOUT_FILE) {
  const notes = {};
  for (const plan of plans) notes[plan.race.key] = plan.visits.map((v) => ({ zone: v.row.zone, left: v.leftOut }));
  fs.writeFileSync(process.env.ER_LEFTOUT_FILE, JSON.stringify(notes));
}

// ---- grind points ---------------------------------------------------------------------------------------------
// The plan orders quests by distance, not by level, so a quest giver can be ahead of the player. Here each race's path is played once
// more with the "casual model" (elite and escort quests are left out on Casual, so they give no xp and get no mark) and every quest the
// model player is too low for gets q.grind = the level it needs: "grind to this level before you pick it up". RouteRun.lua turns the marks
// into "Grind to level N" steps in the same order as the walk below: carried hand-ins first, then for each area and each wave (a quest
// waits for the quest before it, row.p, when that one is listed earlier in the same area) the pick-ups, the work, the hand-ins, and at the
// end of a visit that is not a capital stop the grind to the top of the zone. The levels l, m and p come from Data/Zones.lua, the rows the
// game's ER.QuestRow reads, so builder and game cannot disagree on them.
const zoneRows = new Map();
{
  const vm = newLuaVM();
  vm.run(fs.readFileSync(path.join(REPO, "Data", "Zones.lua")), "Data/Zones.lua");
  vm.run("ER_ROWS = {} for zid, z in pairs(EasyRoute_Zones) do for _, q in ipairs(z.q) do ER_ROWS[#ER_ROWS + 1] = { q.id, q.l, q.m, q.p or 0, zid, q.g or '', q.x or -1 } end end", "rows");
  for (const [id, l, m, p, zid, g, x] of vm.get("ER_ROWS")) {
    const old = zoneRows.get(id);
    if (old && (old.l !== l || old.m !== m || old.p !== (p || null))) die(`Quest ${id} is in Data/Zones.lua twice (zones ${old.zid} and ${zid}) with different l, m or p`);
    zoneRows.set(id, { l, m, p: p || null, zid, g: g || null, x: x < 0 ? null : x });
  }
}
const rowOf = (id) => zoneRows.get(id) || die(`Quest ${id} has no row in Data/Zones.lua`);
const sameZone = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// The waves of one area, as RouteRun.lua makes them: wave 1 = quests whose p is not listed earlier in this area, wave k+1 = quests whose p is in wave k.
function wavesOf(area) {
  const wave = new Map(), waves = [];
  for (const q of area.qs) {
    const p = rowOf(q.id).p;
    const w = p && wave.has(p) ? wave.get(p) + 1 : 1;
    wave.set(q.id, w);
    (waves[w - 1] = waves[w - 1] || []).push(q);
  }
  return waves;
}

// The casual model player does not do elite, group, dungeon, escort, safe-route-skipped or friends'-Hard quests (the game leaves them out
// on Casual), so they give no xp and no grind mark.
const casualOut = (q) => q.e || q.g || q.d || q.s || q.v || q.h;

// Gives q.grind to the quests the casual model player is too low for. Returns { marked, steps } for the console.
function grindWalk(plan) {
  const { race, visits } = plan;
  let total = 0, marked = 0, steps = 0;
  const carried = [];
  const level = () => Math.floor(xp.levelAt(total));
  const gain = (q) => {
    const row = rowOf(q.id), lv = level();
    return xp.questXP(row.l, lv) + (q.k ? xp.K * xp.killXP(lv, row.l) : 0);
  };
  visits.forEach((v, vi) => {
    // Hand in what the visits before left, oldest first.
    for (let i = 0; i < carried.length;) {
      if (carried[i].q.hand && sameZone(carried[i].q.hand.zone, v.row.zone)) {
        total += gain(carried[i].q);
        carried.splice(i, 1);
      } else i++;
    }
    for (const c of carried) {
      // One visit later is allowed only across a capital stop; the game hands in at the next visit or the one after a stop.
      if (vi - c.vi >= 2 || !visits[c.vi + 1].row.stop) die(`${race.name}: quest ${c.q.id} (${c.q.title}) left in ${visits[c.vi].row.zone} is still not handed in at ${v.row.zone}`);
    }
    let reached = 0; // the highest grind step in this visit so far
    for (const area of v.areas) {
      for (const wave of wavesOf(area)) {
        const lv = level();
        // The level the model player has when this wave's pick-ups start: the game's bridges show only to a player below it (ADAPT-03).
        if (!v.row.stop) for (const q of wave) q.pl = lv;
        let hi = 0;
        for (const q of wave) {
          if (casualOut(q)) continue;
          const m = rowOf(q.id).m;
          if (m > lv) {
            q.grind = m;
            marked++;
            hi = Math.max(hi, m);
          }
        }
        // The steps the game will show: one grind step before the first giver batch that needs a higher level than any step so far.
        const batches = new Map();
        for (const q of wave) {
          const row = rowOf(q.id);
          const key = `${row.g || area.who}@${row.x != null ? row.x : area.x}`;
          batches.set(key, Math.max(batches.get(key) || 0, q.grind || 0));
        }
        for (const need of batches.values()) {
          if (need > reached) { reached = need; steps++; }
        }
        total = Math.max(total, xp.xpAt(hi));
        for (const q of wave) {
          if (casualOut(q)) continue;
          if (q.carry) carried.push({ q, vi });
          else total += gain(q);
        }
      }
    }
    if (!v.row.stop) total = Math.max(total, xp.xpAt(v.row.hi));
  });
  if (carried.length) die(`${race.name}: quest ${carried[0].q.id} is still not handed in at the end of the path`);
  return { marked, steps };
}
for (const plan of plans) {
  const r = grindWalk(plan);
  console.log(`grind points: ${plan.race.name}: ${r.marked} quests marked, ${r.steps} grind steps`);
}
// The quests of each faction's paths, once each (the first visit that holds it), for the lists the console shows and the danger table.
const routeQuestsOf = (faction) => {
  const out = new Map();
  for (const plan of plans) {
    if (plan.race.faction !== faction) continue;
    for (const v of plan.visits) for (const q of v.quests) if (!out.has(q.id)) out.set(q.id, q);
  }
  return out;
};
// Every flag list, one line per quest, for review (the letters are worked out as the casual model and the game's leave-out table use them).
function printFlagList(letter, name) {
  for (const f of FACTIONS) {
    const hit = [...routeQuestsOf(f).values()].filter((q) => q[letter]).sort((a, b) => a.id - b.id);
    console.log(`${letter}: ${f} ${hit.length} quests (${name})`);
    for (const q of hit) console.log(`  ${q.id} ${q.title}`);
  }
}
printFlagList("d", "an objective only inside a dungeon");
printFlagList("g", "group quest");
printFlagList("v", "the safe route skips it");
printFlagList("h", "friends found it hard");
printFlagList("u", "goes into a cave, mine or crypt");

// ---- grind spots ------------------------------------------------------------------------------------------------
// Where to grind. For each leveling visit the builder makes a pool of spots (a mob that stands in numbers close to the visit's
// areas) and writes it into Data/Route.lua as the visit's spots field; the game (Grind.lua) picks from the pool by the player's
// level now. Mob groups come from Data/Mobs.lua; whether a mob is yellow (neutral, will not attack first) or red (hostile) comes
// from tools/data/creature-react.tsv (CMaNGOS classic-db and the game's faction data, made by tools/build-creature-react.js);
// pfQuest's rank 1 to 3 units are the strong mobs. The rules, in plain words:
//   a spot is the same mob name and level range seen in groups that lie close to the biggest one (GRIND_MERGE_YARDS), with at least GRIND_MIN_SPAWNS spawns;
//   never a critter, a totem or a creature the player is friendly to;
//   no strong mob (rank 1 to 3) within GRIND_ELITE_YARDS of it that is within GRIND_ELITE_BELOW levels of the player or higher;
//   not more than GRIND_RED_MAX_YELLOW (a yellow spot) or GRIND_RED_MAX_RED (a red spot) spawns of other red or unknown mobs
//     (not grey for the player) within GRIND_RED_YARDS of it, counted group by group (a far-off group of a merged spot does not count);
//   yellow mobs may be GRIND_BELOW levels below the player up to GRIND_YELLOW_LAST above; red or unknown mobs only at the player's
//     level or up to GRIND_BELOW below it; never grey;
//   close to the visit: within GRIND_LAST yards of one of its areas.
// For every player level of the visit the best GRIND_PER_LEVEL spots are kept (the nearest first, where a red or unknown spot counts
// GRIND_YELLOW_EXTRA yards farther than it is and a yellow spot a little above the player GRIND_ABOVE_EXTRA farther; the same order the game
// uses); the pool is what was kept for any level. Grind.lua carries the same names on ER.GRIND; tools/test-route.js reads both.
const GRIND_MIN_SPAWNS = 8, GRIND_MERGE_YARDS = 250, GRIND_ELITE_YARDS = 150, GRIND_ELITE_BELOW = 3;
const GRIND_RED_YARDS = 150, GRIND_RED_MAX_YELLOW = 30, GRIND_RED_MAX_RED = 20;
// GRIND_NEAR and GRIND_FAR only decide the game's words for a walk (a bit of a walk, far away); they are kept equal for the test.
const GRIND_NEAR = 600, GRIND_FAR = 1200, GRIND_LAST = 1800;
const GRIND_YELLOW_EXTRA = 600, GRIND_ABOVE_EXTRA = 300;
const GRIND_YELLOW_ABOVE = 1, GRIND_YELLOW_LAST = 2, GRIND_BELOW = 1;
const GRIND_PER_LEVEL = 2, GRIND_POOL_MAX = 16, GRIND_FILE_MAX_KB = 200;
// Creature types that are never a place to grind: critter, not specified, totem.
const GRIND_NO_TYPES = [8, 10, 11];

const REACT_FILE = path.join(REPO, "tools", "data", "creature-react.tsv");
if (!fs.existsSync(REACT_FILE)) die("tools/data/creature-react.tsv is missing: run node tools/build-creature-react.js first");
const reactRows = new Map();
for (const line of fs.readFileSync(REACT_FILE, "utf8").split("\n")) {
  if (!line || line.charAt(0) === "#") continue;
  const f = line.split("\t");
  reactRows.set(Number(f[0]), { type: Number(f[4]), noAggro: f[5] === "1", Alliance: f[6], Horde: f[7] });
}
if (reactRows.size < 5000) die(`tools/data/creature-react.tsv has only ${reactRows.size} creatures (expected more than 5000)`);

// pfQuest unit ids by "name|lowest level|highest level" (ordinary units only, as Data/Mobs.lua is made), and the strong mobs of each zone.
const unitIdsByKey = new Map();
const strongByZone = new Map();
for (const id of Object.keys(db.units)) {
  const u = db.units[id];
  const name = db.unames[id];
  if (!u || !name) continue;
  const m = String(u.lvl || "").match(/^(\d+)(?:-(\d+))?$/);
  if (!m) continue;
  const lo = Number(m[1]), hi = Number(m[2] || m[1]);
  const rank = Number(u.rnk);
  if (rank >= 1 && rank <= 3) {
    for (const raw of u.coords || []) {
      const c = place(raw);
      if (!db.znames[c[2]]) continue;
      if (!strongByZone.has(c[2])) strongByZone.set(c[2], []);
      strongByZone.get(c[2]).push({ x: c[0], y: c[1], hi });
    }
    continue;
  }
  if (u.fac || (u.rnk && rank !== 0)) continue;
  const key = `${name}|${lo}|${hi}`;
  if (!unitIdsByKey.has(key)) unitIdsByKey.set(key, []);
  unitIdsByKey.get(key).push(Number(id));
}

// The mob groups of Data/Mobs.lua of each zone id: { name, lo, hi, x, y, n }.
const mobGroupsByZone = new Map();
{
  const vm = newLuaVM();
  vm.run(fs.readFileSync(path.join(REPO, "Data", "Mobs.lua")), "Data/Mobs.lua");
  const raw = vm.get("EasyRoute_Mobs");
  for (const zid of Object.keys(raw)) {
    const groups = [];
    for (const entry of String(raw[zid]).split(";")) {
      const m = /^(.*),(\d+),(\d+),([\d.]+),([\d.]+),(\d+)$/.exec(entry);
      if (m) groups.push({ name: m[1], lo: Number(m[2]), hi: Number(m[3]), x: Number(m[4]), y: Number(m[5]), n: Number(m[6]) });
    }
    mobGroupsByZone.set(Number(zid), groups);
  }
}
// Zone name to zone id; a name that two zones carry goes to the one that has mob groups.
const zoneIdByName = new Map();
for (const id of Object.keys(db.znames)) {
  const key = String(db.znames[id]).toLowerCase();
  const old = zoneIdByName.get(key);
  if (old === undefined || (mobGroupsByZone.has(Number(id)) && !mobGroupsByZone.has(old))) zoneIdByName.set(key, Number(id));
}

// What a group of one name is for a faction: u no data, r red, p red name but does not attack first, f friendly, y yellow.
function groupCode(ids, faction) {
  const rows = ids.map((id) => reactRows.get(id)).filter(Boolean);
  if (!rows.length) return { code: "u", bad: false };
  const bad = rows.some((r) => GRIND_NO_TYPES.indexOf(r.type) >= 0);
  const reds = rows.filter((r) => r[faction] === "r");
  if (reds.length) return { code: reds.every((r) => r.noAggro) ? "p" : "r", bad };
  if (rows.some((r) => r[faction] === "f")) return { code: "f", bad };
  return { code: "y", bad };
}

// The clusters of one zone for one faction: groups of the same name and level range within GRIND_MERGE_YARDS of the biggest one are one.
// x, y = the middle of the groups (weighted by spawns, one decimal), n = all spawns, bad = never a spot (friendly or critter),
// strong = the highest level of a strong mob within GRIND_ELITE_YARDS (0 when none), near = the spawns of red and unknown clusters
// of other names within GRIND_RED_YARDS (single mob groups, not whole clusters).
const clusterCache = new Map();
function clustersOf(zoneName, faction) {
  const zid = zoneIdByName.get(zoneName.toLowerCase());
  if (zid === undefined) die(`Zone ${zoneName} has no id in the pfQuest zone table`);
  const cacheKey = `${zid}|${faction}`;
  if (clusterCache.has(cacheKey)) return clusterCache.get(cacheKey);
  const bySpot = new Map();
  for (const g of mobGroupsByZone.get(zid) || []) {
    const { code, bad } = groupCode(unitIdsByKey.get(`${g.name}|${g.lo}|${g.hi}`) || [], faction);
    const key = `${g.name}|${g.lo}|${g.hi}`;
    if (!bySpot.has(key)) bySpot.set(key, []);
    bySpot.get(key).push(Object.assign({ code, bad }, g));
  }
  const clusters = [];
  for (const key of [...bySpot.keys()].sort()) {
    const name = bySpot.get(key)[0].name;
    const left = bySpot.get(key).slice().sort((a, b) => b.n - a.n || a.x - b.x || a.y - b.y);
    while (left.length) {
      const seed = left.shift();
      const members = [seed];
      for (let i = left.length - 1; i >= 0; i--) {
        if (yards(zoneName, seed.x, seed.y, left[i].x, left[i].y) <= GRIND_MERGE_YARDS) members.push(left.splice(i, 1)[0]);
      }
      const codes = members.map((g) => g.code);
      const total = members.reduce((s, g) => s + g.n, 0);
      const c = {
        name, x: Math.round(members.reduce((s, g) => s + g.x * g.n, 0) / total * 10) / 10, y: Math.round(members.reduce((s, g) => s + g.y * g.n, 0) / total * 10) / 10,
        n: total,
        lo: Math.min(...members.map((g) => g.lo)), hi: Math.max(...members.map((g) => g.hi)),
        code: codes.indexOf("r") >= 0 ? "r" : codes.indexOf("u") >= 0 ? "u" : codes.indexOf("p") >= 0 ? "p" : "y",
        bad: members.some((g) => g.bad || g.code === "f"),
        strong: 0, near: [],
      };
      for (const s of strongByZone.get(zid) || []) {
        if (yards(zoneName, c.x, c.y, s.x, s.y) <= GRIND_ELITE_YARDS) c.strong = Math.max(c.strong, s.hi);
      }
      clusters.push(c);
    }
  }
  const allGroups = [];
  for (const list of bySpot.values()) for (const g of list) allGroups.push(g);
  for (const c of clusters) {
    for (const o of allGroups) {
      if ((o.name === c.name && o.lo === c.lo) || o.bad || (o.code !== "r" && o.code !== "u")) continue;
      if (yards(zoneName, c.x, c.y, o.x, o.y) <= GRIND_RED_YARDS) c.near.push(o);
    }
  }
  clusterCache.set(cacheKey, clusters);
  return clusters;
}

// The pool of one leveling visit, as the lines of the spots field (nine tab separated fields; see the header of Data/Route.lua).
function spotsOf(v, faction) {
  const clusters = clustersOf(v.row.zone, faction);
  const pool = new Map();
  for (let L = Math.max(1, v.row.lo - 1); L <= Math.min(59, v.row.hi); L++) {
    const grey = xp.greyLevel(L);
    const cands = [];
    for (const c of clusters) {
      if (c.bad || c.n < GRIND_MIN_SPAWNS || c.hi <= grey) continue;
      if (c.strong !== 0 && c.strong >= L - GRIND_ELITE_BELOW) continue;
      const yellow = c.code === "y" || c.code === "p";
      if (yellow ? !(c.lo <= L + GRIND_YELLOW_LAST && c.hi >= L - GRIND_BELOW) : !(c.hi <= L && c.hi >= L - GRIND_BELOW)) continue;
      const d = Math.min(...v.areas.map((a) => yards(v.row.zone, a.x, a.y, c.x, c.y)));
      if (d > GRIND_LAST) continue;
      let red = 0;
      for (const o of c.near) if (o.hi > grey) red += o.n;
      if (red > (yellow ? GRIND_RED_MAX_YELLOW : GRIND_RED_MAX_RED)) continue;
      const rank = d + (yellow ? (c.lo > L + GRIND_YELLOW_ABOVE ? GRIND_ABOVE_EXTRA : 0) : GRIND_YELLOW_EXTRA);
      cands.push({ c, d, red, rank, yellow: yellow ? 1 : 0 });
    }
    cands.sort((a, b) => a.rank - b.rank || b.yellow - a.yellow || a.d - b.d || (a.c.name < b.c.name ? -1 : a.c.name > b.c.name ? 1 : 0) || a.c.x - b.c.x || a.c.y - b.c.y);
    for (const e of cands.slice(0, GRIND_PER_LEVEL)) {
      const key = `${e.c.name}|${e.c.x}|${e.c.y}`;
      if (!pool.has(key)) pool.set(key, { c: e.c, red: Math.min(99, e.red) });
    }
  }
  if (pool.size > GRIND_POOL_MAX) die(`${faction} ${v.row.zone} ${v.row.lo}-${v.row.hi}: ${pool.size} grind spots (at most ${GRIND_POOL_MAX})`);
  const spots = [...pool.values()].sort((a, b) =>
    a.c.lo - b.c.lo || a.c.hi - b.c.hi || (a.c.name < b.c.name ? -1 : a.c.name > b.c.name ? 1 : 0) || a.c.x - b.c.x || a.c.y - b.c.y);
  return spots.map((s) => [clean(s.c.name), num(s.c.x), num(s.c.y), num(s.c.lo), num(s.c.hi), num(s.c.n), s.c.code, num(s.red), num(s.c.strong)].join("\t"));
}
for (const plan of plans) {
  let visitCount = 0, spotCount = 0, yellowCount = 0;
  for (const v of plan.visits) {
    if (v.row.stop) continue;
    const spotLines = spotsOf(v, plan.race.faction);
    if (!spotLines.length) continue;
    v.spots = spotLines.join("\n");
    visitCount++;
    spotCount += spotLines.length;
    yellowCount += spotLines.filter((l) => l.split("\t")[6] === "y").length;
  }
  console.log(`grind spots: ${plan.race.name}: ${visitCount} visits, ${spotCount} spots, ${yellowCount} of them yellow`);
}

// ---- tools/data/quest-pre.tsv ---------------------------------------------------------------------------------
// One row for each quest on any route that needs other quests: its id, and the quests it needs (any ONE of them done is enough).
// Data/Zones.lua keeps only the first of them, so the route test reads this file to check the order with the whole list.
// The text is written together with Data/Route.lua, after the read back below has passed.
let preText = "";
{
  const seenPre = new Set(), preRows = [];
  for (const plan of plans) for (const v of plan.visits) for (const q of v.quests) {
    if (seenPre.has(q.id)) continue;
    seenPre.add(q.id);
    if (q.base.pre.length) preRows.push([q.id, q.base.pre.slice().sort((a, b) => a - b).join(",")]);
  }
  preRows.sort((a, b) => a[0] - b[0]);
  preText = [
    "# Generated by tools/build-route.js from pfQuest's pre lists. Do not edit by hand.",
    "# quest id <TAB> the quests it needs, split by commas (any ONE of them done is enough), for every quest on a route that needs any",
    ...preRows.map((r) => r.join("\t")),
    "",
  ].join("\n");
  console.log(`quest-pre.tsv: ${preRows.length} quests with prerequisites`);
}

// ---- travel between zones -------------------------------------------------------------------------------------
// A move is two zones in a row on a race's path. Each has an entry in tools/route-travel.js (the format is in that file's header);
// the game turns the entry into the first steps of the next zone. The faction is in the key because the same two zones can
// need other words for the Alliance and the Horde.
const LEG_KINDS = ["walk", "fly", "boat", "zeppelin", "tram", "portal"];
const LEG_FIELDS = ["kind", "text", "tick", "at", "via", "fm", "to", "learn"];
const TEXT_VERBS = ["Walk", "Follow", "Take", "Fly", "Leave", "Ride", "Go", "Head", "Talk", "Cross", "Run"];
const TEXT_MAX = 140, LEG_MAX = 4;
const moves = new Map();
for (const plan of plans) {
  const zones = plan.visits.map((v) => v.row.zone);
  for (let i = 0; i + 1 < zones.length; i++) {
    const key = `${plan.race.faction}|${zones[i]}>${zones[i + 1]}`;
    if (!moves.has(key)) moves.set(key, { key, faction: plan.race.faction, from: zones[i], to: zones[i + 1], races: [] });
    moves.get(key).races.push(plan.race.name);
  }
}
const isZone = (z) => Object.prototype.hasOwnProperty.call(ZONE_SIZES, z);

// What is wrong with the words of one leg (a message), or nothing.
function textProblem(kind, text) {
  if (typeof text !== "string" || !text) return "the text is empty";
  if (text !== text.trim()) return "the text starts or ends with a space";
  if (text.length > TEXT_MAX) return `the text is ${text.length} characters long (at most ${TEXT_MAX})`;
  if (!new RegExp(`^(${TEXT_VERBS.join("|")}) `).test(text)) return `the text does not start with one of ${TEXT_VERBS.join(", ")}`;
  if (/\d/.test(text)) return "the text has a digit";
  if (/[\t\r\n]/.test(text)) return "the text has a tab or a line break";
  if (/[;=]/.test(text)) return "the text has a semicolon or an equals sign";
  if (/ or /i.test(text)) return "the text has \"or\" (never two ways)";
  if (kind !== "walk" && text.split(" ").slice(0, 6).join(" ").toLowerCase().indexOf(kind === "fly" ? "fly" : kind) < 0) {
    return `the text does not say "${kind}" in its first words`;
  }
  return null;
}

// Checks one entry against its move and returns its legs as the game will get them:
// { kind, via, text, tick, to, fm, startZone, endZone } (via "x y Zone" or "").
function checkEntry(move, entry) {
  const bad = (what) => die(`Travel problem for ${move.key}: ${what}`);
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.legs)) bad("the entry needs legs: [ ... ]");
  for (const k of Object.keys(entry)) if (k !== "check" && k !== "legs") bad(`unknown field "${k}"`);
  if (entry.check !== undefined && typeof entry.check !== "boolean") bad("check must be true or false");
  const n = entry.legs.length;
  if (n < 1 || n > LEG_MAX) bad(`${n} legs (1 to ${LEG_MAX} are allowed)`);
  const out = [];
  let start = move.from;
  entry.legs.forEach((leg, i) => {
    const where = `leg ${i + 1}`;
    const last = i === n - 1;
    if (!leg || typeof leg !== "object") bad(`${where} is not an object`);
    for (const k of Object.keys(leg)) if (LEG_FIELDS.indexOf(k) < 0) bad(`${where}: unknown field "${k}"`);
    if (LEG_KINDS.indexOf(leg.kind) < 0) bad(`${where}: kind "${leg.kind}" is none of ${LEG_KINDS.join(", ")}`);
    const why = textProblem(leg.kind, leg.text);
    if (why) bad(`${where}: ${why}`);
    const tick = leg.tick !== undefined ? leg.tick : (last ? move.to : undefined);
    if (typeof tick !== "string" || !tick) bad(`${where}: tick is missing`);
    const at = leg.at !== undefined ? leg.at : tick;
    if (!isZone(at)) bad(`${where}: "${at}" is not a zone of Data/ZoneSizes.lua${leg.at === undefined ? " (a town name needs at: the zone it is in)" : ""}`);
    if (tick.toLowerCase() === start.toLowerCase()) bad(`${where}: tick "${tick}" is the zone the leg starts in`);
    if (last && at !== move.to) bad(`the last leg ends in ${at}, not in ${move.to}`);
    let via = "";
    if (leg.via !== undefined) {
      const m = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (.+)$/.exec(leg.via);
      if (!m || Number(m[1]) > 100 || Number(m[2]) > 100) bad(`${where}: via "${leg.via}" is not "x y Zone" (map percent)`);
      if (m[3] !== start) bad(`${where}: via is in ${m[3]} but the leg starts in ${start}`);
      via = leg.via;
    }
    if (leg.kind === "fly") {
      if (typeof leg.fm !== "string" || !leg.fm || typeof leg.to !== "string" || !leg.to) bad(`${where}: a fly leg needs fm (where you leave from) and to (where you land)`);
      if (leg.via !== undefined) bad(`${where}: a fly leg has no via of its own: the arrow points at its flight master (fm)`);
    } else if (leg.fm !== undefined || leg.to !== undefined) {
      bad(`${where}: fm and to belong to fly legs only`);
    }
    if (leg.learn !== undefined) {
      if (typeof leg.learn !== "string" || !leg.learn) bad(`${where}: learn needs the name of a flight master`);
      if (tick !== at) bad(`${where}: learn needs a tick that is a zone (${tick} is a town in ${at})`);
      if (!(FLIGHT[move.faction].get(at) || []).some((fm) => fm.name === leg.learn)) bad(`${where}: ${leg.learn} is not a flight master in ${at} that RestedXP's steps know`);
    }
    out.push({ kind: leg.kind, via, text: leg.text, tick, to: leg.to || "", fm: leg.fm || "", learn: leg.learn || "", startZone: start, endZone: at });
    start = at;
  });
  return out;
}

// A flight master that RestedXP's steps do not know is looked up as a unit of that exact name in the pfQuest data and placed like every
// other pfQuest place. zone: the zone it must stand in. Returns { zone, x, y } or null.
let unitIdsByName = null;
function pfFlightMaster(name, zone) {
  if (!unitIdsByName) {
    unitIdsByName = new Map();
    for (const id of Object.keys(db.unames).map(Number).sort((a, b) => a - b)) {
      const n = db.unames[id];
      if (typeof n !== "string") continue;
      if (!unitIdsByName.has(n)) unitIdsByName.set(n, []);
      unitIdsByName.get(n).push(id);
    }
  }
  const points = pointsOf(unitIdsByName.get(name) || [], []);
  const p = points.find((q) => q.zone === zone);
  return p ? { zone: p.zone, x: p.x, y: p.y } : null;
}
const pfPlaced = [];
// A flight master of the faction by name in a zone: RestedXP's own steps first, pfQuest second, else the build stops.
function findFlightMaster(move, where, name, zone) {
  const list = FLIGHT[move.faction].get(zone) || [];
  const here = list.find((fm) => fm.name === name);
  if (here) return { zone, x: here.x, y: here.y };
  const pf = pfFlightMaster(name, zone);
  if (pf) {
    pfPlaced.push(`${name} (${zone})`);
    console.log(`travel: ${name} placed from pfQuest`);
    return pf;
  }
  die(`Travel problem for ${move.key}: ${where}: ${name} is not a flight master in ${zone} that RestedXP's steps or pfQuest know`);
}
// The place of a fly leg is its flight master (fm, in the zone the leg starts in); it lands at to, in the zone the leg ends in.
function placeFlights(move, legs) {
  legs.forEach((leg, i) => {
    if (leg.kind !== "fly") return;
    const from = findFlightMaster(move, `leg ${i + 1}`, leg.fm, leg.startZone);
    leg.via = `${num(from.x)} ${num(from.y)} ${from.zone}`;
    findFlightMaster(move, `leg ${i + 1}`, leg.to, leg.endZone);
  });
}

const travelLegs = new Map(); // key -> checked legs
const travelCheck = new Set(); // keys marked check
const missing = [];
for (const move of moves.values()) {
  const entry = TRAVEL[move.key];
  if (!entry) { missing.push(move.key); continue; }
  const legs = checkEntry(move, entry);
  placeFlights(move, legs);
  travelLegs.set(move.key, legs);
  if (entry.check) travelCheck.add(move.key);
}
for (const key of Object.keys(TRAVEL)) if (!moves.has(key)) die(`Travel problem for ${key}: no race's path has this move`);
if (missing.length) die(`Travel problem: ${missing.length} moves have no entry in tools/route-travel.js, the first is ${missing[0]}`);
// Two names at exactly one place are one flight master written two ways in RestedXP's steps (Borgun and Borgus Stoutarm): the last name
// in the sorted list stays, so the game gets one step for the place.
function onePerPlace(list) {
  const out = [];
  for (const fm of list) {
    const at = out.findIndex((o) => o.x === fm.x && o.y === fm.y);
    if (at >= 0) out[at] = fm; else out.push(fm);
  }
  return out;
}
// The flight masters of every zone on the faction's paths that has one in RestedXP's steps, for the steps that teach the flight paths.
const flightRows = new Map(); // "<Faction>|<Zone>" -> [ { name, x, y } ]
for (const plan of plans) {
  for (const v of plan.visits) {
    const list = FLIGHT[plan.race.faction].get(v.row.zone);
    if (list) flightRows.set(`${plan.race.faction}|${v.row.zone}`, onePerPlace(list));
  }
}
// The flight-path rule, the same in the game (FP_NEAR in RouteRun.lua; the two numbers must not differ): in the first visit of a zone
// (not a named second visit) each flight master of the faction in that zone gets a "Get the flight path" step right after the steps of the area
// nearest to it, when that area is at most FP_NEAR yards away (the S.Yards formula). Farther flight masters get no step.
const FP_NEAR = 600;
// Walks every race's path in order and keeps the flight masters its steps teach; every fly leg of a move must land on one that was taught in the
// visits before it. Stops the build otherwise.
const untaught = [];
for (const plan of plans) {
  const taught = new Set();
  const faction = plan.race.faction;
  plan.visits.forEach((v, i) => {
    const zone = v.row.zone;
    if (!v.row.again) {
      for (const fm of flightRows.get(`${faction}|${zone}`) || []) {
        let best = Infinity;
        for (const a of v.areas) best = Math.min(best, yards(zone, fm.x, fm.y, a.x, a.y));
        if (best <= FP_NEAR) taught.add(`${zone}|${fm.name}`);
      }
    }
    const next = plan.visits[i + 1];
    if (!next) return;
    const key = `${faction}|${zone}>${next.row.zone}`;
    for (const leg of travelLegs.get(key)) {
      if (leg.kind === "fly") {
        if (!taught.has(`${leg.endZone}|${leg.to}`)) {
          untaught.push(`Travel problem for ${key} (${plan.race.key}): the flight lands at ${leg.to} in ${leg.endZone}, but no step teaches that flight path earlier on the path`);
        }
        // You learn a flight master by talking to it, so the one you take off from is known from then on.
        taught.add(`${leg.startZone}|${leg.fm}`);
      }
      if (leg.learn) taught.add(`${leg.endZone}|${leg.learn}`);
    }
  });
  console.log(`flight paths: ${plan.race.key}: ${taught.size} taught`);
}
if (untaught.length) {
  for (const m of untaught) console.log(m);
  die(`Travel problem: ${untaught.length} flights land on a flight path that no step teaches (a flight master is taught only when it is within ${FP_NEAR} yards of an area of the first visit of its zone)`);
}
const flightKeys = [...flightRows.keys()].sort();
const flightMasterCount = flightKeys.reduce((n, k) => n + flightRows.get(k).length, 0);
const flightText = (key) => flightRows.get(key).map((fm) => [num(fm.x), num(fm.y), clean(fm.name)].join("\t")).join("\n");
console.log(`flights: ${flightKeys.length} zones, ${flightMasterCount} flight masters`);
const flightLines = flightKeys.map((key) => `    [${lua(key)}] = ${lua(flightText(key))},`);
const travelKeys = [...travelLegs.keys()].sort();
const legText = (l) => [l.kind, l.via, l.text, l.tick, l.to].concat(l.learn ? [l.learn] : []).join("\t");
const legCount = [...travelLegs.values()].reduce((sum, legs) => sum + legs.length, 0);
console.log(`travel: ${moves.size} moves, ${legCount} legs, ${travelCheck.size} marked check`);
const travelLines = travelKeys.map((key) => `    [${lua(key)}] = ${lua(travelLegs.get(key).map(legText).join("\n"))},`);

// ---- Data/Route.lua -------------------------------------------------------------------------------------------
// The danger table: per faction, every quest of the faction's paths and every quest of RestedXP's guides for it that has any of the danger
// letters, written in the order of DANGER_LETTERS; and the cave words that are not "cave" (mine, crypt).
const dangerTable = {}, caveWords = {};
for (const f of FACTIONS) {
  const ids = new Set(routeQuestsOf(f).keys());
  for (const id of RX[f].pos.keys()) ids.add(id);
  dangerTable[f] = new Map();
  for (const id of [...ids].sort((a, b) => a - b)) {
    const k = kindsOf(id, f), letters = dangerOf(k);
    if (!letters) continue;
    dangerTable[f].set(id, letters);
    if (k.u && k.caveWord !== "cave" && !caveWords[id]) caveWords[id] = k.caveWord;
  }
  const count = (ch) => [...dangerTable[f].values()].filter((l) => l.indexOf(ch) >= 0).length;
  console.log(`danger: ${f}: ${dangerTable[f].size} quests (${DANGER_LETTERS.split("").map((ch) => ch + " " + count(ch)).join(", ")})`);
}
console.log(`caveword: ${Object.keys(caveWords).length} quests with the word mine or crypt`);
const dangerLines = [];
for (const f of FACTIONS) {
  dangerLines.push(`    ${f} = {`);
  for (const [id, letters] of dangerTable[f]) dangerLines.push(`      [${num(id)}] = ${lua(letters)},`);
  dangerLines.push("    },");
}
const caveLines = Object.keys(caveWords).map(Number).sort((a, b) => a - b).map((id) => `    [${num(id)}] = ${lua(caveWords[id])},`);
const flagsOf = (q) => (q.e ? "e" : "") + (q.d ? "d" : "") + (q.s ? "s" : "") + (q.chain >= 4 ? "c" : "") + (q.f ? "f" : "") + (q.carry ? "x" : "") + (q.k ? "k" : "") + (q.g ? "g" : "") + (q.v ? "v" : "") + (q.h ? "h" : "") + (q.u ? "u" : "");
const handOf = (q) => q.hand ? `${num(q.hand.x)} ${num(q.hand.y)}${q.hand.zone ? " " + q.hand.zone : ""}` : "";
const objOf = (q) => q.obj ? `${num(q.obj.x)} ${num(q.obj.y)}` : "";
const lines = [
  "-- Generated by tools/build-route.js from the pfQuest, pfQuest-turtle and pfExtend data and RestedXP's quest order. Do not edit by hand.",
  "-- RestedXP's order is used under CC BY-NC-SA 4.0 (https://github.com/RestedXP/RXPGuides).",
  "-- TourGuide (cralor, Tekkub, Road-block, rsheep) and VanillaGuide (mrmr, lanjelin) quest facts come through tools/data/guide-index.tsv.",
  "-- RestedXP's Survival Guide comes through Data/Survival.lua, and the friends' ratings through Data/Ratings.lua.",
  "-- paths: per start race, keyed by the game's race name, the visit numbers in order.",
  "-- visit: race, zone, lo and hi levels, gap = total levels of grinding in this visit (also where the quests run out in the middle of it),",
  "-- stop = 1 for a capital short stop,",
  "-- again = 1 for a named second visit, n = number of quests, areas = lines split by tabs:",
  "--   A x y who      starts an area (map percent, the giver it is named after)",
  "--   Q id flags hand obj grind      is a quest; hand and obj are \"x y\" when away from the giver or the area, \"x y Zone\" when in",
  "--   another zone, empty otherwise; grind = grind to this level before picking the quest up (empty: no need); worked out with the",
  "--   casual model: elite, group, dungeon, escort, safe-route-skipped and friends'-Hard quests give no xp",
  "-- version 2: the Q line has the grind field.",
  "-- pl: a seventh field of the Q line of a leveling visit (not of a capital stop): the level the casual model player has when the pick-ups of the",
  "--   quest's wave start; the game shows a grind bridge only to a player below it.",
  "-- spots: the grind spots of a leveling visit (not of a capital stop), lines split by tabs: name, x, y (map percent of the biggest group), lowest level,",
  "--   highest level, number of spawns, code, red, strong. code: y yellow by data (will not attack first), p red name but does not attack first, r red,",
  "--   u no data. red = spawns of other red or unknown mobs close by, strong = the highest level of a strong mob close by (0: none).",
  "-- version 3: leveling visits have a spots field (the grind spots).",
  "-- version 4: new flag letters (g v h u), d means an objective only inside a dungeon.",
  "-- The yellow and red facts come from CMaNGOS classic-db (GPL-3.0, github.com/cmangos/classic-db) through tools/data/creature-react.tsv.",
  "-- travel: per move from one zone of a path to the next, keyed \"<Faction>|<From>><To>\" (hand-kept in tools/route-travel.js). The value is one leg",
  "--   per line, fields split by tabs: kind (walk fly boat zeppelin tram portal), via (\"x y Zone\": where the arrow points, empty: none), text (the",
  "--   words), tick (the zone or sub-zone that ends the leg), to (a fly leg: the flight master you land at, empty otherwise). A fly leg's via is the",
  "--   place of the flight master it leaves from (RestedXP's own steps first, pfQuest second). A sixth field, learn, is optional: the flight master in",
  "--   the tick zone to talk to after the leg, to get its flight path.",
  "-- flights: per \"<Faction>|<Zone>\" of that faction's paths, the flight masters RestedXP's steps know there, one per line, fields split by tabs: x, y, name.",
  "--   The first visit of a zone teaches the flight masters within a short walk of its areas (RouteRun.lua and the build use the same rule).",
  "-- flags: e elite, d an objective only inside a dungeon, s escort, c chain of 4 or more, f far from its area,",
  "-- x handed in later, at the capital stop right after this visit or in the next zone (at most 3 per visit), k something to kill or collect,",
  "-- g group quest, v the safe route skips it, h friends found it hard, u goes into a cave, mine or crypt.",
  "-- danger: per faction, every route and RestedXP quest id with any of the letters e g d s v h u, for the game's leave-out table in any guide.",
  "-- caveword: the u quests whose word is mine or crypt (cave otherwise).",
  "EasyRoute_Route = {",
  "  version = 4,",
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
      for (const q of a.qs) {
        const fields = ["Q", num(q.id), flagsOf(q), handOf(q), objOf(q), q.grind ? num(q.grind) : ""];
        if (q.pl) fields.push(num(q.pl));
        area.push(fields.join("\t"));
      }
    }
    const parts = [`race = ${lua(plan.race.key)}`, `zone = ${lua(v.row.zone)}`, `lo = ${num(v.row.lo)}`, `hi = ${num(v.row.hi)}`, `gap = ${num(v.gap)}`];
    if (v.row.stop) parts.push("stop = 1");
    if (v.row.again) parts.push("again = 1");
    parts.push(`n = ${num(v.quests.length)}`);
    if (!v.row.stop && v.spots) parts.push(`spots = ${lua(v.spots)}`);
    parts.push(`areas = ${lua(area.join("\n"))}`);
    visitLines.push(`    [${visitNo}] = { ${parts.join(", ")} },`);
    totalQuests += v.quests.length;
  }
  lines.push(`    ${plan.race.key} = { ${numbers.join(", ")} },`);
}
lines.push("  },", "  visits = {", ...visitLines, "  },", "  travel = {", ...travelLines, "  },", "  flights = {", ...flightLines, "  },", "  danger = {", ...dangerLines, "  },", "  caveword = {", ...caveLines, "  },", "}", "");
// The new file is written next to the old one under another name, read back from there, and moved into place only when the read back
// passes; a failed run leaves the old Data/Route.lua as it was.
const OUT_TMP = OUT_FILE + ".tmp";
fs.writeFileSync(OUT_TMP, lines.join("\n"));
const kb = (fs.statSync(OUT_TMP).size / 1024).toFixed(1);
if (fs.statSync(OUT_TMP).size > GRIND_FILE_MAX_KB * 1024) {
  try { fs.unlinkSync(OUT_TMP); } catch (e) { /* already gone */ }
  die(`read back FAILED: Data/Route.lua would be ${kb} KB, more than ${GRIND_FILE_MAX_KB} KB (Data/Route.lua was not changed)`);
}

// ---- read it back -------------------------------------------------------------------------------------------
const backFailed = (msg) => {
  try { fs.unlinkSync(OUT_TMP); } catch (e) { /* already gone */ }
  die(`read back FAILED: ${msg} (Data/Route.lua was not changed)`);
};
const checkVM = newLuaVM();
try {
  checkVM.run(fs.readFileSync(path.join(REPO, "Data", "Zones.lua")), "Data/Zones.lua");
  checkVM.run(fs.readFileSync(OUT_TMP), "Data/Route.lua");
  checkVM.run("ER_IDS = {} for _, z in pairs(EasyRoute_Zones) do for _, q in ipairs(z.q) do ER_IDS[tostring(q.id)] = 1 end end", "ids");
} catch (e) {
  backFailed(e.message);
}
const known = checkVM.get("ER_IDS");
const readVisits = checkVM.get("EasyRoute_Route.visits");
let readQuests = 0, readCount = 0;
for (const plan of plans) {
  for (const v of plan.visits) {
    const rv = Array.isArray(readVisits) ? readVisits[v.number - 1] : readVisits[String(v.number)];
    if (!rv) backFailed(`visit ${v.number} (${v.row.zone}) is missing`);
    const ids = rv.areas.split("\n").filter((l) => l.charAt(0) === "Q").map((l) => Number(l.split("\t")[1]));
    if (ids.length !== v.quests.length || ids.length !== rv.n) backFailed(`visit ${v.number} (${v.row.zone}) has ${ids.length} quests, expected ${v.quests.length}`);
    for (const id of ids) if (!known[String(id)]) backFailed(`quest ${id} in ${v.row.zone} is not in Data/Zones.lua`);
    const wantSpots = !v.row.stop && v.spots ? v.spots : undefined;
    if (rv.spots !== wantSpots) backFailed(`visit ${v.number} (${v.row.zone}) did not get its grind spots back as written`);
    readQuests += ids.length;
    readCount++;
  }
}
const readTravel = checkVM.get("EasyRoute_Route.travel");
if (!readTravel || typeof readTravel !== "object") backFailed("the travel table is missing");
for (const key of travelKeys) {
  if (readTravel[key] !== travelLegs.get(key).map(legText).join("\n")) backFailed(`travel entry ${key} did not come back as written`);
}
if (Object.keys(readTravel).length !== travelKeys.length) backFailed(`the travel table has ${Object.keys(readTravel).length} entries, expected ${travelKeys.length}`);
const readFlights = checkVM.get("EasyRoute_Route.flights");
if (!readFlights || typeof readFlights !== "object") backFailed("the flights table is missing");
for (const key of flightKeys) {
  if (readFlights[key] !== flightText(key)) backFailed(`flights entry ${key} did not come back as written`);
}
if (Object.keys(readFlights).length !== flightKeys.length) backFailed(`the flights table has ${Object.keys(readFlights).length} entries, expected ${flightKeys.length}`);
const readDanger = checkVM.get("EasyRoute_Route.danger"), readCave = checkVM.get("EasyRoute_Route.caveword");
if (!readDanger || typeof readDanger !== "object" || !readCave || typeof readCave !== "object") backFailed("the danger or caveword table is missing");
for (const f of FACTIONS) {
  const got = readDanger[f] || {};
  if (Object.keys(got).length !== dangerTable[f].size) backFailed(`the ${f} danger table has ${Object.keys(got).length} entries, expected ${dangerTable[f].size}`);
  for (const [id, letters] of dangerTable[f]) if (got[String(id)] !== letters) backFailed(`danger entry ${f} ${id} did not come back as written`);
}
if (Object.keys(readCave).length !== Object.keys(caveWords).length) backFailed("the caveword table did not come back as written");
for (const id of Object.keys(caveWords)) if (readCave[id] !== caveWords[id]) backFailed(`caveword entry ${id} did not come back as written`);
console.log(`read back: ${readQuests} quests in ${readCount} visits, all found in Data/Zones.lua; ${travelKeys.length} travel entries`);
fs.renameSync(OUT_TMP, OUT_FILE);
fs.mkdirSync(path.dirname(PRE_FILE), { recursive: true });
fs.writeFileSync(PRE_FILE + ".tmp", preText);
fs.renameSync(PRE_FILE + ".tmp", PRE_FILE);

// ---- outlines -----------------------------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
let outlineFiles = 0;
const leftNamed = {};
const guideNotes = {};
for (const plan of plans) {
  const { race, visits } = plan;
  const rxi = RX[race.faction];
  const marks = (q) => {
    const m = [];
    if (q.e) m.push("elite");
    if (q.s) m.push("escort");
    if (q.d) m.push("part in a dungeon");
    if (q.g) m.push("group quest");
    if (q.v) m.push("safe route skips it");
    if (q.h) m.push("friends found it hard");
    if (q.u) m.push(`goes into a ${q.caveWord}`);
    if (q.chain >= 4) m.push(`chain of ${q.chain}`);
    if (q.f) m.push("long walk");
    if (q.carry) m.push(`hand in at ${q.hand.zone}`);
    if (q.back) m.push(q.back.by.length ? `RestedXP does it in ${q.back.rz}; ${q.back.by.join(" and ")} ${q.back.by.length > 1 ? "pick" : "picks"} it up here` : `RestedXP does it in ${q.back.rz}, which cannot take it`);
    if (q.freed) m.push("do it without the quest before it");
    if (!rxi.pos.has(q.id)) {
      const others = guidesFor(q.id, race);
      m.push(others.length ? `extra: RestedXP skips it, ${others.join(" and ")} ${others.length > 1 ? "do" : "does"} it` : "extra: no guide does it");
    }
    return m.map((x) => ` (${x})`).join("");
  };
  // The ending of a named left-out quest: how many guides do it for this race (none: nothing is said).
  const guideEnding = (id, r) => {
    const n = guidesFor(id, r).length;
    return n === 0 ? "" : n === 3 ? " (in all 3 guides)" : ` (in ${n} ${n === 1 ? "guide" : "guides"})`;
  };
  const onPathIds = new Set();
  const placeOf = new Map();
  for (const v of visits) for (const q of v.quests) { onPathIds.add(q.id); if (!placeOf.has(q.id)) placeOf.set(q.id, v.row.zone); }
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
    const extraQs = v.quests.filter((q) => !rxi.pos.has(q.id));
    const extra = extraQs.length, inOther = extraQs.filter((q) => q.guides > 0).length;
    out.push(`${head}: ${v.areas.length} areas, ${v.quests.length} quests${extra > 0 ? `, ${extra} extra that RestedXP skips${inOther > 0 ? ` (${inOther} of them in another guide)` : ""}` : ""}`);
    let n = 0;
    v.areas.forEach((a, ai) => {
      out.push(`  Area ${ai + 1}: around ${a.who}, ${a.qs.length} ${a.qs.length === 1 ? "quest" : "quests"}`);
      for (const q of a.qs) out.push(`     ${++n}. ${q.title} (level ${q.l})${marks(q)}`);
    });
    {
      // Every zone, at every level, names each left-out quest with its level and the reason (ROUTE-03, D-14). A quest that needs
      // you in another zone says so when its work is in the next zone of the route and none of it is here.
      const nextRow = visits.slice(i + 1).find((x) => !x.row.stop);
      const named = [];
      for (const why of Object.keys(v.leftOut).sort()) {
        const qs = v.leftOut[why].map((id) => baseById.get(id)).filter(Boolean).sort(byLevelId);
        for (const q of qs) {
          let reason = v.notes[q.id] || WHY_ONE[why] || why;
          // Maps overlap, so a quest of another zone can show up here as well: say where the route does it.
          if (placeOf.has(q.id)) reason += `, but the route does it in ${placeOf.get(q.id)}`;
          else if (why === WHY.elsewhere && nextRow && objPoints(q).some((p) => p.zone === nextRow.row.zone) && !objPoints(q).some((p) => p.zone === v.row.zone)) {
            reason += `, its work is in ${nextRow.row.zone}`;
          }
          named.push(`     - ${q.title} (level ${q.l}): ${reason}${guideEnding(q.id, race)}`);
        }
      }
      if (named.length) out.push("  Left out:", ...named);
      leftNamed[race.key] = (leftNamed[race.key] || 0) + named.length;
    }
    if (v.row.stop) {
      // A capital stop only takes the quests of its own level. The quests a guide picks up in this city at other levels, for this
      // race and not on the route anywhere, are all named here (by level, then id; the same title and level only once).
      const win = (q) => q.l >= v.row.lo - 2 && q.l <= v.row.lo + 3 && q.m <= v.row.lo;
      const others = new Set();
      for (const q of base) {
        if (onPathIds.has(q.id) || win(q) || !raceFits(q, race.bit) || isBattleground(q)) continue;
        if (rxi.zone.get(q.id) !== v.row.zone && !guideRows(q.id, race, /A/).some((g) => g.row.zone === v.row.zone)) continue;
        if (guidesFor(q.id, race).length === 0) continue;
        others.add(q);
      }
      const names = [...new Set([...others].sort(byLevelId).map((q) => `${q.title} (level ${q.l})`))];
      if (names.length) out.push(`  Not on this route (the guides do them here at other levels): ${names.join(", ")}`);
    }
    if (v.gap >= 0.1) out.push(`  Gap: grind about ${v.gap} levels here.`);
    out.push(i + 1 < visits.length ? `  Next: ${visits[i + 1].row.zone} at level ${visits[i + 1].row.lo}.` : "  That is level 60: the end of the route.");
    out.push("");
  });
  out.push("How the levels are worked out: each quest gives about 90 xp per quest level (less when you are far above it), plus about 6 kills for quests where you kill or collect something. Real numbers vary a little.");
  out.push("");
  fs.writeFileSync(path.join(OUT_DIR, race.file + ".txt"), out.join("\n"));
  outlineFiles++;
  console.log(`left out, named: ${race.name}: ${leftNamed[race.key] || 0} quests`);
  const onRoute = visits.reduce((all, v) => all.concat(v.quests), []);
  console.log(`guides: ${race.name}: ${onRoute.filter((q) => q.back).length} quests back in that RestedXP picks up in another zone`);
  console.log(`guides: ${race.name}: ${onRoute.filter((q) => q.freed).length} quests stand on their own (their go-and-talk-to quest is in no guide)`);
  console.log(`guides: ${race.name}: ${onRoute.filter((q) => q.guides > 0).length} quests on the route are in at least one guide, ${onRoute.filter((q) => q.guides === 0).length} in none`);
  guideNotes[race.key] = { back: onRoute.filter((q) => q.back).map((q) => [q.id, q.title, q.back.rz, q.back.by.join("+")]), freed: onRoute.filter((q) => q.freed).map((q) => [q.id, q.title, q.base.pre.join("+")]) };
  console.log(`${race.name}: ${visits.length} zones, ${questCount} quests, about ${gapTotal} levels to grind`);
  const lost = {};
  for (const v of visits) for (const why of Object.keys(v.leftOut)) lost[why] = (lost[why] || 0) + v.leftOut[why].length;
  console.log("  left out, all zones: " + Object.keys(lost).sort().map((why) => `${lost[why]} ${why}`).join("; "));
}
// ER_GUIDES_FILE=<file> also writes, per race, the quests brought back by the zone rule and the ones the prerequisite rule frees.
if (process.env.ER_GUIDES_FILE) fs.writeFileSync(process.env.ER_GUIDES_FILE, JSON.stringify(guideNotes));
fs.writeFileSync(path.join(OUT_DIR, "README.txt"), [
  "Each file is the whole plan for one starting race: the zones in order, and inside each zone the areas in the order you walk them.",
  "\"Gap\" means grind about that many levels there; \"Left out\" lists quests the plan skips and why.",
  "Every zone lists each quest it leaves out, with its level, the reason and how many guides do it. Please read those lists.",
  "A quest marked \"extra\" is a fun quest of the zone that RestedXP's own guide does not do; the mark says which other guide does it, or that no guide does.",
  "Three guides were used: RestedXP, TourGuide and VanillaGuide (Joana's and Brian Kopp's guides).",
  "\"in 2 guides\" means two of the three guides do that quest; a quest more guides do is more worth doing.",
  "Under each short stop in a city, \"Not on this route\" names the quests the guides give in that city at other levels.",
  "\"hand in at <place>\" means you carry the quest on and hand it in there: only at the city stop right after the zone or in the next zone, at most 3 quests per zone. \"do it without the quest before it\" means the quest before it cannot be walked to (an item starts it) or most guides skip it.",
  "\"hand in at <city>, which the route does not visit then\" on a left-out line means the quest has to be handed in at a city the plan does not stop in right after that zone, so it is not on the route.",
  "\"but the route does it in <zone>\" on a left-out line means the quest is not lost: it is on the route in that zone.",
  "\"group quest\", \"elite\", \"escort\" and \"part in a dungeon\" are quests Casual leaves out; so are \"safe route skips it\" (the safe way of playing drops or abandons it) and \"friends found it hard\". \"goes into a cave\" (or mine, crypt) is a warning only.",
  "",
  "Each race keeps to its own continent after the start, with at most one boat or zeppelin.",
  "The levels come from a simple experience estimate, not from the pfExtend numbers.",
  "Dwarf and Gnome share one plan (same zones, same order), and so do Orc and Troll; only the quests of their own race differ.",
  "Battleground quests (Warsong Gulch, Arathi Basin, Alterac Valley) are left out: they are PvP, not casual questing.",
  "",
].join("\n"));
// The travel words for the owner, in path order: what the guide says between one zone and the next.
{
  const out = [
    "How the guide says to get from one zone to the next. Lines marked \"please check in the game\" are my best guess.",
    `${travelCheck.size} of the ${moves.size} moves are marked \"please check in the game\".`,
    "",
  ];
  for (const faction of FACTIONS) {
    out.push(faction.toUpperCase(), "");
    for (const move of moves.values()) {
      if (move.faction !== faction) continue;
      out.push(`${move.from} to ${move.to} (${move.races.join(", ")})${travelCheck.has(move.key) ? " (please check in the game)" : ""}:`);
      travelLegs.get(move.key).forEach((leg, i) => out.push(`  ${i + 1}. ${leg.text}${leg.kind === "fly" ? ` (lands in ${leg.endZone})` : ""}`));
      out.push("");
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, "TRAVEL.txt"), out.join("\n"));
}
console.log(`Route.lua: ${visitNo} visits for ${plans.length} races, ${totalQuests} quests, ${kb} KB`);
console.log(`outlines: ${outlineFiles + 1} files in .planning/route-outlines`);
