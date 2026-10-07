// Builds Data/Zones.lua and Data/Mobs.lua from the pfQuest and pfQuest-turtle databases (plus the quest XP
// and reward table that pfExtend ships, when you have it). The game only has to read the result.
//   Data/Zones.lua: for each map zone, the quests that start there (level, where, who, chain, XP, rewards)
//   Data/Mobs.lua:  for each map zone, where ordinary mobs of each level stand, for the grind suggestions
//
// Needs the Lua VM "fengari" (npm install, in this tools folder) to read pfQuest's Lua data files.
// Usage: node tools/build-director.js <AddOns folder or any folder holding pfQuest and pfQuest-turtle> [rewards_data.lua]

const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const ROOT = process.argv[2];
const REWARDS = process.argv[3] || (ROOT && path.join(ROOT, "pfExtend", "questGaindb", "rewards_data.lua"));
if (!ROOT || !fs.existsSync(path.join(ROOT, "pfQuest", "db", "quests.lua"))) {
  console.error("Usage: node tools/build-director.js <folder holding pfQuest and pfQuest-turtle> [rewards_data.lua]");
  process.exit(1);
}
const OUT = path.resolve(__dirname, "..", "Data");

// ---- read the Lua data files in a Lua VM and bring the tables over as JSON ----------------------------
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
function run(code, name) {
  const buf = typeof code === "string" ? to_luastring(code) : code;
  if (lauxlib.luaL_loadbuffer(L, buf, buf.length, to_luastring(name)) !== 0 || lua.lua_pcall(L, 0, 0, 0) !== 0) {
    throw new Error(name + ": " + to_jsstring(lua.lua_tostring(L, -1)));
  }
}
run("pfDB = setmetatable({}, {__index = function(t, k) local v = {} rawset(t, k, v) return v end})", "init");
const files = [];
for (const db of ["quests", "units", "objects", "zones"]) {
  files.push(`pfQuest/db/${db}.lua`, `pfQuest/db/enUS/${db}.lua`, `pfQuest-turtle/db/${db}-turtle.lua`, `pfQuest-turtle/db/enUS/${db}-turtle.lua`);
}
for (const f of files) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) run(fs.readFileSync(p), f);
  else console.warn("missing (skipped): " + f);
}
const haveRewards = REWARDS && fs.existsSync(REWARDS);
if (haveRewards) run(fs.readFileSync(REWARDS), "rewards");
else console.warn("no rewards_data.lua found: quests will have no XP or reward information");

run(`
local function patch(base, diff)
  for k, v in pairs(diff) do
    if v == "_" then base[k] = nil else base[k] = v end
  end
end
for _, db in ipairs({"quests", "units", "objects", "zones"}) do
  if rawget(pfDB[db], "data-turtle") then patch(pfDB[db]["data"], pfDB[db]["data-turtle"]) end
  if rawget(pfDB[db], "enUS-turtle") then patch(pfDB[db]["enUS"], pfDB[db]["enUS-turtle"]) end
end
local function ser(v)
  local t = type(v)
  if t == "number" or t == "boolean" then return tostring(v)
  elseif t == "string" then
    return '"' .. v:gsub('\\\\', '\\\\\\\\'):gsub('"', '\\\\"'):gsub('[%c]', ' ') .. '"'
  elseif t == "table" then
    local n = 0
    for _ in pairs(v) do n = n + 1 end
    if n == 0 then return "[]" end
    local isarr = true
    for i = 1, n do if v[i] == nil then isarr = false break end end
    local parts = {}
    if isarr then
      for i = 1, n do parts[#parts + 1] = ser(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for k, x in pairs(v) do parts[#parts + 1] = '"' .. tostring(k) .. '":' .. ser(x) end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
local function names(db, key)
  local out = {}
  for id, v in pairs(pfDB[db]["enUS"]) do
    if type(v) == "table" then out[id] = v[key] else out[id] = v end
  end
  return out
end
DUMP = ser({
  quests = pfDB["quests"]["data"], qnames = names("quests", "T"),
  units = pfDB["units"]["data"], unames = names("units"),
  objects = pfDB["objects"]["data"], onames = names("objects"),
  zones = pfDB["zones"]["data"], znames = names("zones"),
  rewards = PfExtend_QuestRewards or {},
})
`, "patch+dump");
lua.lua_getglobal(L, to_luastring("DUMP"));
const db = JSON.parse(to_jsstring(lua.lua_tostring(L, -1)));

// ---- helpers -------------------------------------------------------------------------------------------
const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
const round1 = (n) => Math.round(n * 10) / 10;
// pfQuest stores a few towns (Darkshire in Duskwood) as zones of their own, with the town's own 0-100 map. Fold such a
// sub-area back into its parent zone: the zone table gives parent, width, height, centre x and centre y on the parent.
function place(c) {
  const sub = db.zones[c[2]];
  if (Array.isArray(sub) && sub[0] > 0 && db.znames[sub[0]]) {
    return [Math.round((sub[3] + (c[0] - 50) * sub[1] / 100) * 10) / 10, Math.round((sub[4] + (c[1] - 50) * sub[2] / 100) * 10) / 10, sub[0]];
  }
  return [c[0], c[1], c[2]];
}
const firstCoord = (entry) => (entry && Array.isArray(entry.coords) && entry.coords.length ? place(entry.coords[0]) : null);

// ---- Zones.lua: quests by the zone they start in -----------------------------------------------------
const zones = {};
let kept = 0, skippedNoStart = 0;
for (const id of Object.keys(db.quests)) {
  const d = db.quests[id];
  if (!d || typeof d !== "object") continue;
  const name = db.qnames[id];
  if (!name || d.lvl == null) continue;
  const start = d.start || {};
  let coord = null, giver = null;
  for (const u of start.U || []) {
    coord = firstCoord(db.units[u]);
    if (coord) { giver = db.unames[u]; break; }
  }
  if (!coord) {
    for (const o of start.O || []) {
      coord = firstCoord(db.objects[o]);
      if (coord) { giver = db.onames[o]; break; }
    }
  }
  if (!coord) { skippedNoStart++; continue; }
  const zone = coord[2];
  // A quest whose kill target is an elite or boss is the kind that wants a group.
  let elite = false;
  for (const u of (d.obj && d.obj.U) || []) {
    const unit = db.units[u];
    if (unit && unit.rnk && Number(unit.rnk) >= 1 && Number(unit.rnk) <= 3) elite = true;
  }
  const row = { id: Number(id), n: name, l: d.lvl, m: d.min == null ? 1 : d.min, x: round1(coord[0]), y: round1(coord[1]) };
  if (giver) row.g = giver;
  if (Array.isArray(d.pre) && d.pre.length) row.p = d.pre[0];
  if (d.race && d.race !== 255) row.r = d.race;
  if (d.class) row.c = d.class;
  if (elite) row.e = 1;
  const rw = db.rewards[id];
  if (rw) {
    if (rw.xp) row.xp = rw.xp;
    const fixed = Array.isArray(rw.reward) ? rw.reward.length : 0;
    const pick = Array.isArray(rw.choice) ? rw.choice.length : 0;
    if (fixed + pick > 0) row.rw = fixed + pick * 10; // tens = number of items to choose from
  }
  (zones[zone] = zones[zone] || []).push(row);
  kept++;
}

const zoneLines = ["-- Generated by tools/build-director.js from the pfQuest, pfQuest-turtle and pfExtend data. Do not edit by hand.",
  "-- Per map zone: the quests that start there. l = quest level, m = lowest level that may take it, x y = where it starts,",
  "-- g = who gives it, p = the quest before it in a chain, r = race mask, c = class mask, e = kill target is an elite,",
  "-- xp = experience, rw = reward items (units: fixed items, tens: items to choose from).",
  "EasyRoute_Zones = {"];
const zoneIds = Object.keys(zones).map(Number).filter((z) => db.znames[z]).sort((a, b) => a - b);
for (const z of zoneIds) {
  const rows = zones[z].sort((a, b) => a.l - b.l || a.id - b.id);
  zoneLines.push(`  [${z}] = { name = ${q(db.znames[z])}, q = {`);
  for (const r of rows) {
    const parts = [`id = ${r.id}`, `n = ${q(r.n)}`, `l = ${r.l}`, `m = ${r.m}`, `x = ${r.x}`, `y = ${r.y}`];
    if (r.g) parts.push(`g = ${q(r.g)}`);
    if (r.p) parts.push(`p = ${r.p}`);
    if (r.r) parts.push(`r = ${r.r}`);
    if (r.c) parts.push(`c = ${r.c}`);
    if (r.e) parts.push(`e = 1`);
    if (r.xp) parts.push(`xp = ${r.xp}`);
    if (r.rw) parts.push(`rw = ${r.rw}`);
    zoneLines.push(`    { ${parts.join(", ")} },`);
  }
  zoneLines.push("  } },");
}
zoneLines.push("}", "");

// ---- Mobs.lua: where ordinary mobs of each level stand ---------------------------------------------------
const CELL = 8; // map percent; spawns of one mob inside one 8x8 square count as one group
const skipName = /guard|dummy|spirit|trigger|\[|\bdnd\b|\btest\b|\bevent\b|bunny|invisible|stalker|totem|\bnpc\b|\bgm\b|\(|\)/i;
const mobs = {};
for (const id of Object.keys(db.units)) {
  const u = db.units[id];
  const name = db.unames[id];
  if (!u || !name || u.fac || (u.rnk && Number(u.rnk) !== 0) || skipName.test(name)) continue;
  const m = String(u.lvl || "").match(/^(\d+)(?:-(\d+))?$/);
  if (!m) continue;
  const lo = Number(m[1]), hi = Number(m[2] || m[1]);
  if (lo < 1 || hi > 60) continue;
  const cells = {};
  for (const raw of u.coords || []) {
    const c = place(raw);
    if (!db.znames[c[2]]) continue;
    const key = c[2] + ":" + Math.floor(c[0] / CELL) + ":" + Math.floor(c[1] / CELL);
    const cell = (cells[key] = cells[key] || { zone: c[2], n: 0, sx: 0, sy: 0 });
    cell.n++; cell.sx += c[0]; cell.sy += c[1];
  }
  for (const cell of Object.values(cells)) {
    if (cell.n < 2) continue;
    (mobs[cell.zone] = mobs[cell.zone] || []).push({ name, lo, hi, x: round1(cell.sx / cell.n), y: round1(cell.sy / cell.n), n: cell.n });
  }
}
const mobLines = ["-- Generated by tools/build-director.js from the pfQuest and pfQuest-turtle data. Do not edit by hand.",
  "-- Per map zone, one string of groups of ordinary mobs: name,lowest level,highest level,x,y,number of spawns;",
  "EasyRoute_Mobs = {"];
let mobGroups = 0;
for (const z of Object.keys(mobs).map(Number).sort((a, b) => a - b)) {
  if (!zones[z] && mobs[z].length < 30) continue; // empty corners of the world
  mobs[z].sort((a, b) => a.lo - b.lo || a.name.localeCompare(b.name));
  mobLines.push(`  [${z}] = ${q(mobs[z].map((g) => `${g.name},${g.lo},${g.hi},${g.x},${g.y},${g.n}`).join(";"))},`);
  mobGroups += mobs[z].length;
}
mobLines.push("}", "");

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "Zones.lua"), zoneLines.join("\n"));
fs.writeFileSync(path.join(OUT, "Mobs.lua"), mobLines.join("\n"));
console.log(`Zones.lua: ${kept} quests in ${zoneIds.length} zones (${skippedNoStart} skipped, no start position). ` +
  `${(fs.statSync(path.join(OUT, "Zones.lua")).size / 1024).toFixed(0)} KB`);
console.log(`Mobs.lua: ${mobGroups} mob groups. ${(fs.statSync(path.join(OUT, "Mobs.lua")).size / 1024).toFixed(0)} KB`);
