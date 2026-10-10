// Builds Data/Prices.lua: the vendor sell price (in copper) of every item a quest offers as a reward to choose from.
// Auto mode uses it at a hand-in with two or more rewards when none of them fits the character: it takes the one that sells for the most.
// Sources:
//   CMaNGOS classic-db (GPL-3.0, github.com/cmangos/classic-db): quest_template RewChoiceItemId1-6 (which items are choices) and
//   item_template SellPrice (the price). The dump is never run and never copied into this repo; it is read as plain text.
//   pfExtend's questGaindb/rewards_data.lua (OctoWoW database, which follows Turtle WoW), when found: its "choice" lists add the
//   Turtle quests' choice items. pfExtend has no prices, so only items classic-db knows get one; Turtle-only items have none.
// Only items with a price above 0 are written. The game's GetItemInfo in 1.12 has no sell price, hence this file.
// Usage: node tools/build-prices.js [classicdb.sql or .sql.gz] [pfExtend rewards_data.lua]
//   (defaults: ../_data/classic-db/classicdb.sql and E:\Ravencraft\twmoa_1181\Interface\AddOns\pfExtend\questGaindb\rewards_data.lua)

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const REPO = path.resolve(__dirname, "..");
const OUT_FILE = path.join(REPO, "Data", "Prices.lua");
const DEFAULT_SQL = path.join(REPO, "..", "_data", "classic-db", "classicdb.sql");
const DEFAULT_PFEXTEND = "E:\\Ravencraft\\twmoa_1181\\Interface\\AddOns\\pfExtend\\questGaindb\\rewards_data.lua";

function die(msg) {
  console.error("build-prices: " + msg);
  process.exit(1);
}

// The column names of one table's CREATE TABLE, in order; null when the table is not in the text.
function readColumns(sql, table) {
  const m = new RegExp("CREATE TABLE `" + table + "` \\(([\\s\\S]*?)\\) ENGINE").exec(sql);
  if (!m) return null;
  const cols = [];
  for (const line of m[1].split("\n")) {
    const t = line.trim();
    if (t.charAt(0) === "`") cols.push(t.split("`")[1]);
  }
  return cols;
}

const ESCAPES = { n: "\n", r: "\r", t: "\t", "0": "\0", b: "\b", Z: "\x1a" };

// Every tuple of every INSERT INTO `table` statement, as an array of values (numbers, strings, null). Nothing is run.
function readTuples(sql, table) {
  const tuples = [];
  const marker = "INSERT INTO `" + table + "` VALUES ";
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

function indexOf(cols, names, table) {
  const idx = {};
  for (const c of names) {
    idx[c] = cols.indexOf(c);
    if (idx[c] < 0) die(`${table} has no ${c} column`);
  }
  return idx;
}

// ---- read ------------------------------------------------------------------------------------------------------
const sqlPath = process.argv[2] || DEFAULT_SQL;
const pfPath = process.argv[3] || DEFAULT_PFEXTEND;
if (!fs.existsSync(sqlPath)) die(`no classic-db dump at ${sqlPath}`);
let raw = fs.readFileSync(sqlPath);
if (/\.gz$/i.test(sqlPath)) raw = zlib.gunzipSync(raw);
const sql = raw.toString("utf8");

// The choice items of classic-db's quests.
const choice = new Set();
const qcols = readColumns(sql, "quest_template");
if (!qcols) die("the dump has no quest_template table");
const CH = ["RewChoiceItemId1", "RewChoiceItemId2", "RewChoiceItemId3", "RewChoiceItemId4", "RewChoiceItemId5", "RewChoiceItemId6"];
const qi = indexOf(qcols, ["entry"].concat(CH), "quest_template");
let quests = 0;
for (const vals of readTuples(sql, "quest_template")) {
  if (vals.length !== qcols.length) continue;
  quests++;
  for (const c of CH) {
    const id = vals[qi[c]];
    if (Number.isInteger(id) && id > 0) choice.add(id);
  }
}
const fromDb = choice.size;

// The choice items of pfExtend's quests (Turtle and vanilla, as OctoWoW lists them).
let fromPf = 0;
if (fs.existsSync(pfPath)) {
  const text = fs.readFileSync(pfPath, "utf8");
  const re = /choice\s*=\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    // a bare id, or { id, count }: the first number of each pair is the id
    const body = m[1].replace(/\{\s*(\d+)\s*,\s*\d+\s*\}/g, "$1");
    for (const n of body.match(/\d+/g) || []) {
      const id = Number(n);
      if (id > 0 && !choice.has(id)) { choice.add(id); fromPf++; }
    }
  }
} else {
  console.log(`pfExtend's rewards_data.lua not found at ${pfPath}: classic-db's choices only`);
}

// The prices.
const icols = readColumns(sql, "item_template");
if (!icols) die("the dump has no item_template table");
const ii = indexOf(icols, ["entry", "SellPrice"], "item_template");
const price = new Map();
let items = 0;
for (const vals of readTuples(sql, "item_template")) {
  if (vals.length !== icols.length) continue;
  items++;
  const id = vals[ii.entry], sell = vals[ii.SellPrice];
  if (choice.has(id) && Number.isInteger(sell) && sell > 0) price.set(id, sell);
}
if (quests < 1000 || items < 5000) die(`source looks incomplete: ${quests} quests, ${items} items`);

// ---- write -----------------------------------------------------------------------------------------------------
const ids = Array.from(price.keys()).sort((a, b) => a - b);
const lines = [
  "-- Generated by tools/build-prices.js from CMaNGOS classic-db (GPL-3.0, github.com/cmangos/classic-db) and pfExtend (OctoWoW database,",
  "-- octowow.st). Do not edit by hand.",
  "-- The vendor sell price in copper of each item a quest offers as a reward to choose from (items with no known price are left out).",
  "EasyRoute_Prices = {",
];
for (const id of ids) lines.push(`  [${id}] = ${price.get(id)},`);
lines.push("}");
fs.writeFileSync(OUT_FILE, lines.join("\n") + "\n");
console.log(`choice items: ${choice.size} (${fromDb} from classic-db, ${fromPf} more from pfExtend); with a price: ${ids.length}; written ${path.relative(REPO, OUT_FILE)}`);
