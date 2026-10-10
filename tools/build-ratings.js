// Builds Data/Ratings.lua from the friends' feedback files: which quests players found Hard.
//   Data/Ratings.lua   EasyRoute_Ratings = { version, files, counts = { [questId] = { hard, skip, medium, easy, deaths } },
//                      hard = { [questId] = 1 } }. Quest ids and counts only: no names, no text, nothing about the players.
// Reads: every file ending -EasyRoute.lua in the feedback folder (a friend's saved Easy Route file, EasyRouteDB with its
// ratings). Each file is somebody else's Lua, so it runs only inside the sandbox of tools/lib/pfdb.js (newLuaVM: no os, io,
// files, require, load or debug). A file over FILE_MAX_MB, or one that fails to run, is named and passed over.
// The Hard rule (D-11): a quest is Hard when
//   - at least H_MIN_HARD ratings say Hard or Skip and the Easy ratings are no more than those, or
//   - the deaths seen with a Medium or Hard rating add up to H_DEATHS or more and at least one rating is Medium or Hard.
// A rating without a pfQuest number is matched by title, quest level and faction; a title that still matches more than one
// quest, or none, is left out and listed under "not matched".
// Usage: node tools/build-ratings.js [feedback folder] [AddOns folder]
//   defaults: the "feedback" folder next to this repo, and E:\Ravencraft\twmoa_1181\Interface\AddOns (only read when a
//   rating has no pfQuest number)

const fs = require("fs");
const path = require("path");
const { newLuaVM, loadPf } = require("./lib/pfdb.js");

const H_MIN_HARD = 1;   // Hard or Skip ratings needed
const H_DEATHS = 3;     // deaths with a Medium or Hard rating
const FILE_MAX_MB = 5;  // a bigger feedback file is skipped

const REPO = path.resolve(__dirname, "..");
const OUT_FILE = path.join(REPO, "Data", "Ratings.lua");
const FEEDBACK = path.resolve(process.argv[2] || path.join(REPO, "..", "feedback"));
const ROOT = process.argv[3] || "E:\\Ravencraft\\twmoa_1181\\Interface\\AddOns";

const ALLIANCE_RACES = new Set(["Human", "Dwarf", "Gnome", "Night Elf", "NightElf", "High Elf", "HighElf"]);
const WORDS = new Set(["easy", "medium", "hard", "skip"]);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(FEEDBACK)) fail("Feedback folder not found: " + FEEDBACK);
const files = fs.readdirSync(FEEDBACK).filter((f) => /-EasyRoute\.lua$/.test(f)).sort();

// Copies the fields we need into a plain list inside the sandbox, so nothing else leaves it.
const COPY = `
ER_R = {}
if type(EasyRouteDB) == "table" and type(EasyRouteDB.ratings) == "table" then
  for k, r in pairs(EasyRouteDB.ratings) do
    if type(r) == "table" then
      ER_R[#ER_R + 1] = { rating = r.rating, pfid = r.pfid, deaths = r.deaths, qlevel = r.qlevel, title = r.title or k, race = r.race }
    end
  end
end
`;

const per = new Map();   // id -> { hard, skip, medium, easy, deaths, deathsNonEasy }
const loose = [];        // ratings with no pfQuest number
let usedFiles = 0, ratingCount = 0;

for (const f of files) {
  const full = path.join(FEEDBACK, f);
  const size = fs.statSync(full).size;
  if (size > FILE_MAX_MB * 1024 * 1024) {
    console.log(`skipped (over ${FILE_MAX_MB} MB): ${f}`);
    continue;
  }
  let list;
  try {
    const vm = newLuaVM();
    vm.run(fs.readFileSync(full), f);
    vm.run(COPY, "copy");
    list = vm.get("ER_R");
  } catch (e) {
    console.log(`skipped (does not run): ${f}: ${String(e.message).split("\n")[0].slice(0, 120)}`);
    continue;
  }
  usedFiles++;
  if (!Array.isArray(list)) list = [];
  for (const r of list) {
    if (!r || typeof r !== "object" || !WORDS.has(r.rating)) continue;
    ratingCount++;
    const deaths = typeof r.deaths === "number" && r.deaths > 0 ? Math.floor(r.deaths) : 0;
    const entry = { rating: r.rating, deaths, title: typeof r.title === "string" ? r.title : "", qlevel: typeof r.qlevel === "number" ? r.qlevel : null,
      race: typeof r.race === "string" ? r.race : "" };
    if (typeof r.pfid === "number" && r.pfid > 0) entry.id = Math.floor(r.pfid);
    if (entry.id) add(entry.id, entry); else loose.push(entry);
  }
}

function add(id, e) {
  const p = per.get(id) || { hard: 0, skip: 0, medium: 0, easy: 0, deaths: 0, deathsNonEasy: 0 };
  p[e.rating]++;
  p.deaths += e.deaths;
  if (e.rating !== "easy") p.deathsNonEasy += e.deaths;
  per.set(id, p);
}

let names = {};
const notMatched = [];
if (loose.length) {
  const pf = loadPf(ROOT).db;
  names = pf.qnames;
  for (const e of loose) {
    const faction = ALLIANCE_RACES.has(e.race) ? 1 : 2;   // pfQuest's race mask: 77 Alliance, 178 Horde
    const hits = Object.keys(pf.quests).filter((id) => {
      const q = pf.quests[id];
      if (!q || pf.qnames[id] !== e.title) return false;
      if (e.qlevel !== null && q.lvl !== e.qlevel) return false;
      if (typeof q.race === "number") {
        const mask = faction === 1 ? 77 : 178;
        if ((q.race & mask) === 0) return false;
      }
      return true;
    });
    if (hits.length === 1) add(+hits[0], e); else notMatched.push(`${e.title} (level ${e.qlevel}): ${hits.length} matches`);
  }
}

const ids = [...per.keys()].sort((a, b) => a - b);
const hard = ids.filter((id) => {
  const p = per.get(id);
  return ((p.hard + p.skip) >= H_MIN_HARD && p.easy <= p.hard + p.skip) || (p.deathsNonEasy >= H_DEATHS && (p.medium + p.hard) >= 1);
});

const out = [];
out.push("-- Generated by tools/build-ratings.js from the friends' feedback files. Do not edit by hand.");
out.push("-- Quest ids and counts only: { hard, skip, medium, easy, deaths } (deaths rated Easy are not counted).");
out.push("EasyRoute_Ratings = {");
out.push("  version = 1,");
out.push(`  files = ${usedFiles},`);
out.push("  counts = {");
for (const id of ids) {
  const p = per.get(id);
  out.push(`    [${id}] = { ${p.hard}, ${p.skip}, ${p.medium}, ${p.easy}, ${p.deathsNonEasy} },`);
}
out.push("  },");
out.push("  hard = {");
for (const id of hard) out.push(`    [${id}] = 1,`);
out.push("  },");
out.push("}");

const tmp = OUT_FILE + ".tmp";
fs.writeFileSync(tmp, out.join("\n") + "\n");
try {
  const vm = newLuaVM();
  vm.run(fs.readFileSync(tmp), "Ratings.lua");
  vm.run("ER_CHECK = type(EasyRoute_Ratings) == 'table' and type(EasyRoute_Ratings.hard) == 'table' and type(EasyRoute_Ratings.counts) == 'table'", "check");
  if (vm.get("ER_CHECK") !== true) throw new Error("EasyRoute_Ratings or its hard list is missing");
} catch (e) {
  fs.unlinkSync(tmp);
  fail("read back FAILED: " + e.message);
}
fs.renameSync(tmp, OUT_FILE);

console.log(`${usedFiles} feedback file(s), ${ratingCount} ratings, ${ids.length} quests`);
console.log(`${hard.length} quests count as Hard`);
if (!Object.keys(names).length && hard.length) {
  // Titles for the console only: from pfQuest, and only when it is there.
  try { names = loadPf(ROOT).db.qnames; } catch (e) { names = {}; }
}
for (const id of hard) console.log(`  ${id} ${names[id] || ""}`.trimEnd());
if (notMatched.length) {
  console.log("not matched:");
  for (const n of notMatched) console.log("  " + n);
}
