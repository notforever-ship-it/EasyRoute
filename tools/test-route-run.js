// Checks that the casual route (Data/Route.lua) runs in the real step engine: RouteRun.lua turns each visit into steps,
// Steps.lua lists them as guides, and a pretend game (tools/lib/fakegame.js) does what each step asks. It is quick because
// the windows are not redrawn while a whole path is walked.
// Usage: node tools/test-route-run.js     (needs fengari: npm install inside tools)

const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const { PRELUDE, PLAYER } = require("./lib/fakegame.js");

const ROOT = path.resolve(__dirname, "..");
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

function run(code, name) {
  const buf = typeof code === "string" ? to_luastring(code) : code;
  if (lauxlib.luaL_loadbuffer(L, buf, buf.length, to_luastring(name)) !== 0 || lua.lua_pcall(L, 0, 0, 0) !== 0) {
    console.error("FAILED in " + name + ": " + to_jsstring(lua.lua_tostring(L, -1)));
    process.exit(1);
  }
}

// A Lua global read back into JS.
function getNumber(name) {
  lua.lua_getglobal(L, to_luastring(name));
  const n = lua.lua_tonumber(L, -1);
  lua.lua_pop(L, 1);
  return n;
}
function getString(name) {
  lua.lua_getglobal(L, to_luastring(name));
  const s = lua.lua_isstring(L, -1) ? to_jsstring(lua.lua_tostring(L, -1)) : "";
  lua.lua_pop(L, 1);
  return s;
}

let jsFailures = 0;
function jsCheck(cond, msg) {
  if (!cond) {
    jsFailures++;
    console.log("  FAIL: " + msg);
  }
}

const started = Date.now();
run(PRELUDE, "prelude");
for (const f of ["Data/Zones.lua", "Data/ZoneSizes.lua", "Data/Route.lua", "Director.lua", "Steps.lua", "RouteReader.lua", "RouteRun.lua",
  "Arrow.lua", "Tracker.lua"]) {
  run(fs.readFileSync(path.join(ROOT, f)), f);
}
run(PLAYER, "player");

// Every section starts the same way: its own character, an empty log, nothing saved.
const SECTION_START = `
local ER = EasyRoute
local S = ER.Steps
`;

// Plays the steps of the guide being followed to its end. Returns steps walked and pushes; the first stuck steps are
// kept in STUCK_WHERE. The windows are not redrawn on the way, which is what makes a whole path quick.
const WALKER = `
function WalkGuide(ER, S)
  local walked, pushes, where, guard = 0, 0, {}, 0
  while S.Current() and guard < 5000 do
    guard = guard + 1
    local before, step = S.Position(), S.Current()
    Satisfy(step)
    NOW = NOW + 1
    S.Check()
    G.taxi = false
    if S.Position() == before then
      pushes = pushes + 1
      if table.getn(where) < 3 then
        local lines = {}
        for _, e in ipairs(step.elements) do table.insert(lines, e.kind .. ":" .. tostring(e.id or e.text or "")) end
        table.insert(where, "step " .. step.n .. " [" .. table.concat(lines, ", ") .. "]")
      end
      S.Next()
    end
    walked = walked + 1
  end
  return walked, pushes, where
end
`;
run(WALKER, "walker");

console.log("1. An Orc's Durotar visit runs as a guide");
run(SECTION_START + `
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.guides, ER.db.done, ER.db.autoNextOff = "hard", {}, {}, true
local infos = ER.RouteGuides()
check(table.getn(infos) == table.getn(EasyRoute_Route.paths.Orc), "the Orc path has " .. table.getn(EasyRoute_Route.paths.Orc) .. " visits but " .. table.getn(infos) .. " guides were made")
local first = infos[1]
check(first and first.name == "Durotar", "the first Orc guide is not Durotar: " .. tostring(first and first.name))
local key = "Casual route\\\\Durotar"
check(first and S.Key(first) == key, "the key of the first guide is " .. tostring(first and S.Key(first)))
local areas = ER.RouteReader.ReadVisit(first.visit)
G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
check(ER.StartGuide(key, true), "the Durotar visit did not start")
check(EasyRouteTracker:IsShown(), "the step window did not open")
local shown = ""
for i = 1, 10 do
  local b = _G["EasyRouteTrackerLine" .. i]
  if b and b:IsShown() then shown = shown .. b.text._text .. " / " end
end
check(string.find(shown, "Talk to", 1, true) ~= nil, "the box does not say who to talk to: " .. shown)
check(string.find(shown, "Accept ", 1, true) ~= nil, "the box does not say what to accept: " .. shown)
local target = S.Target()
check(target and target.zone == "Durotar", "the arrow has no place in Durotar: " .. tostring(target and target.zone))
print("  box: " .. shown)
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local walked, pushes, where = WalkGuide(ER, S)
ER.StepsChanged = savedChanged
check(pushes == 0, pushes .. " steps needed a push: " .. table.concat(where, "; "))
check(walked > 40, "only " .. walked .. " steps were walked in Durotar")
print("  Durotar: " .. walked .. " steps, " .. pushes .. " pushes")
`, "section 1");

console.log("2. Every race walks its whole casual path");
const VISITS = { Human: 16, Dwarf: 16, Gnome: 16, NightElf: 12, Orc: 13, Troll: 13, Tauren: 13, Scourge: 14 };
const FACTION = { Human: "Alliance", Dwarf: "Alliance", Gnome: "Alliance", NightElf: "Alliance", Orc: "Horde", Troll: "Horde",
  Tauren: "Horde", Scourge: "Horde" };
for (const race of Object.keys(VISITS)) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff = {}, {}, "hard", true
local race = G.race
local infos = ER.RouteGuides()
PATH_LENGTH = table.getn(EasyRoute_Route.paths[race])
check(table.getn(infos) == PATH_LENGTH, race .. ": " .. table.getn(infos) .. " guides for a path of " .. PATH_LENGTH .. " visits")
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local loaded, steps, pushes, where = 0, 0, 0, {}
local info = infos[1]
while info do
  check(S.Load(S.Key(info), true), race .. ": " .. info.name .. " did not load")
  loaded = loaded + 1
  local w, p, stuck = WalkGuide(ER, S)
  steps, pushes = steps + w, pushes + p
  for _, text in ipairs(stuck) do if table.getn(where) < 3 then table.insert(where, info.name .. " " .. text) end end
  info = S.NextGuide()
end
ER.StepsChanged = savedChanged
check(loaded == PATH_LENGTH, race .. ": walked " .. loaded .. " visits of " .. PATH_LENGTH)
check(pushes == 0, race .. ": " .. pushes .. " steps needed a push: " .. table.concat(where, "; "))
LOADED, PUSHES = loaded, pushes
print("  " .. race .. ": " .. loaded .. " visits, " .. steps .. " steps, " .. pushes .. " pushes")
S.Stop()
`, "section 2 " + race);
  jsCheck(getNumber("PATH_LENGTH") === VISITS[race], race + ": the path has " + getNumber("PATH_LENGTH") + " visits, expected " + VISITS[race]);
  jsCheck(getNumber("LOADED") === VISITS[race], race + ": " + getNumber("LOADED") + " visits were walked, expected " + VISITS[race]);
}

console.log("3. Carried quests and titles");
for (const race of Object.keys(VISITS)) {
  run(SECTION_START + `
G.race, G.faction = ${JSON.stringify(race)}, ${JSON.stringify(FACTION[race])}
local race = G.race
local infos = ER.RouteGuides()
-- the T lines of every visit: id -> number of lines, per visit
local handIns = {}
local carriedTotal, missing, bad = 0, 0, 0
for i, info in ipairs(infos) do
  local text = info.steps
  check(not string.find(text, "\\r", 1, true), race .. " " .. info.name .. ": a carriage return in the steps")
  handIns[i] = {}
  for line in string.gfind(text, "[^\\n]+") do
    local _, _, kind, id = string.find(line, "^(%u)\\t\\t(%d+)\\t")
    if kind == "A" or kind == "C" or kind == "T" then
      id = tonumber(id)
      if not S.QuestTitle(id) then missing = missing + 1 end
      if kind == "T" then handIns[i][id] = (handIns[i][id] or 0) + 1 end
    end
    if string.sub(line, 1, 2) == "S\\t" then
      local _, _, flags = string.find(line, "^S\\t[^\\t]*\\t[^\\t]*\\t(.*)$")
      if flags and flags ~= "" then
        for pair in string.gfind(flags, "[^;]+") do
          if not string.find(pair, "^[%w_]+=[^=;]*$") then bad = bad + 1 end
        end
        local _, _, title = string.find(flags, "title=([^;]*)")
        if title and (string.find(title, ";", 1, true) or string.find(title, "=", 1, true)) then bad = bad + 1 end
      end
    end
  end
end
check(missing == 0, race .. ": " .. missing .. " quest ids in the steps have no title")
check(bad == 0, race .. ": " .. bad .. " step flags are not key=value")
for i, info in ipairs(infos) do
  for _, area in ipairs(ER.RouteReader.ReadVisit(info.visit)) do
    for _, q in ipairs(area.q) do
      if q.id and string.find(q.flags, "x", 1, true) then
        carriedTotal = carriedTotal + 1
        local later = 0
        for j = i + 1, table.getn(infos) do later = later + (handIns[j][q.id] or 0) end
        check(later == 1, race .. ": quest " .. q.id .. " (" .. tostring(S.QuestTitle(q.id)) .. ") marked x in " .. info.name .. " has " .. later .. " hand-in steps in later visits")
        check((handIns[i][q.id] or 0) == 0, race .. ": quest " .. q.id .. " marked x is also handed in inside " .. info.name)
      end
    end
  end
end
CARRIED = carriedTotal
print("  " .. race .. ": " .. carriedTotal .. " carried quests, each handed in once; every quest has a title")
`, "section 3 " + race);
  jsCheck(getNumber("CARRIED") > 0, race + ": no quest marked x was found on the path");
}

console.log("4. The Finish line shows the objective count");
run(SECTION_START + `
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff = {}, {}, "hard", true
GetNumQuestLeaderBoards = function() return 1 end
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
S.Load(S.Key(ER.RouteGuides()[1]), true)
-- walk up to the first step that finishes a quest, with the quest in the log and not complete
local step, e
for guard = 1, 400 do
  step = S.Current()
  if not step then break end
  e = nil
  for _, el in ipairs(step.elements) do if el.kind == "C" and S.InLog(el.id) then e = el end end
  if e then break end
  local before = S.Position()
  Satisfy(step)
  NOW = NOW + 1
  S.Check()
  if S.Position() == before then S.Next() end
end
check(e ~= nil, "no Finish step with its quest in the log was found in Durotar")
if e then
  local line = S.Line(step, e)
  local plain = string.gsub(string.gsub(line.text, "|c%x%x%x%x%x%x%x%x", ""), "|r", "")
  check(string.find(plain, "%(Thing 1: 0/1%)$") ~= nil, "the Finish line does not end with the objective count: " .. plain)
  print("  " .. plain)
end
GetNumQuestLeaderBoards = nil
ER.StepsChanged = savedChanged
S.Stop()
`, "section 4");

// 5. The xp walk. A pretend player follows the generated steps of a whole path on Casual with the builder's own xp model
// (tools/lib/xpmodel.js): a hand-in gives the xp of the quest, a grind step lifts the player to its level, and a pick-up whose quest needs
// a higher level than the player has is a failure. Elite and escort quests are left out on Casual, so they give no xp and are not asked for.
const xp = require("./lib/xpmodel.js");
const RACES_WALKED = Object.keys(VISITS);
console.log("5. Every race: the plan never asks for a quest above your level");
for (const race of RACES_WALKED) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1
local infos = ER.RouteGuides()
local flagsOf = {}
for _, info in ipairs(infos) do
  for _, area in ipairs(ER.RouteReader.ReadVisit(info.visit)) do
    for _, q in ipairs(area.q) do
      if q.id and not flagsOf[q.id] then flagsOf[q.id] = q.flags end
    end
  end
end
local dump = {}
for _, info in ipairs(infos) do
  for line in string.gfind(ER.RouteGenerate(info), "[^\\n]+") do
    local _, _, kind, id = string.find(line, "^(%u)\\t\\t(%d+)\\t")
    if kind == "A" then
      local row = ER.QuestRow(tonumber(id))
      table.insert(dump, "A\\t" .. id .. "\\t" .. tostring(row and row.m or 1) .. "\\t" .. (flagsOf[tonumber(id)] or "") .. "\\t" .. info.visit.zone)
    elseif kind == "T" then
      local row = ER.QuestRow(tonumber(id))
      table.insert(dump, "T\\t" .. id .. "\\t" .. tostring(row and row.l or 1) .. "\\t" .. (flagsOf[tonumber(id)] or ""))
    else
      local _, _, level = string.find(line, "^X\\t\\t\\t(%d+)\\t")
      if level then table.insert(dump, "X\\t" .. level .. "\\t" .. info.visit.zone) end
    end
  end
end
WALK_DUMP = table.concat(dump, "\\n")
`, "section 5 dump " + race);
  const lines = getString("WALK_DUMP").split("\n");
  let total = 0, grindSteps = 0, above = 0;
  const done = new Set(), examples = [], shown = [];
  for (const line of lines) {
    const f = line.split("\t");
    if (f[0] === "X") {
      grindSteps++;
      shown.push(f[1] + " in " + f[2]);
      total = Math.max(total, xp.xpAt(Number(f[1])));
    } else if (f[0] === "A" || f[0] === "T") {
      const id = f[1], flags = f[3];
      if (/[es]/.test(flags)) continue;
      const lv = Math.floor(xp.levelAt(total));
      if (f[0] === "A") {
        if (Number(f[2]) > lv) {
          above++;
          if (examples.length < 5) examples.push(`quest ${id} in ${f[4]} needs level ${f[2]}, the player has ${lv}`);
        }
      } else if (!done.has(id)) {
        done.add(id);
        total += xp.questXP(Number(f[2]), lv) + (flags.indexOf("k") >= 0 ? xp.K * xp.killXP(lv, Number(f[2])) : 0);
      }
    }
  }
  console.log(`  ${race}: ${grindSteps} grind steps, ${above} pick-ups above your level`);
  for (const e of examples) console.log("    " + e);
  if (process.env.ER_SHOW_GRIND) console.log("    grind steps (level in zone): " + shown.join(", "));
  jsCheck(above === 0, `${race}: ${above} pick-ups are above the player's level on Casual`);
}

console.log("6. The steps of a visit are the same at any level and difficulty");
// [race, faction, zone, which visit of that zone: 1 = the first, "last" = the last visit of the path]
const SAME_AT_ANY_LEVEL = [["Human", "Alliance", null, 1], ["Orc", "Horde", "The Barrens", 1], ["Scourge", "Horde", null, "last"]];
for (const [race, faction, zone, which] of SAME_AT_ANY_LEVEL) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(faction)}, 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff = {}, {}, "casual", true
local infos = ER.RouteGuides()
local info
if ${JSON.stringify(which)} == "last" then
  info = infos[table.getn(infos)]
else
  for _, i in ipairs(infos) do
    if not info and (${JSON.stringify(zone)} == nil or i.visit.zone == ${JSON.stringify(zone)}) then info = i end
  end
end
check(info ~= nil, ${JSON.stringify(race)} .. ": the visit to compare was not found")
local plain = ER.RouteGenerate(info)
-- two quests of the visit in the pretend log, level 40, Hard
local taken = 0
for line in string.gfind(plain, "[^\\n]+") do
  local _, _, id = string.find(line, "^A\\t\\t(%d+)\\t")
  if id and taken < 2 then
    local title = S.QuestTitle(tonumber(id))
    if title and not G.log[title] then
      G.log[title] = { complete = false, objs = {} }
      table.insert(G.order, title)
      taken = taken + 1
    end
  end
end
G.level = 40
ER.db.mode = "hard"
local again = ER.RouteGenerate(info)
SAME_LEN = string.len(plain)
SAME_AT_ALL = (plain == again) and 1 or 0
SAME_TAKEN = taken
`, "section 6 " + race);
  jsCheck(getNumber("SAME_TAKEN") === 2, `${race}: only ${getNumber("SAME_TAKEN")} quests could be put in the pretend log`);
  jsCheck(getNumber("SAME_AT_ALL") === 1, `${race}: the steps of the visit change with the level, the difficulty or the quest log`);
  console.log(`  ${race} ${zone || (which === "last" ? "(last visit)" : "(first visit)")}: ${getNumber("SAME_LEN")} characters of steps, the same at level 1 on Casual and level 40 on Hard`);
}

console.log("7. The first step picks up a quest; Needs level shows when you are too low");
for (const race of Object.keys(VISITS)) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff = {}, {}, "casual", true
local infos = ER.RouteGuides()
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
check(S.Load(S.Key(infos[1]), true), ${JSON.stringify(race)} .. ": the first visit did not load")
local step = S.Current()
check(step ~= nil, ${JSON.stringify(race)} .. ": the first visit has no step")
local hasA, hasX = false, false
for _, e in ipairs(step and step.elements or {}) do
  if e.kind == "A" then hasA = true end
  if e.kind == "X" then hasX = true end
end
check(hasA, ${JSON.stringify(race)} .. ": the first step does not pick up a quest")
check(not hasX, ${JSON.stringify(race)} .. ": the first step is a grind step")
ER.StepsChanged = savedChanged
S.Stop()
`, "section 7a " + race);
}
run(SECTION_START + `
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff = {}, {}, "hard", true
local barrens
for _, i in ipairs(ER.RouteGuides()) do
  if not barrens and i.visit.zone == "The Barrens" then barrens = i end
end
check(barrens ~= nil, "no Barrens visit for the Orc")
-- the first step of the visit with a pick-up whose quest needs more than level 1
local at, want, n = nil, nil, 0
for line in string.gfind(ER.RouteGenerate(barrens), "[^\\n]+") do
  if string.sub(line, 1, 2) == "S\\t" then n = n + 1 end
  local _, _, id = string.find(line, "^A\\t\\t(%d+)\\t")
  if id and not at then
    local row = ER.QuestRow(tonumber(id))
    if row and row.m and row.m > 1 then at, want = n, row.m end
  end
end
check(at ~= nil, "the Barrens visit has no pick-up above level 1")
local function BoxText()
  local shown = ""
  for i = 1, 10 do
    local b = _G["EasyRouteTrackerLine" .. i]
    if b and b:IsShown() then shown = shown .. b.text._text .. " / " end
  end
  return shown
end
local before, during, atLevel, high = "", "", "", ""
if at then
  check(ER.StartGuide(S.Key(barrens), true), "the Barrens visit did not start")
  S.Jump(at)
  check(S.Position() == at, "the jump went to step " .. S.Position() .. " not " .. at)
  ER.StepsChanged()
  during = BoxText()
  G.level = want
  ER.StepsChanged()
  atLevel = BoxText()
  G.level = 60
  ER.StepsChanged()
  high = BoxText()
end
NEED_SHOWN = string.find(during, "Needs level " .. tostring(want), 1, true) and 1 or 0
NEED_AT_LEVEL = string.find(atLevel, "Needs level", 1, true) and 1 or 0
NEED_AT_60 = string.find(high, "Needs level", 1, true) and 1 or 0
NEED_BOX = during
S.Stop()
`, "section 7b");
jsCheck(getNumber("NEED_SHOWN") === 1, "the box does not say Needs level at level 1 on a Barrens pick-up: " + getString("NEED_BOX"));
jsCheck(getNumber("NEED_AT_LEVEL") === 0, "the box still says Needs level when the player has the level");
jsCheck(getNumber("NEED_AT_60") === 0, "the box says Needs level at level 60");
console.log("  Needs level: shown at level 1 on a Barrens pick-up (" + getString("NEED_BOX").replace(/\|c[0-9a-fA-F]{8}|\|r/g, "") + "), gone at the right level and at level 60");

// 8. Difficulty on the casual route. The plan's flags e (elite) and s (escort) decide what Steps.lua LeftOut answers:
// Casual leaves out both, Medium only the elite ones, Hard neither. A quest in the log always stays.
console.log("8. Casual, Medium and Hard on the casual route");
for (const [race, faction] of [["Human", "Alliance"], ["Orc", "Horde"]]) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(faction)}, 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.autoNextOff = {}, {}, true
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end

local function FlagsOfVisit(info)
  local flags = {}
  for _, area in ipairs(ER.RouteReader.ReadVisit(info.visit)) do
    for _, q in ipairs(area.q) do
      if q.id then flags[q.id] = q.flags end
    end
  end
  return flags
end
local function FirstWith(letter)
  for _, info in ipairs(ER.RouteGuides()) do
    for _, f in pairs(FlagsOfVisit(info)) do
      if string.find(f, letter, 1, true) then return info end
    end
  end
  return nil
end

-- e quests and s quests whose pick-up the player would see: the step fits and the quest is not left out.
local function Count(info, mode)
  ER.db.mode, ER.db.guides, ER.db.done = mode, {}, {}
  G.log, G.order = {}, {}
  G.level = info.lo
  check(S.Load(S.Key(info), true), info.name .. " did not load")
  local flags = FlagsOfVisit(info)
  local e, s = 0, 0
  for n = 1, S.Count() do
    local step = S.Step(n)
    if S.Fits(step) then
      for _, el in ipairs(step.elements) do
        if el.kind == "A" and not S.LeftOut(el.id) then
          local f = flags[el.id] or ""
          if string.find(f, "e", 1, true) then e = e + 1 end
          if string.find(f, "s", 1, true) then s = s + 1 end
        end
      end
    end
  end
  return e, s
end

local eVisit, sVisit = FirstWith("e"), FirstWith("s")
E_FOUND = (E_FOUND or 0) + (eVisit and 1 or 0)
S_FOUND = (S_FOUND or 0) + (sVisit and 1 or 0)
local seen = {}
for _, info in ipairs({ eVisit or {}, sVisit or {} }) do
  if info.visit and not seen[info] then
    seen[info] = true
    local ce, cs = Count(info, "casual")
    local me, ms = Count(info, "medium")
    local he, hs = Count(info, "hard")
    local who = ${JSON.stringify(race)} .. " " .. info.name
    check(ce == 0 and cs == 0, who .. ": Casual still picks up " .. ce .. " elite and " .. cs .. " escort quests")
    check(me == 0, who .. ": Medium still picks up " .. me .. " elite quests")
    check(he >= 1 or info ~= eVisit, who .. ": Hard shows no elite quest")
    check(ms >= 1 or info ~= sVisit, who .. ": Medium shows no escort quest")
    check(hs >= 1 or info ~= sVisit, who .. ": Hard shows no escort quest")
    print("  " .. who .. ": casual " .. ce .. "/" .. cs .. ", medium " .. me .. "/" .. ms .. ", hard " .. he .. "/" .. hs)
  end
end

-- a quest you have stays, even on Casual
if eVisit then
  local flags = FlagsOfVisit(eVisit)
  local pick
  for id, f in pairs(flags) do
    if string.find(f, "e", 1, true) and not pick then pick = id end
  end
  ER.db.mode, ER.db.guides = "casual", {}
  check(S.Load(S.Key(eVisit), true), "the elite visit did not load")
  check(S.LeftOut(pick) == true, "an elite quest that is not in the log is not left out on Casual")
  local title = S.QuestTitle(pick)
  G.log[title] = { complete = false, objs = {} }
  table.insert(G.order, title)
  check(S.LeftOut(pick) == false, "an elite quest in the log is left out on Casual")
  G.log[title] = nil
  G.order = {}

  -- a change of difficulty on a step keeps the place in the guide
  ER.db.mode, ER.db.guides, G.log = "hard", {}, {}
  G.level = eVisit.lo
  check(S.Load(S.Key(eVisit), true), "the elite visit did not load on Hard")
  for i = 1, 6 do
    local before, step = S.Position(), S.Current()
    if not step then break end
    Satisfy(step)
    NOW = NOW + 1
    S.Check()
  end
  local at = S.Position()
  ER.db.mode = "casual"
  S.Check()
  check(S.Position() == at, "switching from Hard to Casual moved the guide from step " .. at .. " to " .. S.Position())
end
ER.StepsChanged = savedChanged
S.Stop()
`, "section 8 " + race);
}

// 9. Ahead of the plan. At the top level of a zone the quests you have not started drop, the zone ends after the quests you have,
// the next one starts by itself, and the chat gets one line. A zone that ends because its quests ran out gets one line too.
console.log("9. Ahead of the plan");
function aheadStart(race, faction, zone) {
  return SECTION_START + `
G.race, G.class, G.faction = "${race}", "WARRIOR", "${faction}"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff = {}, {}, "hard", nil
local infos = ER.RouteGuides()
local first = infos[1]
check(first and first.name == "${zone}", "the first ${race} guide is not ${zone}")
first.ahead = nil
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local seen = {}
local origSatisfy = Satisfy
Satisfy = function(step)
  for _, e in ipairs(step.elements) do
    if e.kind == "A" or e.kind == "C" or e.kind == "T" then seen[e.id] = true end
  end
  origSatisfy(step)
end
-- Plays the running guide until another one runs. pin: the level the pretend player is kept at (nil: it grows with the grind steps).
local function WalkOut(pin)
  local guard = 0
  while S.Info() == first and guard < 1000 do
    guard = guard + 1
    local step = S.Current()
    if not step then break end
    local before = S.Position()
    Satisfy(step)
    if pin then G.level = pin end
    NOW = NOW + 1
    S.Check()
    G.taxi = false
    if S.Info() == first and S.Position() == before then
      S.Next()
      S.Check()
    end
  end
  return guard
end
local function Lines(text)
  local n = 0
  for _ in string.gfind(text or "", "Easy Route:") do n = n + 1 end
  return n
end
`;
}
const AHEAD_START = aheadStart("Orc", "Horde", "Durotar");
// 9a: one level above Durotar's top level with two quests in the log
run(AHEAD_START + `
G.level = first.hi + 1
-- two quests of the visit in the pretend log
local mine, count = {}, 0
for _, area in ipairs(ER.RouteReader.ReadVisit(first.visit)) do
  for _, q in ipairs(area.q) do
    if q.id and count < 2 and not string.find(q.flags, "[xes]") then
      local title = S.QuestTitle(q.id)
      if title and not G.log[title] then
        G.log[title] = { complete = false, objs = {} }
        table.insert(G.order, title)
        mine[q.id] = true
        count = count + 1
      end
    end
  end
end
check(count == 2, "only " .. count .. " Durotar quests could be put in the pretend log")
CHAT = ""
check(S.Load(S.Key(first), true), "Durotar did not load")
-- A quest the route grinds you up for (its grind mark or its own minimum level is the zone's top level) stays when you are above that
-- level; the other quests you have not started drop.
local stays, droppable = {}, nil
for _, area in ipairs(ER.RouteReader.ReadVisit(first.visit)) do
  for _, q in ipairs(area.q) do
    local row = ER.QuestRow(q.id)
    if (q.grind and q.grind >= first.hi) or (row and row.m and row.m >= first.hi) then
      stays[q.id] = true
    elseif q.id and not mine[q.id] and not droppable then
      droppable = q.id
    end
  end
end
check(next(stays) ~= nil, "no Durotar quest needs the zone's top level, so the stay rule is not tried")
check(droppable ~= nil, "no Durotar quest is left to drop above the top level")
for id in pairs(stays) do check(ER.RouteLeftOut(id) == false, "quest " .. id .. " needs the zone's top level but is dropped above it") end
check(droppable and ER.RouteLeftOut(droppable) == true, "quest " .. tostring(droppable) .. " is not dropped above the zone's top level")
local guard = WalkOut(nil)
local now = S.Info()
check(now ~= first and now and now.visit.zone == "Orgrimmar" and now.stop, "the guide that runs after Durotar is " .. tostring(now and now.name))
local strangers = 0
for id in pairs(seen) do if not mine[id] and not stays[id] then strangers = strangers + 1 end end
check(strangers == 0, strangers .. " quests other than the two in the log and the ones that need the top level were picked up, worked on or handed in in Durotar")
for id in pairs(mine) do check(S.TurnedIn(id), "quest " .. id .. " from the log was not handed in before the zone ended") end
check(Lines(CHAT) == 1, "the chat has " .. Lines(CHAT) .. " Easy Route lines: " .. tostring(CHAT))
check(string.find(CHAT, "You are ahead of the plan: moving on to Orgrimmar", 1, true) ~= nil, "no ahead line in the chat: " .. tostring(CHAT))
AHEAD_A = string.gsub(string.gsub(tostring(CHAT), "|c%x%x%x%x%x%x%x%x", ""), "|r", "")
AHEAD_STEPS = guard
Satisfy = origSatisfy
ER.StepsChanged = savedChanged
S.Stop()
`, "section 9a");
console.log("  Durotar at level 11 with two quests in the log (" + getNumber("AHEAD_STEPS") + " steps): " + getString("AHEAD_A").replace(/\|$/, ""));

// 9b: a player who stays at level 1 runs out of Durotar quests; the player's level is pinned because the grind steps would
// lift it to the top of the zone, which 9d covers.
run(AHEAD_START + `
G.level = 1
CHAT = ""
check(S.Load(S.Key(first), true), "Durotar did not load")
WalkOut(1)
local now = S.Info()
check(now ~= first and now and now.visit.zone == "Orgrimmar", "the guide that runs after Durotar is " .. tostring(now and now.name))
check(Lines(CHAT) == 1, "the chat has " .. Lines(CHAT) .. " Easy Route lines: " .. tostring(CHAT))
check(string.find(CHAT, "Durotar is done. Now following Orgrimmar", 1, true) ~= nil, "no done line in the chat: " .. tostring(CHAT))
check(string.find(CHAT, "ahead", 1, true) == nil, "the done line says ahead: " .. tostring(CHAT))
AHEAD_B = string.gsub(string.gsub(tostring(CHAT), "|c%x%x%x%x%x%x%x%x", ""), "|r", "")

-- 9c: the old "move on?" question stays away from a route zone
G.level = 30
ER.db.autoNextOff = true
check(S.Load(S.Key(first), true), "Durotar did not load again")
OUTLEVELLED_FALSE = (S.Outlevelled() == false) and 1 or 0
Satisfy = origSatisfy
ER.StepsChanged = savedChanged
S.Stop()
`, "section 9b");
// 9d: a player who follows the plan exactly gets the "done" line, not the "ahead" line. The walker's grind steps lift the pretend player
// to the zone's top level on the way (the route's own "Grind to level N" step comes before quests that need level N), and the zone must
// stay whole at that level.
for (const [race, faction, zone] of [["Orc", "Horde", "Durotar"], ["Human", "Alliance", "Elwynn Forest"]]) {
  run(aheadStart(race, faction, zone) + `
G.level = 1
CHAT = ""
check(S.Load(S.Key(first), true), "${zone} did not load")
WalkOut(nil)
local now = S.Info()
check(now ~= first and now ~= nil, "the guide after ${zone} never started")
check(G.level >= first.hi, "the plan's grind steps did not lift the pretend player to the top level of ${zone}: " .. G.level .. " of " .. first.hi)
check(Lines(CHAT) == 1, "the chat has " .. Lines(CHAT) .. " Easy Route lines: " .. tostring(CHAT))
check(string.find(CHAT, "${zone} is done. Now following", 1, true) ~= nil, "no done line in the chat: " .. tostring(CHAT))
check(string.find(CHAT, "ahead", 1, true) == nil, "a player who follows the plan exactly is told they are ahead: " .. tostring(CHAT))
FOLLOW_EXACT = string.gsub(string.gsub(tostring(CHAT), "|c%x%x%x%x%x%x%x%x", ""), "|r", "")
Satisfy = origSatisfy
ER.StepsChanged = savedChanged
S.Stop()
`, "section 9d " + race);
  console.log("  " + zone + ", following the plan exactly: " + getString("FOLLOW_EXACT").replace(/\|$/, ""));
}

jsCheck(getNumber("OUTLEVELLED_FALSE") === 1, "Outlevelled asks to move on in a casual-route zone at level 30");
console.log("  Durotar at level 1, quests run out: " + getString("AHEAD_B").replace(/\|$/, "") + " (Outlevelled stays false at level 30)");

jsCheck(getNumber("E_FOUND") > 0, "no visit with an elite quest (flag e) on the Human or the Orc path");
jsCheck(getNumber("S_FOUND") > 0, "no visit with an escort quest (flag s) on the Human or the Orc path");

const secs = (Date.now() - started) / 1000;
console.log("  (" + secs.toFixed(1) + " seconds)");
const luaFailures = getNumber("failures");
const total = luaFailures + jsFailures;
if (total === 0) {
  console.log("ALL ROUTE RUN CHECKS PASSED");
} else {
  console.log(total + " CHECK(S) FAILED");
  process.exit(1);
}
