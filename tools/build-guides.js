// Builds Data/Guides.lua from RestedXP's classic leveling guides (RXPGuides, CC BY-NC-SA 4.0, credit: RestedXP)
// and Data/ZoneSizes.lua from the game's own map table (WorldMapArea.dbc in the game's Data folder) or, without it,
// pfQuest's map sizes.
//   Data/Guides.lua:    every Alliance and Horde leveling guide for the classic game, 1-60, as Easy Route steps
//                       (one string per guide, read only when you pick that guide), plus the quest titles they use
//   Data/ZoneSizes.lua: how big each zone's map is in yards and where it lies on its continent, so the arrow can
//                       say how far away something is and point at a place in another zone
//   Data/Survival.lua:  RestedXP's Survival Guide (the safe way through the same quests): which quests the safe route skips or
//                       abandons, its danger warnings (a few words each), the quests it does only in a group or a dungeon, the
//                       quests whose text names a cave, and each zone's cave sub-zones from the game's AreaTable.dbc
//
// The game only has to read the result. Everything that depends on the game version (classic, not TBC or Season of
// Discovery), the server type (normal, not hardcore) and the experience rate (1x) is decided here; what depends on
// the character (race, class, faction, level) is kept as a condition the addon checks in the game.
//
// Needs the Lua VM "fengari" (npm install, in this tools folder) to read pfQuest's Lua data files.
// Usage: node tools/build-guides.js [--survival-only] <RXPGuides folder> <folder holding pfQuest and pfQuest-turtle> [game Data folder]
//   --survival-only  writes only Data/Survival.lua (Data/Guides.lua and Data/ZoneSizes.lua stay as they are); for an RXPGuides
//                    copy that differs from the one Data/Guides.lua was built from

const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const { ReadGameFile, ReadDBC } = require("./read-mpq.js");
const { newLuaVM } = require("./lib/pfdb.js");
const words = require("./lib/danger-words.js");

const SURVIVAL_ONLY = process.argv.slice(2).indexOf("--survival-only") >= 0;
const ARGV = process.argv.slice(2).filter((a) => a !== "--survival-only");
const RXP = ARGV[0];
const PF = ARGV[1];
const GAME = ARGV[2];
if (!RXP || !fs.existsSync(path.join(RXP, "Guides")) || !PF || !fs.existsSync(path.join(PF, "pfQuest", "db", "quests.lua"))) {
  console.error("Usage: node tools/build-guides.js [--survival-only] <RXPGuides folder> <folder holding pfQuest and pfQuest-turtle> [game Data folder]");
  process.exit(1);
}
const OUT = path.resolve(__dirname, "..", "Data");

// ---- pfQuest: quest titles, zone names and map sizes -----------------------------------------------------

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
function run(code, name) {
  const buf = typeof code === "string" ? to_luastring(code) : code;
  if (lauxlib.luaL_loadbuffer(L, buf, buf.length, to_luastring(name)) !== 0 || lua.lua_pcall(L, 0, 1, 0) !== 0) {
    throw new Error(name + ": " + to_jsstring(lua.lua_tostring(L, -1)));
  }
  const out = lua.lua_isstring(L, -1) ? to_jsstring(lua.lua_tostring(L, -1)) : null;
  lua.lua_pop(L, 1);
  return out;
}
run("pfDB = setmetatable({}, {__index = function(t, k) local v = {} rawset(t, k, v) return v end})", "init");
for (const f of ["pfQuest/db/enUS/quests.lua", "pfQuest-turtle/db/enUS/quests-turtle.lua", "pfQuest/db/enUS/zones.lua",
  "pfQuest-turtle/db/enUS/zones-turtle.lua", "pfQuest/db/minimap.lua", "pfQuest-turtle/db/minimap-turtle.lua"]) {
  const p = path.join(PF, f);
  if (fs.existsSync(p)) run(fs.readFileSync(p), f);
  else console.warn("missing (skipped): " + f);
}
const pf = JSON.parse(run(`
local function str(s) return '"' .. s:gsub('\\\\', '\\\\\\\\'):gsub('"', '\\\\"'):gsub('[%c]', ' ') .. '"' end
local parts = {}
-- Quest titles, and the quests Turtle WoW took out ("_").
local titles, removed = {}, {}
for id, v in pairs(pfDB["quests"]["enUS"]) do
  if type(v) == "table" and v.T then titles[#titles + 1] = '"' .. id .. '":' .. str(v.T) end
end
for id, v in pairs(rawget(pfDB["quests"], "enUS-turtle") or {}) do
  if v == "_" then removed[#removed + 1] = '"' .. id .. '":1'
  elseif type(v) == "table" and v.T then titles[#titles + 1] = '"' .. id .. '":' .. str(v.T) end
end
local names = {}
for id, v in pairs(pfDB["zones"]["enUS"]) do if type(v) == "string" then names[#names + 1] = '"' .. id .. '":' .. str(v) end end
for id, v in pairs(rawget(pfDB["zones"], "enUS-turtle") or {}) do if type(v) == "string" and v ~= "_" then names[#names + 1] = '"' .. id .. '":' .. str(v) end end
local sizes = {}
local function addSizes(t) for id, v in pairs(t or {}) do if type(v) == "table" and v[1] and v[1] > 0 then sizes[#sizes + 1] = '"' .. id .. '":[' .. v[1] .. ',' .. v[2] .. ']' end end end
addSizes(rawget(pfDB, "minimap"))
addSizes(rawget(pfDB, "minimap-turtle"))
return '{"titles":{' .. table.concat(titles, ",") .. '},"removed":{' .. table.concat(removed, ",") .. '},"zones":{' ..
  table.concat(names, ",") .. '},"sizes":{' .. table.concat(sizes, ",") .. '}}'
`, "export"));

// Later entries win, so Turtle's map sizes replace the original ones.
const zoneSizes = {};
for (const [id, size] of Object.entries(pf.sizes)) {
  const name = pf.zones[id];
  if (name) zoneSizes[name] = size;
}

// The game's own map table, when its Data folder is given: each zone's edges in world yards and its continent
// (0 the Eastern Kingdoms, 1 Kalimdor). Turtle WoW's new zones are in it too.
let worldMaps = 0;
if (GAME) {
  const file = ReadGameFile(GAME, "DBFilesClient\\WorldMapArea.dbc");
  if (!file) {
    console.warn("WorldMapArea.dbc not found in " + GAME + ": the arrow will only point inside your own zone");
  } else {
    const dbc = ReadDBC(file.data);
    for (const r of dbc.records) {
      const continent = r.readUInt32LE(4), area = r.readUInt32LE(8);
      const left = r.readFloatLE(16), right = r.readFloatLE(20), top = r.readFloatLE(24), bottom = r.readFloatLE(28);
      const name = pf.zones[area];
      if (!area || !name || (continent !== 0 && continent !== 1)) continue;
      zoneSizes[name] = [+(left - right).toFixed(2), +(top - bottom).toFixed(2), continent, +left.toFixed(2), +top.toFixed(2)];
      worldMaps++;
    }
    console.log("Map table: " + worldMaps + " zones from " + file.from);
  }
}

// ---- zones as RestedXP writes them --------------------------------------------------------------------

// The classic map numbers RestedXP uses in place of zone names (from its DB/classic/db.lua).
const MAP_IDS = {
  1411: "Durotar", 1412: "Mulgore", 1413: "The Barrens", 1414: "Kalimdor", 1415: "Eastern Kingdoms", 1416: "Alterac Mountains",
  1417: "Arathi Highlands", 1418: "Badlands", 1419: "Blasted Lands", 1420: "Tirisfal Glades", 1421: "Silverpine Forest",
  1422: "Western Plaguelands", 1423: "Eastern Plaguelands", 1424: "Hillsbrad Foothills", 1425: "The Hinterlands", 1426: "Dun Morogh",
  1427: "Searing Gorge", 1428: "Burning Steppes", 1429: "Elwynn Forest", 1430: "Deadwind Pass", 1431: "Duskwood", 1432: "Loch Modan",
  1433: "Redridge Mountains", 1434: "Stranglethorn Vale", 1435: "Swamp of Sorrows", 1436: "Westfall", 1437: "Wetlands",
  1438: "Teldrassil", 1439: "Darkshore", 1440: "Ashenvale", 1441: "Thousand Needles", 1442: "Stonetalon Mountains", 1443: "Desolace",
  1444: "Feralas", 1445: "Dustwallow Marsh", 1446: "Tanaris", 1447: "Azshara", 1448: "Felwood", 1449: "Un'Goro Crater",
  1450: "Moonglade", 1451: "Silithus", 1452: "Winterspring", 1453: "Stormwind City", 1454: "Orgrimmar", 1455: "Ironforge",
  1456: "Thunder Bluff", 1457: "Darnassus", 1458: "Undercity", 1459: "Alterac Valley",
};
const ZONE_ALIAS = {
  StormwindClassic: "Stormwind City", Stormwind: "Stormwind City", "Stormwind City": "Stormwind City",
  "Stranglethorn": "Stranglethorn Vale", "Un'goro Crater": "Un'Goro Crater", "Hinterlands": "The Hinterlands",
  "Barrens": "The Barrens", "Tirisfal": "Tirisfal Glades", "Undercity": "Undercity",
};
const unknownZones = {};
function zoneName(z) {
  z = String(z).trim();
  if (/^\d+$/.test(z)) z = MAP_IDS[z] || z;
  z = ZONE_ALIAS[z] || z;
  if (!zoneSizes[z] && !/^(Kalimdor|Eastern Kingdoms)$/.test(z)) unknownZones[z] = (unknownZones[z] || 0) + 1;
  return z;
}

// ---- conditions ("<< Human Warrior", "<< !Hunter", "<< Alliance/Horde", "<< 20") ----------------------------
// Three answers: true, false, or "depends on the character" (kept for the game to decide).

const T = 1, F = 0, U = 2;
const CLASSES = new Set(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "PRIEST", "SHAMAN", "MAGE", "WARLOCK", "DRUID"]);
const RACES = new Set(["Human", "Dwarf", "NightElf", "Gnome", "Orc", "Undead", "Scourge", "Tauren", "Troll", "HighElf", "Goblin"]);
function token(entry) {
  const up = entry.toUpperCase();
  if (up === "CLASSIC") return T;
  if (up === "ENUS") return T;
  if (up === "MALE" || up === "FEMALE") return U;
  if (CLASSES.has(up) || RACES.has(entry) || entry === "Alliance" || entry === "Horde" || /^\d+$/.test(entry)) return U;
  return F;   // tbc, wotlk, sod, som, retail, other languages, and words the game would not know either
}
function evalCond(text) {
  let s = text.replace(/(!?)\(\s*(.*?)\s*\)/g, (m, op, inner) => {
    let v = evalCond(inner);
    if (op === "!") v = v === U ? U : (v === T ? F : T);
    return v === T ? " __T " : v === F ? " __F " : " __U ";
  });
  let any = F;
  for (const part of s.split("/")) {
    let all = T;
    for (let entry of part.match(/!?[\w\d]+/g) || []) {
      let neg = false;
      if (entry[0] === "!") { neg = true; entry = entry.slice(1); }
      let v = entry === "__T" ? T : entry === "__F" ? F : entry === "__U" ? U : token(entry);
      if (neg) v = v === U ? U : (v === T ? F : T);
      if (v === F) { all = F; break; }
      if (v === U) all = U;
    }
    if (all === T) return T;
    if (all === U) any = U;
  }
  return any;
}

// ---- text ----------------------------------------------------------------------------------------------

const COLOURS = { FRIENDLY: "|cff00ff25", ENEMY: "|cffff5722", LOOT: "|cff00bcd4", WARN: "|cfffcdc00", PICK: "|cffdb2eef",
  BUY: "|cff38c040" };
function clean(t) {
  if (!t) return "";
  return t
    .replace(/\|T[^|]*\|t/g, "")                                   // icons the 1.12 client cannot show
    .replace(/\|[cC]RXP_([A-Z]+)_/g, (m, k) => COLOURS[k] || "|cffffffff")
    .replace(/RestedXP 1-60 Speedrun Guide/g, "Fast route 1-60")   // the player never sees the source guide's name
    .replace(/\s*Thank you for using RestedXP\.?/g, "")
    .replace(/\|c(?![0-9a-fA-F]{8})/g, "")                          // anything else that is not a real colour
    .replace(/\\n/g, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
}
function stripColours(t) {
  return t.replace(/\|c[0-9a-fA-F]{8}/g, "").replace(/\|r/g, "");
}

// ---- reading one guide --------------------------------------------------------------------------------

const DROP_ALWAYS = new Set(["flygoto", "bindlocation", "dungeon"]);   // handled below or not for this game
const QUIET = new Set(["target", "mob", "unitscan", "skipgossip", "disablecheckbox", "line", "link", "cooldown", "timer",
  "aura", "itemStat", "engrave", "emote", "money", "destroy", "bankdeposit", "bankwithdraw", "usespell", "cast", "equip",
  "skill", "spell", "reputation", "isQuestAvailable", "daily", "maxskill", "openitem", "beta", "loadguide", "next", "sticky",
  "zoneskipcheck", "hardcore", "softcore", "deathskip", "subzone"]);
const stats = { guides: 0, steps: 0, droppedSteps: 0, unknown: {}, removedQuests: 0 };
const questTitles = {};
const usedQuests = new Set();

function parseArgs(s) {
  return s.replace(/\s*,\s*/g, ",").split(",").filter((x) => x !== "");
}

// Tags that leave a guide or a step out of this game: other seasons, hardcore and self-found play, double-XP
// servers, and phases before the last one (Turtle WoW has all of the content).
function Hides(tag, value) {
  value = value || "";
  if (tag === "season") return !value.split(/[,;\s]+/).includes("0");
  if (tag === "som" || tag === "hardcore" || tag === "hardcoreserver" || tag === "ssf" || tag === "questguide") return true;
  if (tag === "xprate") {
    const x = value.match(/^([<>]?)\s*(\d+\.?\d*)-?(\d*\.?\d*)/);
    if (!x) return false;
    let lo = 1, hi = 0xfff;
    if (x[1] === "<") { lo = 0; hi = parseFloat(x[2]) - 1e-4; }
    else if (x[1] === ">") { lo = parseFloat(x[2]) + 1e-4; }
    else { lo = parseFloat(x[2]); hi = x[3] ? parseFloat(x[3]) : 0xfff; }
    return 1 < lo || 1 > hi;
  }
  if (tag === "phase") {
    const p = value.match(/(\d+)-(\d+)/);
    const lo = p ? +p[1] : +value, hi = p ? +p[2] : 0xffff;
    return !(6 >= lo && 6 <= hi);
  }
  return false;
}

function stepLine(fields) {
  return fields.map((f) => String(f === undefined || f === null ? "" : f).replace(/[\t\n]/g, " ")).join("\t");
}

function readGuide(raw, fileName) {
  const text = raw.replace(/--[^\r\n]*/g, "");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const guide = {};
  let i = 0;
  // Header: everything before the first step.
  for (; i < lines.length && !/^step\b/.test(lines[i]); i++) {
    let line = lines[i];
    let cond = null;
    const m = line.match(/^(.*?)\s*<<\s*(.+)$/);
    if (m) { line = m[1]; cond = m[2]; }
    const v = cond ? evalCond(cond) : T;
    if (line === "") {
      if (v === F) return null;               // the whole guide is for something else
      guide.cond = cond;
      continue;
    }
    if (v === F) continue;
    const t = line.match(/^#(\S+)\s*(.*)$/);
    // A display name for some classes only (the warlock's longer Elwynn guide) would mislabel it for everyone else.
    if (t && t[1] === "displayname" && v === U) continue;
    if (t && guide[t[1]] === undefined) guide[t[1]] = t[2];
  }
  if (guide.classic === undefined || !guide.name || !guide.group) return null;
  for (const tag of ["som", "hardcore", "xprate", "phase", "ssf"]) {
    if (guide[tag] !== undefined && Hides(tag, guide[tag])) return null;
  }
  if (!/^RestedXP (Alliance|Horde) \d+-\d+$/.test(guide.group)) return null;
  if (/\bSoD\b/i.test(guide.name) || /\bSoD\b/i.test(guide.displayname || "")) return null;
  if (guide.season !== undefined && !guide.season.split(/[,;\s]+/).includes("0")) return null;
  if (guide.hardcore !== undefined) return null;
  const faction = guide.group.indexOf("Horde") >= 0 ? "Horde" : "Alliance";
  const title = clean(guide.displayname || guide.name);
  const range = title.match(/^(\d+)-(\d+)/);

  const steps = [];
  let step = null;
  let skip = false;
  function finish() {
    if (!step) return;
    if (step.drop) { stats.droppedSteps++; return; }
    const shows = step.elements.some((e) => e[0] !== "Q" && e[0] !== "W" && e[0] !== "SW" && e[0] !== "L" && e[0] !== "N");
    if (!shows) { stats.droppedSteps++; return; }
    if (step.hadQuest && !step.elements.some((e) => e[0] === "A" || e[0] === "T" || e[0] === "C" || e[0] === "K")) {
      // Every quest in it was taken out of the game (Turtle WoW): the step has nothing left to do.
      stats.droppedSteps++;
      return;
    }
    steps.push(step);
  }
  for (; i < lines.length; i++) {
    const line0 = lines[i];
    if (/^step\b/.test(line0)) {
      finish();
      step = null;
      const m = line0.match(/<<\s*(.+)$/);
      const v = m ? evalCond(m[1]) : T;
      skip = v === F;
      if (!skip) step = { need: v === U ? m[1].trim() : "", not: [], flags: {}, elements: [] };
      continue;
    }
    if (skip || !step) continue;
    let line = line0;
    let cond = "";
    const cm = line.match(/^(.*?)\s*<<\s*(.+)$/);
    if (cm) {
      const v = evalCond(cm[2]);
      if (v === F) continue;
      line = cm[1];
      cond = v === U ? cm[2].trim() : "";
    }
    // Step tags.
    const tm = line.match(/^#(\S+)\s*(.*)$/);
    if (tm) {
      const [, tag, value] = tm;
      // A tag that hides the step: drop it, or (when it only applies to some characters) hide it for them.
      const hide = Hides(tag, value);
      if (hide) {
        if (cond) step.not.push(cond);
        else step.drop = true;
        continue;
      }
      if (["completewith", "sticky", "optional", "label", "requires", "loop", "title"].includes(tag) && step.flags[tag] === undefined) {
        step.flags[tag] = tag === "title" ? clean(value).replace(/[;=]/g, ",") : (value || "1");
      }
      continue;
    }
    // Elements.
    let say = null;
    line = line.replace(/\s*>>\s*(.*)$/, (m, t) => { if (t !== "") say = t; return ""; });
    const em = line.match(/^\.(\S+)\s*(.*)$/);
    const e = (() => {
      if (em) {
        const tag = em[1];
        const a = parseArgs(em[2]);
        const txt = clean(say);
        if (tag === "goto" || tag === "groundgoto" || tag === "waypoint") {
          // "1438/1" is a world position, and a bare number is a dungeon or city part map: neither is on a zone map.
          if (a.length < 3 || /\//.test(a[0]) || (/^\d+$/.test(a[0]) && !MAP_IDS[a[0]])) return txt ? ["I", cond, txt] : null;
          const flag = tag === "waypoint" ? "0" : (a[4] || "");
          return ["G", cond, zoneName(a[0]), +(+a[1]).toFixed(2), +(+a[2]).toFixed(2), a[3] || "", flag, txt];
        }
        // A speedrun trick that is bad advice for a relaxed player: throwing the hearthstone away.
        if (tag === "destroy" && a[0] === "6948") { step.drop = true; return null; }
        if (DROP_ALWAYS.has(tag)) {
          if (tag === "dungeon" && a[0] && a[0][0] !== "!") step.drop = true;   // only for people doing that dungeon
          return null;
        }
        if (tag === "accept" || tag === "turnin" || tag === "complete" || tag === "collect" || tag === "abandon") {
          const qid = tag === "collect" ? +a[2] || 0 : +a[0];
          if (tag !== "collect" || qid) {
            step.hadQuest = true;
            if (pf.removed[qid]) { stats.removedQuests++; return null; }
            usedQuests.add(qid);
          }
          if (tag === "accept" || tag === "turnin") {
            const title = stripColours(txt).replace(/^(Accept|Turn in|Turn-in)\s+/i, "").trim();
            if (!questTitles[qid] && title) questTitles[qid] = title;
            return [tag === "accept" ? "A" : "T", cond, qid, txt];
          }
          if (tag === "complete") return ["C", cond, qid, a[1] || "", txt];
          if (tag === "abandon") return ["R", cond, qid, txt];
          return ["K", cond, +a[0], +a[1] || 1, qid || "", txt];
        }
        if (tag === "xp") {
          const x = (a[0] || "").replace(/\s/g, "").match(/^(<?)(\d+)([+.\-]?\d*)$/);
          if (!x) return null;
          return ["X", cond, x[1], +x[2], x[3] || "", a[1] ? "1" : "", txt];
        }
        if (tag === "maxlevel") {
          const x = (a[0] || "").replace(/\s/g, "").match(/^(\d+)([+.\-]?\d*)$/);
          return x ? ["L", cond, +x[1], x[2] || ""] : null;
        }
        if (tag === "isOnQuest" || tag === "isNotOnQuest" || tag === "isQuestTurnedIn" || tag === "isQuestComplete") {
          const kind = { isOnQuest: "on", isNotOnQuest: "noton", isQuestTurnedIn: "done", isQuestComplete: "comp" }[tag];
          const ids = a.filter((x) => /^\d+$/.test(x));
          return ids.length ? ["Q", cond, kind, ids.join(",")] : null;
        }
        if (tag === "zoneskip") {
          if (!a[0]) return null;
          return ["W", cond, a[0].split(/[+\/]/).map(zoneName).join(","), a[1] || ""];
        }
        if (tag === "subzoneskip") {
          if (!a[0]) return null;
          const names = a[0].split(/[+\/]/).map((id) => pf.zones[id]).filter(Boolean);
          return names.length ? ["SW", cond, names.join(","), a[1] || ""] : null;
        }
        if (tag === "itemcount") {
          const x = (a[1] || "").replace(/\s/g, "").match(/^([<>]?)(=?)(\d+)$/);
          if (!a[0] || !x) return null;
          return ["N", cond, a[0].split(/[^\d]+/).filter(Boolean).join(","), x[1] + x[2], +x[3]];
        }
        if (tag === "hs") return ["H", cond, txt || "Use your Hearthstone"];
        if (tag === "home") return ["B", cond, txt || "Set your Hearthstone here"];
        if (tag === "fp") return ["P", cond, a.join(" "), txt || ("Get the flight path at " + a.join(" "))];
        if (tag === "fly") return ["F", cond, a.join(" "), txt || ("Fly to " + a.join(" "))];
        if (tag === "zone") return a[0] ? ["Z", cond, zoneName(a[0]), txt || ("Go to " + zoneName(a[0]))] : null;
        if (tag === "trainer" || tag === "train" || tag === "vendor") return ["V", cond, tag, txt || (tag === "vendor" ? "Sell your junk" : "Train your spells")];
        if (tag === "use") return ["U", cond, +a[0] || "", txt];
        if (tag === "group") {
          step.flags.group = "1";
          return txt ? ["I", cond, txt] : null;
        }
        if (tag === "solo") {
          step.flags.solo = "1";   // the way round a group quest, for people who skip group quests
          return txt ? ["I", cond, txt] : null;
        }
        if (!QUIET.has(tag)) stats.unknown[tag] = (stats.unknown[tag] || 0) + 1;
        if (tag === "deathskip") return ["M", cond, txt || "Die on purpose and come back at the spirit healer"];
        return txt ? ["I", cond, txt] : null;
      }
      if (line.startsWith("+")) return ["M", cond, clean(line.slice(1))];
      if (line.startsWith("*")) return ["I", cond, clean(line.slice(1))];
      if (say !== null) return ["I", cond, clean(say)];
      return null;
    })();
    if (e) step.elements.push(e);
  }
  finish();
  stats.guides++;
  stats.steps += steps.length;

  const body = steps.map((s) => {
    const flags = Object.entries(s.flags).map(([k, v]) => k + "=" + v).join(";");
    return [stepLine(["S", s.need, s.not.join("|"), flags])].concat(s.elements.map(stepLine)).join("\n");
  }).join("\n");
  return {
    name: guide.name.trim(), title, group: guide.group.trim().replace(/^RestedXP /, ""), faction, lo: range ? +range[1] : 0, hi: range ? +range[2] : 0,
    next: (guide.next || "").replace(/RestedXP (Alliance|Horde) [\d-]+\\/g, "").trim(),
    defaultFor: (guide.defaultfor || "").trim(), cond: guide.cond || "", file: fileName, steps: body, count: steps.length,
  };
}

// ---- all guides ---------------------------------------------------------------------------------------

const dir = path.join(RXP, "Guides");
const files = fs.readdirSync(dir).filter((f) => /^Classic-(Alliance|Horde)-.*\.lua$/.test(f) || f === "Era Custom.lua").sort();
const guides = [];
const seen = new Set();
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  const re = /RegisterGuide\(\s*(?:"[^"]*"\s*,\s*)?\[(=*)\[([\s\S]*?)\]\1\]/g;
  let m;
  while ((m = re.exec(text))) {
    const g = readGuide(m[2], f);
    if (!g || g.count === 0) continue;
    const key = g.group + "\\" + g.name;
    if (seen.has(key)) continue;   // the first copy of a guide wins, as in RestedXP
    seen.add(key);
    guides.push(g);
  }
}
guides.sort((a, b) => (a.faction < b.faction ? -1 : a.faction > b.faction ? 1 : 0) || a.lo - b.lo || a.hi - b.hi);

// Quest titles: pfQuest's (Turtle's where it changed them) first, then the guide's own words.
const titleOut = [];
for (const id of [...usedQuests].sort((a, b) => a - b)) {
  const t = pf.titles[id] || questTitles[id];
  if (t) titleOut.push(`  [${id}] = ${luaString(t)},`);
}

function luaString(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "") + '"';
}

const out = [];
out.push("-- Generated by tools/build-guides.js from RestedXP's classic leveling guides (RXPGuides). Do not edit by hand.");
out.push("-- The routes and their wording are RestedXP's (https://github.com/RestedXP/RXPGuides), used under the Creative");
out.push("-- Commons Attribution-NonCommercial-ShareAlike 4.0 licence; this file is shared under the same licence.");
out.push("-- Each guide's steps are one string, read only when that guide is picked (Steps.lua explains the format).");
out.push("EasyRoute_Guides = {");
for (const g of guides) {
  out.push(`  { name = ${luaString(g.name)}, title = ${luaString(g.title)}, group = ${luaString(g.group)}, faction = "${g.faction}", lo = ${g.lo}, hi = ${g.hi},` +
    ` next = ${luaString(g.next)}, defaultFor = ${luaString(g.defaultFor)}, cond = ${luaString(g.cond)},`);
  out.push(`    steps = ${luaString(g.steps)} },`);
}
out.push("}");
out.push("");
out.push("-- Quest titles by id, for the quests the guides mention (the 1.12 quest log only knows titles).");
out.push("EasyRoute_GuideQuests = {");
out.push(...titleOut);
out.push("}");
if (!SURVIVAL_ONLY) fs.writeFileSync(path.join(OUT, "Guides.lua"), out.join("\n") + "\n");

const sizeOut = ["-- Generated by tools/build-guides.js from the game's map table (WorldMapArea.dbc) and pfQuest's map sizes.",
  "-- Do not edit by hand. Each zone: width and height in yards; and where the game says, c = its continent (0 the",
  "-- Eastern Kingdoms, 1 Kalimdor), l and t = its left and top edge in world yards, so the arrow can point across zones.",
  "EasyRoute_ZoneSizes = {"];
for (const name of Object.keys(zoneSizes).sort()) {
  const [w, h, c, l, t] = zoneSizes[name];
  sizeOut.push(`  [${luaString(name)}] = { ${w}, ${h}` + (c !== undefined ? `, c = ${c}, l = ${l}, t = ${t}` : "") + " },");
}
sizeOut.push("}");
if (!SURVIVAL_ONLY) fs.writeFileSync(path.join(OUT, "ZoneSizes.lua"), sizeOut.join("\n") + "\n");

// ---- RestedXP's Survival Guide -> Data/Survival.lua ------------------------------------------------------
// The safe way through the same quests. Per faction: skip (the safe route drops the quest: "a" it abandons it, "f" its text calls it
// very difficult or fatal), absent (the normal guides do it, the safe route never names it), warn (up to two danger lines),
// group / dungeon (the safe route does it only in a group or a dungeon step), cave (its text names a cave). Per zone: the cave
// sub-zones of the game's area table. The player never sees a guide's name: warnings are shown as Easy Route's own words.

const SURVIVAL_MAX_KB = 150;   // the file must stay smaller than this
const SURV_MIN_WARN = 60;      // warnings each faction must have, or the read does not look right
const SURV_MIN_CAVES = 60;     // cave names in all, for the same reason
const WARN_MAX_CHARS = 160;    // the longest warning line allowed
const WARN_CUT = 140;          // a warning is cut near this many characters
const WARN_LINES = 2;          // warnings kept per quest
const SURV_FACTIONS = ["Alliance", "Horde"];

// Like Hides, except: a hardcore tag keeps the step (this server is normal), softcore and hardcore-server tags hide it.
function HidesSurvival(tag, value) {
  if (tag === "hardcore") return false;
  if (tag === "softcore" || tag === "softcoreserver" || tag === "hardcoreserver") return true;
  return Hides(tag, value);
}
const classOnly = (c) => !!c && /\b(Warrior|Paladin|Hunter|Rogue|Priest|Shaman|Mage|Warlock|Druid)\b/i.test(c);

// Keeps the enemy colour and its end, takes out every other colour code and its end, textures, and any stray "|".
function keepEnemyColour(t) {
  let state = "";
  return String(t).replace(/\|T[^|]*\|t/g, "").replace(/\|c([0-9a-fA-F]{8})|\|r|\|/g, (m, code) => {
    if (code) { state = m.toLowerCase() === COLOURS.ENEMY ? "keep" : "drop"; return state === "keep" ? m : ""; }
    if (m === "|r") { const was = state; state = ""; return was === "keep" ? m : ""; }
    return "";
  }).replace(/\s{2,}/g, " ").trim();
}
// Is a colour still open at the end of this text?
const colourOpen = (t) => { const a = t.lastIndexOf("|c"), b = t.lastIndexOf("|r"); return a >= 0 && a > b; };

// A line cut at a sentence end at or before max characters, or at a word with "..." when there is no sentence end to use.
function cutWarning(t, max) {
  if (t.length > max) {
    const s = t.slice(0, max);
    const end = Math.max(s.lastIndexOf(". "), s.lastIndexOf("! "));
    t = end > 40 ? s.slice(0, end + 1) : s.replace(/\s+\S*$/, "") + "...";
    // Never leave a half colour code at the cut.
    t = t.replace(/\|c[0-9a-fA-F]{0,7}$/, "").replace(/\|$/, "");
  }
  return colourOpen(t) ? t + "|r" : t;
}

// One Survival Guide: its steps with the quests they do, abandon, and their texts. null when the guide is not for this game.
function readSurvivalGuide(raw) {
  const lines = raw.replace(/--[^\r\n]*/g, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const g = {};
  let i = 0;
  for (; i < lines.length && !/^step\b/.test(lines[i]); i++) {
    let line = lines[i], cond = null;
    const cm = line.match(/^(.*?)\s*<<\s*(.+)$/);
    if (cm) { line = cm[1]; cond = cm[2]; }
    const v = cond ? evalCond(cond) : T;
    if (line === "") { if (v === F) return null; continue; }
    if (v === F) continue;
    const t = line.match(/^#(\S+)\s*(.*)$/);
    if (t && g[t[1]] === undefined) g[t[1]] = t[2];
  }
  const head = String(g.group || "").trim().match(/^RestedXP Survival Guide \((A|H)\)$/);
  if (g.classic === undefined || !head) return null;
  for (const tag of ["som", "softcore", "softcoreserver", "hardcoreserver", "xprate", "phase", "ssf", "season"]) {
    if (g[tag] !== undefined && HidesSurvival(tag, g[tag])) return null;
  }
  const steps = [];
  let step = null;
  for (; i < lines.length; i++) {
    const l0 = lines[i];
    if (/^step\b/.test(l0)) {
      if (step) steps.push(step);
      const cm = l0.match(/<<\s*(.+)$/);
      step = (cm ? evalCond(cm[1]) : T) === F ? null : { need: cm ? cm[1] : "", q: [], warn: [], text: [], group: false, dungeon: false, drop: false };
      continue;
    }
    if (!step) continue;
    let line = l0, cond = "";
    const cm = line.match(/^(.*?)\s*<<\s*(.+)$/);
    if (cm) { if (evalCond(cm[2]) === F) continue; line = cm[1]; cond = cm[2]; }
    const tm = line.match(/^#(\S+)\s*(.*)$/);
    if (tm) { if (HidesSurvival(tm[1], tm[2]) && !cond) step.drop = true; continue; }
    let say = null;
    line = line.replace(/\s*>>\s*(.*)$/, (m, t) => { if (t !== "") say = t; return ""; });
    if (say) { step.text.push(say); if (/cRXP_WARN_/.test(say)) step.warn.push(say); }
    if (/^[+*]/.test(line)) { step.text.push(line.slice(1)); if (/cRXP_WARN_/.test(line)) step.warn.push(line.slice(1)); }
    const em = line.match(/^\.(\S+)\s*(.*)$/);
    if (!em) continue;
    const tag = em[1], a = parseArgs(em[2]);
    if (tag === "group") step.group = true;
    if (tag === "dungeon" && a[0] && a[0][0] !== "!") step.dungeon = true;
    if (["accept", "turnin", "complete", "abandon"].indexOf(tag) >= 0 && +a[0] > 0) {
      step.q.push({ tag, id: +a[0], cls: classOnly(cond) || classOnly(step.need) });
    }
  }
  if (step) steps.push(step);
  return { faction: head[1] === "A" ? "Alliance" : "Horde", steps: steps.filter((s) => !s.drop) };
}

const surv = {};
for (const fac of SURV_FACTIONS) {
  surv[fac] = { steps: 0, does: new Set(), group: new Set(), dungeon: new Set(), abandon: new Set(), abandonAll: new Set(),
    turnin: new Set(), text: new Map(), warn: new Map() };
}
{
  const sdir = path.join(RXP, "Guides", "SurvivalGuide");
  if (!fs.existsSync(sdir)) { console.error("No Guides/SurvivalGuide folder in " + RXP); process.exit(1); }
  for (const f of fs.readdirSync(sdir).filter((x) => x.endsWith(".lua")).sort()) {
    const text = fs.readFileSync(path.join(sdir, f), "utf8");
    const re = /RegisterGuide\(\s*(?:"[^"]*"\s*,\s*)?\[(=*)\[([\s\S]*?)\]\1\]/g;
    let m;
    while ((m = re.exec(text))) {
      const g = readSurvivalGuide(m[2]);
      if (!g) continue;
      const S = surv[g.faction];
      for (const s of g.steps) {
        S.steps++;
        for (const q of s.q) {
          if (q.tag === "abandon") {
            S.abandon.add(q.id);
            if (!q.cls) S.abandonAll.add(q.id);
            continue;
          }
          if (q.tag === "turnin" && !s.dungeon && !s.group) S.turnin.add(q.id);
          if (!s.dungeon) S.text.set(q.id, (S.text.get(q.id) || "") + " " + s.text.map((t) => stripColours(clean(t))).join(" "));
          if (s.dungeon) S.dungeon.add(q.id);
          else if (s.group) S.group.add(q.id);
          else S.does.add(q.id);
          for (const w of s.warn) {
            if (!S.warn.has(q.id)) S.warn.set(q.id, []);
            S.warn.get(q.id).push(keepEnemyColour(clean(w.replace(/\|cRXP(?!_)/g, ""))));   // one source line has a broken colour code
          }
        }
      }
    }
  }
}

// The quests the normal guides do, per faction, from Data/Guides.lua as it is on disk now (class-only steps and lines aside).
const normalQuests = {};
{
  const gvm = newLuaVM();
  gvm.run(fs.readFileSync(path.join(OUT, "Guides.lua")), "Guides.lua");
  gvm.run("ER_G = {} for i, g in ipairs(EasyRoute_Guides) do ER_G[i] = { faction = g.faction, steps = g.steps } end", "guides");
  for (const fac of SURV_FACTIONS) normalQuests[fac] = new Set();
  for (const g of gvm.get("ER_G")) {
    let classStep = false;
    for (const line of String(g.steps).split("\n")) {
      const c = line.split("\t");
      if (c[0] === "S") { classStep = classOnly(c[1]); continue; }
      if (classStep || classOnly(c[1])) continue;
      if ((c[0] === "A" || c[0] === "T" || c[0] === "C") && +c[2] > 0) normalQuests[g.faction].add(+c[2]);
    }
  }
}

const survOut = {};
for (const fac of SURV_FACTIONS) {
  const S = surv[fac];
  const o = { skip: new Map(), absent: new Set(), warn: new Map(), group: new Set(), dungeon: new Set(), cave: new Set() };
  for (const id of S.abandonAll) if (!S.turnin.has(id)) o.skip.set(id, "a");
  for (const id of S.does) {
    if (!o.skip.has(id) && words.FATAL.test(S.text.get(id) || "")) o.skip.set(id, "f");
    if (words.caveIn(S.text.get(id) || "")) o.cave.add(id);
  }
  for (const id of S.group) {
    if (!S.does.has(id) && words.caveIn(S.text.get(id) || "")) o.cave.add(id);
  }
  for (const id of normalQuests[fac]) {
    if (!S.does.has(id) && !S.group.has(id) && !S.dungeon.has(id) && !S.abandon.has(id)) o.absent.add(id);
  }
  for (const id of S.group) if (!S.does.has(id)) o.group.add(id);
  for (const id of S.dungeon) if (!S.does.has(id)) o.dungeon.add(id);
  for (const [id, list] of S.warn) {
    const seen = new Set(), keep = [];
    for (const w of list) {
      const plain = stripColours(w);
      if (!words.DANGER.test(plain) || words.PRACTICAL.test(plain) || words.GUIDE_NAMES.test(plain)) continue;
      const c = cutWarning(w, WARN_CUT);
      if (seen.has(c)) continue;
      seen.add(c);
      keep.push(c);
      if (keep.length >= WARN_LINES) break;
    }
    if (keep.length) o.warn.set(id, keep.join("\n"));
  }
  survOut[fac] = o;
}

// The cave sub-zones per zone from the game's area table (AreaTable.dbc: field 0 id, 1 map, 2 parent area, name at byte 44).
const caveZones = {};
{
  const add = (zone, name, word) => {
    const list = caveZones[zone] = caveZones[zone] || new Map();
    if (!list.has(name)) list.set(name, word);
  };
  let file = null;
  if (GAME) file = ReadGameFile(GAME, "DBFilesClient\\AreaTable.dbc");
  if (!file) {
    console.warn("AreaTable.dbc not found" + (GAME ? " in " + GAME : " (no game Data folder given)") + ": the cave list holds only the hand-added names");
  } else {
    const dbc = ReadDBC(file.data);
    const areas = new Map();
    for (const r of dbc.records) areas.set(r.readUInt32LE(0), { map: r.readUInt32LE(4), parent: r.readUInt32LE(8), name: dbc.string(r.readUInt32LE(44)) });
    for (const a of areas.values()) {
      if ((a.map !== 0 && a.map !== 1) || !a.parent || !areas.get(a.parent)) continue;
      const w = words.caveIn(a.name);
      if (w && !words.isCaveNoise(a.name)) add(areas.get(a.parent).name, a.name, words.caveWordFor(w));
    }
  }
  for (const x of words.CAVE_EXTRA) add(x.zone, x.name, "cave");
}

const idList = (map) => [...map.keys()].sort((a, b) => a - b);
function luaIdTable(indent, name, entries) {
  // entries: [[id, luaValue], ...] sorted by id, wrapped at about 110 columns
  if (!entries.length) return [`${indent}${name} = {},`];
  const lines = [`${indent}${name} = {`];
  let cur = indent + "  ";
  for (const [id, v] of entries) {
    const item = `[${id}] = ${v},`;
    if (cur.length + item.length + 1 > 110 && cur.trim() !== "") { lines.push(cur.trimEnd()); cur = indent + "  "; }
    cur += item + " ";
  }
  if (cur.trim() !== "") lines.push(cur.trimEnd());
  lines.push(`${indent}},`);
  return lines;
}
function survivalLua() {
  const o = [];
  o.push("-- Generated by tools/build-guides.js from RestedXP's Survival Guide (RXPGuides), the game's AreaTable.dbc and Easy Route's word lists. Do not edit by hand.");
  o.push("-- RestedXP's words are used under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 licence; this file is shared under the same licence.");
  o.push("-- skip: the safe route drops the quest. a = it abandons it, f = it calls it very difficult or fatal.");
  o.push("-- absent: the normal guides do the quest and the safe route never does.");
  o.push("-- warn: up to two danger lines for the quest, in the colour codes of the step box.");
  o.push("-- group, dungeon: the safe route does the quest only in a group step, or only in a dungeon step.");
  o.push("-- cave: the safe route's text for the quest names a cave.");
  o.push("-- caves: per zone, the cave sub-zones (a line each: name, a tab, mine / crypt / cave).");
  o.push("EasyRoute_Survival = {");
  o.push("  version = 1,");
  for (const fac of SURV_FACTIONS) {
    const x = survOut[fac];
    o.push(`  ${fac} = {`);
    o.push(...luaIdTable("    ", "skip", idList(x.skip).map((id) => [id, luaString(x.skip.get(id))])));
    o.push(...luaIdTable("    ", "absent", idList(x.absent).map((id) => [id, "1"])));
    o.push(...luaIdTable("    ", "group", idList(x.group).map((id) => [id, "1"])));
    o.push(...luaIdTable("    ", "dungeon", idList(x.dungeon).map((id) => [id, "1"])));
    o.push(...luaIdTable("    ", "cave", idList(x.cave).map((id) => [id, "1"])));
    o.push("    warn = {");
    for (const id of idList(x.warn)) o.push(`      [${id}] = ${luaString(x.warn.get(id))},`);
    o.push("    },");
    o.push("  },");
  }
  o.push("  caves = {");
  for (const zone of Object.keys(caveZones).sort()) {
    const list = [...caveZones[zone].keys()].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
    o.push(`    [${luaString(zone)}] = ${luaString(list.map((n) => n + "\t" + caveZones[zone].get(n)).join("\n"))},`);
  }
  o.push("  },");
  o.push("}");
  return o.join("\n") + "\n";
}

// Written beside the target, read back in a fresh sandbox, and only then moved into place.
const SURV_FILE = path.join(OUT, "Survival.lua");
const survText = survivalLua();
fs.writeFileSync(SURV_FILE + ".tmp", survText);
let caveCount = 0;
{
  const failBack = (why) => { try { fs.unlinkSync(SURV_FILE + ".tmp"); } catch (e) { /* nothing to remove */ } console.error("read back FAILED: " + why); process.exit(1); };
  let back;
  try {
    const vm = newLuaVM();
    vm.run(fs.readFileSync(SURV_FILE + ".tmp"), "Survival.lua");
    back = vm.get("EasyRoute_Survival");
  } catch (e) {
    failBack(String(e.message).split("\n")[0]);
  }
  if (!back || typeof back !== "object") failBack("EasyRoute_Survival is not a table");
  for (const fac of SURV_FACTIONS) {
    const t = back[fac];
    if (!t || typeof t !== "object") failBack(fac + " is missing");
    for (const k of ["skip", "warn", "group", "dungeon"]) {
      if (!t[k] || Object.keys(t[k]).length === 0) failBack(`${fac} has no ${k}`);
    }
    const ids = Object.keys(t.warn);
    if (ids.length < SURV_MIN_WARN) failBack(`${fac} has only ${ids.length} warnings (at least ${SURV_MIN_WARN})`);
    for (const id of ids) {
      const lines = String(t.warn[id]).split("\n");
      if (lines.length > WARN_LINES) failBack(`warning ${id} has ${lines.length} lines`);
      for (const line of lines) {
        const plain = stripColours(line);
        if (line.length > WARN_MAX_CHARS) failBack(`warning ${id} is ${line.length} characters long`);
        if (words.PRACTICAL.test(plain)) failBack(`warning ${id} holds a practical word: ${line}`);
        if (words.GUIDE_NAMES.test(line)) failBack(`warning ${id} names a guide: ${line}`);
        if (/\|/.test(line.replace(/\|cffff5722/g, "").replace(/\|r/g, ""))) failBack(`warning ${id} holds a colour code or bar that is not the enemy colour: ${line}`);
      }
    }
  }
  for (const zone of Object.keys(back.caves || {})) caveCount += String(back.caves[zone]).split("\n").length;
  if (caveCount < SURV_MIN_CAVES) failBack(`only ${caveCount} cave names (at least ${SURV_MIN_CAVES})`);
  const kb = Buffer.byteLength(survText) / 1024;
  if (kb >= SURVIVAL_MAX_KB) failBack(`the file is ${kb.toFixed(1)} KB (under ${SURVIVAL_MAX_KB})`);
  fs.renameSync(SURV_FILE + ".tmp", SURV_FILE);
}

const bytes = fs.statSync(path.join(OUT, "Guides.lua")).size;
console.log(`Guides: ${stats.guides} read, ${guides.length} kept, ${stats.steps} steps (${stats.droppedSteps} left out), ` +
  `${titleOut.length} quest titles, ${stats.removedQuests} mentions of quests Turtle removed. Guides.lua: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
for (const fac of ["Alliance", "Horde"]) {
  console.log(fac + ":");
  for (const g of guides.filter((x) => x.faction === fac)) {
    console.log(`  ${g.group} | ${g.title} (${g.lo}-${g.hi}) ${g.count} steps${g.cond ? " << " + g.cond : ""}${g.defaultFor ? " [default " + g.defaultFor + "]" : ""}`);
  }
}
console.log("Zone sizes: " + Object.keys(zoneSizes).length);
if (Object.keys(unknownZones).length) console.log("Zones without a size: " + JSON.stringify(unknownZones));
if (Object.keys(stats.unknown).length) console.log("Unhandled functions (kept as text when they had any): " + JSON.stringify(stats.unknown));
console.log("Survival.lua read back: OK");
for (const fac of SURV_FACTIONS) {
  const x = survOut[fac];
  const kinds = [...x.skip.values()];
  console.log(`Survival ${fac}: ${surv[fac].steps} kept steps, skip a ${kinds.filter((k) => k === "a").length} / f ${kinds.filter((k) => k === "f").length}, ` +
    `absent ${x.absent.size}, warnings ${x.warn.size}, group ${x.group.size}, dungeon ${x.dungeon.size}, cave ${x.cave.size}`);
}
console.log(`Survival caves: ${caveCount} names in ${Object.keys(caveZones).length} zones; Survival.lua ${(Buffer.byteLength(survText) / 1024).toFixed(1)} KB`);
