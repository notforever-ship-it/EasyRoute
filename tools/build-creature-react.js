// Builds tools/data/creature-react.tsv: for every creature of the classic-db creature table, whether a player of each
// faction sees it as yellow (neutral: it will not attack you first), red (hostile) or friendly.
// Sources:
//   CMaNGOS classic-db (GPL-3.0, github.com/cmangos/classic-db): the creature_template table of the Full_DB dump, read as plain text.
//   The game's own DBFilesClient\FactionTemplate.dbc (read from the Data folder's archives with tools/read-mpq.js).
// The reaction is the engine's own rule (CMaNGOS FactionTemplateEntry::IsHostileTo / IsFriendlyTo): the creature's faction template
// against the template of the player's race (Human 1, Dwarf 3, Night Elf 4, Gnome 115 for the Alliance; Orc 2, Undead 5, Tauren 6,
// Troll 116 for the Horde). The four races of a faction have to agree; when they do not the creature is called red.
// Only the derived facts are kept (id, name, levels, creature type, the no-aggro flag, one code per faction). The dump is never run
// and never copied into this repo; it is data, read with a text parser that looks at the creature_template INSERT lines only.
// Usage: node tools/build-creature-react.js <ClassicDB .sql.gz or .sql> [game Data folder]
//   (default game Data folder: E:\Ravencraft\twmoa_1181\Data)

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const REPO = path.resolve(__dirname, "..");
const OUT_FILE = path.join(REPO, "tools", "data", "creature-react.tsv");
const DEFAULT_DATA = "E:\\Ravencraft\\twmoa_1181\\Data";

// The player race templates of FactionTemplate.dbc.
const PLAYER_TEMPLATES = {
  Alliance: [1, 3, 4, 115],
  Horde: [2, 5, 6, 116],
};
// ExtraFlags bit 2: the creature does not attack on sight, whatever its faction says.
const NO_AGGRO_ON_SIGHT = 2;

// ---- the creature_template table, as text -------------------------------------------------------------------
// The column names of the CREATE TABLE of creature_template, in order. Returns null when the table is not in the text.
function readColumns(sql) {
  const m = /CREATE TABLE `creature_template` \(([\s\S]*?)\) ENGINE/.exec(sql);
  if (!m) return null;
  const cols = [];
  for (const line of m[1].split("\n")) {
    const t = line.trim();
    if (t.charAt(0) === "`") cols.push(t.split("`")[1]);
  }
  return cols;
}

const ESCAPES = { n: "\n", r: "\r", t: "\t", "0": "\0", b: "\b", Z: "\x1a" };

// Every tuple of every INSERT INTO `creature_template` statement, as an array of values (numbers, strings, null).
// Nothing is run: the text between the quotes is read character by character.
function readTuples(sql) {
  const tuples = [];
  const marker = "INSERT INTO `creature_template` VALUES ";
  let pos = 0;
  while ((pos = sql.indexOf(marker, pos)) >= 0) {
    pos += marker.length;
    while (sql.charAt(pos) === "(") {
      pos++;
      const vals = [];
      let cur = "", inQuote = false, isStr = false;
      for (;;) {
        if (pos >= sql.length) return tuples;
        const ch = sql.charAt(pos++);
        if (inQuote) {
          if (ch === "\\") {
            const next = sql.charAt(pos++);
            cur += Object.prototype.hasOwnProperty.call(ESCAPES, next) ? ESCAPES[next] : next;
          } else if (ch === "'") {
            if (sql.charAt(pos) === "'") { cur += "'"; pos++; } else inQuote = false;
          } else cur += ch;
        } else if (ch === "'") {
          inQuote = true; isStr = true;
        } else if (ch === "," || ch === ")") {
          const t = cur.trim();
          vals.push(isStr ? cur : (t === "NULL" ? null : (t === "" ? NaN : Number(t))));
          cur = ""; isStr = false;
          if (ch === ")") break;
        } else cur += ch;
      }
      tuples.push(vals);
      if (sql.charAt(pos) === ",") pos++; else break;
    }
  }
  return tuples;
}

// The creatures of the dump: [{ id, name, lo, hi, faction, type, extra }], and how many tuples were skipped.
function parseCreatures(sql) {
  const cols = readColumns(sql);
  if (!cols) throw new Error("the dump has no creature_template table");
  const idx = {};
  for (const c of ["Entry", "Name", "MinLevel", "MaxLevel", "Faction", "CreatureType", "ExtraFlags"]) {
    idx[c] = cols.indexOf(c);
    if (idx[c] < 0) throw new Error(`creature_template has no ${c} column`);
  }
  const out = [];
  let skipped = 0;
  for (const vals of readTuples(sql)) {
    const id = vals[idx.Entry], faction = vals[idx.Faction];
    if (vals.length !== cols.length || !Number.isInteger(id) || !Number.isInteger(faction)) { skipped++; continue; }
    out.push({
      id,
      name: String(vals[idx.Name] == null ? "" : vals[idx.Name]).replace(/[\t\r\n|]+/g, " ").trim(),
      lo: Number(vals[idx.MinLevel]) || 0,
      hi: Number(vals[idx.MaxLevel]) || 0,
      faction,
      type: Number(vals[idx.CreatureType]) || 0,
      extra: Number(vals[idx.ExtraFlags]) || 0,
    });
  }
  return { creatures: out, skipped };
}

// ---- FactionTemplate.dbc and the engine's rule ----------------------------------------------------------------
// 14 uint32 fields: id, faction, flags, ourGroup, friendGroup, enemyGroup, enemies[4], friends[4].
function readTemplates(buf) {
  const { ReadDBC } = require("./read-mpq.js");
  const dbc = ReadDBC(buf);
  if (dbc.fields !== 14) throw new Error(`FactionTemplate.dbc has ${dbc.fields} fields, expected 14`);
  const T = new Map();
  for (const rec of dbc.records) {
    const r = [];
    for (let j = 0; j < 14; j++) r.push(rec.readUInt32LE(j * 4));
    T.set(r[0], { id: r[0], faction: r[1], flags: r[2], ours: r[3], friendly: r[4], hostile: r[5], enemies: r.slice(6, 10), friends: r.slice(10, 14) });
  }
  return T;
}
// Is template a hostile to template b? (CMaNGOS FactionTemplateEntry::IsHostileTo)
function isHostileTo(a, b) {
  if (a.id === b.id) return false;
  if (b.faction) {
    for (const e of a.enemies) if (e === b.faction) return true;
    for (const f of a.friends) if (f === b.faction) return false;
  }
  return (a.hostile & b.ours) !== 0;
}
// Is template a friendly to template b? (CMaNGOS FactionTemplateEntry::IsFriendlyTo)
function isFriendlyTo(a, b) {
  if (a.id === b.id) return true;
  if (b.faction) {
    for (const e of a.enemies) if (e === b.faction) return false;
    for (const f of a.friends) if (f === b.faction) return true;
  }
  return ((a.friendly & b.ours) !== 0) || ((a.ours & b.friendly) !== 0);
}
// The reaction of a creature template to a player race template: r hostile, f friendly, y neutral.
function reactionTo(creature, player) {
  if (isHostileTo(creature, player)) return "r";
  if (isFriendlyTo(creature, player)) return "f";
  return "y";
}
// The code a faction sees: the code its races agree on, else r. disagreed.n counts the creatures where the races did not agree.
function factionCode(templates, creature, faction, disagreed) {
  const codes = new Set(PLAYER_TEMPLATES[faction].map((id) => reactionTo(creature, templates.get(id))));
  if (codes.size === 1) return [...codes][0];
  disagreed.n++;
  return "r";
}

// The rows of the tsv for creatures and templates; counts what was left out.
function makeRows(creatures, templates) {
  for (const faction of Object.keys(PLAYER_TEMPLATES)) {
    for (const id of PLAYER_TEMPLATES[faction]) if (!templates.get(id)) throw new Error(`FactionTemplate.dbc has no player template ${id}`);
  }
  const rows = [];
  const disagreed = { n: 0 };
  let noTemplate = 0;
  for (const c of creatures) {
    const t = templates.get(c.faction);
    if (!t) { noTemplate++; continue; }
    rows.push({
      id: c.id, name: c.name, lo: c.lo, hi: c.hi, type: c.type,
      noAggro: (c.extra & NO_AGGRO_ON_SIGHT) ? 1 : 0,
      Alliance: factionCode(templates, t, "Alliance", disagreed),
      Horde: factionCode(templates, t, "Horde", disagreed),
    });
  }
  rows.sort((a, b) => a.id - b.id);
  return { rows, noTemplate, disagreed: disagreed.n };
}

function tsvText(rows) {
  return [
    "# Generated by tools/build-creature-react.js from CMaNGOS classic-db (GPL-3.0, github.com/cmangos/classic-db) creature_template and the game's FactionTemplate data. Only facts are kept. Do not edit by hand.",
    "# id <TAB> name <TAB> lowest level <TAB> highest level <TAB> creature type <TAB> noAggro (1: does not attack on sight) <TAB> Alliance <TAB> Horde",
    "# codes: y neutral (yellow, will not attack you first), r hostile (red), f friendly. The rule is the engine's: the creature's faction template against the player race templates.",
    ...rows.map((r) => [r.id, r.name, r.lo, r.hi, r.type, r.noAggro, r.Alliance, r.Horde].join("\t")),
    "",
  ].join("\n");
}

module.exports = { readColumns, readTuples, parseCreatures, readTemplates, isHostileTo, isFriendlyTo, reactionTo, makeRows, tsvText, PLAYER_TEMPLATES };

if (require.main === module) {
  const usage = (msg) => {
    console.error((msg ? msg + "\n" : "") + "Usage: node tools/build-creature-react.js <ClassicDB .sql.gz or .sql> [game Data folder]");
    process.exit(1);
  };
  const DUMP = process.argv[2];
  const DATA = process.argv[3] || DEFAULT_DATA;
  if (!DUMP) usage("The classic-db dump is needed. The creature-react file was not changed.");
  if (!fs.existsSync(DUMP)) usage(`${DUMP} is not there. The creature-react file was not changed.`);
  let raw = fs.readFileSync(DUMP);
  if (/\.gz$/i.test(DUMP)) raw = zlib.gunzipSync(raw);
  let parsed, templates;
  try {
    parsed = parseCreatures(raw.toString("utf8"));
    const file = require("./read-mpq.js").ReadGameFile(DATA, "DBFilesClient\\FactionTemplate.dbc");
    if (!file) throw new Error(`FactionTemplate.dbc was not found in ${DATA}`);
    templates = readTemplates(file.data);
  } catch (e) {
    console.error(e.message + "\nThe creature-react file was not changed.");
    process.exit(1);
  }
  const made = makeRows(parsed.creatures, templates);
  const count = (key, code) => made.rows.filter((r) => r[key] === code).length;
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE + ".tmp", tsvText(made.rows));
  fs.renameSync(OUT_FILE + ".tmp", OUT_FILE);
  console.log(`creature-react: ${made.rows.length} creatures (${parsed.skipped + made.noTemplate} skipped); ` +
    `Alliance ${count("Alliance", "y")} yellow, ${count("Alliance", "r")} red, ${count("Alliance", "f")} friendly; ` +
    `Horde ${count("Horde", "y")} yellow, ${count("Horde", "r")} red, ${count("Horde", "f")} friendly`);
  if (made.disagreed) console.log(`creature-react: ${made.disagreed} faction codes where the races of a faction disagreed (written as red)`);
  console.log(`creature-react: ${parsed.skipped} tuples skipped (bad shape), ${made.noTemplate} creatures skipped (faction has no template)`);
}
