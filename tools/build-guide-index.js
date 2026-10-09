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
const ZONE_KEYS = new Map(Object.keys(ZONE_SIZES).map((k) => [k.toLowerCase(), k]));
// A guide's zone name as a key of Data/ZoneSizes.lua, or "" when it is none (a city district, two zones in one, a typo).
function mapZone(raw) {
  const s = String(raw || "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  if (!s) return "";
  const name = ZONE_ALIAS[s] || ZONE_KEYS.get(s) || "";
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
  for (const w of tag.split(",")) { const r = TG_RACE[w.trim().toLowerCase()]; if (r) out.add(r); }
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
