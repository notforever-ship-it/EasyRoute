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
for (const f of ["Data/Zones.lua", "Data/Guides.lua", "Data/ZoneSizes.lua", "Data/Route.lua", "Director.lua", "Steps.lua", "RouteReader.lua", "RouteRun.lua",
  "Arrow.lua", "Tracker.lua", "Simple.lua"]) {
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

// 10. Travel steps. A visit starts with the way from the zone before: one step for each leg of the travel entry. It points at the leg's
// place, ticks when the zone is reached, and is left out at once when you already stand there.
console.log("10. Travel steps: Durotar to Orgrimmar");
run(SECTION_START + `
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.guides, ER.db.done, ER.db.autoNextOff = "hard", {}, {}, true
local infos = ER.RouteGuides()
local org = infos[2]
check(org and org.visit.zone == "Orgrimmar" and org.stop, "the second Orc guide is not the Orgrimmar stop: " .. tostring(org and org.name))
G.zone, G.x, G.y = "Durotar", 43.56, 15.08
check(S.Load(S.Key(org), true), "the Orgrimmar stop did not load")
local step = S.Current()
check(step and S.Title(step) == "Go to Orgrimmar", "the first step of the Orgrimmar stop is " .. tostring(step and S.Title(step)))
local words = ""
for _, e in ipairs(step and step.elements or {}) do
  local line = S.Line(step, e)
  if line then words = words .. line.text .. " / " end
end
check(string.find(words, "Follow the road north from Razor Hill to Orgrimmar.", 1, true) ~= nil, "the travel words are not in the step: " .. words)
local target = S.Target()
check(target and target.zone == "Durotar" and math.abs(target.x - 43.56) < 0.01 and math.abs(target.y - 15.08) < 0.01,
  "the arrow does not point at the road out of Durotar: " .. tostring(target and (target.zone .. " " .. target.x .. " " .. target.y)))
local here = S.Position()
NOW = NOW + 1
S.Check()
check(S.Position() == here, "the travel step ticked while the player was still in Durotar")
G.zone = "Orgrimmar"
NOW = NOW + 1
S.Check()
check(S.Position() > here, "the travel step did not tick when the player reached Orgrimmar")
TRAVEL_WORDS = string.gsub(words, " / $", "")
-- Already there: the step is left out at once.
S.Stop()
ER.db.guides = {}
G.zone = "Orgrimmar"
check(S.Load(S.Key(org), true), "the Orgrimmar stop did not load a second time")
local now = S.Current()
check(now and S.Title(now) ~= "Go to Orgrimmar", "the travel step is shown to a player who already stands in Orgrimmar")
S.Stop()
`, "section 10");
console.log("  " + getString("TRAVEL_WORDS"));

// 10b: a move with two legs (a flight, then a walk): Westfall to Redridge Mountains. The flight ticks on the taxi, the walk when the zone is reached,
// and a player who already stands in Stormwind City starts at the walk.
run(SECTION_START + `
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.guides, ER.db.done, ER.db.autoNextOff = "hard", {}, {}, true
local red
for _, info in ipairs(ER.RouteGuides()) do
  if info.visit.zone == "Redridge Mountains" then red = info end
end
check(red ~= nil, "the Human path has no Redridge Mountains visit")
local function Words(step)
  local words = ""
  for _, e in ipairs(step and step.elements or {}) do
    local line = S.Line(step, e)
    if line then words = words .. line.text .. " / " end
  end
  return words
end
local function Is(text)
  return string.find(Words(S.Current()), text, 1, true) ~= nil
end
G.zone, G.x, G.y = "Westfall", 56.55, 52.64
check(S.Load(S.Key(red), true), "the Redridge Mountains visit did not load")
check(S.Title(S.Current()) == "Go to Redridge Mountains" and Is("Fly from Sentinel Hill to Stormwind."), "the first step is not the flight: " .. Words(S.Current()))
local thor = S.Target()
check(thor and thor.zone == "Westfall" and math.abs(thor.x - 56.55) < 0.01 and math.abs(thor.y - 52.64) < 0.01,
  "the arrow of the flight does not point at the flight master in Westfall: " .. tostring(thor and (thor.zone .. " " .. thor.x .. " " .. thor.y)))
NOW = NOW + 1
S.Check()
check(Is("Fly from Sentinel Hill to Stormwind."), "the flight step ticked before the player took off")
G.taxi = true
NOW = NOW + 1
S.Check()
G.taxi = false
check(S.Title(S.Current()) == "Go to Redridge Mountains" and Is("Leave Stormwind by the main gate"), "the walk does not follow the flight: " .. Words(S.Current()))
local target = S.Target()
check(target and target.zone == "Stormwind City", "the arrow of the walk is not in Stormwind City: " .. tostring(target and target.zone))
G.zone = "Stormwind City"
NOW = NOW + 1
S.Check()
check(Is("Leave Stormwind by the main gate"), "the walk ticked in Stormwind City")
G.zone = "Redridge Mountains"
NOW = NOW + 1
S.Check()
check(S.Title(S.Current()) ~= "Go to Redridge Mountains", "the walk did not tick when the player reached Redridge Mountains")
S.Stop()
-- Standing in Stormwind City already: the flight is left out, the walk is first.
ER.db.guides = {}
G.zone, G.x, G.y = "Stormwind City", 50, 50
check(S.Load(S.Key(red), true), "the Redridge Mountains visit did not load from Stormwind City")
check(Is("Leave Stormwind by the main gate") and not Is("Fly from"), "from Stormwind City the first step is not the walk: " .. Words(S.Current()))
S.Stop()
`, "section 10b");

// 11. One flight end to end. The Human gets the Stormwind City flight path at level 10 (first Stormwind City visit) and the flight from
// Duskwood at 28 lands on it (the later visit, "Stormwind City 2", starts with that flight).
console.log("11. One flight: Stormwind City");
run(SECTION_START + `
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.guides, ER.db.done, ER.db.autoNextOff = "hard", {}, {}, true
local infos = ER.RouteGuides()
local fly
for _, leg in ipairs(ER.RouteReader.ReadTravel(EasyRoute_Route.travel["Alliance|Duskwood>Stormwind City"])) do
  if leg.kind == "fly" then fly = leg end
end
check(fly and fly.to, "the Duskwood to Stormwind City move has no fly leg in this build")
local landing = fly and fly.to or "?"
local first, later
for _, info in ipairs(infos) do
  if info.visit.zone == "Stormwind City" then
    if not first then first = info elseif not later then later = info end
  end
end
check(first and later and later.name == "Stormwind City 2", "the Human path has no second Stormwind City visit")
local text = ER.RouteGenerate(first)
check(string.find(text, "\\nP\\t\\t" .. landing .. "\\t", 1, true) ~= nil, "the first Stormwind City visit has no flight path step for " .. landing)
check(string.find(text, "title=Get the flight path", 1, true) ~= nil, "the first Stormwind City visit has no 'Get the flight path' title")
-- the first step of the later visit is the flight to that flight master
local steps = ER.RouteGenerate(later)
local head = string.sub(steps, 1, (string.find(steps, "\\nS\\t\\t\\t", 5, true) or string.len(steps)))
check(string.find(head, "\\nF\\t\\t" .. landing .. "\\t", 1, true) ~= nil, "the later Stormwind City visit does not start with the flight to " .. landing)
-- walk the whole path: the flight path is taught (its step ticks) before the flight that lands on it ticks
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local events, pushes = {}, 0
local info = infos[1]
check(S.Load(S.Key(info), true), "the first Human visit did not load")
local guard = 0
while S.Current() and guard < 8000 do
  guard = guard + 1
  local before, step, at = S.Position(), S.Current(), S.Info().name
  Satisfy(step)
  NOW = NOW + 1
  S.Check()
  G.taxi = false
  if S.Position() == before then
    pushes = pushes + 1
    S.Next()
  else
    for _, e in ipairs(step.elements) do
      if e.kind == "P" then table.insert(events, "P:" .. tostring(e.name) .. "@" .. at) end
      if e.kind == "F" then table.insert(events, "F:" .. tostring(e.dest) .. "@" .. at) end
    end
  end
  if not S.Current() then
    local nextInfo = S.NextGuide()
    if nextInfo then S.Load(S.Key(nextInfo), true) end
  end
end
ER.StepsChanged = savedChanged
local p, f
for i, ev in ipairs(events) do
  if ev == "P:" .. landing .. "@Stormwind City" and not p then p = i end
  if ev == "F:" .. landing .. "@Stormwind City 2" and not f then f = i end
end
check(p ~= nil, "the walk never got the flight path of " .. landing)
check(f ~= nil, "the walk never took the flight to " .. landing)
check(p and f and p < f, "the flight to " .. landing .. " came before its flight path was taught")
check(pushes == 0, pushes .. " steps needed a push on the Human path")
ONE_FLIGHT = landing .. ": taught as event " .. tostring(p) .. ", flown as event " .. tostring(f) .. ", " .. pushes .. " pushes"
S.Stop()
`, "section 11");
console.log("  " + getString("ONE_FLIGHT"));

// 12. Every race, over the generated steps of its whole path in order: every zone after the first starts with its travel steps, and every
// flight lands on a flight path the path has already taught. A flight path is taught by a "Get the flight path" step (a P element), and a
// flight master you take off from is known from then on, because you learn it by talking to it (the builder uses the same two ways).
console.log("12. Every zone starts with its travel; every flight lands on a taught flight path");
for (const race of Object.keys(VISITS)) {
  run(SECTION_START + `
G.race, G.class, G.faction = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}
local race, faction = G.race, G.faction
local infos = ER.RouteGuides()
local function Fields(line)
  local out, pos = {}, 1
  while true do
    local a, b = string.find(line, "\\t", pos, true)
    if not a then table.insert(out, string.sub(line, pos)) break end
    table.insert(out, string.sub(line, pos, a - 1))
    pos = b + 1
  end
  return out
end
-- "zone|x|y" -> the name of the flight master standing there
local atPlace = {}
for key, text in pairs(EasyRoute_Route.flights) do
  local bar = string.find(key, "|", 1, true)
  if string.sub(key, 1, bar - 1) == faction then
    for line in string.gfind(text, "[^\\n]+") do
      local f = Fields(line)
      atPlace[string.sub(key, bar + 1) .. "|" .. tostring(tonumber(f[1])) .. "|" .. tostring(tonumber(f[2]))] = f[3]
    end
  end
end
local taught = {}
local travel, taughtCount, flights = 0, 0, 0
for n, info in ipairs(infos) do
  local steps = {}
  for line in string.gfind(ER.RouteGenerate(info), "[^\\n]+") do
    local f = Fields(line)
    if f[1] == "S" then
      local _, _, title = string.find(f[4] or "", "title=([^;]*)")
      table.insert(steps, { title = title or "", elements = {} })
    elseif steps[table.getn(steps)] then
      table.insert(steps[table.getn(steps)].elements, f)
    end
  end
  if n > 1 then
    check(steps[1] and string.find(steps[1].title, "^Go to ") ~= nil, race .. ": " .. info.name .. " does not start with a travel step: " .. tostring(steps[1] and steps[1].title))
  end
  for _, step in ipairs(steps) do
    if string.find(step.title, "^Go to ") then travel = travel + 1 end
    local place
    for _, e in ipairs(step.elements) do
      if e[1] == "G" then place = e end
      if e[1] == "P" then
        taught[e[3]] = true
        taughtCount = taughtCount + 1
      end
      if e[1] == "F" then
        flights = flights + 1
        check(taught[e[3]], race .. ": " .. info.visit.zone .. ": the flight to " .. e[3] .. " lands on a flight path no earlier step teaches")
        local from = place and atPlace[tostring(place[3]) .. "|" .. tostring(tonumber(place[4])) .. "|" .. tostring(tonumber(place[5]))]
        if from then taught[from] = true end
      end
    end
  end
end
TRAVEL_LINE = race .. ": " .. travel .. " travel steps, " .. taughtCount .. " flight paths, " .. flights .. " flights"
TRAVEL_STEPS, FLIGHT_PATHS = travel, taughtCount
`, "section 12 " + race);
  console.log("  " + getString("TRAVEL_LINE"));
  jsCheck(getNumber("TRAVEL_STEPS") >= VISITS[race] - 1, race + ": only " + getNumber("TRAVEL_STEPS") + " travel steps for " + (VISITS[race] - 1) + " moves");
  jsCheck(getNumber("FLIGHT_PATHS") > 0, race + ": no flight path step on the whole path");
}

// 13. The arrow points across zones. S.CrossYards gives the way from a place in one zone to a place in another zone of the same continent
// (Data/ZoneSizes.lua: l grows to the west, t to the north); Arrow.lua turns the pointer that way and still says "Go to <zone>". On another
// continent the pointer stays hidden. The signs come from the data only, they have not been tried in the game.
console.log("13. The arrow points across zones");
run(SECTION_START + `
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.guides, ER.db.done, ER.db.autoNextOff, ER.db.arrowOff = "hard", {}, {}, true, nil
-- Westfall lies west of Elwynn Forest, Orgrimmar north of Durotar's Razor Hill, and Durotar is on another continent than Elwynn Forest
local yards, east, south = S.CrossYards("Elwynn Forest", 40, 60, "Westfall", 50, 50)
check(yards and east < 0, "Elwynn Forest to Westfall: east should be below 0 (the place is to the west), got " .. tostring(east))
yards, east, south = S.CrossYards("Durotar", 52, 43, "Orgrimmar", 50, 50)
check(yards and south < 0, "Durotar to Orgrimmar: south should be below 0 (the place is to the north), got " .. tostring(south))
CROSS_YARDS = yards and math.floor(yards + 0.5) or -1
check(S.CrossYards("Durotar", 52, 43, "Elwynn Forest", 40, 60) == nil, "Durotar to Elwynn Forest should give nothing (another continent)")
check(S.CrossYards("Durotar", 52, 43, "Nowhere", 40, 60) == nil, "a zone that is not in the table should give nothing")
-- the arrow, with the Durotar visit running
local first = ER.RouteGuides()[1]
G.zone, G.x, G.y, G.facing = "Durotar", 52, 43, 0
check(S.Load(S.Key(first), true), "the Durotar visit did not load")
local savedChanged, saved = ER.StepsChanged, S.Target
local function ArrowTo(zone, x, y)
  S.Target = function() return { zone = zone, x = x, y = y, text = "test" } end
  NOW = NOW + 1
  ER.ArrowUpdate()
  S.Target = saved
  local words, pointer
  for _, f in ipairs(ALLFRAMES) do
    if rawget(f, "_coord") then pointer = f end
    if string.find(rawget(f, "_text") or "", "Go to ", 1, true) then words = f._text end
  end
  return words, pointer
end
local words, pointer = ArrowTo("Orgrimmar", 50, 50)
check(words and string.find(words, "Go to Orgrimmar", 1, true) ~= nil, "the arrow does not say 'Go to Orgrimmar': " .. tostring(words))
check(pointer and pointer:IsShown(), "the pointer is hidden for a place in Orgrimmar")
-- Orgrimmar is 330 yards west and 1500 north of Razor Hill: a little to the left of straight ahead (cell 2 of 64 on our own sheet)
check(pointer and pointer._coord and math.abs(pointer._coord[1] - 2 / 8) < 1e-6 and pointer._coord[3] == 0, "the pointer does not turn a little to the left")
G.facing = math.pi
words, pointer = ArrowTo("Orgrimmar", 50, 50)
check(pointer and pointer:IsShown() and pointer._coord[3] ~= 0, "facing south the pointer should turn well away from straight ahead")
G.facing = 0
words, pointer = ArrowTo("Elwynn Forest", 40, 60)
check(words and string.find(words, "Go to Elwynn Forest", 1, true) ~= nil, "the arrow does not say 'Go to Elwynn Forest': " .. tostring(words))
check(pointer and not pointer:IsShown(), "the pointer is shown for a place on another continent")
S.Target = saved
S.Stop()
`, "section 13");
console.log("  Durotar 52, 43 to Orgrimmar 50, 50: " + getNumber("CROSS_YARDS") + " yards; the pointer turns toward it, and stays away for Elwynn Forest");

// 14. A new character starts the casual route by itself, a few seconds after login and once the quest log has been read, with one chat line.
// (The pretend ER.Print adds no "Easy Route: " in front, so the lines are counted by their end mark.)
console.log("14. A new character starts the casual route by itself");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.autoNextOff, ER.db.arrowOff, ER.db.routeTold = {}, {}, true, nil, nil
ER.db.mode = nil
S.Stop()
-- The quest log is not read yet: the route waits for it, and gives up after 20 seconds.
local readyWas = ER.Recorder.Ready
ER.Recorder.Ready = function() return false end
Fire("PLAYER_ENTERING_WORLD")
for i = 1, 10 do Tick(1) end
check(not S.Running(), "the route started before the quest log was read")
ER.Recorder.Ready = readyWas
Tick(1)
check(S.Running(), "the route did not start once the quest log was read")
S.Stop()
ER.db.guides, ER.db.mode = {}, nil
ER.Recorder.Ready = function() return false end
Fire("PLAYER_ENTERING_WORLD")
for i = 1, 22 do Tick(1) end
ER.Recorder.Ready = readyWas
for i = 1, 3 do Tick(1) end
check(not S.Running(), "the route started after waiting more than 20 seconds for the log")
ER.db.guides, ER.db.mode = {}, nil
CHAT = ""
Fire("PLAYER_ENTERING_WORLD")
for i = 1, 3 do Tick(1) end
check(not S.Running(), "the route started before the 4 seconds were over")
check(CHAT == "", "something was printed before the route started: " .. CHAT)
for i = 1, 2 do Tick(1) end
local info = S.Info()
check(S.Running() and info and info.route and info.name == "Durotar", "the casual Durotar zone is not running after the wait: " .. tostring(info and info.name))
check(ER.db.mode == "casual", "the difficulty should be set to casual when none is saved, it is " .. tostring(ER.db.mode))
local _, lines = string.gsub(CHAT, "|", "")
check(lines == 1, "the start should print exactly one line, it printed " .. lines .. ": " .. CHAT)
check(string.find(CHAT, "following the casual route for Orc on Casual.", 1, true) ~= nil, "the start line is wrong: " .. CHAT)
check(string.find(CHAT, "The gear on the step box changes the route or difficulty", 1, true) ~= nil, "the start line does not mention the gear: " .. CHAT)
START_LINE = CHAT
S.Stop()
ER.db.guides = {}
`, "section 14");
console.log("  " + getString("START_LINE"));

// 15. Every other start. ER.RouteAutoStart is called by hand (the starter's timing is section 14's job); a RestedXP guide, a stopped guide
// and a saved difficulty are left alone, a lost zone restarts by level, a race without a path and damaged saved data raise no error.
console.log("15. Every other start");
run(SECTION_START + `
local who = ER.Char()
local function Fresh(level)
  G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", level or 1, "Durotar"
  G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
  S.Stop()
  ER.db.guides, ER.db.done, ER.db.autoNextOff, ER.db.arrowOff, ER.db.routeTold = {}, {}, true, nil, nil
  ER.db.mode = nil
  CHAT = ""
end
local function Lines()
  local _, n = string.gsub(CHAT, "|", "")
  return n
end
local HINT = "The new casual route is in the guide menu."
local rested
for _, g in ipairs(S.Guides()) do
  if not g.route and not rested then rested = g end
end
check(rested ~= nil, "no RestedXP guide for the Orc to test with")
local restedKey = S.Key(rested)
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end

-- a. a RestedXP guide is running: it stays, one hint, never repeated
Fresh()
check(S.Load(restedKey, true), "the RestedXP guide did not load")
CHAT = ""
ER.RouteAutoStart()
check(S.Info() == rested, "a running RestedXP guide was replaced by " .. tostring(S.Info() and S.Info().name))
check(Lines() == 1 and string.find(CHAT, HINT, 1, true) ~= nil, "expected the one hint line, got: " .. CHAT)
ER.RouteAutoStart()
check(Lines() == 1, "the hint was printed a second time: " .. CHAT)
check(ER.db.mode == nil, "a RestedXP player's difficulty was set: " .. tostring(ER.db.mode))

-- b. a RestedXP key saved but not running and not stopped: nothing starts; the hint only once per character
Fresh()
ER.db.guides[who] = { key = restedKey, pos = 3, passed = {}, fired = {}, side = {} }
ER.db.routeTold = {}
ER.db.routeTold[who] = true
ER.RouteAutoStart()
check(not S.Running(), "a saved RestedXP guide was replaced by the casual route")
check(Lines() == 0, "the hint was printed again for a character that was told: " .. CHAT)
check(ER.db.guides[who].key == restedKey and ER.db.guides[who].pos == 3, "the saved RestedXP record was changed")
ER.db.routeTold = nil
ER.RouteAutoStart()
check(not S.Running() and Lines() == 1 and string.find(CHAT, HINT, 1, true) ~= nil, "expected the hint once, got: " .. CHAT)
ER.RouteAutoStart()
check(Lines() == 1, "the hint was printed twice: " .. CHAT)

-- c. a guide stopped on purpose stays stopped, casual or RestedXP, and nothing is said
Fresh()
local durotarKey = S.Key(ER.RouteGuides()[1])
check(S.Load(durotarKey, true), "the Durotar visit did not load")
S.Stop()
CHAT = ""
ER.RouteAutoStart()
check(not S.Running() and Lines() == 0, "a stopped casual guide was started again or something was said: " .. CHAT)
Fresh()
check(S.Load(restedKey, true), "the RestedXP guide did not load")
S.Stop()
CHAT = ""
ER.RouteAutoStart()
check(not S.Running() and Lines() == 0, "a stopped RestedXP guide was replaced or something was said: " .. CHAT)

-- d. a saved casual key that no zone matches: the zone for the level starts, with the one start line
Fresh()
ER.db.guides[who] = { key = "Casual route\\\\Nowhere", pos = 4, passed = {}, fired = {}, side = {} }
ER.RouteAutoStart()
check(S.Running() and S.Info().route and S.Info().name == "Durotar", "a lost casual zone did not restart by level: " .. tostring(S.Info() and S.Info().name))
check(Lines() == 1 and string.find(CHAT, "following the casual route for Orc on Casual.", 1, true) ~= nil, "expected the one start line, got: " .. CHAT)

-- e. a character that starts part-way lands in the zone that fits its level
local PARTWAY = {}
for _, level in ipairs({ 25, 10, 60 }) do
  Fresh(level)
  local info = ER.RouteVisitFor(level)
  ER.RouteAutoStart()
  local run = S.Info()
  check(run and run == info, "level " .. level .. ": the running guide is not the one for the level: " .. tostring(run and run.name))
  PARTWAY[level] = run and (run.visit.zone .. (run.stop and " (stop)" or "")) or "nothing"
end
check(PARTWAY[25] == "Stonetalon Mountains", "level 25 should get Stonetalon Mountains, got " .. PARTWAY[25])
check(PARTWAY[10] == "Orgrimmar (stop)", "level 10 should get the Orgrimmar stop, got " .. PARTWAY[10])
check(PARTWAY[60] == "Silithus", "level 60 should get the last zone of the path, Silithus, got " .. PARTWAY[60])
PARTWAY_TEXT = "level 25: " .. PARTWAY[25] .. "; level 10: " .. PARTWAY[10] .. "; level 60: " .. PARTWAY[60]

-- f. a saved difficulty stays
Fresh()
ER.db.mode = "hard"
ER.RouteAutoStart()
check(S.Running() and ER.db.mode == "hard", "the saved difficulty was changed to " .. tostring(ER.db.mode))
check(string.find(CHAT, "on Hard.", 1, true) ~= nil, "the start line does not say Hard: " .. CHAT)

-- g. a race with no path: nothing, no line, no error
Fresh()
G.race = "Goblin"
check(table.getn(ER.RouteGuides()) == 0, "a Goblin should have no casual path")
local ok, err = pcall(ER.RouteAutoStart)
check(ok, "the start raised an error for a race without a path: " .. tostring(err))
check(not S.Running() and CHAT == "" and ER.db.mode == nil, "a race without a path started something or said something: " .. CHAT)
check(ER.RouteVisitFor(10) == nil, "RouteVisitFor should give nothing for a race without a path")

-- h. damaged saved data raises no error
local damage = {
  function() ER.db.guides = "junk" end,
  function() ER.db.guides = { [who] = "junk" } end,
  function() ER.db.guides = { [who] = { key = 5 } } end,
  function() ER.db.guides = { [who] = { key = "" } } end,
  function() ER.db.routeTold = "junk" ER.db.guides = { [who] = { key = restedKey } } end,
}
for i, hurt in ipairs(damage) do
  Fresh()
  hurt()
  local ok2, err2 = pcall(ER.RouteAutoStart)
  check(ok2, "damaged saved data " .. i .. " raised an error: " .. tostring(err2))
end
Fresh()
ER.db.routeTold = "junk"
check(S.Load(restedKey, true), "the RestedXP guide did not load")
local ok3, err3 = pcall(ER.RouteAutoStart)
check(ok3, "a damaged routeTold raised an error: " .. tostring(err3))

ER.StepsChanged = savedChanged
Fresh()
ER.db.mode = "hard"
`, "section 15");
console.log("  " + getString("PARTWAY_TEXT"));

// 16. Where you are in the plan. The Orc's Durotar zone, the stop and the last zone: the one line of the step box, counted from the
// plan and the quest log, kept for 2 seconds.
console.log("16. Where you are in the plan");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.guides, ER.db.done, ER.db.autoNextOff = "casual", {}, {}, true
S.Stop()
local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  s = string.gsub(s, "|r", "")
  return s
end
local function BoxLines()
  local out = {}
  for i = 1, 10 do
    local b = _G["EasyRouteTrackerLine" .. i]
    if b and b:IsShown() then table.insert(out, PlainText(b.text._text)) end
  end
  return out
end
local function BoxHas(text)
  for _, l in ipairs(BoxLines()) do if l == text then return true end end
  return false
end

local infos = ER.RouteGuides()
local durotar = infos[1]
check(durotar and durotar.name == "Durotar", "the first Orc guide is not Durotar")
-- the zone's own quests without x, e and s, counted from the reader
local ids, n = {}, 0
for _, area in ipairs(ER.RouteReader.ReadVisit(durotar.visit)) do
  for _, q in ipairs(area.q) do
    local f = q.flags or ""
    if q.id and not ids[q.id] and not string.find(f, "x", 1, true) and not string.find(f, "e", 1, true) and not string.find(f, "s", 1, true) then
      ids[q.id] = true
      n = n + 1
    end
  end
end
check(n >= 5, "Durotar has only " .. n .. " counted quests")
local areas = ER.RouteReader.ReadVisit(durotar.visit)
G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
local want0 = "Durotar (1-10): 0 of " .. n .. " quests done. Next: Orgrimmar at 10."
check(BoxHas(want0), "the box does not say '" .. want0 .. "': " .. table.concat(BoxLines(), " / "))
check(ER.RouteLine() == want0, "RouteLine says " .. tostring(ER.RouteLine()))
check(ER.RouteShort() == "Durotar 1-10: 0 of " .. n .. " done", "RouteShort says " .. tostring(ER.RouteShort()))
LINE_BEFORE = ER.RouteLine()

-- hand one in: the kept text holds for 2 seconds, then the number rises
local handed
for id in pairs(ids) do
  if not handed then
    local title = S.QuestTitle(id)
    ER.Log("turnin", { title = title })
    ER.OnTurnIn(title)
    if S.TurnedIn(id) then handed = id end
  end
end
check(handed ~= nil, "no quest could be handed in")
check(ER.RouteLine() == want0, "the line changed within the 2 seconds: " .. tostring(ER.RouteLine()))
NOW = NOW + 3
ER.StepsChanged()
local want1 = "Durotar (1-10): 1 of " .. n .. " quests done. Next: Orgrimmar at 10."
check(BoxHas(want1), "the box does not say '" .. want1 .. "' after the hand-in: " .. table.concat(BoxLines(), " / "))
LINE_AFTER = ER.RouteLine()

-- the stop, the last zone, a RestedXP guide
local stop
for _, info in ipairs(infos) do if info.stop and not stop then stop = info end end
check(stop ~= nil, "the Orc path has no stop")
check(S.Load(S.Key(stop), true), "the stop did not load")
NOW = NOW + 3
local line = ER.RouteLine() or ""
check(string.sub(line, 1, 29) == "Orgrimmar (short stop at 10):", "the stop line starts wrong: " .. line)
check(string.find(line, "Next: ", 1, true) ~= nil, "the stop line has no next zone: " .. line)
STOP_LINE = line
local last = infos[table.getn(infos)]
check(S.Load(S.Key(last), true), "the last zone did not load")
NOW = NOW + 3
line = ER.RouteLine() or ""
check(string.sub(line, -35) == "This is the last zone of the route.", "the last line ends wrong: " .. line)
check(string.sub(line, 1, string.len(last.visit.zone) + 2) == last.visit.zone .. " (", "the last line starts wrong: " .. line)
LAST_LINE = line
local rested
for _, g in ipairs(S.Guides()) do if not g.route and not rested then rested = g end end
check(S.Load(S.Key(rested), true), "the RestedXP guide did not load")
check(ER.RouteLine() == nil and ER.RouteShort() == nil, "a RestedXP guide got a position line")
S.Stop()
check(ER.RouteLine() == nil, "a stopped guide got a position line")
ER.db.guides, ER.db.done = {}, {}
`, "section 16");
console.log("  " + getString("LINE_BEFORE"));
console.log("  " + getString("LINE_AFTER"));
console.log("  " + getString("STOP_LINE"));
console.log("  " + getString("LAST_LINE"));

// 17. The same line in the guide menu and a short form in Simple mode.
console.log("17. The line in the guide menu and in Simple mode");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.guides, ER.db.done, ER.db.autoNextOff = "casual", {}, {}, true
S.Stop()
local simpleWas = ER.db.simple
ER.db.simple = nil
local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  s = string.gsub(s, "|r", "")
  return s
end
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)
G.x, G.y = areas[1].x, areas[1].y
check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
local want = ER.RouteLine()
check(want and string.sub(want, 1, 17) == "Durotar (1-10): 0", "RouteLine says " .. tostring(want))

-- the guide menu: open each group in turn
ER.ShowGuideMenu()
local panel = EasyRouteGuideMenuPanel
check(EasyRouteGuideMenu:IsShown(), "the guide menu did not open")
local heights, casualRows, restedRows, restedName = {}, 0, 0, nil
for i = 1, 6 do
  local row = _G["EasyRouteGuideMenuGroup" .. i]
  if row and row.grp then
    this = row
    row:GetScript("OnClick")()
    local name, count = row.grp.name, table.getn(row.grp.guides)
    if name == "Casual route" then
      casualRows = count
      check(panel.line:IsShown(), "the casual route group shows no position line")
      check(PlainText(panel.line._text) == want, "the menu line says '" .. PlainText(panel.line._text) .. "', not '" .. want .. "'")
      check(panel:GetHeight() > count * 16 + 36, "the panel did not grow for the line: " .. panel:GetHeight())
      MENU_LINE = PlainText(panel.line._text)
    elseif not restedName then
      restedName, restedRows = name, count
      check(not panel.line:IsShown(), name .. " shows a position line")
      check(panel:GetHeight() == count * 16 + 36, name .. " panel is " .. panel:GetHeight() .. " high, not " .. (count * 16 + 36))
    end
  end
end
check(casualRows > 0 and restedRows > 0, "the menu has no casual route group or no other group")
EasyRouteGuideMenu:Hide()

-- Simple mode: the name line shows the short form
local function Find(prefix)
  for _, f in ipairs(ALLFRAMES) do
    if rawget(f, "_text") and string.sub(PlainText(f._text), 1, string.len(prefix)) == prefix then return f end
  end
  return nil
end
-- The pretend game counts colour codes in a text's width, so it would cut the line short; this checks which text is chosen.
local fitWas = ER.FitLine
ER.FitLine = function(fs, text, width) fs:SetText(text) end
ER.db.simple = true
ER.ShowSimple()
ER.RefreshSimple()
local name = Find("Durotar 1-10:")
check(name ~= nil, "Simple mode's name line does not start with 'Durotar 1-10:'")
SIMPLE_LINE = name and PlainText(name._text) or ""
local rested
for _, g in ipairs(S.Guides()) do if not g.route and not rested then rested = g end end
check(S.Load(S.Key(rested), true), "the RestedXP guide did not load")
ER.RefreshSimple()
check(Find("Durotar 1-10:") == nil, "a RestedXP guide still shows the casual short line")
ER.FitLine = fitWas
ER.HideSimple()
ER.db.simple = simpleWas
S.Stop()
ER.db.guides, ER.db.done = {}, {}
`, "section 17");
console.log("  menu: " + getString("MENU_LINE"));
console.log("  simple: " + getString("SIMPLE_LINE"));

// 18. Stuck? Skip this step. Ten minutes without progress raise a line in the step box (a tip in Simple mode); a click skips the step,
// the guide never does; time dead, on a flight, and walks of more than 60 yards do not count as being stuck.
console.log("18. Stuck? Skip this step");
run(SECTION_START + `
G.race, G.class, G.faction = "Orc", "WARRIOR", "Horde"
ER.db.mode, ER.db.autoNextOff = "casual", true
local simpleWas = ER.db.simple
ER.db.simple = nil
local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  s = string.gsub(s, "|r", "")
  return s
end
local function StuckButton()
  for i = 1, 10 do
    local b = _G["EasyRouteTrackerLine" .. i]
    if b and b:IsShown() and PlainText(b.text._text) == "Stuck? Skip this step" then return b end
  end
  return nil
end
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)
local per = S.Yards("Durotar", 50, 50, 51, 50)   -- yards in one map percent
-- A fresh clock: no guide for a look (the clock resets), the zone started, one look (the clock starts).
local function Fresh()
  G.dead, G.taxi, G.level = false, false, 1
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  S.Stop()
  Tick(2)
  G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
  check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
  Tick(2)
end

-- a. 10 minutes without progress
Fresh()
local pos0 = S.Position()
Tick(598)
check(not ER.IsStuck() and not StuckButton(), "stuck after 598 seconds")
Tick(3)
check(ER.IsStuck(), "not stuck after 601 seconds")
check(ER.StuckFor() >= 600, "StuckFor says " .. ER.StuckFor())
check(StuckButton() ~= nil, "the box has no 'Stuck? Skip this step' line")
check(S.Position() == pos0, "the guide moved on by itself from step " .. pos0 .. " to " .. S.Position())
-- b. a click skips; the line goes
local b = StuckButton()
this = b
b:GetScript("OnClick")()
check(S.Position() > pos0, "the click did not skip the step")
Tick(2)
check(not ER.IsStuck() and StuckButton() == nil, "the stuck line is still there after the skip")
STUCK_LINE = "Stuck? Skip this step"

-- c. dead, d. on a flight: the time does not count; after it, the clock runs on
for _, what in ipairs({ "dead", "taxi" }) do
  Fresh()
  G[what] = true
  Tick(601)
  check(not ER.IsStuck() and not StuckButton(), "stuck after 601 seconds while " .. what)
  G[what] = false
  Tick(2)
  check(not ER.IsStuck(), "stuck right after " .. what .. " ended")
  Tick(601)
  check(ER.IsStuck(), "not stuck after 601 more seconds once " .. what .. " ended")
end

-- e. a walk of 70 yards starts the clock again; a walk of 40 does not
Fresh()
Tick(300)
G.x = G.x + 70 / per
Tick(300)
check(not ER.IsStuck() and not StuckButton(), "stuck after a walk of 70 yards in the middle")
Tick(2)
check(not ER.IsStuck(), "stuck 2 seconds after the walk")
G.x = G.x + 40 / per
Tick(600)
check(ER.IsStuck(), "a walk of 40 yards started the clock again")
-- another zone is a walk too
Fresh()
Tick(300)
G.zone = "The Barrens"
Tick(300)
Tick(2)
check(not ER.IsStuck(), "a change of zone did not start the clock again")

-- f. Simple mode: a tip with a button, gone on progress
Fresh()
ER.db.simple = true
Tick(601)
check(ER.HasTip("stuck"), "Simple mode has no stuck tip")
local tipText, tipLabel
for _, tip in ipairs(ER.TipsList()) do
  if tip.key == "stuck" then tipText, tipLabel = tip.text, tip.buttons and tip.buttons[1] and tip.buttons[1].label end
end
check(tipText == "Stuck? This step has not moved on for 10 minutes.", "the tip says: " .. tostring(tipText))
check(tipLabel == "Skip this step", "the tip button says: " .. tostring(tipLabel))
G.level = G.level + 1
Tick(2)
check(not ER.HasTip("stuck"), "the stuck tip stays after a level up")
Tick(601)
check(ER.HasTip("stuck"), "the stuck tip did not come back after 10 more minutes")
local before = S.Position()
for _, tip in ipairs(ER.TipsList()) do
  if tip.key == "stuck" then tip.buttons[1].fn() end
end
check(S.Position() > before, "the tip button did not skip the step")
ER.RemoveTip("stuck")

G.dead, G.taxi, G.level = false, false, 1
ER.db.simple = simpleWas
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
`, "section 18");
console.log("  " + getString("STUCK_LINE"));

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
