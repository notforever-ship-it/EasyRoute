// The chain rule, in one place, for the route builder (tools/build-route.js) and the quick checks (tools/test-route.js, tools/test-route-run.js).
// Only constants and pure functions: nothing runs when this file is required, and nothing here reads the AddOns folder.
//
// What a chain is: the quests of one race's route that wait for each other (pfQuest "pre" lists) form groups; the longest line through a
// group is its chain. Its "own part" starts after the last line step that another route quest of the race needs, so a hub quest (one many
// others wait for) never goes with a chain. Only the own part is judged, left out and worded.
//
// The rule (D-06, calibrated in 07-RESEARCH "The worth rule"): a chain of CHAIN_MIN_STEPS or more own steps is worth it when
//   value >= walk x FACTOR[mode]
// both in minutes. value = the xp of the kept steps as minutes of grinding saved (KILLS_PER_MIN kills a minute at the chain's start level),
// plus, when the whole chain is kept and the class can use the best item at the end, BONUS[quality] minutes. walk = the extra walking the
// chain's places add to what the visit walks anyway. "Kept" = the steps before the first one the difficulty leaves out, by the same letters
// table the game uses (Steps.lua S.LEAVE_OUT, read by readLeaveOut), so every leave-out rule cuts chains too.
// The same numbers are in RouteRun.lua; tools/test-route-run.js and tools/test-route.js compare both.

const fs = require("fs");
const xp = require("./xpmodel.js");

// ---- the one constants table -----------------------------------------------------------------------------------
const N = {
  KILLS_PER_MIN: 2,          // kills a minute while grinding at the chain's start level (same-level kills)
  RUN_YPM: 420,              // yards a minute on foot (7 yards a second)
  MOUNT_YPM: 672,            // yards a minute on a slow mount (+60%)
  MOUNT_LEVEL: 40,           // the level a slow mount is bought
  PATH_FACTOR: 1.3,          // straight-line yards to real walking
  SHARE_YARDS: 300,          // a chain place this close to another quest's area or place in the same visit costs nothing extra
  BONUS: { 2: 8, 3: 30, 4: 45 }, // minutes of value for a green, blue, purple item at the end the class can use
  FACTOR: { casual: 1.5, medium: 1.0, hard: 0.5 }, // value must reach walk times this
  HOP_FLIGHT_MIN: 3,         // minutes for a zone hop with a known flight
  HOP_WALK_MIN: 8,           // minutes for a zone hop without one
  OFF_PLAN_MIN: 15,          // minutes for a zone the race's path does not visit then (every chain step is on the path, so these add 0 today; the build stops if a step would leave it)
  CHAIN_MIN_STEPS: 3,        // the rule and the words apply from this many own steps
  WORDS_MIN_VALUE: 10,       // minutes of grinding saved before the line says "worth doing for the xp"
  LOTS_SHARE: 0.5,           // "lots of xp" = at least this share of the start level's xp
  REAL_SHARE: 0.5,           // xp words only when at least this share of the xp is real
  XP_CAP_PER_LEVEL: 120,     // a step's xp is capped at 120 x its level + XP_CAP_BASE (Director.lua's rule)
  XP_CAP_BASE: 300,
  ESTIMATE_PER_LEVEL: 90,    // the guess (xp per quest level) for a quest no source has an xp for
  CHAINS_FILE_MAX_KB: 80,    // Data/Chains.lua must stay under this
  CHAIN_PASSES: 3,           // at most this many passes of dropping chains that are dead on every difficulty
  CASUAL_KEEP_MIN: 0.6,      // Casual must keep at least this share of the judged chains of a race
  CACHE_SECONDS: 2,          // the game keeps a verdict this long
};

// ---- classes, slots, qualities -------------------------------------------------------------------------------------
const CLASS_LETTERS = { WARRIOR: "W", PALADIN: "P", HUNTER: "H", ROGUE: "R", PRIEST: "I", SHAMAN: "S", MAGE: "M", WARLOCK: "L", DRUID: "D" };
// classic-db class ids: 1 warrior, 2 paladin, 3 hunter, 4 rogue, 5 priest, 7 shaman, 8 mage, 9 warlock, 11 druid.
const CLASS_IDS = { 1: "W", 2: "P", 3: "H", 4: "R", 5: "I", 7: "S", 8: "M", 9: "L", 11: "D" };
const ALL_LETTERS = "WPHRISMLD";
const SLOT_WORDS = ["sword", "axe", "mace", "dagger", "staff", "bow", "gun", "crossbow", "wand", "shield", "ring", "necklace", "cloak",
  "chest piece", "leggings", "boots", "gloves", "belt", "helm", "shoulders", "bracers", "trinket", "off-hand", "polearm", "fist weapon"];
const QUALITY_WORDS = ["grey", "white", "green", "blue", "purple"];

// ---- the cached classic-db facts ---------------------------------------------------------------------------------
// tools/data/chain-facts.tsv -> { quests: Map id -> { xp, group, breadcrumb, next, reward: [ids], choice: [ids] },
//                                 items: Map id -> { q, inv, cls, sub, allow, reqLevel, name } }
function readFacts(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error("run node tools/build-chain-facts.js first");
  }
  const quests = new Map(), items = new Map();
  const ids = (s) => (s ? s.split(",").map(Number).filter((n) => n > 0) : []);
  for (const line of text.split("\n")) {
    if (!line || line.charAt(0) === "#") continue;
    const f = line.split("\t");
    if (f[0] === "Q") {
      quests.set(Number(f[1]), { xp: Number(f[2]), group: Number(f[3]), breadcrumb: Number(f[4]), next: Number(f[5]), reward: ids(f[6]), choice: ids(f[7]) });
    } else if (f[0] === "I") {
      items.set(Number(f[1]), { q: Number(f[2]), inv: Number(f[3]), cls: Number(f[4]), sub: Number(f[5]), allow: Number(f[6]), reqLevel: Number(f[7]), name: f[8] || "" });
    }
  }
  if (quests.size === 0) throw new Error("run node tools/build-chain-facts.js first");
  return { quests, items };
}

// ---- the leave-out letters, read from the game's own table --------------------------------------------------------------
// Steps.lua: S.LEAVE_OUT = { casual = "egdsvhm", medium = "egdhm", hard = "d" } -> { casual, medium, hard } (letter strings).
function readLeaveOut(stepsText) {
  const m = /S\.LEAVE_OUT\s*=\s*\{([^}]*)\}/.exec(stepsText);
  if (!m) throw new Error("Steps.lua has no S.LEAVE_OUT table");
  const out = {};
  for (const mode of ["casual", "medium", "hard"]) {
    const e = new RegExp(mode + "\\s*=\\s*\"([^\"]*)\"").exec(m[1]);
    if (!e) throw new Error(`S.LEAVE_OUT has no ${mode} entry`);
    out[mode] = e[1];
  }
  return out;
}
// True when any letter of letters is one the table leaves out on the mode (Steps.lua S.LeftByKinds).
function leftBy(letters, mode, table) {
  const out = table[mode || "casual"];
  if (!out || !letters) return false;
  for (const ch of String(letters)) if (out.indexOf(ch) >= 0) return true;
  return false;
}

// ---- xp ------------------------------------------------------------------------------------------------------------------
// D-01a: classic-db's xp for every quest it has (0 when it gives none); pfExtend's xp for a Turtle-only quest; else 90 x level, estimated.
// Each step's xp is capped at 120 x level + 300. pfx = pfExtend's table: id -> { xp, reward, choice }. Returns { xp, real }.
function stepXp(id, level, facts, pfx) {
  const q = facts.quests.get(id);
  let value, real = true;
  if (q) value = q.xp;
  else if (pfx && pfx[id] && pfx[id].xp) value = pfx[id].xp;
  else { value = N.ESTIMATE_PER_LEVEL * level; real = false; }
  return { xp: Math.min(value, N.XP_CAP_PER_LEVEL * level + N.XP_CAP_BASE), real };
}

// ---- items -------------------------------------------------------------------------------------------------------------
const WEAPON_WORD = { 0: "axe", 1: "axe", 2: "bow", 3: "gun", 4: "mace", 5: "mace", 6: "polearm", 7: "sword", 8: "sword", 10: "staff", 13: "fist weapon", 15: "dagger", 18: "crossbow", 19: "wand" };
const ARMOUR_WORD = { 1: "helm", 2: "necklace", 3: "shoulders", 5: "chest piece", 6: "belt", 7: "leggings", 8: "boots", 9: "bracers", 10: "gloves", 11: "ring", 12: "trinket", 14: "shield", 16: "cloak", 20: "chest piece", 22: "off-hand", 23: "off-hand" };
// item = { inv, cls, sub } (InventoryType, class, subclass). "" for what is not gear (thrown, shirt, tabard, bag, ammo, consumables).
function slotWord(item) {
  if (!item) return "";
  if (item.cls === 2) return WEAPON_WORD[item.sub] || "";
  if (item.cls === 4) return ARMOUR_WORD[item.inv] || "";
  return "";
}

// Weapon skills a class can train (subclass numbers), 1.12.
const WEAPON_SKILLS = {
  W: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18], P: [0, 1, 4, 5, 6, 7, 8], H: [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18],
  R: [2, 3, 4, 7, 13, 15, 16, 18], I: [4, 10, 15, 19], S: [0, 1, 4, 5, 10, 13, 15], M: [7, 10, 15, 19], L: [7, 10, 15, 19], D: [4, 5, 10, 13, 15],
};
// The armour type (armour subclass 1 cloth, 2 leather, 3 mail, 4 plate) a class wears at a level.
function armourType(letter, level) {
  if (letter === "I" || letter === "M" || letter === "L") return 1;
  if (letter === "R" || letter === "D") return 2;
  if (letter === "H" || letter === "S") return level >= N.MOUNT_LEVEL ? 3 : 2;
  return level >= N.MOUNT_LEVEL ? 4 : 3; // warrior, paladin
}
// The class letters (in ALL_LETTERS order) that can use the item as gear at the level the chain ends; "" for nobody or for no slot word.
function classLetters(item, endLevel) {
  if (!item || slotWord(item) === "") return "";
  const ALL_BITS = 1503; // the nine classes: 1 + 2 + 4 + 8 + 16 + 64 + 128 + 256 + 1024
  const allow = item.allow;
  const anyone = !(allow > 0) || (allow & ALL_BITS) === ALL_BITS;
  const out = [];
  for (const cid of Object.keys(CLASS_IDS)) {
    const letter = CLASS_IDS[cid];
    if (!anyone && (allow & (1 << (Number(cid) - 1))) === 0) continue;
    let ok = false;
    if (item.cls === 2) ok = WEAPON_SKILLS[letter].indexOf(item.sub) >= 0;
    else if (item.cls === 4) {
      if ([2, 11, 12, 16].indexOf(item.inv) >= 0) ok = true;
      else if (item.inv === 14 || item.sub === 6) ok = "WPS".indexOf(letter) >= 0;
      else if (item.inv === 23) ok = "PISMLD".indexOf(letter) >= 0;
      else if (item.sub >= 1 && item.sub <= 4) ok = item.sub === armourType(letter, endLevel);
    }
    if (ok) out.push(letter);
  }
  return ALL_LETTERS.split("").filter((l) => out.indexOf(l) >= 0).join("");
}

const itemIdOf = (e) => Array.isArray(e) ? e[0] : (e && typeof e === "object" ? Object.values(e)[0] : e);
const listOf = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);
// The last quest's items. pfExtend's lists when it has the quest with any item, else classic-db's. names = id -> name (pfQuest).
// Returns { items: [{ kind r|c, id, q (null: unknown), slot, letters, name }], differ } where differ is true when pfExtend and classic-db
// both have items for the quest and the lists are not the same (D-03: pfExtend is used).
function endItems(endId, endLevel, facts, pfx, names) {
  const cq = facts.quests.get(endId);
  const px = pfx && pfx[endId];
  const pxR = px ? listOf(px.reward).map(itemIdOf).map(Number).filter((n) => n > 0) : [];
  const pxC = px ? listOf(px.choice).map(itemIdOf).map(Number).filter((n) => n > 0) : [];
  const usePf = pxR.length + pxC.length > 0;
  const r = usePf ? pxR : (cq ? cq.reward : []);
  const c = usePf ? pxC : (cq ? cq.choice : []);
  let differ = false;
  if (usePf && cq && cq.reward.length + cq.choice.length > 0) {
    const key = (a) => a.slice().sort((x, y) => x - y).join(",");
    differ = key(pxR) !== key(cq.reward) || key(pxC) !== key(cq.choice);
  }
  const items = [];
  for (const [kind, ids] of [["r", r], ["c", c]]) {
    for (const id of ids) {
      const it = facts.items.get(id);
      const word = it ? slotWord(it) : "";
      items.push({
        kind, id, q: it ? it.q : null, slot: word, letters: it ? classLetters(it, endLevel) : "",
        name: it && it.name ? it.name : ((names && names[id]) || `item ${id}`),
      });
    }
  }
  return { items, differ };
}

// ---- the lines of one race's route ---------------------------------------------------------------------------------------
// steps = the race's route quests in path order, each { id, l, zone, vi, area {x, y}, obj, hand, carry, letters, pre }.
// opts.children (Map id -> follow-up ids) and opts.tailOk (id -> true for a follow-up that fits the race) give each line its tail: the
// follow-ups of the line's end that are not on the route. Returns the lines (groups of 2 or more) in route order of their first quest:
// { ids, steps, own, ownSteps, groupSize, tail }, own = the index of the first own step (0: the whole line is its own part).
function linesOf(steps, opts) {
  opts = opts || {};
  const at = new Map();
  steps.forEach((s, i) => { if (!at.has(s.id)) at.set(s.id, i); });
  const byId = (id) => steps[at.get(id)];
  const routeParents = (id) => (byId(id).pre || []).filter((p) => at.has(p) && at.get(p) < at.get(id));
  const parent = new Map();
  const find = (a) => { while (parent.get(a) !== a) a = parent.get(a); return a; };
  for (const id of at.keys()) parent.set(id, id);
  for (const id of at.keys()) for (const p of routeParents(id)) parent.set(find(id), find(p));
  const groups = new Map();
  for (const id of at.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  const lines = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.sort((a, b) => at.get(a) - at.get(b));
    const best = new Map(), from = new Map();
    for (const id of ids) {
      let b = 1, f = null;
      for (const p of routeParents(id)) if (best.get(p) + 1 > b) { b = best.get(p) + 1; f = p; }
      best.set(id, b);
      from.set(id, f);
    }
    let end = ids[0];
    for (const id of ids) if (best.get(id) > best.get(end) || (best.get(id) === best.get(end) && at.get(id) > at.get(end))) end = id;
    const line = [];
    for (let c = end; c != null; c = from.get(c)) line.unshift(c);
    const inLine = new Set(line);
    let own = 0;
    line.forEach((id, i) => {
      if (steps.some((s) => !inLine.has(s.id) && (s.pre || []).indexOf(id) >= 0)) own = i + 1;
    });
    const tail = [];
    if (opts.children) {
      const walk = (id, depth) => {
        if (depth > 12) return;
        for (const c of opts.children.get(id) || []) {
          if (at.has(c) || (opts.tailOk && !opts.tailOk(c)) || tail.indexOf(c) >= 0) continue;
          tail.push(c);
          walk(c, depth + 1);
        }
      };
      walk(end, 0);
    }
    const lineSteps = line.map(byId);
    lines.push({ ids: line, steps: lineSteps, own, ownSteps: lineSteps.slice(own), groupSize: ids.length, tail });
  }
  lines.sort((a, b) => at.get(a.ids[0]) - at.get(b.ids[0]));
  return lines;
}

// ---- the extra walking ---------------------------------------------------------------------------------------------------------
// The minutes of extra walking each own step adds. A step's places are its work place (obj, same zone) and its hand-in place (same zone,
// not carried on). A place costs nothing when it is within SHARE_YARDS of the area or the work place of another route quest of the same
// visit that is not on this line, or of a place this chain already counted; else it costs the way there and back from the step's area.
// allSteps = the race's route steps; yards(zone, x1, y1, x2, y2) = map yards; L = the chain's start level (a mount from MOUNT_LEVEL).
function walkMinutes(ownSteps, lineIds, allSteps, yards, L) {
  const inLine = new Set(lineIds);
  const counted = [];
  const speed = L >= N.MOUNT_LEVEL ? N.MOUNT_YPM : N.RUN_YPM;
  return ownSteps.map((s) => {
    const places = [];
    if (s.obj && !s.obj.zone) places.push(s.obj);
    if (s.hand && !s.hand.zone && !s.carry) places.push(s.hand);
    let yd = 0;
    for (const p of places) {
      const shared = allSteps.some((o) => o.vi === s.vi && !inLine.has(o.id) &&
        ((o.area && yards(s.zone, o.area.x, o.area.y, p.x, p.y) < N.SHARE_YARDS) ||
         (o.obj && !o.obj.zone && yards(s.zone, o.obj.x, o.obj.y, p.x, p.y) < N.SHARE_YARDS)));
      const dup = counted.some((q) => q.zone === s.zone && yards(s.zone, q.x, q.y, p.x, p.y) < N.SHARE_YARDS);
      if (shared || dup) continue;
      counted.push({ zone: s.zone, x: p.x, y: p.y });
      if (s.area) yd += 2 * yards(s.zone, s.area.x, s.area.y, p.x, p.y);
    }
    return yd * N.PATH_FACTOR / speed;
  });
}

// ---- the verdict ---------------------------------------------------------------------------------------------------------------
// chain = { l, h, steps: [{ id, xp, real, v, w }], items: [...] } (parseChain gives it); leftAt(index) is true when the mode leaves the
// step out. letter = the class letter ("": no class bonus). The kept part is the steps before the first one left out.
function judge(chain, mode, letter, leftAt) {
  let kept = 0;
  while (kept < chain.steps.length && !leftAt(kept)) kept++;
  let value = 0, walk = 0, keptXp = 0, realXp = 0;
  for (let i = 0; i < kept; i++) {
    const s = chain.steps[i];
    value += s.v;
    walk += s.w;
    keptXp += s.xp;
    if (s.real) realXp += s.xp;
  }
  let best = 0;
  if (kept === chain.steps.length && letter) {
    for (const it of chain.items) {
      if (it.q != null && it.q >= 2 && it.slot !== "" && it.letters.indexOf(letter) >= 0 && it.q > best) best = it.q;
    }
    if (best >= 2) value += N.BONUS[best];
  }
  const worth = kept < N.CHAIN_MIN_STEPS || value >= walk * N.FACTOR[mode];
  return { worth, kept, value, walk, keptXp, realXp, best };
}

// A Data/Chains.lua entry ({ l, h, z, s, e } as the Lua VM gives it) in the shape RouteReader.ReadChain gives in the game.
function parseChain(entry) {
  const out = { l: Number(entry.l), h: Number(entry.h), z: entry.z || "", steps: [], items: [] };
  for (const line of String(entry.s || "").split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    out.steps.push({ id: Number(f[0]), xp: Number(f[1]), real: f[2] === "r", v: Number(f[3]), w: Number(f[4]) });
  }
  for (const line of String(entry.e || "").split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    out.items.push({ kind: f[0], id: Number(f[1]), q: f[2] === "?" ? null : Number(f[2]), slot: f[3] || "", letters: f[4] || "", name: f[5] || "" });
  }
  return out;
}

module.exports = {
  N, CLASS_LETTERS, CLASS_IDS, ALL_LETTERS, SLOT_WORDS, QUALITY_WORDS,
  readFacts, readLeaveOut, leftBy, stepXp, slotWord, classLetters, endItems, linesOf, walkMinutes, judge, parseChain,
  killXP: xp.killXP, XP_TABLE: xp.XP_TABLE,
};
