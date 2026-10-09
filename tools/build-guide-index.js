// Builds tools/data/guide-index.tsv: the quest facts of two more leveling guides, so the route builder can let them count
// next to RestedXP. The guides are the owner's uploads, unpacked by hand into a scratch folder (never into this repo):
//   TourGuideVanilla   (cralor, Tekkub, Road-block, rsheep; Joana's and Brian Kopp's route files)
//   VanillaGuide       (mrmr, lanjelin; the English tables, also by Joana and Brian Kopp)
// Only facts are kept: which guide, which faction, the quest id, the order the guide does it in, the zone where the guide
// picks it up, the races it is for and what the guide does with it (A accept, C complete, T turn in, S skip). No guide text
// is copied. The archive files are read as plain text with regular expressions and are never run.
// Usage: node tools/build-guide-index.js <TourGuideVanilla folder> [VanillaGuide folder]
//   (the second folder is the one that holds en/GuideTables; without it only TourGuide rows are written)

const fs = require("fs");
const path = require("path");
const { newLuaVM } = require("./lib/pfdb.js");

const REPO = path.resolve(__dirname, "..");
const OUT_FILE = path.join(REPO, "tools", "data", "guide-index.tsv");
const TG_DIR = process.argv[2];
const VG_DIR = process.argv[3];
const FACTIONS = ["Alliance", "Horde"];

function usage(msg) {
  console.error((msg ? msg + "\n" : "") + "Usage: node tools/build-guide-index.js <TourGuideVanilla folder> [VanillaGuide folder]");
  process.exit(1);
}
if (!TG_DIR) usage();

// ---- what the repo already knows (trusted files of this repo) --------------------------------------------------
const vm = newLuaVM();
vm.run(fs.readFileSync(path.join(REPO, "Data", "ZoneSizes.lua")), "Data/ZoneSizes.lua");
vm.run(fs.readFileSync(path.join(REPO, "Data", "Zones.lua")), "Data/Zones.lua");
vm.run("ER_FLAT = {} for _, z in pairs(EasyRoute_Zones) do for _, q in ipairs(z.q) do ER_FLAT[table.getn(ER_FLAT) + 1] = " +
  "{ id = q.id, n = q.n, l = q.l, m = q.m, r = q.r or 0, c = q.c or 0, p = q.p or 0, z = z.name } end end", "flat");
const ZONE_SIZES = vm.get("EasyRoute_ZoneSizes");
const ROWS = vm.get("ER_FLAT").sort((a, b) => a.id - b.id);
const KNOWN = new Set(ROWS.map((r) => r.id));
const ROW_BY_ID = new Map(ROWS.map((r) => [r.id, r]));

// Race words, as the route builder spells them, and the race mask bits of the two factions.
const START_RACES = {
  "Elwynn Forest": ["Human"], "Dun Morogh": ["Dwarf", "Gnome"], "Teldrassil": ["NightElf"],
  "Durotar": ["Orc", "Troll"], "Mulgore": ["Tauren"], "Tirisfal Glades": ["Undead"],
};
const FACTION_BITS = { Alliance: 1 | 4 | 8 | 64, Horde: 2 | 16 | 32 | 128 };

// Zone names the guides write differently from the map zone names of Data/ZoneSizes.lua (matched without case).
const ZONE_ALIAS = {
  "stranglethorn": "Stranglethorn Vale", "stranglethron vale": "Stranglethorn Vale",
  "tirisfal": "Tirisfal Glades", "deathknell": "Tirisfal Glades", "deathknell (tirisfal glades)": "Tirisfal Glades",
  "un'goro": "Un'Goro Crater", "un'goro crater": "Un'Goro Crater",
  "hinterlands": "The Hinterlands", "barrens": "The Barrens", "southern barrens": "The Barrens",
  "barrens (part 1)": "The Barrens", "barrens (part 2)": "The Barrens",
  "stormwind": "Stormwind City", "iron forge": "Ironforge", "darnassus": "Darnassus", "orgrimma": "Orgrimmar",
  "burning steps": "Burning Steppes", "felalas": "Feralas", "duskwallow marsh": "Dustwallow Marsh",
  "swamp of sorrow": "Swamp of Sorrows", "moodglade": "Moonglade",
  "cold ridge valley": "Dun Morogh", "lakeshire": "Redridge Mountains",
  "tn (shimmering flats)": "Thousand Needles", "thousand needles (shimmering flats)": "Thousand Needles",
  "uldaman": "Badlands",
};
// The tables above are looked up with text out of the guide archives, which are not trusted: a name such as "constructor" or
// "__proto__" must find nothing, not a function from Object.prototype.
const own = (table, key) => Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
const ZONE_KEYS = new Map(Object.keys(ZONE_SIZES).map((k) => [k.toLowerCase(), k]));
// A guide's zone name as a key of Data/ZoneSizes.lua, or "" when it is none (a city district, two zones in one, a typo).
function mapZone(raw) {
  const s = String(raw || "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  if (!s) return "";
  const name = own(ZONE_ALIAS, s) || ZONE_KEYS.get(s) || "";
  return ZONE_KEYS.get(name.toLowerCase()) || "";
}

// ---- the rows ----------------------------------------------------------------------------------------------
// One row per (guide, faction, id). The first mention sets the position; the first accept mention with a zone sets the zone;
// races are the union (everyone wins); verbs are the set of what the guide does.
const rowsOut = [];
function newCollector(guide, faction) {
  const byId = new Map();
  let position = 0;
  return {
    add(id, verb, zone, races) {
      position++;
      let r = byId.get(id);
      if (!r) {
        r = { guide, faction, id, position, zone: "", races: new Set(), verbs: new Set() };
        byId.set(id, r);
      }
      r.verbs.add(verb);
      if (verb === "A" && !r.zone && zone) r.zone = zone;
      for (const w of races) r.races.add(w);
    },
    finish() {
      for (const r of byId.values()) {
        const races = r.races.has("*") ? "*" : [...r.races].sort().join(",");
        rowsOut.push({ guide: r.guide, faction: r.faction, id: r.id, position: r.position, zone: r.zone, races, verbs: "ACTS".split("").filter((v) => r.verbs.has(v)).join("") });
      }
      return byId.size;
    },
  };
}

// ---- TourGuide ---------------------------------------------------------------------------------------------
// |R| words to race words. A tag that names no known race counts as "everyone".
const TG_RACE = { human: "Human", dwarf: "Dwarf", gnome: "Gnome", "night elf": "NightElf", nightelf: "NightElf", orc: "Orc", troll: "Troll", tauren: "Tauren", scourge: "Undead", undead: "Undead" };
function tgTag(line, name) {
  const m = line.match(new RegExp("\\|" + name + "\\|([^|]*)\\|"));
  return m ? m[1].trim() : null;
}
function tgRaces(tag) {
  if (!tag) return null;
  const out = new Set();
  for (const w of tag.split(",")) { const r = own(TG_RACE, w.trim().toLowerCase()); if (r) out.add(r); }
  return out.size ? [...out] : null;
}
let tgNoZone = 0;
function readTourGuide() {
  const counts = {};
  for (const faction of FACTIONS) {
    const dir = path.join(TG_DIR, "TourGuide_" + faction);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".lua")).sort(); } catch (e) { files = []; }
    if (files.length < 40) usage(`TourGuide_${faction} is missing or holds fewer than 40 .lua files`);
    const col = newCollector("TG", faction);
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const head = text.match(/RegisterGuide\(\s*"([^"]+)"/);
      if (!head) continue;
      const guideZone = mapZone(head[1].replace(/\s*\(\d+-\d+\)\s*$/, ""));
      const startRaces = /^01_12_/.test(f) ? (START_RACES[guideZone] || null) : null;
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        const m = line.match(/^([ACT])\s/);
        if (!m || !/\|QID\|\d+\|/.test(line)) continue;
        if (tgTag(line, "C")) continue;
        const id = parseInt(tgTag(line, "QID"), 10);
        if (!id) continue;
        let zone = "";
        if (m[1] === "A") {
          const z = tgTag(line, "Z");
          zone = mapZone(z || head[1].replace(/\s*\(\d+-\d+\)\s*$/, ""));
          if (!zone) tgNoZone++;
        }
        col.add(id, m[1], zone, tgRaces(tgTag(line, "R")) || startRaces || ["*"]);
      }
    }
    counts[faction] = col.finish();
  }
  console.log(`TourGuide: ${counts.Alliance} Alliance quests, ${counts.Horde} Horde quests, ${tgNoZone} pick-up zones not on the map left empty`);
}
readTourGuide();

// ---- VanillaGuide ------------------------------------------------------------------------------------------
// A step is  [n] = { str = "<text>", x = .., y = .., zone = ".." }  inside a section  title = "<lo>-<hi> <place>".  Quest names sit in
// the text as #GET<name># (accept), #DO<name># (do), #IN<name># (turn in) and #SKIP<name># (the guide skips it). Names are matched
// to the quest titles of Data/Zones.lua that fit the faction.
// Names the guide spells in a way no title matches (a typo): the cleaned name, lower case, to the exact title in Data/Zones.lua.
const VG_TITLE_FIX = {
  "master's glaive": "The Master's Glaive",                       // the guide leaves out "The"
  "the prodical lich": "The Prodigal Lich",                       // typo
  "retrun to witch doctor uzer'i": "Return to Witch Doctor Uzer'i", // typo
  "retrun to witch doctor uzer": "Return to Witch Doctor Uzer'i", // typo, name cut short
  "a threath in feralas": "A Threat in Feralas",                  // typo
  "the stones that binds us": "The Stones That Bind Us",          // typo
  "break a few egg": "Break a Few Eggs",                          // typo
  "enroaching wildlife": "Encroaching Wildlife",                  // typo
  "assessing the thread": "Assessing the Threat",                 // typo
  "reclaimers' business": "Reclaimers' Business in Desolace",     // name cut short
  "fiery blaze enchantment": "Fiery Blaze Enchantments",          // typo
  "find oox-22/fe!": "Rescue OOX-22/FE!",                         // the guide says Find, the quest is Rescue
  "find oox-09/hl": "Rescue OOX-09/HL!",                          // same, without the !
  "find oox-09/hl!": "Rescue OOX-09/HL!",                         // same
  "find oox-17/tn!": "Rescue OOX-17/TN!",                         // same
  "queatthe ruins of stardust": "The Ruins of Stardust",          // QUEAT typed in front
  "queatkobold candles": "Kobold Candles",                        // QUEAT typed in front
  "twisted hatred at dolanaar": "Twisted Hatred",                 // place added to the name
  "oakenscowl elite": "Oakenscowl",                               // "elite" added to the name
  "glowing fruit": "The Glowing Fruit",                           // the guide leaves out "The"
  "skeletal fragments bones": "Skeletal Fragments",               // word added to the name
  "zanzil's mixture": "Zanzil's Mixture and a Fool's Stout",      // one quest, written as two names
  "a fool's stout": "Zanzil's Mixture and a Fool's Stout",        // same quest
  "spirits of stonetalon": "The Spirits of Stonetalon",           // the guide leaves out "The"
};
const VG_VERB = { GET: "A", DO: "C", IN: "T", SKIP: "S" };
const alnum = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// A name from the guide, cleaned: curly quotes and the ellipsis character made plain, spaces collapsed, and a trailing
// "pt.N" or "part N" (the N-th part of a chain, given as part), "(escort)" or "(complete)" taken off.
function vgClean(raw) {
  let s = raw.replace(/[‘’‛′]/g, "'").replace(/[“”]/g, "\"").replace(/…/g, "...").replace(/\s+/g, " ").trim();
  let part = 0;
  for (let again = true; again;) {
    again = false;
    let m = s.match(/\s*\((?:escort|complete)\)\s*$/i);
    if (m) { s = s.slice(0, m.index).trim(); again = true; continue; }
    m = s.match(/\s*\b(?:pt|part)\.?\s*(\d+)\.?\s*$/i);
    if (m) { part = Number(m[1]); s = s.slice(0, m.index).trim(); again = true; }
  }
  return { name: s, part };
}
// The quest titles of one faction: a quest for the faction's races (or all), no class quest.
function titleTables(faction) {
  const bits = FACTION_BITS[faction];
  const byTitle = new Map(), byKey = new Map();
  const put = (map, key, row) => { if (!map.has(key)) map.set(key, []); map.get(key).push(row); };
  for (const r of ROWS) {
    if (r.c || !(r.r === 0 || r.r === 255 || (r.r & bits))) continue;
    const title = vgClean(r.n).name;
    put(byTitle, r.n.toLowerCase(), r);
    put(byKey, alnum(r.n), r);
    if (title.toLowerCase() !== r.n.toLowerCase()) put(byTitle, title.toLowerCase(), r);
  }
  return { byTitle, byKey };
}
// Which quest a name means. Several quests can share a title: "pt.N" takes the N-th along the chain (the quests that follow
// another candidate through p come later; else level, then id); otherwise the one whose zone is the step's zone, then the one
// whose level is nearest the middle of the section's levels, then the lowest id.
function vgPick(cands, part, zone, mid) {
  if (cands.length === 1) return cands[0];
  const set = new Set(cands.map((c) => c.id));
  const depth = (c, n) => (n < 20 && set.has(c.p) && c.p !== c.id ? 1 + depth(ROW_BY_ID.get(c.p), n + 1) : 0);
  const chain = cands.slice().sort((a, b) => depth(a, 0) - depth(b, 0) || a.l - b.l || a.id - b.id);
  if (part > 0) return chain[Math.min(part, chain.length) - 1];
  let pool = cands.filter((c) => zone && c.z === zone);
  if (!pool.length) pool = cands;
  return pool.slice().sort((a, b) => Math.abs(a.l - mid) - Math.abs(b.l - mid) || a.id - b.id)[0];
}
function readVanillaGuide() {
  const base = path.join(VG_DIR, "en", "GuideTables");
  const result = {};
  for (const faction of FACTIONS) {
    const dir = path.join(base, faction);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".lua")).sort(); } catch (e) { files = []; }
    if (files.length < 6) usage(`VanillaGuide: en/GuideTables/${faction} is missing or holds fewer than 6 .lua files`);
    const { byTitle, byKey } = titleTables(faction);
    const col = newCollector("VG", faction);
    const names = new Map();   // cleaned name (lower case) -> the quest id it means, or 0
    for (const f of files) {
      const lines = fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/);
      const start = f.match(/^002_(.+)\.lua$/);
      const startZone = start ? mapZone(start[1].replace(/([a-z])([A-Z])/g, "$1 $2")) : "";
      const startRaces = startZone ? (START_RACES[startZone] || null) : null;
      let place = "", mid = 30, last = "";
      for (const raw of lines) {
        const line = raw.trim();
        if (line.slice(0, 2) === "--") continue;
        const t = line.match(/\btitle\s*=\s*"([^"]*)"/);
        if (t) {
          const m = t[1].match(/^(\d+)-(\d+)\s+(.*)$/);
          place = mapZone(m ? m[3] : t[1]);
          mid = m ? (Number(m[1]) + Number(m[2])) / 2 : 30;
          last = "";
          continue;
        }
        const step = line.match(/\[\d+\]\s*=\s*\{\s*str\s*=\s*"((?:[^"\\]|\\.)*)"([^}]*)\}/);
        if (!step) continue;
        const z = step[2].match(/\bzone\s*=\s*"([^"]*)"/);
        const stepZone = z ? mapZone(z[1]) : "";
        if (stepZone) last = stepZone;
        const zone = stepZone || place || last;
        for (const tok of step[1].matchAll(/#(GET|DO|IN|SKIP)([^#]*)#/g)) {
          const { name, part } = vgClean(tok[2]);
          if (!name) continue;
          const fix = own(VG_TITLE_FIX, name.toLowerCase());
          const key = (fix || name).toLowerCase();
          const cands = byTitle.get(key) || byKey.get(alnum(fix || name));
          if (!names.has(key)) names.set(key, { name, id: 0 });
          if (!cands) continue;
          const pick = vgPick(cands, part, stepZone || place, mid);
          names.get(key).id = pick.id;
          col.add(pick.id, VG_VERB[tok[1]], VG_VERB[tok[1]] === "A" ? zone : "", startRaces || ["*"]);
        }
      }
    }
    const all = [...names.values()];
    const found = all.filter((n) => n.id).length;
    const missing = all.filter((n) => !n.id).map((n) => n.name);
    const percent = all.length ? Math.round(found / all.length * 1000) / 10 : 0;
    const shown = process.env.ER_GI_LIST_ALL ? missing : missing.slice(0, 15);
    console.log(`VanillaGuide: ${faction}: ${all.length} names, ${found} found (${percent}%), not found: ${shown.join("; ")}`);
    if (percent < 90) usage(`VanillaGuide: only ${percent}% of the ${faction} quest names were found (at least 90% expected)`);
    result[faction] = col.finish();
  }
  console.log(`VanillaGuide: ${result.Alliance} Alliance quests, ${result.Horde} Horde quests`);
}
if (VG_DIR) readVanillaGuide();

// ---- write -------------------------------------------------------------------------------------------------
const ORDER = { TG: 0, VG: 1 };
rowsOut.sort((a, b) => ORDER[a.guide] - ORDER[b.guide] || FACTIONS.indexOf(a.faction) - FACTIONS.indexOf(b.faction) || a.position - b.position || a.id - b.id);
const out = [
  "# Generated by tools/build-guide-index.js from TourGuideVanilla (cralor, Tekkub, Road-block, rsheep) and VanillaGuide (mrmr, lanjelin; Joana/Mancow's and Brian Kopp's guides). Facts only. Do not edit by hand.",
  "# guide (TG TourGuide, VG VanillaGuide) <TAB> faction <TAB> quest id <TAB> position in the guide <TAB> zone it is picked up in (empty: unknown) <TAB> races (* all, or a comma list) <TAB> what the guide does (A accept, C complete, T turn in, S skip)",
];
for (const r of rowsOut) out.push([r.guide, r.faction, r.id, r.position, r.zone, r.races, r.verbs].join("\t"));
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, out.join("\n") + "\n");
console.log(`guide-index.tsv: ${rowsOut.length} rows, ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);
