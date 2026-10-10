// Builds tools/data/chain-facts.tsv: the quest and item facts the chain rule needs, cached once so the route builder never reads the
// 73 MB SQL dump.
// Sources:
//   CMaNGOS classic-db (GPL-3.0, github.com/cmangos/classic-db): the quest_template and item_template tables of the dump, read as plain
//   text by tools/lib/sqldump.js (never run, never copied into this repo).
//   pfExtend's questGaindb/rewards_data.lua (OctoWoW database), only for the reward item ids of its quests: the items those quests give
//   are looked up in item_template too.
// The quest's xp is CMaNGOS's own rule for quest levels 1 to 60: RewMoneyMaxLevel / 0.6, rounded up (Quest::XPValue). The Turtle WoW
// database agrees (The Zhevra 900, Big Game Hunter 5350, Letter to Jin'Zil 1550).
// Rows, sorted by id, split by tabs:
//   Q id xp group breadcrumb next reward choice     one per quest_template row: group = ExclusiveGroup, breadcrumb = BreadcrumbForQuestId,
//                                                   next = NextQuestInChain, reward and choice = the item ids split by commas
//   I id quality inv class subclass allowable reqLevel name     one per item_template row that is a reward of a quest above
// Usage: node --max-old-space-size=4096 tools/build-chain-facts.js [classicdb.sql] [AddOns folder]
//   (defaults: ../_data/classic-db/classicdb.sql next to this repo, and E:\Ravencraft\twmoa_1181\Interface\AddOns)

const fs = require("fs");
const path = require("path");
const { newLuaVM } = require("./lib/pfdb.js");
const sqldump = require("./lib/sqldump.js");

const REPO = path.resolve(__dirname, "..");
const OUT_FILE = path.join(REPO, "tools", "data", "chain-facts.tsv");
const ARGS = process.argv.slice(2);
const SQL_FILE = ARGS[0] || path.resolve(REPO, "..", "_data", "classic-db", "classicdb.sql");
const ROOT = ARGS[1] || "E:\\Ravencraft\\twmoa_1181\\Interface\\AddOns";

function die(msg) {
  console.error(msg);
  process.exit(1);
}
if (!fs.existsSync(SQL_FILE)) die(`The classic-db dump was not found: ${SQL_FILE}\nUsage: node --max-old-space-size=4096 tools/build-chain-facts.js [classicdb.sql] [AddOns folder]`);

const list = (v) => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);
const itemId = (e) => Array.isArray(e) ? e[0] : (e && typeof e === "object" ? Object.values(e)[0] : e);
// Names go into tab-separated lines: tabs, line breaks and the "|" of colour codes are taken out.
const tidy = (s) => String(s == null ? "" : s).replace(/[\t\r\n|]+/g, " ").trim();

console.log(`reading ${SQL_FILE}`);
const sql = fs.readFileSync(SQL_FILE, "utf8");

const QUEST_COLS = ["entry", "RewMoneyMaxLevel", "ExclusiveGroup", "BreadcrumbForQuestId", "NextQuestInChain",
  "RewItemId1", "RewItemId2", "RewItemId3", "RewItemId4",
  "RewChoiceItemId1", "RewChoiceItemId2", "RewChoiceItemId3", "RewChoiceItemId4", "RewChoiceItemId5", "RewChoiceItemId6"];
const ITEM_COLS = ["entry", "class", "subclass", "name", "Quality", "InventoryType", "AllowableClass", "RequiredLevel"];
let quests, items;
try {
  quests = sqldump.rows(sql, "quest_template", QUEST_COLS);
  items = sqldump.rows(sql, "item_template", ITEM_COLS);
} catch (e) {
  die(`self-check FAILED: ${e.message}`);
}

// The reward item ids of pfExtend's quests (a missing file is a warning, not a stop).
const wanted = new Set();
const rewardsFile = path.join(ROOT, "pfExtend", "questGaindb", "rewards_data.lua");
if (fs.existsSync(rewardsFile)) {
  const vm = newLuaVM();
  vm.run(fs.readFileSync(rewardsFile), "rewards_data.lua");
  const rw = vm.get("PfExtend_QuestRewards");
  for (const id of Object.keys(rw || {})) {
    const r = rw[id];
    if (!r || typeof r !== "object") continue;
    for (const e of list(r.reward).concat(list(r.choice))) {
      const n = Number(itemId(e));
      if (n > 0) wanted.add(n);
    }
  }
} else {
  console.warn(`warning: pfExtend's rewards_data.lua is missing in ${ROOT}; only the items of classic-db's own quests are kept`);
}

const qLines = [];
for (const q of quests) {
  const xpFull = q.RewMoneyMaxLevel > 0 ? Math.ceil(q.RewMoneyMaxLevel / 0.6) : 0;
  const reward = [q.RewItemId1, q.RewItemId2, q.RewItemId3, q.RewItemId4].filter((n) => n > 0);
  const choice = [q.RewChoiceItemId1, q.RewChoiceItemId2, q.RewChoiceItemId3, q.RewChoiceItemId4, q.RewChoiceItemId5, q.RewChoiceItemId6].filter((n) => n > 0);
  for (const n of reward.concat(choice)) wanted.add(n);
  qLines.push({ id: q.entry, text: ["Q", q.entry, xpFull, q.ExclusiveGroup, q.BreadcrumbForQuestId, q.NextQuestInChain, reward.join(","), choice.join(",")].join("\t") });
}
const iLines = [];
for (const it of items) {
  if (!wanted.has(it.entry)) continue;
  iLines.push({ id: it.entry, text: ["I", it.entry, it.Quality, it.InventoryType, it.class, it.subclass, it.AllowableClass, it.RequiredLevel, tidy(it.name)].join("\t") });
}
qLines.sort((a, b) => a.id - b.id);
iLines.sort((a, b) => a.id - b.id);

// The self-check: three known quests and the sizes.
const xpOf = (id) => { const l = qLines.find((x) => x.id === id); return l ? Number(l.text.split("\t")[2]) : null; };
const KNOWN = [[845, 900], [208, 5350], [1060, 1550]];
for (const [id, want] of KNOWN) {
  if (xpOf(id) !== want) die(`self-check FAILED: quest ${id} should give ${want} xp, the facts say ${xpOf(id)}`);
}
if (qLines.length < 4000) die(`self-check FAILED: only ${qLines.length} quest rows (expected more than 4000)`);
if (iLines.length < 1000) die(`self-check FAILED: only ${iLines.length} item rows (expected more than 1000)`);

const out = [
  "# Generated by tools/build-chain-facts.js from CMaNGOS classic-db (GPL-3.0, github.com/cmangos/classic-db) quest_template and item_template. Only facts are kept. Do not edit by hand.",
  "# The route builder (tools/build-route.js) reads this file, never the SQL dump. Tools only: it is not part of the addon.",
  "# Q <TAB> id <TAB> xp (RewMoneyMaxLevel / 0.6, rounded up; 0: gives none) <TAB> ExclusiveGroup <TAB> BreadcrumbForQuestId <TAB> NextQuestInChain <TAB> reward item ids (commas) <TAB> choice item ids (commas)",
  "# I <TAB> id <TAB> quality (0 grey, 1 white, 2 green, 3 blue, 4 purple) <TAB> InventoryType <TAB> class <TAB> subclass <TAB> AllowableClass (-1: anyone) <TAB> RequiredLevel <TAB> name",
  ...qLines.map((x) => x.text),
  ...iLines.map((x) => x.text),
  "",
];
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE + ".tmp", out.join("\n"));
fs.renameSync(OUT_FILE + ".tmp", OUT_FILE);
console.log(`${qLines.length} Q rows, ${iLines.length} I rows -> tools/data/chain-facts.tsv`);
console.log("self-check: OK");
