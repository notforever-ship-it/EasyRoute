// Checks tools/build-creature-react.js (the tool that works out which creatures are yellow, red or friendly) on a small made-up
// creature table and a made-up faction table built in memory. Made-up data only: the real dump is not needed, and nothing is
// written to tools/data.
//   - the reading of the creature_template text: columns in another order than the real dump and one column the tool does not use,
//     a plain tuple, a name with a backslash-escaped quote, a name with a doubled quote, a NULL, a name with a tab, a name with a
//     bar, commas and brackets inside a name, a second INSERT statement, another table that must be ignored, a tuple with too few
//     values, a creature whose faction has no template
//   - the engine's rule on a made-up FactionTemplate table (a neutral template, a monster, a template friendly to the Alliance only,
//     the no-aggro flag, a template that makes the four Alliance races disagree)
//   - the tsv text and the errors for a broken faction table
// Usage: node tools/test-creature-react.js

const fs = require("fs");
const path = require("path");
const react = require("./build-creature-react.js");

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.log("  FAIL: " + msg);
  }
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// What is in tools/data before and after: the test must not change it.
const DATA_DIR = path.join(__dirname, "data");
function dataState() {
  return fs.readdirSync(DATA_DIR).sort().map((f) => {
    const st = fs.statSync(path.join(DATA_DIR, f));
    return f + ":" + st.size + ":" + st.mtimeMs;
  }).join("|");
}
const dataBefore = dataState();

// ---- the made-up creature_template text ----------------------------------------------------------------------
// Columns in an order that is not the real one, and Extra is a column the tool does not use.
const SQL = [
  "-- a made-up dump",
  "DROP TABLE IF EXISTS `creature_template`;",
  "CREATE TABLE `creature_template` (",
  "  `Entry` int(10) unsigned NOT NULL DEFAULT '0',",
  "  `Extra` varchar(20) DEFAULT NULL,",
  "  `Faction` smallint(5) unsigned NOT NULL DEFAULT '0',",
  "  `Name` char(100) NOT NULL DEFAULT '0',",
  "  `MaxLevel` tinyint(3) unsigned NOT NULL DEFAULT '1',",
  "  `MinLevel` tinyint(3) unsigned NOT NULL DEFAULT '1',",
  "  `CreatureType` tinyint(3) unsigned NOT NULL DEFAULT '0',",
  "  `ExtraFlags` int(10) unsigned NOT NULL DEFAULT '0',",
  "  PRIMARY KEY (`Entry`)",
  ") ENGINE=MyISAM DEFAULT CHARSET=utf8;",
  "INSERT INTO `other_table` VALUES (999,'not a creature');",
  "INSERT INTO `creature_template` VALUES (1,NULL,100,'Plain Boar',2,1,1,0),(2,'x',101,'Murloc\\'s Friend',5,4,7,0),(3,NULL,100,'Dwarf''s Wolf',3,3,1,0);",
  "INSERT INTO `creature_template` VALUES (4,NULL,102,'Town Guard',60,60,7,0),(5,'y',100,'Tab\\tName',9,8,1,2),(6,NULL,103,'Bar|Name',12,10,1,0);",
  "INSERT INTO `creature_template` VALUES (7,NULL,100,'Boar (Elder), Big',9,9,1,0),(8,NULL,100,'Too Short'),(9,NULL,555,'Lost Faction',5,5,1,0);",
  "",
].join("\n");

console.log("1. The creature_template text is read");
{
  const cols = react.readColumns(SQL);
  check(same(cols, ["Entry", "Extra", "Faction", "Name", "MaxLevel", "MinLevel", "CreatureType", "ExtraFlags"]), "the columns are read in the dump's order: " + JSON.stringify(cols));
  check(react.readColumns("CREATE TABLE `other` (\n  `a` int\n) ENGINE=MyISAM;") === null, "a text with no creature_template table is not null");
  const tuples = react.readTuples(SQL);
  check(tuples.length === 9, "9 tuples are read from the 3 INSERT lines (and none from the other table), got " + tuples.length);
  check(tuples[0][1] === null, "a NULL is not read as null: " + JSON.stringify(tuples[0]));
  check(tuples[1][3] === "Murloc's Friend", "a backslash-escaped quote: " + tuples[1][3]);
  check(tuples[2][3] === "Dwarf's Wolf", "a doubled quote: " + tuples[2][3]);
  check(tuples[4][3] === "Tab\tName", "a backslash-t is a tab in the raw tuple: " + JSON.stringify(tuples[4][3]));
  check(tuples[6][3] === "Boar (Elder), Big", "commas and brackets inside a name: " + tuples[6][3]);
  check(tuples[7].length === 4, "the short tuple has 4 values, got " + tuples[7].length);

  const parsed = react.parseCreatures(SQL);
  check(parsed.skipped === 1, "one tuple with too few values is skipped and counted, got " + parsed.skipped);
  check(parsed.creatures.length === 8, "8 creatures are kept, got " + parsed.creatures.length);
  const byId = new Map(parsed.creatures.map((c) => [c.id, c]));
  check(same(byId.get(1), { id: 1, name: "Plain Boar", lo: 1, hi: 2, faction: 100, type: 1, extra: 0 }), "the plain tuple: " + JSON.stringify(byId.get(1)));
  check(byId.get(2).name === "Murloc's Friend" && byId.get(2).lo === 4 && byId.get(2).hi === 5 && byId.get(2).faction === 101 && byId.get(2).type === 7, "the escaped-quote tuple: " + JSON.stringify(byId.get(2)));
  check(byId.get(3).name === "Dwarf's Wolf" && byId.get(3).lo === 3 && byId.get(3).hi === 3, "the doubled-quote tuple: " + JSON.stringify(byId.get(3)));
  check(byId.get(5).name === "Tab Name" && byId.get(5).extra === 2, "a tab in a name is cleaned to a space: " + JSON.stringify(byId.get(5)));
  check(byId.get(6).name === "Bar Name", "a bar in a name is cleaned to a space: " + JSON.stringify(byId.get(6)));
  check(byId.get(7).name === "Boar (Elder), Big", "commas and brackets stay in a parsed name: " + JSON.stringify(byId.get(7)));
  check(!byId.has(8), "the short tuple is not a creature");
  let threw = false;
  try { react.parseCreatures("nothing here"); } catch (e) { threw = true; }
  check(threw, "a text with no creature_template table does not throw");
  console.log("  " + parsed.creatures.length + " creatures read, " + parsed.skipped + " skipped");
}

// ---- the made-up FactionTemplate table ------------------------------------------------------------------------
// 14 uint32 fields: id, faction, flags, ourGroup, friendGroup, enemyGroup, enemies[4], friends[4].
function dbc(records, fields) {
  const size = (fields || 14) * 4;
  const buf = Buffer.alloc(20 + records.length * size + 1);
  buf.write("WDBC", 0, "latin1");
  buf.writeUInt32LE(records.length, 4);
  buf.writeUInt32LE(fields || 14, 8);
  buf.writeUInt32LE(size, 12);
  buf.writeUInt32LE(1, 16);
  records.forEach((r, i) => {
    for (let j = 0; j < (fields || 14); j++) buf.writeUInt32LE(r[j] || 0, 20 + i * size + j * 4);
  });
  return buf;
}
function rec(id, faction, ours, friendly, hostile, enemies, friends) {
  const e = enemies || [], f = friends || [];
  return [id, faction, 0, ours, friendly, hostile, e[0] || 0, e[1] || 0, e[2] || 0, e[3] || 0, f[0] || 0, f[1] || 0, f[2] || 0, f[3] || 0];
}
// Alliance races have the group 2, Horde races the group 4. Each side is friendly to its own group and hostile to the other.
const PLAYERS = [
  rec(1, 1, 2, 2, 4), rec(3, 3, 2, 2, 4), rec(4, 4, 2, 2, 4), rec(115, 115, 2, 2, 4),
  rec(2, 2, 4, 4, 2), rec(5, 5, 4, 4, 2), rec(6, 6, 4, 4, 2), rec(116, 116, 4, 4, 2),
];
const CREATURE_TEMPLATES = [
  rec(100, 100, 8, 0, 0),             // neutral: hostile to nobody, friendly to nobody
  rec(101, 101, 8, 0, 6),             // a monster: hostile to both player groups
  rec(102, 102, 8, 2, 4),             // friendly to the Alliance group, hostile to the Horde group
  rec(103, 103, 8, 0, 0, [3]),        // its enemy list names only the Dwarf faction
];

console.log("2. The engine's rule on a made-up faction table");
{
  const templates = react.readTemplates(dbc(PLAYERS.concat(CREATURE_TEMPLATES)));
  check(templates.size === 12, "12 templates are read, got " + templates.size);
  const t = (id) => templates.get(id);
  check(react.reactionTo(t(100), t(1)) === "y" && react.reactionTo(t(100), t(2)) === "y", "a neutral template is not y for both factions");
  check(react.reactionTo(t(101), t(1)) === "r" && react.reactionTo(t(101), t(2)) === "r", "a monster template is not r for both factions");
  check(react.reactionTo(t(102), t(1)) === "f", "a template friendly to the Alliance is not f for a Human");
  check(react.reactionTo(t(102), t(2)) === "r", "a template friendly to the Alliance is not r for an Orc");
  check(react.isHostileTo(t(103), t(3)) && !react.isHostileTo(t(103), t(1)), "an enemy list naming only the Dwarf faction is hostile to the Dwarf only");
  check(!react.isHostileTo(t(1), t(1)) && react.isFriendlyTo(t(1), t(1)), "a template is never hostile to itself and always friendly to itself");

  const parsed = react.parseCreatures(SQL);
  const made = react.makeRows(parsed.creatures, templates);
  check(made.noTemplate === 1, "one creature whose faction has no template is skipped and counted, got " + made.noTemplate);
  check(made.rows.length === 7, "7 rows are made, got " + made.rows.length);
  check(same(made.rows.map((r) => r.id), [1, 2, 3, 4, 5, 6, 7]), "the rows are in id order: " + made.rows.map((r) => r.id).join(","));
  const row = (id) => made.rows.find((r) => r.id === id);
  check(row(1).Alliance === "y" && row(1).Horde === "y" && row(1).noAggro === 0, "the neutral boar: " + JSON.stringify(row(1)));
  check(row(2).Alliance === "r" && row(2).Horde === "r", "the monster murloc: " + JSON.stringify(row(2)));
  check(row(4).Alliance === "f" && row(4).Horde === "r", "the guard, friendly to the Alliance only: " + JSON.stringify(row(4)));
  check(row(5).noAggro === 1 && row(5).Alliance === "y", "ExtraFlags 2 gives noAggro 1: " + JSON.stringify(row(5)));
  check(row(6).Alliance === "r" && row(6).Horde === "y", "the Alliance races disagree, so the Alliance gets r and the Horde keeps y: " + JSON.stringify(row(6)));
  check(made.disagreed === 1, "one faction code where the races disagreed is counted, got " + made.disagreed);
  console.log("  " + made.rows.length + " rows, " + made.noTemplate + " without a template, " + made.disagreed + " disagreed");

  // The tsv text.
  const text = react.tsvText(made.rows);
  const lines = text.split("\n");
  check(lines[0].charAt(0) === "#" && lines[0].indexOf("CMaNGOS classic-db") >= 0 && lines[0].indexOf("GPL-3.0") >= 0, "the first line is not the credit comment");
  const body = lines.filter((l) => l && l.charAt(0) !== "#");
  check(body.length === 7, "7 data lines, got " + body.length);
  check(body.every((l) => l.split("\t").length === 8), "every data line has 8 fields");
  check(body[0] === "1\tPlain Boar\t1\t2\t1\t0\ty\ty", "the first data line: " + JSON.stringify(body[0]));
  check(text.charAt(text.length - 1) === "\n", "the text does not end with a line break");
  check(text === react.tsvText(react.makeRows(react.parseCreatures(SQL).creatures, templates).rows), "making the text twice gives different texts");

  // Errors.
  let missing = null;
  try { react.makeRows(parsed.creatures, react.readTemplates(dbc(PLAYERS.filter((p) => p[0] !== 115).concat(CREATURE_TEMPLATES)))); } catch (e) { missing = e.message; }
  check(missing && /115/.test(missing), "a faction table with no Gnome template does not fail by name: " + missing);
  let wrongFields = null;
  try { react.readTemplates(dbc([[1, 2, 3]], 3)); } catch (e) { wrongFields = e.message; }
  check(wrongFields && /14/.test(wrongFields), "a faction table with 3 fields does not fail: " + wrongFields);
  let notDbc = null;
  try { react.readTemplates(Buffer.from("not a dbc file at all, just text")); } catch (e) { notDbc = e.message; }
  check(notDbc !== null, "text that is not a DBC does not fail");
}

console.log("3. Nothing was written to tools/data");
check(dataState() === dataBefore, "the files in tools/data changed while the test ran");

if (failures) {
  console.log(failures + " CHECK(S) FAILED");
  process.exit(1);
}
console.log("CREATURE REACT CHECKS PASSED");
