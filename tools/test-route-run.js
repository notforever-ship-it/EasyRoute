// Checks that the casual route (Data/Route.lua) runs in the real step engine: RouteRun.lua turns each visit into steps,
// Steps.lua lists them as guides, and a pretend game (tools/lib/fakegame.js) does what each step asks. It is quick because
// the windows are not redrawn while a whole path is walked.
// Usage: node tools/test-route-run.js     (needs fengari: npm install inside tools)

const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const { PRELUDE, PLAYER } = require("./lib/fakegame.js");
const { newLuaVM } = require("./lib/pfdb.js");

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
for (const f of ["Data/Zones.lua", "Data/Guides.lua", "Data/ZoneSizes.lua", "Data/Route.lua", "Data/Survival.lua", "Data/Ratings.lua", "Data/Chains.lua", "Director.lua", "Steps.lua", "RouteReader.lua", "RouteRun.lua", "Grind.lua",
  "Arrow.lua", "Tracker.lua", "Simple.lua"]) {
  run(fs.readFileSync(path.join(ROOT, f)), f);
}
run(PLAYER, "player");

// Every section starts the same way: its own character, an empty log, nothing saved.
const SECTION_START = `
local ER = EasyRoute
local S = ER.Steps
ER.db.flightPaths, G.nodes = nil, nil
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
// A new login: the two starters (the route's and the step window's) listen for PLAYER_ENTERING_WORLD again.
run(`
function NewLogin()
  for _, name in ipairs({ "EasyRouteRouteStarter", "EasyRouteTrackerStarter" }) do
    local f = _G[name]
    f:SetScript("OnUpdate", nil)
    f:RegisterEvent("PLAYER_ENTERING_WORLD")
  end
end
`, "newlogin");

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

// 2b. The game's own move from one zone to the next: auto-next ON (the guide starts the next visit by itself when one ends), only the first
// visit is loaded by hand. Every next visit must begin at its top: no step passed by the part-way scan ("auto"), and the first step still
// to do is no later than the first pick-up (so the travel steps and the hand-ins are not dropped, and a quest of the same title from the zone
// before cannot move the start to the end of the zone). Orc Durotar to Orgrimmar starts at step 1, "Go to Orgrimmar".
console.log("2b. Every race walks its whole path with auto-next on");
run(`
function WalkPath(race, mode)
  local ER, S = EasyRoute, EasyRoute.Steps
  local infos = ER.RouteGuides()
  G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
  ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff = {}, {}, mode or "hard", nil
  ER.db.flightPaths, G.nodes = nil, nil
  local savedChanged = ER.StepsChanged
  ER.StepsChanged = function() end
  local starts, bad, visited = {}, {}, {}
  local origAuto = ER.AutoNextGuide
  ER.AutoNextGuide = function()
    local fromZone = G.zone
    local fromInfo = S.Info()
    local started = origAuto()
    if started then
      local info = S.Info()
      local firstAccept = 1000000
      for n = 1, S.Count() do
        for _, e in ipairs(S.Step(n).elements) do
          if e.kind == "A" and n < firstAccept then firstAccept = n end
        end
      end
      local autos = 0
      for n = 1, S.Count() do if S.Passed(n) == "auto" then autos = autos + 1 end end
      local pos = S.Position()
      local title = S.Current() and S.Title(S.Current()) or "(none)"
      local words = ""
      for _, e in ipairs(S.Current() and S.Current().elements or {}) do
        local line = S.Line(S.Current(), e)
        if line then words = words .. line.text .. " / " end
      end
      table.insert(starts, { name = info.name, from = fromInfo and fromInfo.name or "?", zone = fromZone, pos = pos, title = title, words = words })
      if autos > 0 then table.insert(bad, info.name .. ": " .. autos .. " steps were passed by the part-way scan") end
      if pos > firstAccept then table.insert(bad, info.name .. ": started at step " .. pos .. ", after its first pick-up at step " .. firstAccept) end
    end
    return started
  end
  S.Load(S.Key(infos[1]), true)
  table.insert(visited, infos[1].name)
  local steps, pushes, guard, where = 0, 0, 0, {}
  local flights, rides = 0, 0
  while guard < 40000 do
    guard = guard + 1
    local step = S.Current()
    if not step then break end
    local before, was = S.Position(), S.Info()
    for _, e in ipairs(step.elements) do
      if e.kind == "F" then flights = flights + 1 end
    end
    if step.flags.rt and string.find(step.flags.rt, "^nofp") then rides = rides + 1 end
    Satisfy(step)
    NOW = NOW + 1
    S.Check()
    G.taxi = false
    steps = steps + 1
    if S.Info() ~= was then
      table.insert(visited, S.Info().name)
    elseif S.Position() == before then
      pushes = pushes + 1
      if table.getn(where) < 3 then table.insert(where, was.name .. " step " .. step.n) end
      S.Next()
      S.Check()
      if S.Info() ~= was then table.insert(visited, S.Info().name) end
    end
  end
  ER.AutoNextGuide = origAuto
  ER.StepsChanged = savedChanged
  local last = S.Info()
  S.Stop()
  return { starts = starts, bad = bad, visited = visited, steps = steps, pushes = pushes, where = where, last = last, guard = guard, flights = flights, rides = rides }
end
`, "walkpath");
for (const race of Object.keys(VISITS)) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1
local r = WalkPath(${JSON.stringify(race)}, "hard")
local want = table.getn(EasyRoute_Route.paths[G.race])
check(table.getn(r.visited) == want, G.race .. ": " .. table.getn(r.visited) .. " visits were walked with auto-next on, expected " .. want .. " (" .. table.concat(r.visited, ", ") .. ")")
check(r.guard < 40000, G.race .. ": the walk did not end")
check(r.pushes == 0, G.race .. ": " .. r.pushes .. " steps needed a push with auto-next on: " .. table.concat(r.where, "; "))
for _, text in ipairs(r.bad) do check(false, G.race .. ": " .. text) end
for _, st in ipairs(r.starts) do
  -- from the zone before, a player who stands there sees the first travel step
  if st.zone == "Durotar" and st.name == "Orgrimmar" then
    -- step 1 is the plain 'Head to Orgrimmar' step, left out at once for a player who stands in Durotar; the road out of Durotar is next
    check(st.pos <= 2 and st.title == "Go to Orgrimmar" and string.find(st.words, "Follow the road north from Razor Hill", 1, true) ~= nil,
      "Durotar to Orgrimmar did not start with the way out of Durotar: step " .. st.pos .. " " .. st.title .. " " .. st.words)
    ORGRIMMAR_START = 1
  end
end
-- a character that follows the route from step 1 has every flight path a flight lands on: each flight is flown, none becomes a ride
check(r.rides == 0, G.race .. ": " .. r.rides .. " flights were turned into rides on a walk that got every flight path on the way")
local expect = 0
do
  local list = ER.RouteGuides()
  for i = 2, table.getn(list) do
    local entry = EasyRoute_Route.travel[G.faction .. "|" .. list[i - 1].visit.zone .. ">" .. list[i].visit.zone]
    for _, leg in ipairs(ER.RouteReader.ReadTravel(entry)) do
      if leg.kind == "fly" then expect = expect + 1 end
    end
  end
end
check(r.flights == expect, G.race .. ": " .. r.flights .. " flights were flown, the travel table has " .. expect)
WALK_TEXT = G.race .. ": " .. table.getn(r.visited) .. " visits, " .. r.steps .. " steps, " .. r.pushes .. " pushes, " .. table.getn(r.starts) .. " zone changes, each started at its top, " .. r.flights .. " flights"
`, "section 2b " + race);
  console.log("  " + getString("WALK_TEXT"));
  if (race === "Orc") jsCheck(getNumber("ORGRIMMAR_START") === 1, "the Orc walk never moved from Durotar to Orgrimmar");
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
// a higher level than the player has is a failure. Elite, group, dungeon, escort, safe-route-skipped and friends'-Hard quests are left out on Casual, so they give no xp and are not asked for.
const xp = require("./lib/xpmodel.js");
const RACES_WALKED = Object.keys(VISITS);
console.log("5. Every race: the plan never asks for a quest above your level");
for (const race of RACES_WALKED) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1
local infos = ER.RouteGuides()
local flagsOf = {}
-- A quest of a chain that Casual leaves out for its walk (the chain rule, no class bonus) gets the letter C: the casual model gives it no xp.
for _, info in ipairs(infos) do
  for _, area in ipairs(ER.RouteReader.ReadVisit(info.visit)) do
    for _, q in ipairs(area.q) do
      if q.id and not flagsOf[q.id] then
        flagsOf[q.id] = q.flags
        if ER._testChainCut(${JSON.stringify(race)}, q.id, "casual", false) then flagsOf[q.id] = q.flags .. "C" end
      end
    end
  end
end
local dump = {}
for _, info in ipairs(infos) do
  local flags = ""
  for line in string.gfind(ER._testGenerate(info), "[^\\n]+") do
    local _, _, sflags = string.find(line, "^S\\t\\t\\t(.*)$")
    if sflags then flags = sflags end
    local _, _, kind, id = string.find(line, "^(%u)\\t\\t(%d+)\\t")
    if kind == "A" then
      local row = ER.QuestRow(tonumber(id))
      table.insert(dump, "A\\t" .. id .. "\\t" .. tostring(row and row.m or 1) .. "\\t" .. (flagsOf[tonumber(id)] or "") .. "\\t" .. info.visit.zone)
    elseif kind == "T" then
      local row = ER.QuestRow(tonumber(id))
      table.insert(dump, "T\\t" .. id .. "\\t" .. tostring(row and row.l or 1) .. "\\t" .. (flagsOf[tonumber(id)] or ""))
    else
      -- a bridge's X level is only a place holder (the walk is of a player on the plan: a bridge would not show)
      local _, _, level = string.find(line, "^X\\t\\t\\t(%d+)\\t")
      if level and not string.find(flags, "grind=bridge", 1, true) then table.insert(dump, "X\\t" .. level .. "\\t" .. info.visit.zone) end
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
      if (/[esgdvhC]/.test(flags)) continue;
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
local plain = ER._testGenerate(info)
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
local again = ER._testGenerate(info)
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
for line in string.gfind(ER._testGenerate(barrens), "[^\\n]+") do
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
-- a visit with no group, dungeon, safe-route or Hard quest, so that only e and s decide what Casual leaves out in it
local function Plain(info)
  for _, f in pairs(FlagsOfVisit(info)) do
    if string.find(f, "[gdvh]") then return false end
  end
  return true
end
local function FirstWith(letter)
  for _, info in ipairs(ER.RouteGuides()) do
    if Plain(info) then
      for _, f in pairs(FlagsOfVisit(info)) do
        if string.find(f, letter, 1, true) then return info end
      end
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

// 8b. A quest that waits for a quest the difficulty leaves out is left out too (the NPC would never offer it): "The Deathstalkers' Report" (449)
// follows the escort "Escorting Erland" (435) in Silverpine Forest, "Doling Justice" (2970) follows the escort
// "Freedom for All Creatures" (2969) in Feralas. A quest you have, or whose parent you have, stays; on a difficulty that keeps the parent the child stays as well.
console.log("8b. A quest after a left-out quest is left out too");
for (const [race, faction, zone, child, parent] of [["Scourge", "Horde", "Silverpine Forest", 449, 435], ["NightElf", "Alliance", "Feralas", 2970, 2969]]) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(faction)}, 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.autoNextOff = {}, {}, true
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local info
for _, i in ipairs(ER.RouteGuides()) do
  if i.visit.zone == ${JSON.stringify(zone)} and not info then info = i end
end
check(info ~= nil, "no ${zone} visit for ${race}")
local pf, cf
for _, area in ipairs(ER.RouteReader.ReadVisit(info.visit)) do
  for _, q in ipairs(area.q) do
    if q.id == ${parent} then pf = q.flags end
    if q.id == ${child} then cf = q.flags end
  end
end
check(pf and cf, "quest ${parent} or ${child} is not in the ${zone} visit of the ${race}")
check(pf and (string.find(pf, "[es]") ~= nil), "quest ${parent} is neither elite nor escort: " .. tostring(pf))
local function Title(id) return S.QuestTitle(id) end
local function Out(mode)
  ER.db.mode = mode
  check(S.Load(S.Key(info), true), "${zone} did not load")
  return S.LeftOut(${child}), S.LeftOut(${parent})
end
local childCasual, parentCasual = Out("casual")
check(parentCasual == true, "casual: quest ${parent} is not left out")
check(childCasual == true, "casual: quest ${child} waits for quest ${parent} but is not left out")
local childMedium, parentMedium = Out("medium")
local childHard, parentHard = Out("hard")
check(parentHard == false and childHard == false, "hard: quest ${parent} or ${child} is left out")
check(childMedium == parentMedium, "medium: quest ${child} is left out " .. tostring(childMedium) .. " but its parent " .. tostring(parentMedium))
-- the pick-up step of the child is passed over on Casual, so nothing waits for it; the whole visit walks without a push
ER.db.mode, ER.db.guides, ER.db.done = "casual", {}, {}
G.level = info.lo
check(S.Load(S.Key(info), true), "${zone} did not load on Casual")
local seen = false
local origSatisfy = Satisfy
Satisfy = function(step)
  for _, e in ipairs(step.elements) do if e.kind == "A" and e.id == ${child} then seen = true end end
  origSatisfy(step)
end
local walked, pushes, where = WalkGuide(ER, S)
Satisfy = origSatisfy
check(not seen, "casual: the walk stopped at the pick-up of quest ${child}")
check(pushes == 0, "casual: " .. pushes .. " steps needed a push in ${zone}: " .. table.concat(where, "; "))
-- a quest of the chain in the log: the way on is open
ER.db.guides, ER.db.done = {}, {}
G.log, G.order = {}, {}
check(S.Load(S.Key(info), true), "${zone} did not load again")
local pt = Title(${parent})
G.log[pt] = { complete = false, objs = {} }
table.insert(G.order, pt)
check(S.LeftOut(${child}) == false, "casual: quest ${child} is left out while quest ${parent} is in the log")
G.log, G.order = {}, {}
CHAIN_OK = (CHAIN_OK or 0) + 1
ER.StepsChanged = savedChanged
S.Stop()
`, "section 8b " + race);
}
jsCheck(getNumber("CHAIN_OK") === 2, "the chain checks did not run for both quests");
console.log("  449 (Silverpine Forest, Undead) and 2970 (Feralas, Night Elf): left out on Casual with their parents, kept on Hard");

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

// 9e. Far ahead of the plan: a zone you are past (level above its top level) is passed over as a whole, travel steps included, and the next
// zone that still fits starts, with one chat line. A short stop is never passed over, the last zone of the path is the end of the walk.
console.log("9e. Past a whole zone");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 30, "Orgrimmar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff = {}, {}, "hard", nil
local infos = ER.RouteGuides()
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local function Lines(text)
  local n = 0
  for _ in string.gfind(text or "", "Easy Route:") do n = n + 1 end
  return n
end
-- the stop right after Durotar is not passed over; the zones after it up to level 30 are
local stop, barrens
for _, i in ipairs(infos) do
  if i.stop and not stop then stop = i end
  if i.visit.zone == "The Barrens" and not barrens then barrens = i end
end
check(stop and barrens, "no Orgrimmar stop or Barrens visit for the Orc")
local want, passed = nil, {}
local seenStop = false
for _, i in ipairs(infos) do
  if seenStop and not want then
    if i.stop or i.hi >= 30 then want = i else table.insert(passed, i) end
  end
  if i == stop then seenStop = true end
end
check(want ~= nil and table.getn(passed) >= 2, "the level 30 test needs a zone that fits and two that are passed over")
local skip, list = ER.RouteSkipPast(barrens)
check(skip == want, "RouteSkipPast(Barrens) gives " .. tostring(skip and skip.name) .. ", not " .. tostring(want and want.name))
check(list and table.getn(list) == table.getn(passed), "RouteSkipPast passed over " .. tostring(list and table.getn(list)) .. " zones, not " .. table.getn(passed))
local same, none = ER.RouteSkipPast(stop)
check(same == stop and none == nil, "a short stop was passed over")
local lastInfo = infos[table.getn(infos)]
G.level = 80
local atEnd, noneEnd = ER.RouteSkipPast(lastInfo)
check(atEnd == lastInfo and noneEnd == nil, "the last zone of the path was passed over")
G.level = 30
-- the stop runs to its end, then the automatic move lands on the zone that fits, with one line
check(S.Load(S.Key(stop), true), "the Orgrimmar stop did not load")
CHAT = ""
local guard = 0
while S.Info() == stop and guard < 1000 do
  guard = guard + 1
  local step = S.Current()
  if not step then break end
  local before = S.Position()
  Satisfy(step)
  G.level = 30
  NOW = NOW + 1
  S.Check()
  G.taxi = false
  if S.Info() == stop and S.Position() == before then S.Next() S.Check() end
end
local now = S.Info()
check(now == want, "after the stop the guide runs " .. tostring(now and now.name) .. ", not " .. tostring(want and want.name))
check(Lines(CHAT) == 1, "the chat has " .. Lines(CHAT) .. " Easy Route lines: " .. tostring(CHAT))
check(string.find(CHAT, "You are ahead of the plan: skipping " .. table.getn(passed) .. " zones, moving on to " .. want.visit.zone, 1, true) ~= nil, "the skip line is wrong: " .. tostring(CHAT))
PAST_LINE = string.gsub(string.gsub(tostring(CHAT), "|c%x%x%x%x%x%x%x%x", ""), "|r", "")
-- the way to it is one plain step, shown to a player who stands in Orgrimmar (no leg of a zone that was passed over)
G.zone = "Orgrimmar"
check(S.Current() ~= nil and S.Title(S.Current()) == "Go to " .. want.visit.zone, "the first step is not 'Go to " .. want.visit.zone .. "': " .. tostring(S.Current() and S.Title(S.Current())))
local words = ""
for _, e in ipairs(S.Current() and S.Current().elements or {}) do
  local line = S.Line(S.Current(), e)
  if line then words = words .. line.text .. " / " end
end
check(string.find(words, "Head to " .. want.visit.zone .. ": the arrow points the way.", 1, true) ~= nil, "the plain step does not say so: " .. words)
S.Stop()

-- A zone started from the menu while you are past it has no way to it: Human, level 30, standing in Westfall, Redridge Mountains
G.race, G.faction, G.level, G.zone = "Human", "Alliance", 30, "Westfall"
ER.db.guides, ER.db.autoNextOff = {}, true
local red
for _, i in ipairs(ER.RouteGuides()) do if i.visit.zone == "Redridge Mountains" then red = i end end
check(red ~= nil, "no Redridge Mountains visit for the Human")
check(S.Load(S.Key(red), true), "Redridge Mountains did not load")
for i = 1, 6 do NOW = NOW + 1 S.Check() end
local cur = S.Current()
check(cur == nil or S.Title(cur) ~= "Go to Redridge Mountains", "a level 30 player is held on 'Go to Redridge Mountains'")
S.Stop()
ER.db.autoNextOff = nil
ER.StepsChanged = savedChanged
`, "section 9e");
console.log("  Orc, level 30 after Orgrimmar: " + getString("PAST_LINE").replace(/\|$/, ""));

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
local text = ER._testGenerate(first)
check(string.find(text, "\\nP\\t\\t" .. landing .. "\\t", 1, true) ~= nil, "the first Stormwind City visit has no flight path step for " .. landing)
check(string.find(text, "title=Get the flight path", 1, true) ~= nil, "the first Stormwind City visit has no 'Get the flight path' title")
-- the first step of the later visit is the flight to that flight master
local steps = ER._testGenerate(later)
-- (the first step is the plain 'Head to' step for a player who is not on the way; the flight comes right after it, before any pick-up)
local flightAt = string.find(steps, "\\nF\\t\\t" .. landing .. "\\t", 1, true)
local pickAt = string.find(steps, "\\nA\\t\\t", 1, true)
check(flightAt ~= nil and pickAt ~= nil and flightAt < pickAt, "the later Stormwind City visit does not start with the flight to " .. landing)
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

// 11b. A flight to a flight path the character has not got becomes a ride or a walk to the zone it lands in, with the arrow on the flight
// master there. What the character has comes from the flight map (NumTaxiNodes, TaxiNodeName, TaxiNodeGetType: "NONE" is not usable) and from the
// route's own "Get the flight path" steps and flights taken; with nothing known yet the route is trusted and the flight is shown.
console.log("11b. A flight the character cannot take is a ride or a walk");
run(SECTION_START + `
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.guides, ER.db.done, ER.db.autoNextOff = "hard", {}, {}, true
local who = ER.Char()
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
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
local function Is(text) return string.find(Words(S.Current()), text, 1, true) ~= nil end
local function Start()
  S.Stop()
  ER.db.guides = {}
  G.zone, G.x, G.y, G.taxi = "Westfall", 56.55, 52.64, false
  check(S.Load(S.Key(red), true), "the Redridge Mountains visit did not load")
end
-- the flight master of Stormwind City, from the plan's own table
local fx, fy
for line in string.gfind(EasyRoute_Route.flights["Alliance|Stormwind City"], "[^\\n]+") do
  local _, _, x, y, name = string.find(line, "^([^\\t]*)\\t([^\\t]*)\\t(.*)$")
  if name == "Dungar Longdrink" then fx, fy = tonumber(x), tonumber(y) end
end
check(fx and fy, "no flight master Dungar Longdrink in Stormwind City")

-- a. nothing known yet (a fresh character): the flight is shown
ER.db.flightPaths = nil
Start()
check(Is("Fly from Sentinel Hill to Stormwind."), "fresh data: the first step is not the flight: " .. Words(S.Current()))

-- b. the flight map listed other places only: the ride is shown, the arrow is on the flight master in Stormwind City
ER.db.flightPaths = { [who] = { nodes = { ["Ironforge, Dun Morogh"] = true }, towns = {} } }
Start()
check(S.Title(S.Current()) == "Go to Redridge Mountains" and Is("You do not have the flight path to Stormwind yet: ride or walk to Stormwind City; the arrow points the way."),
  "unknown flight path: the first step is not the ride: " .. Words(S.Current()))
check(not Is("Fly from"), "unknown flight path: the flight is shown as well")
local target = S.Target()
check(target and target.zone == "Stormwind City" and math.abs(target.x - fx) < 0.01 and math.abs(target.y - fy) < 0.01,
  "unknown flight path: the arrow is not on the flight master in Stormwind City: " .. tostring(target and (target.zone .. " " .. target.x .. " " .. target.y)))
RIDE_WORDS = string.gsub(Words(S.Current()), " / $", "")
local here = S.Position()
NOW = NOW + 1
S.Check()
check(S.Position() == here, "the ride ticked while the player was still in Westfall")
G.zone = "Stormwind City"
NOW = NOW + 1
S.Check()
check(Is("Leave Stormwind by the main gate"), "the walk does not follow the ride: " .. Words(S.Current()))
-- the same, for a player who has Stormwind only through a flight he took off from
ER.db.flightPaths = { [who] = { nodes = {}, towns = { stormwind = true } } }
Start()
check(Is("Fly from Sentinel Hill to Stormwind."), "a town the route taught: the flight is not shown: " .. Words(S.Current()))

-- c. the flight map opens: the places it lists are kept for this character, "NONE" ones are not
ER.db.flightPaths = nil
G.nodes = { { "Sentinel Hill, Westfall", "CURRENT" }, { "Stormwind, Elwynn Forest", "REACHABLE" }, { "Darkshire, Duskwood", "NONE" } }
S.Stop()
Fire("TAXIMAP_OPENED")
local mine = ER.db.flightPaths and ER.db.flightPaths[who]
check(mine and mine.nodes["Stormwind, Elwynn Forest"] and mine.nodes["Sentinel Hill, Westfall"], "the flight map's places were not kept")
check(mine and not mine.nodes["Darkshire, Duskwood"], "a place that cannot be used was kept")
Start()
check(Is("Fly from Sentinel Hill to Stormwind."), "the flight map lists Stormwind: the flight is not shown: " .. Words(S.Current()))
G.nodes = { { "Sentinel Hill, Westfall", "CURRENT" } }
ER.db.flightPaths = nil
Fire("TAXIMAP_OPENED")
Start()
check(Is("You do not have the flight path to Stormwind yet"), "the flight map does not list Stormwind: the ride is not shown: " .. Words(S.Current()))
-- a "Get the flight path" step and a flight remember their town (no flight map call in this case)
G.nodes = nil
ER.db.flightPaths = nil
local stormwind
for _, info in ipairs(ER.RouteGuides()) do
  if info.visit.zone == "Stormwind City" and not stormwind then stormwind = info end
end
check(S.Load(S.Key(stormwind), true), "Stormwind City did not load")
local gotIt = false
for guard = 1, 400 do
  local step = S.Current()
  if not step then break end
  local isP = false
  for _, e in ipairs(step.elements) do if e.kind == "P" and e.name == "Dungar Longdrink" then isP = true end end
  Satisfy(step)
  NOW = NOW + 1
  S.Check()
  if isP then gotIt = true break end
end
check(gotIt, "the Stormwind City visit never reached its flight path step")
mine = ER.db.flightPaths and ER.db.flightPaths[who]
check(mine and mine.towns and mine.towns.stormwind, "the flight path step did not teach the town Stormwind")
S.Stop()
G.nodes = nil
ER.db.flightPaths = nil
ER.StepsChanged = savedChanged
`, "section 11b");
console.log("  " + getString("RIDE_WORDS"));

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
  for line in string.gfind(ER._testGenerate(info), "[^\\n]+") do
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
check(EasyRouteRouteStarter._events.PLAYER_ENTERING_WORLD == true, "the route starter is not waiting for the first PLAYER_ENTERING_WORLD")
-- The quest log is not read yet (it is read later, below): the route waits for it, and gives up after 20 seconds.
G.ready = false
NewLogin()
Fire("PLAYER_ENTERING_WORLD")
check(EasyRouteRouteStarter._events.PLAYER_ENTERING_WORLD == nil, "the route starter still listens for PLAYER_ENTERING_WORLD after it began waiting")
for i = 1, 10 do Tick(1) end
check(not S.Running(), "the route started before the quest log was read")
G.ready = true
Tick(1)
check(S.Running(), "the route did not start once the quest log was read")
-- The game fires PLAYER_ENTERING_WORLD at every zone-in: the starter has run, so none of that starts anything again.
S.Stop()
ER.db.guides, ER.db.mode = {}, nil
CHAT = ""
for i = 1, 3 do
  Fire("PLAYER_ENTERING_WORLD")
  for j = 1, 8 do Tick(1) end
end
check(not S.Running(), "a later zone-in started the route again")
check(CHAT == "", "a later zone-in printed something: " .. CHAT)

G.ready = false
NewLogin()
Fire("PLAYER_ENTERING_WORLD")
for i = 1, 22 do Tick(1) end
G.ready = true
for i = 1, 3 do Tick(1) end
check(not S.Running(), "the route started after waiting more than 20 seconds for the log")

ER.db.guides, ER.db.mode = {}, nil
CHAT = ""
G.ready = false
NewLogin()
Fire("PLAYER_ENTERING_WORLD")
Tick(1)
Tick(1)
G.ready = true
Tick(1)
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
G.ready = true
`, "section 14");
console.log("  " + getString("START_LINE"));

// 14b. A saved casual-route position is never replaced by the automatic start, however the two starters (the route's, which waits for the
// quest log, and the step window's, which brings the saved guide back) are ordered in time. The saved zone here is not the one the level
// would give, and a marker on the record shows whether it was kept or made again.
console.log("14b. A saved position survives a slow login");
run(SECTION_START + `
local who = ER.Char()
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 15, "Stonetalon Mountains"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
local function Saved()
  S.Stop()
  ER.db.mode, ER.db.autoNextOff, ER.db.routeTold = "casual", true, nil
  ER.db.guides = { [who] = { key = "Casual route\\\\Stonetalon Mountains", pos = 1, passed = {}, fired = {}, side = {}, marker = "mine" } }
end
check(ER.RouteVisitFor(15).name ~= "Stonetalon Mountains", "level 15 should not give Stonetalon Mountains, the test needs another zone")
local function Kept(what)
  local rec = ER.db.guides[who]
  check(rec and rec.marker == "mine", what .. ": the saved record was replaced")
  check(S.Running() and S.Info().name == "Stonetalon Mountains", what .. ": the running zone is " .. tostring(S.Info() and S.Info().name))
end

-- a. the first frame after the loading screen is long: both starters cross their limits at once, the route's first
Saved()
G.ready = true
NewLogin()
Fire("PLAYER_ENTERING_WORLD")
Tick(6)
Kept("one long first frame")

-- b. the quest log is not read at first, and is read later
Saved()
G.ready = false
NewLogin()
Fire("PLAYER_ENTERING_WORLD")
for i = 1, 6 do Tick(1) end
G.ready = true
Tick(1)
Tick(1)
Kept("quest log read late")

-- c. called by hand with nothing running
Saved()
ER.RouteAutoStart()
Kept("RouteAutoStart by hand")
S.Stop()
ER.db.guides = {}
G.ready = true
`, "section 14b");

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

-- b. a RestedXP key saved but not running and not stopped: the saved guide comes back (the casual route never replaces it); the hint only once per character
Fresh()
ER.db.guides[who] = { key = restedKey, pos = 3, passed = {}, fired = {}, side = {} }
ER.db.routeTold = {}
ER.db.routeTold[who] = true
ER.RouteAutoStart()
check(not (S.Running() and S.Info().route), "a saved RestedXP guide was replaced by the casual route")
check(Lines() == 0, "the hint was printed again for a character that was told: " .. CHAT)
check(ER.db.guides[who].key == restedKey, "the saved RestedXP record was changed")
ER.db.routeTold = nil
ER.RouteAutoStart()
check(not (S.Running() and S.Info().route) and Lines() == 1 and string.find(CHAT, HINT, 1, true) ~= nil, "expected the hint once, got: " .. CHAT)
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
-- the zone's own quests without x and without the ones Casual leaves out (the plan's letters, S.LEAVE_OUT), counted from the reader
local ids, n = {}, 0
for _, area in ipairs(ER.RouteReader.ReadVisit(durotar.visit)) do
  for _, q in ipairs(area.q) do
    local f = q.flags or ""
    if q.id and not ids[q.id] and not string.find(f, "x", 1, true) and not S.LeftByKinds(f, "casual") then
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
check(ER.RouteShort() == "Durotar: 0/" .. n .. " done", "RouteShort says " .. tostring(ER.RouteShort()))
local shortAll, shortHead, shortEnd = ER.RouteShort()
check(shortHead == "Durotar" and shortEnd == ": 0/" .. n .. " done" and shortAll == shortHead .. shortEnd, "RouteShort parts are " .. tostring(shortHead) .. " / " .. tostring(shortEnd))
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
      check(EasyRouteGuideMenuLine:IsShown(), "the casual route group shows no position line")
      check(PlainText(EasyRouteGuideMenuLine._text) == want, "the menu line says '" .. PlainText(EasyRouteGuideMenuLine._text) .. "', not '" .. want .. "'")
      check(panel:GetHeight() > count * 16 + 36, "the panel did not grow for the line: " .. panel:GetHeight())
      MENU_LINE = PlainText(EasyRouteGuideMenuLine._text)
    elseif not restedName then
      restedName, restedRows = name, count
      check(not EasyRouteGuideMenuLine:IsShown(), name .. " shows a position line")
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
ER.FitLine = function(fs, text, width, tail) fs:SetText(text .. (tail or "")) end
ER.db.simple = true
ER.ShowSimple()
ER.RefreshSimple()
local name = Find("Durotar:")
check(name ~= nil, "Simple mode's name line does not start with 'Durotar:'")
SIMPLE_LINE = name and PlainText(name._text) or ""
check(string.find(SIMPLE_LINE, "^Durotar: 0/%d+ done$") ~= nil, "Simple mode's name line says '" .. SIMPLE_LINE .. "'")
-- the short line fits the name line as it is: the real FitLine keeps the numbers when the zone name has to be cut
ER.FitLine = fitWas
local probe = CreateFrame("Frame")
probe.GetStringWidth = function(self) return string.len(self._text or "") * 6 end
ER.FitLine(probe, "Stranglethorn Vale", 110, ": 12/20 done")
check(string.sub(probe._text, -12) == ": 12/20 done" and string.find(probe._text, "...", 1, true) ~= nil and string.len(probe._text) * 6 <= 110, "a long zone name was not cut and the numbers kept: " .. probe._text)
ER.FitLine(probe, "Stranglethorn", 120, ": 12/20 done")
check(string.sub(probe._text, -12) == ": 12/20 done" and string.len(probe._text) * 6 <= 120, "a long one-word zone name was not cut and the numbers kept: " .. probe._text)
ER.FitLine(probe, "Un'Goro", 200, ": 12/20 done")
check(probe._text == "Un'Goro: 12/20 done", "a short line was changed: " .. probe._text)
ER.FitLine = function(fs, text, width, tail) fs:SetText(text .. (tail or "")) end
-- a stop shows the zone and "stop" only
local infosNow = ER.RouteGuides()
local stopInfo
for _, i2 in ipairs(infosNow) do if i2.stop and not stopInfo then stopInfo = i2 end end
check(stopInfo ~= nil, "no stop in the Orc path")
check(S.Load(S.Key(stopInfo), true), "the stop did not load")
NOW = NOW + 3
ER.RefreshSimple()
check(Find(stopInfo.visit.zone .. ": stop") ~= nil, "Simple mode's name line for a stop is not '" .. stopInfo.visit.zone .. ": stop'")
check(ER.RouteShort() == stopInfo.visit.zone .. ": stop", "RouteShort for a stop says " .. tostring(ER.RouteShort()))
local rested
for _, g in ipairs(S.Guides()) do if not g.route and not rested then rested = g end end
check(S.Load(S.Key(rested), true), "the RestedXP guide did not load")
ER.RefreshSimple()
check(Find("Durotar:") == nil, "a RestedXP guide still shows the casual short line")
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
check(ER._testStuckFor() >= 600, "_testStuckFor says " .. ER._testStuckFor())
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

// 18b. The step box shows 10 lines. When the lines of a busy step fill it, "Stuck? Skip this step" (the only way out) still shows: it takes the
// place of the last line shown.
console.log("18b. The stuck line is not cut off by a long step");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
ER.db.mode, ER.db.autoNextOff, ER.db.simple = "casual", true, nil
local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  s = string.gsub(s, "|r", "")
  return s
end
local function Shown()
  local out = {}
  for i = 1, 10 do
    local b = _G["EasyRouteTrackerLine" .. i]
    if b and b:IsShown() then table.insert(out, { text = PlainText(b.text._text), line = b.line }) end
  end
  return out
end
ER.db.guides, ER.db.done = {}, {}
check(ER.StartGuide(S.Key(ER.RouteGuides()[1]), true), "the Durotar zone did not start")
local real = S.Current()
local fake = { flags = {}, nots = {}, need = "", n = real.n, elements = {} }
for i = 1, 12 do table.insert(fake.elements, { kind = "I", text = "Busy line " .. i }) end
local currentWas, stuckWas = S.Current, ER.IsStuck
S.Current = function() return fake end
ER.IsStuck = function() return false end
ER.StepsChanged()
local plain = Shown()
check(table.getn(plain) == 10, "the busy step does not fill the box: " .. table.getn(plain) .. " lines")
for _, l in ipairs(plain) do check(not (l.line and l.line.skip), "a stuck line shows without being stuck") end
ER.IsStuck = function() return true end
ER.StepsChanged()
local lines = Shown()
local at
for i, l in ipairs(lines) do if l.text == "Stuck? Skip this step" and l.line and l.line.skip then at = i end end
check(table.getn(lines) == 10, "the box shows " .. table.getn(lines) .. " lines, not 10")
check(at ~= nil, "the stuck line is cut off by the long step: " .. (lines[10] and lines[10].text or "?"))
check(at == 10, "the stuck line is not in the last place of the box: " .. tostring(at))
S.Current, ER.IsStuck = currentWas, stuckWas
ER.StepsChanged()
S.Stop()
ER.db.guides, ER.db.done = {}, {}
`, "section 18b");

// 18c. A zone that ended because you are ahead says so once; started again it does not say it again.
console.log("18c. The 'ahead' mark goes when the zone is started again");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
ER.db.mode, ER.db.autoNextOff = "hard", true
ER.db.guides, ER.db.done = {}, {}
local first = ER.RouteGuides()[1]
first.ahead = true
check(ER.StartGuide(S.Key(first), true), "the Durotar zone did not start")
check(first.ahead == nil, "the 'ahead' mark of the last time stayed when the zone was started again")
S.Stop()
ER.db.guides, ER.db.done = {}, {}
`, "section 18c");

// 19. A grind step of the route names the mob, says why in the step box, and the arrow points at the spot. The Orc's first grind step in
// Durotar (grind to level 2, a mark of the plan) is the tracer: every layer from the data to the box is real.
console.log("19. A grind step names a mob, says why, and the arrow points at it");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
local first = ER.RouteGuides()[1]
check(first and first.visit.zone == "Durotar", "the Orc's first visit is not Durotar")
check(ER.StartGuide(S.Key(first), true), "the Durotar zone did not start")
local at, grindStep
for n = 1, S.Count() do
  local step = S.Step(n)
  if step.flags.grind and step.flags.grind ~= "bridge" then
    for _, e in ipairs(step.elements) do
      if e.kind == "X" and tonumber(e.level) == 2 and not at then at, grindStep = n, step end
    end
  end
  if at then break end
end
check(at ~= nil, "no grind step to level 2 in the Durotar visit")
if at then
  S.Jump(at)
  ER.StepsChanged()
  local iLine
  for _, e in ipairs(grindStep.elements) do
    if e.kind == "I" then iLine = S.Line(grindStep, e) end
  end
  local text = iLine and iLine.text or ""
  check(string.find(text, "^Grind Mottled Boars") ~= nil, "the step line does not start with Grind Mottled Boars: " .. text)
  check(string.find(text, "until level 2%.$") ~= nil, "the step line does not end with until level 2.: " .. text)
  local reason = ER.GrindReasonLine(grindStep)
  check(reason ~= nil and string.find(reason, "yellow", 1, true) ~= nil, "the reason line does not say yellow: " .. tostring(reason))
  local pick = ER.GrindPick(grindStep)
  check(pick ~= nil and pick.spot.name == "Mottled Boar", "the pick is not the Mottled Boar spot")
  local target = S.Target()
  check(target ~= nil and pick ~= nil and target.zone == "Durotar" and target.x == pick.spot.x and target.y == pick.spot.y,
    "the arrow does not point at the picked spot")
  check(string.find(S.Title(grindStep), "Mottled Boars", 1, true) ~= nil, "the title does not name the Mottled Boars: " .. S.Title(grindStep))
  local shown = ""
  for i = 1, 10 do
    local b = _G["EasyRouteTrackerLine" .. i]
    if b and b:IsShown() then shown = shown .. b.text._text .. " / " end
  end
  check(reason ~= nil and string.find(shown, reason, 1, true) ~= nil, "the step box does not show the reason line: " .. shown)
  GR_LINE, GR_REASON = text, reason or ""
end
S.Stop()
ER.db.guides, ER.db.done = {}, {}
`, "section 19");
console.log("  Orc Durotar level 1: " + getString("GR_LINE") + " / " + getString("GR_REASON"));

// 19b. Every kind of spot is said plainly: the reason for each code, the plural of each mob, the place word, Simple mode's Now line, and the
// step ends at its level, goes on with Skip and falls back to the Phase 3 text when there is no spot.
console.log("19b. The words for every kind of spot");
run(`
function FindGrindStep(S, level)
  for n = 1, S.Count() do
    local step = S.Step(n)
    if step.flags.grind and step.flags.grind ~= "bridge" then
      for _, e in ipairs(step.elements) do
        if e.kind == "X" and tonumber(e.level) == level then return n, step end
      end
    end
  end
  return nil
end
function ShownLines()
  local shown = ""
  for i = 1, 10 do
    local b = _G["EasyRouteTrackerLine" .. i]
    if b and b:IsShown() then shown = shown .. b.text._text .. " / " end
  end
  return shown
end
`, "section 19b helpers");

// 1. The sentence for each case, word for word.
run(SECTION_START + `
local function Spot(code, red, lo, hi)
  return { name = "Mottled Boar", x = 50, y = 50, lo = lo, hi = hi, n = 30, code = code, red = red, elite = 0 }
end
local function Is(got, want, what)
  check(got == want, what .. ": '" .. tostring(got) .. "' is not '" .. want .. "'")
end
local W = ER._testGrindReason
Is(W(Spot("y", 3, 1, 2), "y", 1, 100), "Mottled Boars here are yellow: they won't attack you, and there are few other mobs around.", "yellow, few others")
Is(W(Spot("y", 12, 1, 2), "y", 1, 100), "Mottled Boars here are yellow: they won't attack you, and there are few other mobs around.", "yellow, 12 others is still few")
Is(W(Spot("y", 25, 1, 2), "y", 1, 100), "Mottled Boars here are yellow: they won't attack you first. Other mobs are close by, so keep an eye out.", "yellow, more others")
Is(W(Spot("y", 13, 1, 2), "y", 1, 100), "Mottled Boars here are yellow: they won't attack you first. Other mobs are close by, so keep an eye out.", "yellow, 13 others is more")
Is(W(Spot("y", 3, 4, 5), "y", 2, 100), "Mottled Boars here are a little above you (level 4-5), but yellow: they won't attack you first.", "yellow, above you")
Is(W(Spot("p", 3, 1, 2), "p", 1, 100), "Mottled Boars here do not attack unless you attack them first, and no strong mobs are near.", "no first attack")
Is(W(Spot("r", 3, 1, 2), "r", 2, 100), "Mottled Boars here attack you, but they are your level or lower, and no strong mobs are near.", "red, few others")
Is(W(Spot("r", 15, 1, 2), "r", 2, 100), "Mottled Boars here attack you, but they are your level or lower. Other mobs are close by, so keep an eye out.", "red, more others")
Is(W(Spot("u", 3, 5, 6), "u", 6, 100), "Mottled Boars here are your level (level 5-6), and no strong mobs are near.", "no data, two levels")
Is(W(Spot("u", 3, 5, 5), "u", 5, 100), "Mottled Boars here are your level (level 5), and no strong mobs are near.", "no data, one level")
Is(W(Spot("y", 3, 1, 2), "y", 1, 700), "Mottled Boars here are yellow: they won't attack you, and there are few other mobs around. It is a bit of a walk.", "a bit of a walk")
Is(W(Spot("y", 3, 1, 2), "y", 1, ER.GRIND.GRIND_FAR), "Mottled Boars here are yellow: they won't attack you, and there are few other mobs around. It is a bit of a walk.", "exactly far is still a bit of a walk")
Is(W(Spot("y", 3, 1, 2), "y", 1, ER.GRIND.GRIND_FAR + 1), "Mottled Boars here are yellow: they won't attack you, and there are few other mobs around. It is far away: a long walk.", "far away")
Is(W(Spot("r", 3, 1, 2), "r", 2, 1500), "Mottled Boars here attack you, but they are your level or lower, and no strong mobs are near. It is far away: a long walk.", "red, far away")
for _, yards in ipairs({ 0, 100, 700, 1300 }) do
  check(not string.find(W(Spot("u", 3, 5, 6), "u", 6, yards), "closest", 1, true), "the words claim the closest spot at " .. yards .. " yards")
end
Is(W(Spot("u", 3, 5, 5), "u", 5, ER.GRIND.GRIND_NEAR), "Mottled Boars here are your level (level 5), and no strong mobs are near.", "exactly near is not far")
check(not string.find(W(Spot("u", 3, 5, 6), "u", 6, 700), "yellow", 1, true), "a no-data reason says yellow")
`, "section 19b reasons");

// 1b. The order of the spots: the nearest one that has enough mobs first; red or unknown mobs count GRIND_YELLOW_EXTRA yards farther, mobs
// a little above you GRIND_ABOVE_EXTRA farther. Made-up spots in Durotar, a level 5 player standing at 50,50.
run(SECTION_START + `
local S = ER.Steps
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 5, "Durotar"
local per10 = S.Yards("Durotar", 50, 50, 60, 50)
check(per10 > 100, "Durotar 10 percent is only " .. tostring(per10) .. " yards")
local function At(yards) return 50 + 10 * yards / per10 end
local function Info(spots)
  local lines = {}
  for _, s in ipairs(spots) do
    table.insert(lines, table.concat({ s[1], At(s[2]), 50, s[3], s[4], s[5], s[6], 3, 0 }, "\\t"))
  end
  return { visit = { zone = "Durotar", spots = table.concat(lines, "\\n"), areas = "" } }
end
local function Order(spots)
  local names = {}
  for _, e in ipairs(ER._testGrindChoose(Info(spots), 5, 50, 50)) do table.insert(names, e.spot.name) end
  return table.concat(names, ",")
end
local function Is(got, want, what) check(got == want, what .. ": '" .. got .. "' is not '" .. want .. "'") end
check(ER.GRIND.GRIND_YELLOW_EXTRA == 600 and ER.GRIND.GRIND_ABOVE_EXTRA == 300 and ER.GRIND.GRIND_MIN_SPAWNS == 8, "the order numbers are not what this check expects")
-- {name, yards from the anchor, lo, hi, spawns, code}
Is(Order({ { "Far Big", 500, 4, 5, 40, "y" }, { "Near Small", 100, 4, 5, 8, "y" } }), "Near Small,Far Big", "the nearer small group beats the bigger far one")
Is(Order({ { "Near Small", 100, 4, 5, 8, "y" }, { "Far Big", 500, 4, 5, 40, "y" } }), "Near Small,Far Big", "the same, the other way round in the data")
Is(Order({ { "Tiny Near", 10, 4, 5, 7, "y" }, { "Enough", 300, 4, 5, 8, "y" } }), "Enough", "a spot with fewer than GRIND_MIN_SPAWNS is never picked")
Is(Order({ { "Red Near", 50, 5, 5, 20, "r" }, { "Yellow Far", 640, 4, 5, 20, "y" } }), "Yellow Far,Red Near", "a yellow spot less than 600 yards farther beats a red one")
Is(Order({ { "Red Near", 50, 5, 5, 20, "r" }, { "Yellow Far", 660, 4, 5, 20, "y" } }), "Red Near,Yellow Far", "a yellow spot more than 600 yards farther loses to a red one")
Is(Order({ { "Red Near", 50, 5, 5, 20, "r" }, { "Yellow Far", 1500, 4, 5, 20, "y" } }), "Red Near,Yellow Far", "a far yellow spot loses to a near red one")
Is(Order({ { "Unknown Near", 50, 5, 5, 20, "u" }, { "Yellow Far", 1500, 4, 5, 20, "y" } }), "Unknown Near,Yellow Far", "a far yellow spot loses to a near unknown one")
Is(Order({ { "Red Near", 50, 5, 5, 20, "r" }, { "Red Far", 400, 5, 5, 40, "r" } }), "Red Near,Red Far", "of two red spots the nearer one")
Is(Order({ { "Above Near", 100, 7, 7, 20, "y" }, { "Level Far", 350, 4, 5, 20, "y" } }), "Level Far,Above Near", "mobs a little above you count 300 yards farther")
Is(Order({ { "Above Near", 50, 7, 7, 20, "y" }, { "Level Far", 400, 4, 5, 20, "y" } }), "Above Near,Level Far", "mobs a little above you still win when much nearer")
Is(Order({ { "No Fit", 10, 9, 9, 20, "y" }, { "Fits", 900, 4, 5, 20, "y" } }), "Fits", "a spot too high for you is never picked")
`, "section 19b order");

// 2. Across the pools of all 8 races: a yellow spot says yellow, no other kind does, and every reason starts with the plural.
const reasonCounts = { y: 0, p: 0, r: 0, u: 0 };
const poolNames = new Set();
for (const race of RACES_WALKED) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1, "Durotar"
local counts = { y = 0, p = 0, r = 0, u = 0 }
local names = {}
for _, info in ipairs(ER.RouteGuides()) do
  if info.visit then
    for _, spot in ipairs(ER.RouteReader.ReadSpots(info.visit)) do
      counts[spot.code] = (counts[spot.code] or 0) + 1
      names[spot.name] = true
      local levels = {}
      if spot.code == "y" or spot.code == "p" then
        for lv = math.max(1, spot.lo - 1), spot.hi do table.insert(levels, lv) end
      else
        table.insert(levels, spot.hi)
      end
      local plural = ER.GrindPlural(spot.name)
      for _, lv in ipairs(levels) do
        local text = ER._testGrindReason(spot, spot.code, lv, 0)
        local yellow = string.find(text, "yellow", 1, true) ~= nil
        check(yellow == (spot.code == "y"), ${JSON.stringify(race)} .. " " .. spot.name .. " (" .. spot.code .. ", level " .. lv .. ") reason: " .. text)
        check(string.sub(text, 1, string.len(plural) + 6) == plural .. " here ", ${JSON.stringify(race)} .. " " .. spot.name .. " reason does not start with the plural: " .. text)
      end
    end
  end
end
CNT_Y, CNT_P, CNT_R, CNT_U = counts.y, counts.p, counts.r, counts.u
local list = {}
for name in pairs(names) do table.insert(list, name) end
table.sort(list)
POOL_NAMES = table.concat(list, "|")
`, "section 19b pools " + race);
  reasonCounts.y += getNumber("CNT_Y");
  reasonCounts.p += getNumber("CNT_P");
  reasonCounts.r += getNumber("CNT_R");
  reasonCounts.u += getNumber("CNT_U");
  for (const n of getString("POOL_NAMES").split("|")) if (n) poolNames.add(n);
}
console.log(`  reasons: ${reasonCounts.y} yellow, ${reasonCounts.p} no-first-attack, ${reasonCounts.r} red, ${reasonCounts.u} no data`);
jsCheck(reasonCounts.y > 0 && reasonCounts.r > 0 && reasonCounts.u > 0, "the pools do not hold all the kinds of spot");

// 3. Plurals.
const PLURALS = [["Wolf", "Wolves"], ["Timber Wolf", "Timber Wolves"], ["Giraffe", "Giraffes"], ["Thief", "Thieves"], ["Witch", "Witches"],
  ["Sorceress", "Sorceresses"], ["Fox", "Foxes"], ["Lynx", "Lynxes"], ["Harpy", "Harpies"], ["Grizzly", "Grizzlies"],
  ["Mercenary", "Mercenaries"], ["Monkey", "Monkeys"], ["Watchman", "Watchmen"], ["Servant of Arugal", "Servants of Arugal"],
  ["Mottled Boar", "Mottled Boars"], ["Kobold Vermin", "Kobold Vermin"], ["Deer", "Deer"], ["Daggerspine Siren", "Daggerspine Sirens"],
  ["Citizen", "Citizens"], ["Highwaymen", "Highwaymen"]];
run(SECTION_START + `
local want = {
${PLURALS.map(p => `  { ${JSON.stringify(p[0])}, ${JSON.stringify(p[1])} },`).join("\n")}
}
for _, pair in ipairs(want) do
  local got = ER.GrindPlural(pair[1])
  check(got == pair[2], "the plural of " .. pair[1] .. " is '" .. got .. "', not '" .. pair[2] .. "'")
end
local names = {}
for name in string.gfind(${JSON.stringify([...poolNames].sort().join("|"))}, "[^|]+") do
  local plural = ER.GrindPlural(name)
  table.insert(names, name .. " -> " .. plural)
  check(plural ~= "" and string.find(plural, "|", 1, true) == nil, "the plural of " .. name .. " is odd: '" .. plural .. "'")
end
PLURAL_LIST = table.concat(names, "|")
`, "section 19b plurals");
console.log(`  plurals: ${PLURALS.length} checked, ${poolNames.size} pool names made plural`);
if (process.env.ER_SHOW_PLURALS) for (const p of getString("PLURAL_LIST").split("|")) console.log("    " + p);

// 4. The place word and no map numbers in the step line of every grind step, race by race.
for (const race of RACES_WALKED) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
local named, none = 0, 0
for _, info in ipairs(ER.RouteGuides()) do
  if info.visit and not info.stop then
    G.zone, G.x, G.y = info.visit.zone, 0, 0
    check(S.Load(S.Key(info), true), ${JSON.stringify(race)} .. ": " .. tostring(info.visit.zone) .. " did not load")
    for n = 1, S.Count() do
      local step = S.Step(n)
      if step.flags.grind and step.flags.grind ~= "bridge" then
        local to
        for _, e in ipairs(step.elements) do
          if e.kind == "X" then to = tonumber(e.level) end
        end
        G.level = math.max(1, (to or 2) - 1)
        local text = ER.GrindText(step)
        if text then
          named = named + 1
          local where = ${JSON.stringify(race)} .. " " .. info.visit.zone .. " step " .. n .. ": " .. text
          check(string.find(text, "^Grind .+ near .+ until level %d+%.$") ~= nil or string.find(text, "^Grind .+ here until level %d+%.$") ~= nil,
            "no place word: " .. where)
          check(string.find(text, "(", 1, true) == nil and string.find(text, "%d+, %d+") == nil, "map numbers in the step line: " .. where)
          check(not string.find(text, "yellow", 1, true), "the step line says yellow: " .. where)
          local title = ER.GrindTitle(step)
          check(title ~= nil and string.find(title, "^Grind .+ until level %d+$") ~= nil, "the title is odd: " .. tostring(title))
          check(ER.GrindTarget(step) ~= nil, "no arrow target: " .. where)
          check(ER.GrindReasonLine(step) ~= nil, "no reason line: " .. where)
        else
          none = none + 1
        end
      end
    end
  end
end
S.Stop()
ER.db.guides, ER.db.done = {}, {}
PLACE_NAMED, PLACE_NONE = named, none
`, "section 19b place " + race);
  const named = getNumber("PLACE_NAMED"), none = getNumber("PLACE_NONE");
  console.log(`  ${race}: ${named} grind steps named, ${none} with no spot`);
  jsCheck(named > 0, `${race}: no grind step got a spot`);
}

// 5 to 7. The Orc's Durotar grind step: Simple mode, live xp, the end at the level, Skip, and the Phase 3 text without a spot.
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.guides, ER.db.done, ER.db.autoNextOff, ER.db.grindOff = "casual", {}, {}, true, nil
S.Stop()
local simpleWas = ER.db.simple
ER.db.simple = nil
local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  s = string.gsub(s, "|r", "")
  return s
end
local first = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(first.visit)
G.x, G.y = areas[1].x, areas[1].y
local key = S.Key(first)
check(ER.StartGuide(key, true), "the Durotar zone did not start")
local at, grindStep = FindGrindStep(S, 2)
check(at ~= nil, "no grind step to level 2 in the Durotar visit")
if at then
  S.Jump(at)
  ER.StepsChanged()

  -- Simple mode: the Now line names the mob.
  local fitWas = ER.FitLine
  ER.FitLine = function(fs, text, width, tail) fs:SetText(text .. (tail or "")) end
  ER.db.simple = true
  ER.ShowSimple()
  ER.RefreshSimple()
  local nowLine
  for _, f in ipairs(ALLFRAMES) do
    if rawget(f, "_text") and string.sub(PlainText(f._text), 1, 5) == "Now: " then nowLine = PlainText(f._text) end
  end
  check(nowLine ~= nil and string.find(nowLine, "Grind Mottled Boars", 1, true) ~= nil, "Simple mode's Now line does not say Grind Mottled Boars: " .. tostring(nowLine))
  SIMPLE_NOW = nowLine or ""
  ER.FitLine = fitWas
  ER.HideSimple()
  ER.db.simple = simpleWas

  -- Live xp.
  local xLine
  for _, e in ipairs(grindStep.elements) do
    if e.kind == "X" then xLine = S.Line(grindStep, e) end
  end
  check(xLine ~= nil and string.find(xLine.text, "(you: level 1", 1, true) ~= nil, "the xp line is not live: " .. tostring(xLine and xLine.text))
  LIVE_XP = xLine and xLine.text or ""

  -- Skip goes straight on and the level stays.
  S.Next()
  check(S.Position() > at, "Skip did not move on from the grind step")
  check(G.level == 1, "Skip changed the level")

  -- The step ends by itself at the level, and the next step follows.
  G.level = 1
  check(ER.StartGuide(key, true), "the Durotar zone did not start again")
  S.Jump(at)
  ER.StepsChanged()
  check(S.Position() == at, "the jump did not land on the grind step")
  NOW = NOW + 1
  S.Check()
  check(S.Position() == at, "the grind step ended before the level was reached")
  G.level = 2
  NOW = NOW + 1
  S.Check()
  check(S.Position() > at, "the grind step did not end at level 2")
  local cur = S.Current()
  local hasA = false
  for _, e in ipairs(cur and cur.elements or {}) do
    if e.kind == "A" then hasA = true end
  end
  check(hasA, "the step after the grind does not accept a quest")

  -- No spot: the Phase 3 words, no arrow place, no reason line.
  G.level = 1
  check(ER.StartGuide(key, true), "the Durotar zone did not start a third time")
  at, grindStep = FindGrindStep(S, 2)
  S.Jump(at)
  ER.StepsChanged()
  local reasonBefore = ER.GrindReasonLine(grindStep)
  check(reasonBefore ~= nil, "no reason line before the Settings tick is off")
  ER.db.grindOff = true
  ER.StepsChanged()
  for n = 1, S.Count() do
    local step = S.Step(n)
    if step.flags.grind and step.flags.grind ~= "bridge" then
      local to
      for _, e in ipairs(step.elements) do
        if e.kind == "X" then to = tonumber(e.level) end
      end
      local want
      if step.flags.grind == "end" then
        want = "Out of quests here: grind mobs near you until level " .. to .. ", then the guide goes on."
      else
        want = "Nothing to pick up here yet: grind mobs near you until level " .. to .. "."
      end
      local found = false
      for _, e in ipairs(step.elements) do
        if e.kind == "I" then
          local line = S.Line(step, e)
          found = true
          check(line and line.text == want, "without a spot the line is '" .. tostring(line and line.text) .. "', not '" .. want .. "'")
        end
      end
      check(found, "a grind step has no I line")
      check(string.find(S.Title(step), "^Grind to level " .. to .. "$") ~= nil, "without a spot the title is '" .. S.Title(step) .. "'")
    end
  end
  check(S.Target() == nil, "without a spot the arrow still has a place")
  check(ER.GrindReasonLine(grindStep) == nil, "without a spot there is still a reason line")
  local shown = ShownLines()
  check(string.find(shown, "yellow", 1, true) == nil and string.find(shown, reasonBefore, 1, true) == nil, "without a spot the box still holds a reason: " .. shown)
  ER.db.grindOff = nil
end
S.Stop()
ER.db.simple = simpleWas
ER.db.guides, ER.db.done, ER.db.grindOff = {}, {}, nil
`, "section 19b durotar");
console.log("  Simple mode: " + getString("SIMPLE_NOW"));
console.log("  live xp: " + getString("LIVE_XP"));

// 19c. Every grind point of every race has a safe spot. The xp-model player of section 5 walks each path; wherever a grind step really has
// to lift him (its level is above his), the game's own pick (ER._testGrindChoose) is asked for his level and the step's anchor. A point with
// no spot is a failure, except the one accepted exception: the Felwood zone-end grind from 56 to 57 (D-03a). The builder's numbers and the
// game's must be the same, and so must the grey-level rule.
console.log("19c. Every grind point of every race has a safe spot");
let pointsAll = 0, pointsWithSpot = 0;
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
for idx, info in ipairs(infos) do
  local flags = ""
  for line in string.gfind(ER._testGenerate(info), "[^\\n]+") do
    local _, _, sflags = string.find(line, "^S\\t\\t\\t(.*)$")
    if sflags then flags = sflags end
    local _, _, kind, id = string.find(line, "^(%u)\\t\\t(%d+)\\t")
    if kind == "A" then
      local row = ER.QuestRow(tonumber(id))
      table.insert(dump, "A\\t" .. id .. "\\t" .. tostring(row and row.m or 1) .. "\\t" .. (flagsOf[tonumber(id)] or "") .. "\\t" .. info.visit.zone)
    elseif kind == "T" then
      local row = ER.QuestRow(tonumber(id))
      table.insert(dump, "T\\t" .. id .. "\\t" .. tostring(row and row.l or 1) .. "\\t" .. (flagsOf[tonumber(id)] or ""))
    else
      local _, _, level = string.find(line, "^X\\t\\t\\t(%d+)\\t")
      if level then
        local _, _, gv = string.find(flags, "grind=(%w+)")
        local _, _, ax, ay = string.find(flags, "at=([%d%.]+),([%d%.]+)")
        if gv == "bridge" then
          -- a bridge's level is a placeholder
        elseif gv then
          table.insert(dump, "G\\t" .. idx .. "\\t" .. gv .. "\\t" .. (ax or "") .. "\\t" .. (ay or "") .. "\\t" .. level .. "\\t" .. info.visit.zone)
        else
          table.insert(dump, "X\\t" .. level .. "\\t" .. info.visit.zone)
        end
      end
    end
  end
end
WALK_DUMP = table.concat(dump, "\\n")
`, "section 19c dump " + race);
  let total = 0;
  const done = new Set(), points = [];
  for (const line of getString("WALK_DUMP").split("\n")) {
    const f = line.split("\t");
    if (f[0] === "X") {
      total = Math.max(total, xp.xpAt(Number(f[1])));
    } else if (f[0] === "G") {
      const lv = Math.floor(xp.levelAt(total)), N = Number(f[5]);
      if (N > lv) {
        points.push({ idx: Number(f[1]), kind: f[2], ax: f[3], ay: f[4], lv, N, zone: f[6] });
        total = Math.max(total, xp.xpAt(N));
      }
    } else if (f[0] === "T") {
      const id = f[1], flags = f[3];
      if (/[es]/.test(flags) || done.has(id)) continue;
      done.add(id);
      const lv = Math.floor(xp.levelAt(total));
      total += xp.questXP(Number(f[2]), lv) + (flags.indexOf("k") >= 0 ? xp.K * xp.killXP(lv, Number(f[2])) : 0);
    }
  }
  const lit = (v) => (v === "" ? "nil" : Number(v));
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1
local infos = ER.RouteGuides()
local points = {
${points.map(p => `  { ${p.idx}, ${p.lv}, ${lit(p.ax)}, ${lit(p.ay)} },`).join("\n")}
}
local out = {}
for _, p in ipairs(points) do
  local info = infos[p[1]]
  local ax, ay = p[3], p[4]
  if not ax then
    local first = ER.RouteReader.ReadVisit(info.visit)[1]
    ax, ay = first.x, first.y
  end
  local list = ER._testGrindChoose(info, p[2], ax, ay)
  local names, distinct = {}, 0
  for _, c in ipairs(list) do
    if not names[c.spot.name] then
      names[c.spot.name] = true
      distinct = distinct + 1
    end
  end
  table.insert(out, table.getn(list) .. "," .. (list[1] and list[1].code or "-") .. "," .. distinct)
end
CHOOSE_OUT = table.concat(out, ";")
`, "section 19c pick " + race);
  const answers = getString("CHOOSE_OUT").split(";").filter((s) => s !== "");
  jsCheck(answers.length === points.length, `${race}: asked ${points.length} grind points, got ${answers.length} answers`);
  let withSpot = 0, yellowFirst = 0, several = 0;
  const missing = [];
  points.forEach((p, i) => {
    const [count, code, distinct] = (answers[i] || "0,-,0").split(",");
    if (Number(count) > 0) {
      withSpot++;
      if (code === "y" || code === "p") yellowFirst++;
      if (Number(distinct) >= 2) several++;
      return;
    }
    const accepted = p.zone === "Felwood" && p.kind === "end" && p.N === 57;
    missing.push(`${race} ${p.zone} (${p.kind}, ${p.lv} to ${p.N})${accepted ? " [accepted exception]" : ""}`);
    jsCheck(accepted, `${race}: no safe spot in ${p.zone} for the grind from ${p.lv} to ${p.N} (${p.kind})`);
  });
  pointsAll += points.length;
  pointsWithSpot += withSpot;
  console.log(`  ${race}: ${points.length} grind points to grind through, ${withSpot} with a spot, ${yellowFirst} start with a yellow mob, ${several} offer two or more mobs`);
  for (const m of missing) console.log("  no spot: " + m);
}
console.log(`  all races: ${pointsAll} grind points, ${pointsWithSpot} with a spot`);

// The builder's numbers and the game's must be the same, and so must the grey-level rule.
run(SECTION_START + `
local keys = {}
for k, v in pairs(ER.GRIND) do table.insert(keys, k .. "=" .. v) end
table.sort(keys)
GAME_CONSTS = table.concat(keys, ";")
local grey = {}
for lv = 1, 59 do table.insert(grey, ER.Steps.GreyLevel(lv)) end
GAME_GREY = table.concat(grey, ",")
`, "section 19c constants");
{
  const builderText = fs.readFileSync(path.join(ROOT, "tools", "build-route.js"), "utf8");
  const builder = {};
  for (const m of builderText.matchAll(/\b(GRIND_[A-Z_]+)\s*=\s*([0-9.]+)\b/g)) builder[m[1]] = Number(m[2]);
  const game = {};
  for (const kv of getString("GAME_CONSTS").split(";")) {
    const [k, v] = kv.split("=");
    game[k] = Number(v);
  }
  let compared = 0;
  for (const k of Object.keys(game)) {
    if (!(k in builder)) continue;
    compared++;
    jsCheck(builder[k] === game[k], `${k} is ${builder[k]} in tools/build-route.js but ${game[k]} in Grind.lua`);
  }
  jsCheck(compared >= 8, `only ${compared} grind numbers could be compared between the builder and the game`);
  const grey = getString("GAME_GREY").split(",").map(Number);
  let greyDiff = 0;
  for (let lv = 1; lv <= 59; lv++) {
    if (grey[lv - 1] !== xp.greyLevel(lv)) {
      greyDiff++;
      jsCheck(false, `the grey level of ${lv} is ${grey[lv - 1]} in the game but ${xp.greyLevel(lv)} in tools/lib/xpmodel.js`);
    }
  }
  console.log(`  same numbers: ${compared} grind numbers compared, grey level of 1 to 59 ${greyDiff === 0 ? "equal" : greyDiff + " differ"}`);
}

// 19d. A zone-end grind step is anchored where you stand. Its pick is made again once you have moved more than GRIND_MOVE_YARDS since the
// pick (the Orc in the Barrens at level 20: the walk from 50,40 to 40,80 changes the distance and the words), and not for a small step; a
// pick made while you were in another zone (the step's own place is the anchor then) is made again when you stand in the zone.
console.log("19d. A zone-end pick follows where you stand");
run(SECTION_START + `
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 20
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
local barrens
for _, i in ipairs(ER.RouteGuides()) do
  if not barrens and i.visit.zone == "The Barrens" then barrens = i end
end
check(barrens ~= nil, "the Orc path has no Barrens visit")
local function Pos(zone, x, y)
  G.zone, G.x, G.y = zone, x, y
  NOW = NOW + 1
end
local calls, realChanged = 0, ER.StepsChanged
ER.StepsChanged = function() calls = calls + 1 end
local function GoToEnd()
  Pos("The Barrens", 50, 40)
  G.level = 20
  ER.db.guides, G.log, G.order = {}, {}, {}
  check(S.Load(S.Key(barrens), true), "the Barrens visit did not load")
  local endStep
  for n = 1, S.Count() do
    if S.Step(n).flags.grind == "end" then endStep = S.Step(n) end
  end
  check(endStep ~= nil, "the Barrens visit has no zone-end grind step")
  S.Jump(endStep.n)
  check(S.Current() == endStep, "the zone-end step is not current")
  return endStep
end
local small = ER.Steps.Yards("The Barrens", 50, 40, 51, 40)
local big = ER.Steps.Yards("The Barrens", 50, 40, 40, 80)
check(small < ER.GRIND.GRIND_MOVE_YARDS and big > 3 * ER.GRIND.GRIND_MOVE_YARDS, "the test walks are not a small step (" .. small .. ") and a long walk (" .. big .. ")")

-- a. Standing at 50,40, a small step, a long walk.
local endStep = GoToEnd()
local pick1 = ER.GrindPick(endStep)
check(pick1 ~= nil, "no pick for the zone-end step")
local want1 = ER._testGrindChoose(barrens, 20, 50, 40)[1]
check(pick1 and want1 and pick1.spot == want1.spot and math.abs(pick1.yards - want1.yards) < 0.01, "the first pick is not the choice from where you stand")
Pos("The Barrens", 51, 40)
Tick(1)
check(ER.GrindPick(endStep) == pick1, "a small step made the pick again")
local callsBefore = calls
Pos("The Barrens", 40, 80)
Tick(1)
local pick2 = ER.GrindPick(endStep)
local want2 = ER._testGrindChoose(barrens, 20, 40, 80)[1]
check(pick2 ~= nil and pick2 ~= pick1, "a long walk did not make the pick again")
check(pick2 and want2 and pick2.spot == want2.spot and math.abs(pick2.yards - want2.yards) < 0.01, "the pick after the walk is not the choice from where you stand now")
check(pick1 and pick2 and math.abs(pick1.yards - pick2.yards) > 1, "the distance did not change after the walk (" .. tostring(pick1 and pick1.yards) .. ")")
if pick1 and pick2 then
  check((pick1.spot ~= pick2.spot) == (calls > callsBefore), "the step box was drawn " .. (calls - callsBefore) .. " times for a spot that " .. (pick1.spot ~= pick2.spot and "changed" or "stayed"))
  Z_LINE = pick1.spot.name .. " " .. math.floor(pick1.yards) .. " yd -> " .. pick2.spot.name .. " " .. math.floor(pick2.yards) .. " yd"
end
-- standing still: nothing more happens
local pick3 = ER.GrindPick(endStep)
Tick(1)
Tick(1)
check(ER.GrindPick(endStep) == pick3, "standing still made the pick again")
S.Stop()

-- b. Asked while you are in another zone (the first area is the anchor): made again once you stand in the zone.
endStep = GoToEnd()
Pos("Orgrimmar", 50, 40)
ER.db.guides = {}
check(S.Load(S.Key(barrens), true), "the Barrens visit did not load again")
for n = 1, S.Count() do
  if S.Step(n).flags.grind == "end" then endStep = S.Step(n) end
end
S.Jump(endStep.n)
local away = ER.GrindPick(endStep)
local _, _, atx, aty = string.find(endStep.flags.at or "", "^([%d%.]+),([%d%.]+)$")
check(atx ~= nil, "the zone-end step has no at= place")
local wantAway = ER._testGrindChoose(barrens, 20, tonumber(atx), tonumber(aty))[1]
check(away ~= nil and wantAway ~= nil and away.spot == wantAway.spot and math.abs(away.yards - wantAway.yards) < 0.01, "the pick asked in another zone is not the choice from the step's own place")
Pos("The Barrens", 40, 80)
Tick(1)
local here = ER.GrindPick(endStep)
local wantHere = ER._testGrindChoose(barrens, 20, 40, 80)[1]
check(here ~= nil and here ~= away and wantHere ~= nil and here.spot == wantHere.spot and math.abs(here.yards - wantHere.yards) < 0.01, "the pick was not made again when you came into the zone")
S.Stop()
ER.StepsChanged = realChanged
ER.db.guides, ER.db.done = {}, {}
G.level, G.zone, G.x, G.y = 1, "", 0, 0
`, "section 19d");
console.log("  " + getString("Z_LINE"));

// 20. Grind bridges. A player who is behind the plan (the next quests are more than the comfort of the difficulty above them) gets a bridge
// step first. The bridges are steps of the generated list that Steps.lua asks about on every refresh (ER.RouteStepOut kind bridge); they are
// there for every player and shown to the ones who are behind.
console.log("20. A player behind the plan gets a grind bridge first");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 10, "The Barrens"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local realShows = ER.GrindBridgeShows
check(realShows ~= nil, "Grind.lua has no ER.GrindBridgeShows")
local CHAT_LINE = "The next quests are too high for you right now, so grind first."

local infos = ER.RouteGuides()
local barrens
for _, i in ipairs(infos) do
  if not barrens and i.visit.zone == "The Barrens" then barrens = i end
end
check(barrens ~= nil, "the Orc path has no Barrens visit")

local function Bridges()
  local list = {}
  for n = 1, S.Count() do
    local step = S.Step(n)
    if step.flags.grind == "bridge" then table.insert(list, step) end
  end
  return list
end
local function Load(info, level, mode)
  G.level, ER.db.mode = level, mode
  G.zone, G.x, G.y = info.visit.zone, 0, 0
  ER.db.guides, ER.db.done = {}, {}
  G.log, G.order = {}, {}
  return S.Load(S.Key(info), true)
end
local function XLevel(step)
  for _, e in ipairs(step.elements) do
    if e.kind == "X" then return e.level end
  end
  return nil
end
local function AreaOf(step)
  local _, _, area = string.find(step.flags.rt or "", "^bridge:(%d+)$")
  return tonumber(area)
end
-- The level a bridge should grind to, worked out here from the rule: the highest of each wanted quest's minimum level and its level
-- minus the comfort, never above the top level of the zone.
local function NeedOf(step, info)
  local need = 0
  for id in string.gfind(step.flags.bq or "", "%d+") do
    id = tonumber(id)
    if not (S.InLog(id) or S.TurnedIn(id) or S.LeftOut(id)) then
      local row = ER.QuestRow(id)
      need = math.max(need, row.m or 0, (row.l or 0) - S.Comfort())
    end
  end
  return math.min(need, info.hi)
end
local function ShownList(list)
  local out = {}
  for _, b in ipairs(list) do
    if S.Fits(b) then table.insert(out, b) end
  end
  return out
end

-- A. The Barrens at level 10 on Casual: bridges, some shown, each with the level the rule gives.
check(Load(barrens, 10, "casual"), "the Barrens visit did not load")
local bridges = Bridges()
check(table.getn(bridges) > 0, "the Barrens visit has no bridge steps")
local shown = ShownList(bridges)
check(table.getn(shown) >= 1, "no bridge is shown to a level 10 Orc on Casual in the Barrens")
for _, b in ipairs(shown) do
  local need = NeedOf(b, barrens)
  check(XLevel(b) == need, "a shown bridge grinds to level " .. tostring(XLevel(b)) .. ", the rule says " .. need)
  check(need > 10 and need <= barrens.hi, "a shown bridge grinds to level " .. need .. ", not above 10 and up to " .. barrens.hi)
end
local counts = {}
for _, mode in ipairs({ "casual", "medium", "hard" }) do
  G.level, ER.db.mode = 10, mode
  counts[mode] = table.getn(ShownList(bridges))
end
BR_COUNTS = "The Barrens at level 10: " .. table.getn(bridges) .. " bridge steps, shown on Casual " .. counts.casual .. ", Medium " .. counts.medium ..
  ", Hard " .. counts.hard
check(counts.casual >= counts.medium and counts.medium >= counts.hard, "more bridges are shown on a harder difficulty than on an easier one")

-- B. Over the whole Orc path: a bridge shown on Casual and hidden on Hard at the same level, and an area with two bridges shown at once.
local pairText, twoText, two = nil, nil, nil
local lastTop = 0
for _, info in ipairs(infos) do
  if not info.stop then
    Load(info, info.lo, "casual")
    local bs = Bridges()
    for level = info.lo, info.hi do
      G.level, ER.db.mode = level, "casual"
      local casual = {}
      for i, b in ipairs(bs) do casual[i] = S.Fits(b) and true or false end
      local areas = {}
      for i, b in ipairs(bs) do
        if casual[i] then
          local a = AreaOf(b)
          if not areas[a] then areas[a] = {} end
          table.insert(areas[a], b)
        end
      end
      -- one bridge for each area, also in the list of the next steps: never two shown at once
      for a, list in pairs(areas) do
        check(table.getn(list) < 2, info.visit.zone .. " area " .. a .. " shows " .. table.getn(list) .. " bridges at level " .. level)
      end
      -- the pair that would both be wanted if the area had no rule
      if not two then
        local wantedIn = {}
        for i, b in ipairs(bs) do
          if ER._testBridgeWanted(b) then
            local a = AreaOf(b)
            if not wantedIn[a] then wantedIn[a] = {} end
            table.insert(wantedIn[a], b)
          end
        end
        for a, list in pairs(wantedIn) do
          if table.getn(list) >= 2 and not two then
            two = { info = info, level = level, first = list[1], second = list[2], area = a }
            twoText = info.visit.zone .. " area " .. a .. " at level " .. level
          end
        end
      end
      G.level, ER.db.mode = level, "hard"
      for i, b in ipairs(bs) do
        if casual[i] and not S.Fits(b) and not pairText then pairText = info.visit.zone .. " level " .. level end
      end
    end
  end
end
check(pairText ~= nil, "no bridge of the Orc path is shown on Casual and hidden on Hard at the same level")
check(two ~= nil, "no area of the Orc path has two bridges that would both be wanted at the same level")
BR_PAIR = tostring(pairText) .. "; two bridges: " .. tostring(twoText)

-- C. At the top level of a visit no bridge is shown (every visit of the Orc path).
local atTop = 0
for _, info in ipairs(infos) do
  if not info.stop then
    Load(info, info.hi, "casual")
    local n = table.getn(ShownList(Bridges()))
    atTop = atTop + n
    check(n == 0, info.visit.zone .. ": " .. n .. " bridges are shown at the top level " .. info.hi)
  end
end

-- D. A shown bridge that is the current step: the words, the arrow and the one chat line.
check(Load(barrens, 10, "casual"), "the Barrens visit did not load for the words")
bridges = Bridges()
local current
for _, b in ipairs(bridges) do
  if not current and S.Fits(b) then current = b end
end
check(current ~= nil, "no shown bridge to look at in the Barrens")
if current then
  S.Jump(current.n)
  check(S.Current() == current, "the shown bridge is not the current step")
  local need = NeedOf(current, barrens)
  local text
  for _, e in ipairs(current.elements) do
    if e.kind == "I" then text = S.Line(current, e).text end
  end
  check(text and string.find(text, "^Grind ") ~= nil, "the bridge line does not start with Grind: " .. tostring(text))
  check(text and string.find(text, "until level " .. need .. "%.$") ~= nil, "the bridge line does not end with until level " .. need .. ".: " .. tostring(text))
  local reason = ER.GrindReasonLine(current)
  check(reason and string.find(reason, "^The next quests are too high for you right now%.") ~= nil, "the reason does not start as it should: " .. tostring(reason))
  local pick = ER.GrindPick(current)
  local target = S.Target()
  check(pick ~= nil and target ~= nil and target.zone == "The Barrens" and target.x == pick.spot.x and target.y == pick.spot.y,
    "the arrow does not point at the picked spot")
  check(string.find(S.Title(current), "^Grind .+ until level " .. need .. "$") ~= nil, "the title of the bridge is odd: " .. S.Title(current))
  local nextPickUp
  for n = current.n + 1, S.Count() do
    local step = S.Step(n)
    if not nextPickUp then
      for _, e in ipairs(step.elements) do
        if e.kind == "A" then nextPickUp = n end
      end
    end
  end
  check(nextPickUp ~= nil and S.Position() < nextPickUp, "the pick-up step after the bridge is current while the bridge shows")
  BR_LINE = (text or "") .. " / " .. (reason or "")
  CHAT = ""
  Tick(2)
  Tick(2)
  local seen, from = 0, 1
  while true do
    local s, e = string.find(CHAT or "", CHAT_LINE, from, true)
    if not s then break end
    seen = seen + 1
    from = e + 1
  end
  check(seen == 1, "the chat line was printed " .. seen .. " times, not once: " .. tostring(CHAT))
  local saved = ER.db.guides[ER.Char()]
  check(type(saved.bridges) == "table" and saved.bridges[AreaOf(current)] == current.n, "the watcher did not note the bridge in the saved position")
  BR_CHAT = CHAT_LINE
end

-- E. Two bridges of one area that would both show at the same level: only the first is shown, also in the list of the next steps; once the
-- first has been current the second stays hidden, and Skip does not bring it back.
if two then
  check(Load(two.info, two.level, "casual"), "the visit with two bridges did not load")
  check(S.Fits(two.first), "the first bridge of the area is hidden before it was current")
  check(not S.Fits(two.second), "the second bridge of the area is shown before the first was current")
  local listed1, listed2 = false, false
  for _, s in ipairs(S.Upcoming(400)) do
    if s.n == two.first.n then listed1 = true end
    if s.n == two.second.n then listed2 = true end
  end
  check((S.Current() and S.Current().n == two.first.n) or listed1, "the first bridge of the area is not in the list of the next steps")
  check(not listed2, "the second bridge of the area is in the list of the next steps")
  S.Jump(two.first.n)
  CHAT = ""
  Tick(2)
  check(S.Fits(two.first), "the first bridge of the area is hidden after it was current")
  check(not S.Fits(two.second), "the second bridge of the area is still shown after the first was current")
  S.Next()
  check(not S.Fits(two.second), "the second bridge of the area is shown after Skip on the first")
  check(S.Position() > two.first.n, "Skip did not move on from the first bridge")
  Tick(2)
  local count = 0
  for _ in string.gfind(CHAT or "", "grind first") do count = count + 1 end
  check(count == 1, "the chat line came " .. count .. " times for the two bridges of one area")
end

-- F. The Settings tick off, or Grind.lua missing: every bridge is hidden.
check(Load(barrens, 10, "casual"), "the Barrens visit did not load for the off checks")
bridges = Bridges()
check(table.getn(ShownList(bridges)) >= 1, "no bridge is shown before the switches are tried")
ER.db.grindOff = true
check(table.getn(ShownList(bridges)) == 0, "a bridge is shown with the grind tick off")
ER.db.grindOff = nil
ER.GrindBridgeShows = nil
check(table.getn(ShownList(bridges)) == 0, "a bridge is shown with Grind.lua missing")
ER.GrindBridgeShows = realShows
check(table.getn(ShownList(bridges)) >= 1, "the bridges did not come back")

S.Stop()
ER.StepsChanged = savedChanged
ER.db.guides, ER.db.done, ER.db.grindOff, ER.db.mode = {}, {}, nil, "casual"
ER.GrindBridgeShows = realShows
G.level, G.zone, G.log, G.order = 1, "", {}, {}
`, "section 20");
console.log("  " + getString("BR_COUNTS"));
console.log("  Casual and Hard differ in: " + getString("BR_PAIR"));
console.log("  " + getString("BR_LINE"));
console.log("  chat: " + getString("BR_CHAT"));
for (const race of RACES_WALKED) {
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1
local total, inStops, shapeBad = 0, 0, 0
for _, info in ipairs(ER.RouteGuides()) do
  local flags, hasBridge = "", false
  for line in string.gfind(ER._testGenerate(info), "[^\\n]+") do
    local _, _, sflags = string.find(line, "^S\\t\\t\\t(.*)$")
    if sflags then
      flags = sflags
      if string.find(flags, "grind=bridge", 1, true) then
        total = total + 1
        if info.stop then inStops = inStops + 1 end
        if not (string.find(flags, "rt=bridge:%d+") and string.find(flags, "bq=[%d,]+") and string.find(flags, "title=Grind first", 1, true)) then
          shapeBad = shapeBad + 1
        end
      end
    elseif string.find(line, "^X\\t\\t\\t") and string.find(flags, "grind=bridge", 1, true) then
      if not string.find(line, "^X\\t\\t\\t1\\t") then shapeBad = shapeBad + 1 end
    end
  end
end
BR_TOTAL, BR_STOPS, BR_BAD = total, inStops, shapeBad
`, "section 20 count " + race);
  console.log(`  ${race}: ${getNumber("BR_TOTAL")} bridge steps`);
  jsCheck(getNumber("BR_STOPS") === 0, `${race}: ${getNumber("BR_STOPS")} bridge steps are in capital stop visits`);
  jsCheck(getNumber("BR_BAD") === 0, `${race}: ${getNumber("BR_BAD")} bridge steps have the wrong shape (flags or placeholder level)`);
  jsCheck(getNumber("BR_TOTAL") > 0, `${race}: no bridge steps at all`);
}
// 20c. Bridges are for a player who is behind the plan (ADAPT-03). The xp-model player of section 5 follows each path exactly; at every bridge
// he has at least the level the bridge's pl flag says, so he is not shown one (a new level 1 Orc is not sent to grind boars before the plan's
// own steps). A player one level below him is behind the plan, and the bridges the quests ask for do show to him.
console.log("20c. A player on the plan sees no bridge; one behind the plan does");
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
for idx, info in ipairs(infos) do
  local flags, n = "", 0
  for line in string.gfind(ER._testGenerate(info), "[^\\n]+") do
    if string.sub(line, 1, 2) == "S\\t" then n = n + 1 end
    local _, _, sflags = string.find(line, "^S\\t\\t\\t(.*)$")
    if sflags then flags = sflags end
    local _, _, kind, id = string.find(line, "^(%u)\\t\\t(%d+)\\t")
    if kind == "A" then
      local row = ER.QuestRow(tonumber(id))
      table.insert(dump, "A\\t" .. id .. "\\t" .. tostring(row and row.m or 1) .. "\\t" .. (flagsOf[tonumber(id)] or "") .. "\\t" .. info.visit.zone)
    elseif kind == "T" then
      local row = ER.QuestRow(tonumber(id))
      table.insert(dump, "T\\t" .. id .. "\\t" .. tostring(row and row.l or 1) .. "\\t" .. (flagsOf[tonumber(id)] or ""))
    else
      local _, _, level = string.find(line, "^X\\t\\t\\t(%d+)\\t")
      if level then
        if string.find(flags, "grind=bridge", 1, true) then
          local _, _, pl = string.find(flags, "pl=(%d+)")
          table.insert(dump, "B\\t" .. idx .. "\\t" .. n .. "\\t" .. tostring(pl))
        else
          table.insert(dump, "X\\t" .. level .. "\\t" .. info.visit.zone)
        end
      end
    end
  end
end
WALK_DUMP = table.concat(dump, "\\n")
`, "section 20c dump " + race);
  let total = 0;
  const done = new Set(), bridges = [];
  for (const line of getString("WALK_DUMP").split("\n")) {
    const f = line.split("\t");
    if (f[0] === "X") {
      total = Math.max(total, xp.xpAt(Number(f[1])));
    } else if (f[0] === "B") {
      bridges.push({ idx: Number(f[1]), n: Number(f[2]), pl: Number(f[3]), lv: Math.floor(xp.levelAt(total)) });
    } else if (f[0] === "T") {
      const id = f[1], flags = f[3];
      if (/[es]/.test(flags) || done.has(id)) continue;
      done.add(id);
      const lv = Math.floor(xp.levelAt(total));
      total += xp.questXP(Number(f[2]), lv) + (flags.indexOf("k") >= 0 ? xp.K * xp.killXP(lv, Number(f[2])) : 0);
    }
  }
  let below = 0;
  for (const b of bridges) {
    if (!(b.pl >= 1)) jsCheck(false, `${race}: bridge step ${b.n} of visit ${b.idx} has no plan level`);
    else if (b.lv < b.pl) {
      below++;
      jsCheck(false, `${race}: at bridge step ${b.n} of visit ${b.idx} the xp-model player has level ${b.lv}, the bridge says the plan has ${b.pl}`);
    }
  }
  run(SECTION_START + `
G.race, G.class, G.faction, G.level = ${JSON.stringify(race)}, "WARRIOR", ${JSON.stringify(FACTION[race])}, 1
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local infos = ER.RouteGuides()
local list = {
${bridges.map((b) => `  { ${b.idx}, ${b.n}, ${b.lv} },`).join("\n")}
}
local shownOnPlan, shownBehind, loaded = 0, 0, 0
local lastIdx
for _, b in ipairs(list) do
  local info = infos[b[1]]
  if b[1] ~= lastIdx then
    lastIdx = b[1]
    G.level, G.zone, G.x, G.y = 1, info.visit.zone, 0, 0
    ER.db.guides, ER.db.done = {}, {}
    G.log, G.order = {}, {}
    check(S.Load(S.Key(info), true), "the visit " .. b[1] .. " did not load")
    loaded = loaded + 1
  end
  local step = S.Step(b[2])
  check(step and step.flags.grind == "bridge", "step " .. b[2] .. " of visit " .. b[1] .. " is not a bridge")
  G.level = b[3]
  if S.Fits(step) then shownOnPlan = shownOnPlan + 1 end
  G.level = math.max(1, b[3] - 1)
  if S.Fits(step) then shownBehind = shownBehind + 1 end
end
S.Stop()
ER.StepsChanged = savedChanged
ER.db.guides, ER.db.done = {}, {}
G.level, G.zone = 1, ""
PLAN_ON, PLAN_BEHIND, PLAN_VISITS = shownOnPlan, shownBehind, loaded
`, "section 20c check " + race);
  jsCheck(getNumber("PLAN_ON") === 0, `${race}: ${getNumber("PLAN_ON")} bridges are shown to a player who follows the plan`);
  jsCheck(getNumber("PLAN_BEHIND") >= 3, `${race}: only ${getNumber("PLAN_BEHIND")} bridges are shown to a player one level behind the plan`);
  console.log(`  ${race}: ${bridges.length} bridges; on the plan ${getNumber("PLAN_ON")} shown, one level behind ${getNumber("PLAN_BEHIND")} shown`);
}
// The new level 1 Orc in Durotar, on the plan: none of the bridges whose plan level is 1 shows (the review's case), and the first
// bridge whose plan level is 2 does show to a player who is still at level 1.
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local first = ER.RouteGuides()[1]
check(S.Load(S.Key(first), true), "the Durotar visit did not load")
local atOne, atTwo, shownAtOne, shownAtTwo = 0, 0, 0, 0
for n = 1, S.Count() do
  local step = S.Step(n)
  if step.flags.grind == "bridge" then
    local pl = tonumber(step.flags.pl)
    if pl == 1 then
      atOne = atOne + 1
      if S.Fits(step) then shownAtOne = shownAtOne + 1 end
    elseif pl == 2 then
      atTwo = atTwo + 1
      if S.Fits(step) then shownAtTwo = shownAtTwo + 1 end
    end
  end
end
check(atOne >= 3, "Durotar has only " .. atOne .. " bridges with plan level 1")
check(shownAtOne == 0, shownAtOne .. " of the " .. atOne .. " Durotar bridges for the plan's level 1 are shown to a new level 1 Orc on Casual")
check(atTwo >= 1 and shownAtTwo >= 1, "a level 1 Orc, one level behind the plan, is shown " .. shownAtTwo .. " of the " .. atTwo .. " bridges for plan level 2")
S.Stop()
ER.StepsChanged = savedChanged
ER.db.guides, ER.db.done = {}, {}
G.level, G.zone = 1, ""
`, "section 20c durotar");

// 20d. A bridge that has shown stays until its level is reached or Skip is clicked: it does not vanish when a level-up leaves no spot that
// fits (it reads as the plain grind step then), and it does not vanish when the Settings tick is turned off (and it is the same step when the
// tick is turned on again). A step that is skipped for good is only one that was left.
console.log("20d. A bridge that has shown stays until its level or Skip");
run(SECTION_START + `
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
local who = ER.Char()
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local function NeedOf(step, info)
  local need = 0
  for id in string.gfind(step.flags.bq or "", "%d+") do
    id = tonumber(id)
    if not (S.InLog(id) or S.TurnedIn(id) or S.LeftOut(id)) then
      local row = ER.QuestRow(id)
      need = math.max(need, row.m or 0, (row.l or 0) - S.Comfort())
    end
  end
  return math.min(need, info.hi)
end
local function AreaOf(step)
  local _, _, area = string.find(step.flags.rt or "", "^bridge:(%d+)$")
  return tonumber(area)
end
local HORDE = { Orc = true, Troll = true, Tauren = true, Scourge = true }
-- Find a bridge and a level where it still asks for more but no spot of the pool fits, and a lower level where it shows.
local found
for _, race in ipairs({ "Human", "Scourge", "Dwarf", "Gnome", "NightElf", "Orc", "Troll", "Tauren" }) do
  if not found then
    G.race, G.class, G.faction = race, "WARRIOR", HORDE[race] and "Horde" or "Alliance"
    ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
    for _, info in ipairs(ER.RouteGuides()) do
      if not found and not info.stop then
        G.level, G.zone, G.x, G.y = info.lo, info.visit.zone, 0, 0
        ER.db.guides = {}
        G.log, G.order = {}, {}
        S.Load(S.Key(info), true)
        for n = 1, S.Count() do
          local b = S.Step(n)
          if not found and b.flags.grind == "bridge" then
            local need = NeedOf(b, info)
            for level = info.hi - 1, info.lo + 1, -1 do
              G.level = level
              if not found and need - level >= 1 and ER.GrindPick(b) == nil then
                for lv0 = level - 1, info.lo, -1 do
                  G.level = lv0
                  if not found and S.Fits(b) then found = { race = race, info = info, n = n, lvNo = level, lv0 = lv0, need = need } end
                end
              end
            end
          end
        end
      end
    end
  end
end
check(found ~= nil, "no bridge with a level where it asks for more but no spot fits was found on any path")
if found then
  local info, key = found.info, S.Key(found.info)
  local zone = info.visit.zone
  ER.db.grindOff = nil
  G.level, G.zone, G.x, G.y = found.lv0, zone, 0, 0
  ER.db.guides, ER.db.done, G.log, G.order = {}, {}, {}, {}
  check(S.Load(key, true), "the visit did not load")
  local rec = ER.db.guides[who]
  rec.pos, rec.passed, rec.bridges = found.n, {}, nil
  check(S.Load(key), "the visit did not load at the bridge")
  local b = S.Step(found.n)
  check(S.Current() == b, "the bridge is not the current step at level " .. found.lv0)
  Tick(2)
  check(type(rec.bridges) == "table" and rec.bridges[AreaOf(b)] == b.n, "the bridge was not noted when it was current")
  local function XText()
    for _, e in ipairs(b.elements) do
      if e.kind == "X" then return S.Line(b, e).text end
    end
  end
  check(ER.GrindPick(b) ~= nil and string.find(XText() or "", "Grind until level " .. found.need, 1, true) ~= nil, "the bridge does not read as a grind to level " .. found.need)
  -- a level-up leaves no spot that fits: the bridge stays, as the plain grind step
  G.level = found.lvNo
  Tick(2)
  check(ER.GrindPick(b) == nil, "a spot fits at level " .. found.lvNo .. " after all")
  check(S.Current() == b and S.Passed(b.n) == nil, "the bridge was left (" .. tostring(S.Passed(b.n)) .. ") when no spot fits any more")
  check(S.Fits(b), "the bridge does not fit any more when no spot fits")
  check(string.find(XText() or "", "Grind until level " .. found.need, 1, true) ~= nil, "the plain words are missing: " .. tostring(XText()))
  check(ER.GrindText(b) == nil and ER.GrindReasonLine(b) == nil and S.Title(b) == "Grind first", "the bridge still names a spot when none fits")
  -- the Settings tick off: the bridge stays, plain; on again: still the same step
  G.level = found.lv0
  ER.db.grindOff = true
  Tick(2)
  check(S.Current() == b and S.Passed(b.n) == nil, "the bridge was left when the Settings tick went off")
  check(ER.GrindPick(b) == nil and ER.GrindReasonLine(b) == nil, "the bridge still names a spot with the tick off")
  check(string.find(XText() or "", "Grind until level " .. found.need, 1, true) ~= nil, "the plain words are missing with the tick off")
  ER.db.grindOff = nil
  Tick(2)
  check(S.Current() == b and S.Passed(b.n) == nil, "the bridge was left when the Settings tick came back")
  check(ER.GrindPick(b) ~= nil, "the bridge has no spot with the tick back on")
  -- its level reached: it is over
  G.level = found.need
  Tick(2)
  check(S.Current() ~= b and S.Position() > b.n, "the bridge did not end at its level")
  -- Skip also leaves it
  ER.db.guides, G.log, G.order = {}, {}, {}
  G.level = found.lv0
  check(S.Load(key, true), "the visit did not load for Skip")
  rec = ER.db.guides[who]
  rec.pos, rec.passed, rec.bridges = found.n, {}, nil
  check(S.Load(key), "the visit did not load at the bridge for Skip")
  b = S.Step(found.n)
  check(S.Current() == b, "the bridge is not current for Skip")
  Tick(2)
  S.Next()
  check(S.Current() ~= b and S.Passed(b.n) == "skip", "Skip did not leave the bridge")
  FOUND_BRIDGE = found.race .. " " .. zone .. ": bridge to level " .. found.need .. ", shown at level " .. found.lv0 .. ", no spot at level " .. found.lvNo
end
S.Stop()
ER.StepsChanged = savedChanged
ER.db.guides, ER.db.done, ER.db.grindOff, ER.db.mode = {}, {}, nil, "casual"
G.level, G.zone, G.log, G.order = 1, "", {}, {}
`, "section 20d");
console.log("  " + getString("FOUND_BRIDGE"));

// 20b. The casual route's step list grows between versions (bridges), so a position saved with an older list must not be trusted: the
// record keeps its table and its other fields, but starts again where the quest log says the player is. RestedXP guides are left alone.
console.log("20b. A saved position from an older step list starts again from the quest log");
run(SECTION_START + `
local who = ER.Char()
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 10, "The Barrens"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local barrens
for _, i in ipairs(ER.RouteGuides()) do
  if not barrens and i.visit.zone == "The Barrens" then barrens = i end
end
check(barrens ~= nil, "the Orc path has no Barrens visit")
local key = S.Key(barrens)

-- two early quests of the visit are in the pretend log
local taken = 0
for line in string.gfind(ER._testGenerate(barrens), "[^\\n]+") do
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
check(taken == 2, "only " .. taken .. " quests could be put in the pretend log")

local function Record(extra)
  local r = { key = key, pos = 1, passed = {}, fired = {}, side = {} }
  for k, v in pairs(extra or {}) do r[k] = v end
  return r
end
local function Clear()
  S.Stop()
  ER.db.guides = {}
end

-- 0. A new record of the casual route notes the length of the step list.
check(S.Load(key, true), "the Barrens visit did not start")
local COUNT = S.Count()
check(COUNT > 100, "the Barrens visit has only " .. COUNT .. " steps")
check(ER.db.guides[who].count == COUNT, "a new record does not note the number of steps: " .. tostring(ER.db.guides[who].count))
Clear()

-- a. The start point from the quest log: a record with no count, and no record at all, give the same place, and it is past the first step.
ER.db.done[who] = { [999999] = true }
ER.db.guides = { [who] = Record() }
check(S.Load(key), "the Barrens visit did not load from a record with no count")
local P0 = S.Position()
Clear()
check(S.Load(key), "the Barrens visit did not load with no record")
local P0b = S.Position()
Clear()
check(P0 == P0b, "a record with no count starts at " .. P0 .. ", no record at " .. P0b)
check(P0 > 1, "the start point from the quest log is the first step")
local N = math.min(P0 + 10, COUNT)

-- b. An older record (no count, or another count): same table and other fields kept, a marker in passed gone, the start point again.
for _, extra in ipairs({ {}, { count = COUNT - 7 }, { count = "many" } }) do
  local rec = Record(extra)
  rec.pos, rec.marker = 5, "mine"
  rec.passed[N] = "mine"
  rec.bridges = { [1] = 6 }
  ER.db.guides = { [who] = rec }
  check(S.Load(key), "the Barrens visit did not load from an older record")
  check(ER.db.guides[who] == rec, "the older record was replaced by another table")
  check(rec.marker == "mine", "the older record lost its other fields")
  check(rec.count == COUNT and S.Count() == COUNT, "the older record has count " .. tostring(rec.count) .. " after loading, not " .. COUNT)
  check(rec.passed[N] ~= "mine", "the old passed entry is still there")
  check(rec.bridges == nil, "the bridges noted by the older record are still there")
  check(S.Position() == P0, "the older record starts at " .. S.Position() .. ", the quest log says " .. P0)
  check(ER.db.done[who][999999] == true, "a quest handed in is no longer done")
  Clear()
  ER.db.done[who] = { [999999] = true }
end

-- c. A record with the right count is trusted: passed entry, marker, bridges and the place stay.
local rec = Record({ count = COUNT })
rec.pos, rec.marker = 5, "mine"
rec.passed[N] = "mine"
rec.bridges = { [1] = 6 }
ER.db.guides = { [who] = rec }
check(S.Load(key), "the Barrens visit did not load from a record with the right count")
check(ER.db.guides[who] == rec and rec.marker == "mine", "the record with the right count was changed")
check(rec.passed[N] == "mine", "the passed entry of a record with the right count is gone")
check(rec.bridges ~= nil and rec.bridges[1] == 6, "the bridges of a record with the right count are gone")
check(S.Position() >= 5, "a record with the right count was moved back to " .. S.Position())
Clear()

-- d. A RestedXP guide: a new record has no count, an old one keeps its place and its table.
local rested
for _, g in ipairs(S.Guides()) do
  if not g.route and not rested then rested = g end
end
check(rested ~= nil, "no RestedXP guide for the Orc to test with")
local restedKey = S.Key(rested)
check(S.Load(restedKey, true), "the RestedXP guide did not load")
check(ER.db.guides[who].count == nil, "a RestedXP record notes a count: " .. tostring(ER.db.guides[who].count))
Clear()
local old = { key = restedKey, pos = 3, passed = {}, fired = {}, side = {}, marker = "mine" }
ER.db.guides = { [who] = old }
check(S.Load(restedKey), "the RestedXP guide did not load from a saved record")
check(ER.db.guides[who] == old and old.marker == "mine", "the RestedXP record was replaced")
check(old.count == nil, "the RestedXP record got a count")
check(S.Position() >= 3, "the RestedXP record was moved back to " .. S.Position())
Clear()

BACK_START, BACK_COUNT = P0, COUNT
ER.StepsChanged = savedChanged
ER.db.guides, ER.db.done, ER.db.mode = {}, {}, "casual"
G.level, G.zone, G.log, G.order = 1, "", {}, {}
`, "section 20b");
console.log("  Barrens visit: " + getNumber("BACK_COUNT") + " steps; the quest log puts an older record at step " + getNumber("BACK_START"));

// 21. What the player saw beats the data. A mob targeted or pointed at out of a fight is written down as yellow or red, by name, per faction
// (also with the Settings tick off); the pick uses it before the data, the words say so, and it never takes the last spot away. The saved
// list stays small (800 names per faction), clean, and a damaged list changes nothing.
console.log("21. The guide learns which mobs are yellow or red");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
local keep = { units = G.units, reactions = ER.db.reactions, grindOff = ER.db.grindOff, time = time, mode = ER.db.mode }
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
ER.db.reactions = nil
G.units = {}

local function Mob(name, reaction) return { name = name, reaction = reaction, attackable = true } end
local function Look(unit, u)
  G.units = {}
  G.units[unit] = u
  if unit == "target" then Fire("PLAYER_TARGET_CHANGED") else Fire("UPDATE_MOUSEOVER_UNIT") end
  G.units = {}
end
local function Names(faction)
  local r, n = ER.db.reactions, 0
  if type(r) == "table" and type(r[faction]) == "table" then
    for _ in pairs(r[faction]) do n = n + 1 end
  end
  return n
end
local function Entry(faction, name)
  local r = ER.db.reactions
  if type(r) ~= "table" or type(r[faction]) ~= "table" then return nil end
  return r[faction][name]
end
local function K(faction, name)
  local e = Entry(faction, name)
  if type(e) == "table" then return e.k end
  return nil
end
check(ER.GRIND.REACT_CAP == 800, "REACT_CAP is " .. tostring(ER.GRIND.REACT_CAP) .. ", not 800")
check(_G["EasyRouteGrindLearn"] ~= nil, "Grind.lua has no EasyRouteGrindLearn frame")

-- A. A target or a mouseover out of a fight is written down: yellow for reaction 4, red for 1 to 3, per faction.
Look("target", Mob("Mottled Boar", 4))
check(K("Horde", "mottled boar") == "y", "a yellow target was not remembered: " .. tostring(K("Horde", "mottled boar")))
Look("target", Mob("Mangy Wolf", 2))
check(K("Horde", "mangy wolf") == "r", "a red target was not remembered")
Look("target", Mob("Kobold Worker", 1))
check(K("Horde", "kobold worker") == "r", "reaction 1 was not remembered as red")
Look("target", Mob("Kodo Calf", 3))
check(K("Horde", "kodo calf") == "r", "reaction 3 was not remembered as red")
Look("mouseover", Mob("Dire Mottled Boar", 4))
check(K("Horde", "dire mottled boar") == "y", "a yellow mouseover was not remembered")
Look("mouseover", Mob("Plain Wolf", 2))
check(K("Horde", "plain wolf") == "r", "a red mouseover was not remembered")
local e = Entry("Horde", "mottled boar")
check(type(e) == "table" and type(e.t) == "number" and e.a == nil, "the entry is not { k, t } only")
for k in pairs(e or {}) do
  check(k == "k" or k == "t" or k == "a", "the entry holds the field " .. tostring(k))
end
G.faction = "Alliance"
Look("target", Mob("Alliance Only", 2))
check(K("Alliance", "alliance only") == "r", "an Alliance character did not write into the Alliance list")
check(K("Horde", "alliance only") == nil, "an Alliance sample went into the Horde list")
G.faction = "Horde"
check(K("Alliance", "mottled boar") == nil, "a Horde sample went into the Alliance list")
-- seen yellow later: the entry follows what was seen last
Look("target", Mob("Mangy Wolf", 4))
check(K("Horde", "mangy wolf") == "y", "a later look did not change the entry")
Look("target", Mob("Mangy Wolf", 2))
check(K("Horde", "mangy wolf") == "r", "a later red look did not change the entry")

-- B. Nothing is written down for these.
local cases = {
  { "a mob in a fight", { name = "Fight Boar", reaction = 4, attackable = true, combat = true } },
  { "a red mob in a fight", { name = "Fight Wolf", reaction = 2, attackable = true, combat = true } },
  { "a critter", { name = "Crit Rabbit", reaction = 4, attackable = true, type = "Critter" } },
  { "a player", { name = "Some Player", reaction = 2, attackable = true, player = true } },
  { "a pet", { name = "Some Pet", reaction = 4, attackable = true, controlled = true } },
  { "a dead mob", { name = "Dead Boar", reaction = 4, attackable = true, dead = true } },
  { "a unit you cannot attack", { name = "Guard Boar", reaction = 4, attackable = false } },
  { "reaction 5", { name = "Friendly Boar", reaction = 5, attackable = true } },
  { "reaction 8", { name = "Exalted Boar", reaction = 8, attackable = true } },
  { "no reaction", { name = "Nil Boar", attackable = true } },
  { "no name", { reaction = 4, attackable = true } },
}
local before = Names("Horde")
for _, c in ipairs(cases) do
  Look("target", c[2])
  Look("mouseover", c[2])
  local name = c[2].name and string.lower(c[2].name)
  check(name == nil or Entry("Horde", name) == nil, c[1] .. " was remembered")
end
check(Names("Horde") == before, "the list grew by " .. (Names("Horde") - before) .. " for units that must not be remembered")
G.units = {}
Fire("PLAYER_TARGET_CHANGED")
check(Names("Horde") == before, "no target changed the list")
local oldFaction = G.faction
G.faction = nil
Look("target", Mob("Nobody Boar", 4))
check(Names("Horde") == before and Entry("Horde", "nobody boar") == nil, "a character with no faction wrote something down")
G.faction = oldFaction

-- C. With the Settings tick off the guide does not use it, but the look is still written down.
ER.db.grindOff = true
Look("target", Mob("Tick Off Boar", 4))
check(K("Horde", "tick off boar") == "y", "with the tick off nothing was learned")
ER.db.grindOff = nil

-- D. A name is stored clean and short.
Look("target", Mob("|cffff0000Red\\tBoar|r\\nTwo", 4))
check(K("Horde", "red boar two") == "y", "a name with a colour code, a tab and a line break was not stored clean")
Look("target", Mob(string.rep("Long", 40), 2))
Look("target", Mob("   ", 2))
Look("target", Mob("|r", 2))
for k in pairs(ER.db.reactions.Horde) do
  check(not string.find(k, "|", 1, true) and not string.find(k, "[\\t\\r\\n]") and string.len(k) <= 60 and k ~= "" and k == string.lower(k),
    "a stored name is not clean: " .. k)
end
check(K("Horde", string.rep("long", 15)) == "r", "a long name was not cut to 60 letters")
-- a unit that is still loading is called Unknown: it is not written down
local namesBefore = Names("Horde")
Look("target", Mob("Unknown", 4))
Look("mouseover", Mob("UNKNOWN", 2))
Look("target", Mob("|cff00ff00Unknown|r", 2))
check(K("Horde", "unknown") == nil and Names("Horde") == namesBefore, "a unit called Unknown was written down")
Look("target", Mob("Unknown Horror", 2))
check(K("Horde", "unknown horror") == "r", "a name that only starts with Unknown was not written down")

-- E. 900 different names: at most 800 stay, the newest is there, the first one is gone.
ER.db.reactions = nil
local tick = 5000
time = function() tick = tick + 1 return tick end
for i = 1, 900 do
  Look("target", Mob("Cap Mob " .. i, 2 + math.mod(i, 2) * 2))
  if i == 800 then CAP_AT_800 = Names("Horde") end
end
check(CAP_AT_800 == 800, "800 names did not fit: " .. tostring(CAP_AT_800))
check(Names("Horde") == 800, "900 names left " .. Names("Horde") .. " in the list, not 800")
check(K("Horde", "cap mob 900") ~= nil, "the newest name is not in the list")
check(K("Horde", "cap mob 1") == nil, "the first name is still in the list")
check(K("Horde", "cap mob 100") == nil and K("Horde", "cap mob 101") ~= nil, "the oldest hundred did not go, in order")
check(Names("Alliance") == 0, "the other faction's list was touched")
time = keep.time

-- F. The guide: the pick, the line, the arrow and the words follow what was seen.
ER.db.reactions = nil
local first = ER.RouteGuides()[1]
check(first and first.visit.zone == "Durotar", "the Orc's first visit is not Durotar")
check(ER.StartGuide(S.Key(first), true), "the Durotar zone did not start")
local at, gstep
for n = 1, S.Count() do
  local step = S.Step(n)
  if step.flags.grind and step.flags.grind ~= "bridge" and not at then
    for _, el in ipairs(step.elements) do
      if el.kind == "X" and tonumber(el.level) == 2 then at, gstep = n, step end
    end
  end
end
check(at ~= nil, "no grind step to level 2 in the Durotar visit")
local function LineOf(step)
  for _, el in ipairs(step.elements) do
    if el.kind == "I" then return S.Line(step, el).text end
  end
  return ""
end
if at then
  S.Jump(at)
  ER.StepsChanged()
  local base = ER.GrindPick(gstep)
  check(base ~= nil and base.spot.name == "Mottled Boar", "the pick without learning is not the Mottled Boar spot")
  local baseName = base and base.spot.name or ""

  -- F1. A Mottled Boar seen red: the pick is another mob, or, when nothing else fits, the Mottled Boar with the careful words.
  Look("target", Mob("Mottled Boar", 2))
  local pick = ER.GrindPick(gstep)
  check(pick ~= nil, "a mob seen red took away the last spot")
  if pick then
    local reason = ER.GrindReasonLine(gstep) or ""
    if pick.spot.name == "Mottled Boar" then
      check(string.find(reason, "^Careful: you saw that Mottled Boars attack you%.") ~= nil, "the careful words are missing: " .. reason)
    else
      check(not pick.warn, "a pick that is not the red mob is marked warn")
    end
    check(string.find(LineOf(gstep), "^Grind " .. ER.GrindPlural(pick.spot.name)) ~= nil, "the step line does not follow the pick: " .. LineOf(gstep))
    local target = S.Target()
    check(target ~= nil and target.x == pick.spot.x and target.y == pick.spot.y, "the arrow does not follow the pick")
    check(string.find(S.Title(gstep), ER.GrindPlural(pick.spot.name), 1, true) ~= nil, "the title does not follow the pick")
    PICK_AFTER_RED = pick.spot.name
  end

  -- F2. Every spot of the visit seen red: the best spot of the data stays, with a warning; never fewer than one spot.
  for _, spot in ipairs(ER.RouteReader.ReadSpots(first.visit)) do
    Look("target", Mob(spot.name, 2))
  end
  pick = ER.GrindPick(gstep)
  check(pick ~= nil, "every spot seen red took away the last spot")
  if pick then
    check(pick.warn == true, "the kept spot is not marked warn")
    check(pick.spot.name == baseName, "the kept spot is " .. pick.spot.name .. ", the data's best is " .. baseName)
    local reason = ER.GrindReasonLine(gstep) or ""
    check(string.find(reason, "^Careful: you saw that " .. ER.GrindPlural(pick.spot.name) .. " attack you%. It is the only spot that fits, so fight one at a time%.") ~= nil,
      "the warning words are wrong: " .. reason)
    check(string.find(LineOf(gstep), "^Grind " .. ER.GrindPlural(pick.spot.name)) ~= nil, "the step line is not the kept spot")
    local target = S.Target()
    check(target ~= nil and target.x == pick.spot.x and target.y == pick.spot.y, "the arrow is not on the kept spot")
    WARN_LINE = reason
  end

  -- F3. Every spot seen yellow: the reason starts with what was seen.
  ER.db.reactions = nil
  for _, spot in ipairs(ER.RouteReader.ReadSpots(first.visit)) do
    Look("target", Mob(spot.name, 4))
  end
  pick = ER.GrindPick(gstep)
  check(pick ~= nil and pick.learned == "y", "a spot seen yellow is not marked learned")
  local reason = ER.GrindReasonLine(gstep) or ""
  check(string.find(reason, "^You saw that .- are yellow: they won't attack you first%.") ~= nil, "the learned yellow words are wrong: " .. reason)
  check(string.find(reason, "There are few other mobs around%.") ~= nil or string.find(reason, "Other mobs are close by, so keep an eye out%.") ~= nil,
    "the learned yellow words do not end with the other mobs: " .. reason)
  YELLOW_LINE = reason

  -- F4. The look makes the step box draw again by itself, once.
  local calls, real = 0, ER.StepsChanged
  ER.StepsChanged = function() calls = calls + 1 return real() end
  -- (the step window draws itself now and then anyway: count what a quiet Tick costs, and what a new look adds to it)
  Tick(2)
  local c0 = calls
  Tick(2)
  local quiet = calls - c0
  c0 = calls
  Look("target", Mob("Another Wolf That Is No Spot Here", 2))
  Tick(2)
  check(calls - c0 == quiet, "a look at a mob that is no spot of this visit drew the step box " .. (calls - c0) .. " times, a quiet moment " .. quiet)
  c0 = calls
  Look("target", Mob(ER.RouteReader.ReadSpots(first.visit)[1].name, 2))
  Tick(2)
  check(calls - c0 == quiet + 1, "a new look at a spot's mob drew the step box " .. (calls - c0) .. " times, a quiet moment " .. quiet .. " (one more expected)")
  c0 = calls
  Tick(2)
  check(calls - c0 == quiet, "the step box was drawn " .. (calls - c0) .. " times with nothing new seen, a quiet moment " .. quiet)
  ER.StepsChanged = real

  -- F5. The Settings tick off: the plain Phase 3 words, the look is still written down.
  ER.db.grindOff = true
  check(ER.GrindPick(gstep) == nil, "the pick is there with the tick off")
  ER.db.grindOff = nil
end
S.Stop()
ER.db.guides, ER.db.done = {}, {}

-- G. A spot whose data code is r or u, seen yellow, gets the yellow rules (found over the whole Orc path).
ER.db.reactions = nil
local found, wide, wideTried = 0, 0, 0
for _, info in ipairs(ER.RouteGuides()) do
  if not info.stop and found < 3 then
    for level = info.lo, info.hi do
      ER.db.reactions = nil
      for _, entry in ipairs(ER._testGrindChoose(info, level)) do
        if (entry.code == "r" or entry.code == "u") and found < 3 then
          local spot = entry.spot
          ER.db.reactions = nil
          Look("target", Mob(spot.name, 4))
          local hit
          for _, e2 in ipairs(ER._testGrindChoose(info, level)) do
            if e2.spot == spot then hit = e2 end
          end
          check(hit ~= nil and hit.code == "y" and hit.learned == "y", spot.name .. " (" .. entry.code .. ") seen yellow did not take the yellow code")
          local words = ER._testGrindReason(spot, "y", level, 0, "y")
          check(string.find(words, "^You saw that ") ~= nil, "the learned yellow words do not start with You saw that")
          found = found + 1
          -- wider: one level below the spot's lowest level the data says no (red rules) but the yellow rules say yes
          local low = spot.lo - 1
          if low >= 1 then
            ER.db.reactions = nil
            local inData
            for _, e3 in ipairs(ER._testGrindChoose(info, low)) do if e3.spot == spot then inData = true end end
            Look("target", Mob(spot.name, 4))
            local inLearned
            for _, e3 in ipairs(ER._testGrindChoose(info, low)) do if e3.spot == spot then inLearned = true end end
            if not inData and inLearned then wide = wide + 1 end
            wideTried = wideTried + 1
          end
        end
      end
    end
  end
end
check(found >= 1, "no spot with the data code r or u was found on the Orc path")
check(wide >= 1, "no red or unknown spot became possible one level lower when seen yellow (tried " .. wideTried .. ")")

-- H. Damaged saved data: no error anywhere, and the next look makes it a table again.
local info1 = ER.RouteGuides()[1]
local function Damaged(label, value)
  ER.db.reactions = value
  local ok, err = pcall(function()
    ER._testGrindChoose(info1, 1)
    Look("target", Mob("Fresh Boar", 4))
    ER._testGrindChoose(info1, 1)
    Look("mouseover", Mob("Mottled Boar", 4))
  end)
  check(ok, label .. ": " .. tostring(err))
  check(type(ER.db.reactions) == "table" and K("Horde", "fresh boar") == "y", label .. ": the next look did not make the list a table again")
  check(K("Horde", "mottled boar") == "y", label .. ": the Mottled Boar was not remembered")
end
Damaged("a string", "junk")
Damaged("a number", 42)
Damaged("true", true)
Damaged("a faction that is a string", { Horde = "x" })
Damaged("a faction that is a number", { Horde = 7, Alliance = {} })
Damaged("entries that are not tables", { Horde = { ["mottled boar"] = "junk", ["fresh boar"] = 5, ["other"] = true } })
Damaged("entries with a wrong kind", { Horde = { ["mottled boar"] = { k = 7 }, ["fresh boar"] = { k = "z", t = "x" } } })
-- the guide's pick on damaged data (a fresh level each time, so the kept pick is not used)
local ok2, err2 = pcall(function()
  for _, bad in ipairs({ "junk", { Horde = "x" }, { Horde = { ["mottled boar"] = "junk" } }, { Horde = { ["mottled boar"] = { k = 7 } } } }) do
    ER.db.reactions = bad
    local list = ER._testGrindChoose(info1, 1)
    if table.getn(list) == 0 then error("damaged data left no spot") end
  end
end)
check(ok2, "damaged data in the pick: " .. tostring(err2))

LEARN_LINE = "yellow-for-r/u found " .. found .. ", wider " .. wide .. "; warn: " .. (WARN_LINE or "?") .. " | yellow: " .. (YELLOW_LINE or "?")
G.units, ER.db.reactions, ER.db.grindOff, time, ER.db.mode = keep.units, keep.reactions, keep.grindOff, keep.time, "casual"
G.faction, G.level, G.zone = "Horde", 1, ""
ER.db.guides, ER.db.done = {}, {}
`, "section 21");
console.log("  " + getString("LEARN_LINE"));

// 21b. The backup to the look: a mob whose hit is the first thing that happens in a fight is red, and attacked first. The fight messages are
// English text in arg1. If the player acted first, or two different names hit first, nothing is written down.
console.log("21b. A mob that attacks you first counts as red");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
local keep = { units = G.units, reactions = ER.db.reactions, grindOff = ER.db.grindOff, mode = ER.db.mode }
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
ER.db.reactions = nil
G.units = {}

local HITS, MISSES = "CHAT_MSG_COMBAT_CREATURE_VS_SELF_HITS", "CHAT_MSG_COMBAT_CREATURE_VS_SELF_MISSES"
local function Entry(name)
  local r = ER.db.reactions
  if type(r) ~= "table" or type(r.Horde) ~= "table" then return nil end
  return r.Horde[name]
end
local function Names()
  local r, n = ER.db.reactions, 0
  if type(r) == "table" and type(r.Horde) == "table" then
    for _ in pairs(r.Horde) do n = n + 1 end
  end
  return n
end
local function Clean()
  Fire("PLAYER_REGEN_ENABLED")
  Tick(10)
end

-- A. Regen starts, the mob hits, regen ends: red, attacked first.
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Scorpid Worker hits you for 3.")
check(Entry("scorpid worker") == nil, "written down before the fight ended")
Fire("PLAYER_REGEN_ENABLED")
local e = Entry("scorpid worker")
check(type(e) == "table" and e.k == "r" and e.a == 1 and type(e.t) == "number", "the first hit was not written down as red and attacked first")
for k in pairs(e or {}) do check(k == "k" or k == "t" or k == "a", "the entry holds the field " .. tostring(k)) end

-- B. A crit, and a miss.
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Mangy Wolf crits you for 6.")
Fire("PLAYER_REGEN_ENABLED")
check(type(Entry("mangy wolf")) == "table" and Entry("mangy wolf").a == 1, "a crit was not written down")
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(MISSES, "Kobold Worker misses you.")
Fire("PLAYER_REGEN_ENABLED")
check(type(Entry("kobold worker")) == "table" and Entry("kobold worker").k == "r", "a miss was not written down")

-- B2. A swing that was avoided counts as the first swing too: dodge, parry, block, absorb.
local avoided = { "Dodge Boar attacks. You dodge.", "Parry Boar attacks. You parry.", "Block Boar attacks. You block.",
  "Absorb Boar attacks. You absorb all the damage." }
for _, line in ipairs(avoided) do
  local _, _, who = string.find(line, "^(.-) attacks")
  Clean()
  Fire("PLAYER_REGEN_DISABLED")
  Fire(MISSES, line)
  Fire("PLAYER_REGEN_ENABLED")
  local e2 = Entry(string.lower(who))
  check(type(e2) == "table" and e2.k == "r" and e2.a == 1, "'" .. line .. "' was not written down as the first swing")
end
-- the first swing is dodged and a neighbour hits next: two names, nothing is written (it used to name the neighbour)
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(MISSES, "Dire Wolf attacks. You dodge.")
Fire(HITS, "Mottled Boar hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(Entry("dire wolf") == nil and Entry("mottled boar") == nil, "a dodged first swing and a hit by a neighbour were written down")
-- a line that is no swing at you
Clean()
local n1 = Names()
Fire("PLAYER_REGEN_DISABLED")
Fire(MISSES, "You attack. Something dodges.")
Fire(MISSES, "Something attacks. Another one dodges.")
Fire("PLAYER_REGEN_ENABLED")
check(Names() == n1, "a line about somebody else changed the list")

-- B3. Somebody else started the fight: your pet, or a group. Nothing is written down.
G.units = { pet = { name = "Pet", combat = true } }
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Pet Pull Boar hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(Entry("pet pull boar") == nil, "a mob your pet was already fighting was written down as attacking first")
G.units = {}
-- the pet's own swing comes first (no unit data needed)
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire("CHAT_MSG_COMBAT_PET_HITS", "Your pet hits Pet Swing Boar for 4.")
Fire(HITS, "Pet Swing Boar hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(Entry("pet swing boar") == nil, "a mob your pet hit first was written down as attacking first")
-- the pet only joins after the mob hit you: the mob did attack first
G.units = {}
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Pet Late Boar hits you for 3.")
Fire("CHAT_MSG_COMBAT_PET_HITS", "Your pet hits Pet Late Boar for 4.")
Fire("PLAYER_REGEN_ENABLED")
check(type(Entry("pet late boar")) == "table", "a mob that hit you before your pet joined was not written down")
-- a party pull, a raid pull, and alone again
G.party = 2
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Party Pull Boar hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(Entry("party pull boar") == nil, "a mob that hit you first in a party was written down")
G.party = 0
G.raid = 6
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Raid Pull Boar hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(Entry("raid pull boar") == nil, "a mob that hit you first in a raid was written down")
G.raid = 0
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Solo Pull Boar hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(type(Entry("solo pull boar")) == "table", "a mob that hit you first when you were alone was not written down")

-- C. Several hits by the same mob are one name.
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Quilboar hits you for 2.")
Fire(MISSES, "Quilboar misses you.")
Fire(HITS, "Quilboar crits you for 9.")
Fire("PLAYER_REGEN_ENABLED")
check(type(Entry("quilboar")) == "table", "three hits by one mob were not written down")

-- D. The player acted first: nothing.
local acts = { "PLAYER_ENTER_COMBAT", "SPELLCAST_START", "CHAT_MSG_COMBAT_SELF_HITS", "CHAT_MSG_COMBAT_SELF_MISSES", "CHAT_MSG_SPELL_SELF_DAMAGE",
  "CHAT_MSG_SPELL_SELF_BUFF", "START_AUTOREPEAT_SPELL", "CHAT_MSG_COMBAT_PET_HITS", "CHAT_MSG_COMBAT_PET_MISSES", "CHAT_MSG_SPELL_PET_DAMAGE" }
for i, act in ipairs(acts) do
  local name = "Acted " .. i
  local before = Names()
  Clean()
  Fire("PLAYER_REGEN_DISABLED")
  Fire(act, "You hit something for 3.")
  Fire(HITS, name .. " hits you for 3.")
  Fire("PLAYER_REGEN_ENABLED")
  check(Entry(string.lower(name)) == nil and Names() == before, "the mob was written down although the player acted first (" .. act .. ")")
end
-- the action comes just before the fight begins (a cast, then the regen event)
Clean()
Fire("SPELLCAST_START", "Lightning Bolt")
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Before Cast hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(Entry("before cast") == nil, "the mob was written down although a cast came first")
-- a mob hits first, then the player acts: the mob still attacked first
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Then Acted hits you for 3.")
Fire("PLAYER_ENTER_COMBAT")
Fire(HITS, "Late Joiner hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(type(Entry("then acted")) == "table", "a mob that hit first, before the player acted, was not written down")
check(Entry("late joiner") == nil, "a mob that hit after the player acted was written down")
-- an old action does not count for a later fight
Clean()
Fire("SPELLCAST_START", "Frost Armor")
Tick(20)
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Old Action hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(type(Entry("old action")) == "table", "a cast from a minute ago made the first hit not count")

-- E. Two different names hit first: nothing.
local before = Names()
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Pack One hits you for 3.")
Fire(HITS, "Pack Two hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(Entry("pack one") == nil and Entry("pack two") == nil and Names() == before, "a fight with two different first hitters was written down")

-- F. A mob's line with no regen event before it starts the record; regen ends it always, so the next fight starts clean.
Clean()
Fire(HITS, "No Regen hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(type(Entry("no regen")) == "table", "a hit with no regen event before it was not written down")
-- regen ends the record even when nothing was recorded
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Left One hits you for 3.")
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Left Two hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(Entry("left one") == nil, "two first hitters were written down")
Clean()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Next Fight hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(type(Entry("next fight")) == "table", "the next fight did not start clean")
-- a hit line left over after a fight (no regen after it) does not poison the next fight
Clean()
Fire(HITS, "Stray Hitter hits you for 3.")
Tick(20)
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, "Real Puller hits you for 3.")
Fire("PLAYER_REGEN_ENABLED")
check(Entry("stray hitter") == nil and type(Entry("real puller")) == "table", "a leftover hit line changed the next fight")
-- lines that are no first hit
Clean()
local n0 = Names()
Fire("PLAYER_REGEN_DISABLED")
Fire(HITS, nil)
Fire(HITS, "Your pet hits Something for 3.")
Fire(HITS, "Something hits your pet for 3.")
Fire(HITS, "Something crits your Pet for 6.")
Fire(MISSES, "Something misses your pet.")
Fire(HITS, "Unknown hits you for 3.")
Fire(HITS, "")
Fire(MISSES, 42)
Fire("PLAYER_REGEN_ENABLED")
check(Names() == n0, "a line that is no first hit changed the list")

-- G. Attacked first once is a soft mark; twice it sticks.
local function Look(name, reaction)
  G.units = { target = { name = name, reaction = reaction, attackable = true } }
  Fire("PLAYER_TARGET_CHANGED")
  G.units = {}
end
local function Pull(name)
  Clean()
  Fire("PLAYER_REGEN_DISABLED")
  Fire(HITS, name .. " hits you for 3.")
  Fire("PLAYER_REGEN_ENABLED")
end
local function Mark(name)
  local m = Entry(name)
  return m and m.k, m and m.a
end
check(Entry("scorpid worker").k == "r" and Entry("scorpid worker").a == 1, "section A left the Scorpid Worker as something else")
-- once: a red look keeps the mark, a yellow look out of a fight clears it
Look("Scorpid Worker", 2)
local k1, a1 = Mark("scorpid worker")
check(k1 == "r" and a1 == 1, "a red look lost the attacked-first mark: " .. tostring(k1) .. " " .. tostring(a1))
Look("Scorpid Worker", 4)
k1, a1 = Mark("scorpid worker")
check(k1 == "y" and a1 == nil, "a yellow look did not clear a mark made once: " .. tostring(k1) .. " " .. tostring(a1))
-- twice (no yellow look between): it sticks as red
Pull("Scorpid Worker")
k1, a1 = Mark("scorpid worker")
check(k1 == "r" and a1 == 1, "the first attack after the yellow look is not a soft mark: " .. tostring(k1) .. " " .. tostring(a1))
Pull("Scorpid Worker")
k1, a1 = Mark("scorpid worker")
check(k1 == "r" and a1 == 2, "attacking first twice did not stick: " .. tostring(k1) .. " " .. tostring(a1))
Look("Scorpid Worker", 4)
k1, a1 = Mark("scorpid worker")
check(k1 == "r" and a1 == 2, "a yellow look undid a mark that happened twice: " .. tostring(k1) .. " " .. tostring(a1))
Look("Scorpid Worker", 2)
Pull("Scorpid Worker")
k1, a1 = Mark("scorpid worker")
check(k1 == "r" and a1 == 2, "a red look or a third attack changed the sticky mark: " .. tostring(k1) .. " " .. tostring(a1))
-- a mob seen yellow, then attacking first once, is red with a soft mark, and the guide's words say so
Look("Soft Boar", 4)
Pull("Soft Boar")
k1, a1 = Mark("soft boar")
check(k1 == "r" and a1 == 1, "a yellow mob that attacked first is not red with a soft mark: " .. tostring(k1) .. " " .. tostring(a1))

-- H. The guide: a spot whose mob attacked first has the careful words, and the red rules.
ER.db.reactions = nil
local first = ER.RouteGuides()[1]
check(ER.StartGuide(S.Key(first), true), "the Durotar zone did not start")
local at, gstep
for n = 1, S.Count() do
  local step = S.Step(n)
  if step.flags.grind and step.flags.grind ~= "bridge" and not at then
    for _, el in ipairs(step.elements) do
      if el.kind == "X" and tonumber(el.level) == 2 then at, gstep = n, step end
    end
  end
end
check(at ~= nil, "no grind step to level 2 in the Durotar visit")
if at then
  S.Jump(at)
  ER.StepsChanged()
  local base = ER.GrindPick(gstep)
  check(base ~= nil, "no pick without learning")
  -- every spot of the visit attacked first: the kept spot says so
  for _, spot in ipairs(ER.RouteReader.ReadSpots(first.visit)) do
    Fire("PLAYER_REGEN_DISABLED")
    Fire(HITS, spot.name .. " hits you for 3.")
    Fire("PLAYER_REGEN_ENABLED")
  end
  local pick = ER.GrindPick(gstep)
  check(pick ~= nil, "every spot attacked first took away the last spot")
  if pick then
    local mobs = ER.GrindPlural(pick.spot.name)
    local reason = ER.GrindReasonLine(gstep) or ""
    check(pick.warn == true and pick.first == true, "the kept spot is not marked warn and attacked first")
    check(string.find(reason, "^Careful: " .. mobs .. " attacked you first last time%.") ~= nil, "the attacked-first words are wrong: " .. reason)
    FIRST_LINE = reason
  end
  -- one mob attacked first, others fit: the other pick is not touched; the attacked-first spot has the red rules and the careful words
  ER.db.reactions = nil
  local list = ER._testGrindChoose(first, 1)
  local top = list[1]
  if top then
    Fire("PLAYER_REGEN_DISABLED")
    Fire(HITS, top.spot.name .. " hits you for 3.")
    Fire("PLAYER_REGEN_ENABLED")
    local list2 = ER._testGrindChoose(first, 1)
    local found
    for _, entry in ipairs(list2) do
      if entry.spot == top.spot then found = entry end
    end
    if found then
      check(found.code == "r" and found.learned == "r" and found.first == true, "the attacked-first spot does not have the red rules")
      check(found.spot.hi <= 1, "a red spot above level 1 still fits a level 1 player")
    else
      check(top.spot.hi > 1 or top.spot.red > ER.GRIND.GRIND_RED_MAX_RED, "the attacked-first spot is gone for no reason of the red rules")
    end
    local words = ER._testGrindReason(top.spot, "r", 1, 0, "first")
    check(string.find(words, "^Careful: " .. ER.GrindPlural(top.spot.name) .. " attacked you first last time%. They are your level or lower, and no strong mobs are near%.$") ~= nil,
      "the attacked-first sentence is wrong: " .. words)
  end
end
S.Stop()

G.units, ER.db.reactions, ER.db.grindOff, ER.db.mode = keep.units, keep.reactions, keep.grindOff, "casual"
G.level, G.zone = 1, ""
ER.db.guides, ER.db.done = {}, {}
`, "section 21b");
console.log("  " + getString("FIRST_LINE"));

// 21c. Kept picks. A pick is kept on its step, so a guide that is loaded again starts with none; only what is seen about the mob of a spot of
// this visit makes a pick again (not a new name, not names going out of the full list); and while you stand at the spot you grind it stays
// the pick as long as it still fits (the arrow does not move under you), but not when you are away from it or when it became unsafe.
console.log("21c. Kept picks");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
local keep = { units = G.units, reactions = ER.db.reactions, grindOff = ER.db.grindOff, mode = ER.db.mode }
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
ER.db.reactions = nil
G.units = {}
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local function Look(name, reaction)
  G.units = { target = { name = name, reaction = reaction, attackable = true } }
  Fire("PLAYER_TARGET_CHANGED")
  G.units = {}
end
local function Pos(zone, x, y)
  G.zone, G.x, G.y = zone, x, y
  NOW = NOW + 1
end
local function GrindSteps()
  local out = {}
  for n = 1, S.Count() do
    local st = S.Step(n)
    if tonumber(st.flags.grind) then table.insert(out, st) end
  end
  return out
end

-- A. A guide loaded again starts with no kept picks.
local first = ER.RouteGuides()[1]
check(S.Load(S.Key(first), true), "the Durotar visit did not load")
local step = GrindSteps()[1]
check(step ~= nil and step.grindPick == nil, "a fresh grind step has a kept pick")
local pick = ER.GrindPick(step)
check(pick ~= nil and type(step.grindPick) == "table", "asking for a pick did not keep it on the step")
check(ER.GrindPick(step) == pick, "the kept pick was made again with nothing changed")
check(S.Load(S.Key(first), true), "the Durotar visit did not load again")
local again = GrindSteps()[1]
check(again ~= step and again.grindPick == nil, "a guide loaded again keeps picks from before")
step = again
pick = ER.GrindPick(step)

-- B. Only what is seen about a mob of this visit's spots makes the pick again.
local spots = ER.RouteReader.ReadSpots(first.visit)
local before = step.grindPick
Look("Totally Unrelated Wolf", 2)
Look("Another Unrelated Boar", 4)
check(ER.GrindPick(step) == pick and step.grindPick == before, "mobs that are no spot of this visit made the pick again")
-- a full list (800 names that are no spot of this visit, put in by hand: every look costs a lot in the pretend game), then two new names:
-- the two oldest go out, and they were no spots either
ER.db.reactions = { Horde = {} }
for i = 1, 800 do ER.db.reactions.Horde["filler mob " .. i] = { k = "r", t = i } end
Look("Newcomer One", 2)
Look("Newcomer Two", 4)
local filled = 0
for _ in pairs(ER.db.reactions.Horde) do filled = filled + 1 end
check(filled == 800 and ER.db.reactions.Horde["filler mob 1"] == nil and ER.db.reactions.Horde["newcomer two"] ~= nil, "the full list did not keep its 800 names with the oldest going out (" .. filled .. ")")
check(ER.GrindPick(step) == pick and step.grindPick == before, "names that are no spot (and the oldest going out of the full list) made the pick again")
Look(spots[1].name, 2)
ER.GrindPick(step)
check(step.grindPick ~= before, "a spot's mob seen red did not make the pick again")
ER.db.reactions = nil

-- C. While you grind a spot it stays the pick as long as it fits.
local function Anchor(info, st)
  local _, _, fx, fy = string.find(st.flags.at or "", "^([%d%.]+),([%d%.]+)$")
  if fx then return tonumber(fx), tonumber(fy) end
  local a = ER.RouteReader.ReadVisit(info.visit)[1]
  return a.x, a.y
end
local found
for _, info in ipairs(ER.RouteGuides()) do
  if not found and not info.stop then
    S.Load(S.Key(info), true)
    for _, st in ipairs(GrindSteps()) do
      if not found then
        local ax, ay = Anchor(info, st)
        for L = info.lo, info.hi - 1 do
          if not found then
            local a = ER._testGrindChoose(info, L, ax, ay)[1]
            local nextList = ER._testGrindChoose(info, L + 1, ax, ay)
            if a and nextList[1] and nextList[1].spot ~= a.spot then
              for _, e in ipairs(nextList) do
                if e.spot == a.spot then found = { info = info, n = st.n, L = L, A = a.spot, B = nextList[1].spot } end
              end
            end
          end
        end
      end
    end
  end
end
check(found ~= nil, "no grind step has a level where the spot you grind is still fine but another one is now better")
if found then
  local info = found.info
  local function Fresh(level)
    G.level = level
    ER.db.guides, G.log, G.order = {}, {}, {}
    Pos("Ashenvale", 50, 50)
    S.Load(S.Key(info), true)
    return S.Step(found.n)
  end
  local function Stand()
    Pos(info.visit.zone, found.A.x, found.A.y)
  end
  -- standing at the spot, a level-up that makes another spot better: the arrow stays
  local st = Fresh(found.L)
  local p1 = ER.GrindPick(st)
  check(p1 ~= nil and p1.spot == found.A, "the first pick is not the best spot at level " .. found.L)
  Stand()
  G.level = found.L + 1
  local p2 = ER.GrindPick(st)
  check(p2 ~= nil and p2.spot == found.A, "the arrow moved to another spot while you stood at the one you grind (level " .. (found.L + 1) .. ")")
  -- away from the spot, the same level-up: the best spot is picked
  st = Fresh(found.L)
  ER.GrindPick(st)
  G.level = found.L + 1
  p2 = ER.GrindPick(st)
  check(p2 ~= nil and p2.spot == found.B, "away from the spot the pick did not follow the level-up to the better spot")
  -- standing at the spot, but it is no longer safe: the pick leaves it
  local ax, ay = Anchor(info, st)
  local L2
  for L = found.L + 1, 60 do
    if not L2 then
      local inList = false
      for _, e in ipairs(ER._testGrindChoose(info, L, ax, ay)) do
        if e.spot == found.A then inList = true end
      end
      if not inList then L2 = L end
    end
  end
  check(L2 ~= nil, "the spot " .. found.A.name .. " fits at every level up to 60")
  if L2 then
    st = Fresh(found.L)
    ER.GrindPick(st)
    Stand()
    G.level = L2
    local p3 = ER.GrindPick(st)
    check(p3 == nil or p3.spot ~= found.A, "the arrow stayed on " .. found.A.name .. " at level " .. L2 .. " where it no longer fits")
  end
  KEEP_LINE = info.visit.zone .. ": " .. found.A.name .. " stays at level " .. (found.L + 1) .. " when you stand there (" .. found.B.name .. " is better); gone at level " .. tostring(L2)
end
S.Stop()
ER.StepsChanged = savedChanged
G.units, ER.db.reactions, ER.db.grindOff, ER.db.mode = keep.units, keep.reactions, keep.grindOff, "casual"
G.level, G.zone, G.x, G.y = 1, "", 0, 0
ER.db.guides, ER.db.done = {}, {}
`, "section 21c");
console.log("  " + getString("KEEP_LINE"));

// 22. The Settings tick "Show grind spots" off: the plain Phase 3 grind steps, no grind bridges, Needs level and the learning stay.
console.log("22. Show grind spots off");
run(SECTION_START + `
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
local keep = { units = G.units, reactions = ER.db.reactions, grindOff = ER.db.grindOff, mode = ER.db.mode }
ER.db.guides, ER.db.done, ER.db.mode, ER.db.autoNextOff, ER.db.grindOff = {}, {}, "casual", true, nil
local first = ER.RouteGuides()[1]
check(first and first.visit.zone == "Durotar", "the Orc's first visit is not Durotar")
local key = S.Key(first)

-- Tick on (the default): the Durotar grind step names the Mottled Boars.
check(ER.StartGuide(key, true), "the Durotar zone did not start")
local at, grindStep = FindGrindStep(S, 2)
check(at ~= nil, "no grind step to level 2 in the Durotar visit")
S.Jump(at)
ER.StepsChanged()
local function ILine(step)
  for _, e in ipairs(step.elements) do
    if e.kind == "I" then return S.Line(step, e).text end
  end
  return nil
end
check(string.find(ILine(grindStep) or "", "^Grind Mottled Boars") ~= nil, "with the tick on the line is not about Mottled Boars: " .. tostring(ILine(grindStep)))
check(S.Target() ~= nil, "with the tick on the arrow has no place")
S.Stop()

-- Tick off: the plain level 1 grind step.
ER.db.grindOff = true
ER.db.guides, ER.db.done = {}, {}
check(ER.StartGuide(key, true), "the Durotar zone did not start with the tick off")
at, grindStep = FindGrindStep(S, 2)
check(at ~= nil, "no grind step to level 2 with the tick off")
S.Jump(at)
ER.StepsChanged()
check(ILine(grindStep) == "Nothing to pick up here yet: grind mobs near you until level 2.", "the plain line is '" .. tostring(ILine(grindStep)) .. "'")
check(S.Title(grindStep) == "Grind to level 2", "the plain title is '" .. S.Title(grindStep) .. "'")
check(S.Target() == nil, "with the tick off the arrow still has a place")
check(ER.GrindReasonLine(grindStep) == nil, "with the tick off there is still a reason line")
local shown = ShownLines()
check(string.find(shown, "yellow", 1, true) == nil and string.find(shown, "Mottled", 1, true) == nil, "with the tick off the box still names a mob or a reason: " .. shown)
check(string.find(shown, "(you: level 1", 1, true) ~= nil, "the X line lost the '(you: level 1' part: " .. shown)

-- The zone-end grind step of Durotar.
local endStep
for n = 1, S.Count() do
  local step = S.Step(n)
  if step.flags.grind == "end" then endStep = step end
end
check(endStep ~= nil, "Durotar has no zone-end grind step")
if endStep then
  check(ILine(endStep) == "Out of quests here: grind mobs near you until level 10, then the guide goes on.", "the zone-end line is '" .. tostring(ILine(endStep)) .. "'")
end

-- No bridge step is shown in the Barrens at level 10 on Casual, with the tick off; with it on there is one.
S.Stop()
local barrens
for _, i in ipairs(ER.RouteGuides()) do
  if not barrens and i.visit.zone == "The Barrens" then barrens = i end
end
check(barrens ~= nil, "the Orc path has no Barrens visit")
local savedChanged = ER.StepsChanged
ER.StepsChanged = function() end
local function ShownBridges()
  local n = 0
  for i = 1, S.Count() do
    local step = S.Step(i)
    if step.flags.grind == "bridge" and S.Fits(step) then n = n + 1 end
  end
  return n
end
local function LoadBarrens(level)
  G.level, ER.db.mode = level, "casual"
  G.zone, G.x, G.y = "The Barrens", 0, 0
  ER.db.guides, ER.db.done = {}, {}
  G.log, G.order = {}, {}
  return S.Load(S.Key(barrens), true)
end
ER.db.grindOff = nil
check(LoadBarrens(10), "the Barrens visit did not load")
local withTick = ShownBridges()
check(withTick >= 1, "with the tick on no bridge is shown at level 10 in the Barrens")
S.Stop()
ER.db.grindOff = true
check(LoadBarrens(10), "the Barrens visit did not load with the tick off")
check(ShownBridges() == 0, "with the tick off " .. ShownBridges() .. " bridge steps are shown in the Barrens at level 10")
S.Stop()
ER.StepsChanged = savedChanged

-- Needs level still shows on a Barrens pick-up above level 1, with the tick off.
G.level, G.zone = 1, ""
ER.db.guides, ER.db.done, ER.db.mode = {}, {}, "hard"
local atStep, want, n = nil, nil, 0
for line in string.gfind(ER._testGenerate(barrens), "[^\\n]+") do
  if string.sub(line, 1, 2) == "S\\t" then n = n + 1 end
  local _, _, id = string.find(line, "^A\\t\\t(%d+)\\t")
  if id and not atStep then
    local row = ER.QuestRow(tonumber(id))
    if row and row.m and row.m > 1 then atStep, want = n, row.m end
  end
end
check(atStep ~= nil, "the Barrens visit has no pick-up above level 1")
if atStep then
  check(ER.StartGuide(S.Key(barrens), true), "the Barrens visit did not start with the tick off")
  S.Jump(atStep)
  ER.StepsChanged()
  check(string.find(ShownLines(), "Needs level " .. tostring(want), 1, true) ~= nil, "with the tick off the box does not say Needs level " .. tostring(want) .. ": " .. ShownLines())
  S.Stop()
end

-- A yellow mob is still remembered with the tick off.
ER.db.reactions = nil
G.level, G.zone = 1, "Durotar"
G.units = { target = { name = "Tick Off Boar", reaction = 4, attackable = true } }
Fire("PLAYER_TARGET_CHANGED")
G.units = {}
local r = ER.db.reactions
local e = type(r) == "table" and type(r.Horde) == "table" and r.Horde["tick off boar"]
check(type(e) == "table" and e.k == "y", "with the tick off a yellow mob was not remembered")

-- The tick back on: the Durotar grind step names the Mottled Boars again.
ER.db.grindOff = nil
ER.db.guides, ER.db.done, ER.db.mode = {}, {}, "casual"
check(ER.StartGuide(key, true), "the Durotar zone did not start with the tick back on")
at, grindStep = FindGrindStep(S, 2)
S.Jump(at)
ER.StepsChanged()
check(string.find(ILine(grindStep) or "", "^Grind Mottled Boars") ~= nil, "with the tick back on the line is '" .. tostring(ILine(grindStep)) .. "'")
check(S.Target() ~= nil, "with the tick back on the arrow has no place")
S.Stop()

ER.db.grindOff = nil
G.units, ER.db.reactions, ER.db.mode = keep.units, keep.reactions, "casual"
G.level, G.zone = 1, ""
ER.db.guides, ER.db.done = {}, {}
`, "section 22");

run(fs.readFileSync(path.join(ROOT, "Auto.lua")), "Auto.lua");

// 23. Auto mode takes the quests the plan wants: a wanted quest is accepted one frame after the window opens, through the global AcceptQuest, and
// said in one chat line. A quest the plan does not want, no guide, Shift, the ticks, a shared quest and a window that is gone are never accepted.
console.log("23. Auto mode takes the quests the plan wants");
run(SECTION_START + `
G.race, G.class, G.faction = "Orc", "WARRIOR", "Horde"
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff }
ER.db.mode, ER.db.autoNextOff = "casual", true
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)

local function Occurs(s, sub)
  local n, at = 0, 1
  while true do
    local a, b = string.find(s, sub, at, true)
    if not a then return n end
    n = n + 1
    at = b + 1
  end
end
-- A fresh visit, an empty log, and every pretend switch back to rest.
local function Fresh()
  S.Stop()
  Tick(2)
  G.level, G.taxi, G.dead = 1, false, false
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  ER.db.autoOff, ER.db.autoquestOff = nil, nil
  G.calls, G.window, G.shift, G.units = {}, nil, false, {}
  QuestFrame:Hide()
  QuestFrameDetailPanel:Hide()
  Tick(2)
  G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
  check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
  Tick(2)
  CHAT = ""
end
local function Open(title, logTitle)
  G.window = { title = title, logTitle = logTitle }
  QuestFrame:Show()
  QuestFrameDetailPanel:Show()
  Fire("QUEST_DETAIL")
end
-- The talk is over: both windows shut and a second of quiet goes by.
local function Close()
  QuestFrame:Hide()
  QuestFrameDetailPanel:Hide()
  Tick(1.2)
end

Fresh()
local id1
for _, e in ipairs(S.Current().elements) do
  if e.kind == "A" and e.id and e.id ~= 0 then id1 = e.id break end
end
check(id1 ~= nil, "the first step of the Durotar visit has no Accept line")
local T = S.QuestTitle(id1)
check(T ~= nil, "no title for quest " .. tostring(id1))

-- The read functions of the step engine.
check(S.NormTitle("|cffffff00[12] Lazy Peons|r") == "lazy peons", "NormTitle of a level-tagged title is '" .. S.NormTitle("|cffffff00[12] Lazy Peons|r") .. "'")
check(S.NormTitle("Lazy Peons") == "lazy peons", "NormTitle of a plain title is '" .. S.NormTitle("Lazy Peons") .. "'")
check(S.NormTitle("[12+] Lazy Peons") == "lazy peons" and S.NormTitle("[?] Lazy Peons") == "lazy peons", "NormTitle does not strip [12+] and [?]")
check(S.WantedAccepts()[S.NormTitle(T)] == id1, "WantedAccepts has no entry for '" .. tostring(T) .. "'")
local handTitle
for n = 1, S.Count() do
  for _, e in ipairs(S.Step(n).elements) do
    if not handTitle and e.kind == "T" and e.id and e.id ~= 0 then handTitle = S.QuestTitle(e.id) end
  end
end
check(handTitle ~= nil and S.HandInTitles()[S.NormTitle(handTitle)] ~= nil, "HandInTitles does not hold '" .. tostring(handTitle) .. "'")
check(table.getn(S.OpenElements("F")) == 0, "OpenElements('F') is not empty at the start of the visit")

-- a. a wanted quest: no call at once, one AcceptQuest a frame later, one chat line after the talk
Open(T)
check(table.getn(G.calls) == 0, "AcceptQuest was called at once: " .. table.concat(G.calls, ","))
Tick(0.1)
check(table.getn(G.calls) == 1 and G.calls[1] == "AcceptQuest", "after a frame the calls are: " .. table.concat(G.calls, ","))
check(G.log[T] ~= nil, "the quest did not reach the log")
Close()
check(CHAT == "accepted " .. T .. ".|", "the chat is '" .. CHAT .. "'")

-- b. no guide running: nothing
Fresh()
S.Stop()
Open(T)
Tick(0.1)
check(table.getn(G.calls) == 0, "with no guide a call was made: " .. table.concat(G.calls, ","))
Close()
check(CHAT == "", "with no guide the chat says '" .. CHAT .. "'")

-- c. another addon was first (the detail panel is already shut): no call
Fresh()
Open(T)
QuestFrameDetailPanel:Hide()
Tick(0.1)
check(table.getn(G.calls) == 0, "a closed window still got a call: " .. table.concat(G.calls, ","))
Close()
check(CHAT == "", "a closed window still said '" .. CHAT .. "'")

local norm1 = S.NormTitle(T)
local id2, T2
for _, id in pairs(S.WantedAccepts()) do
  if id ~= id1 and not id2 then id2 = id end
end
check(id2 ~= nil, "the Durotar start wants only one quest")
T2 = S.QuestTitle(id2)
local function Calls() return table.concat(G.calls, ",") end

-- d. Shift when the window opens: the whole talk is left alone, the next talk is not
Fresh()
G.shift = true
Open(T)
Tick(0.1)
check(table.getn(G.calls) == 0, "Shift held at the window, yet a call was made: " .. Calls())
Close()
check(CHAT == "", "Shift held, yet the chat says '" .. CHAT .. "'")
G.shift = false
Open(T)
Tick(0.1)
check(table.getn(G.calls) == 1, "a new talk without Shift made " .. table.getn(G.calls) .. " calls: " .. Calls())
Close()

-- e. Shift at the first window of a talk, let go at the second window of the same talk: still off
Fresh()
G.shift = true
Open(T)
Tick(0.1)
G.shift = false
G.window = { title = T2 }
QuestFrameDetailPanel:Show()
Fire("QUEST_DETAIL")
Tick(0.1)
check(table.getn(G.calls) == 0, "Shift at the first window, yet the second window of the talk got a call: " .. Calls())
Close()

-- f. Shift pressed after the event but before the action runs
Fresh()
Open(T)
G.shift = true
Tick(0.1)
check(table.getn(G.calls) == 0, "Shift pressed before the action, yet a call was made: " .. Calls())
Close()
G.shift = false

-- g. the ticks: all of auto mode, and the quest part
Fresh()
ER.db.autoOff = true
Open(T)
Tick(0.1)
check(table.getn(G.calls) == 0, "with Auto mode off a call was made: " .. Calls())
Close()
ER.db.autoOff = nil
ER.db.autoquestOff = true
Open(T)
Tick(0.1)
check(table.getn(G.calls) == 0, "with the quest part off a call was made: " .. Calls())
Close()
ER.db.autoquestOff = nil
Open(T)
Tick(0.1)
check(table.getn(G.calls) == 1, "with both ticks on again the calls are: " .. Calls())
Close()

-- h. a quest the plan does not want now: one that is not on the plan at all, and the last pick-up of the visit
Fresh()
local last
for n = S.Count(), 1, -1 do
  for _, e in ipairs(S.Step(n).elements) do
    if not last and e.kind == "A" and e.id and e.id ~= 0 then last = S.QuestTitle(e.id) end
  end
end
check(last ~= nil and S.WantedAccepts()[S.NormTitle(last)] == nil, "the last pick-up of the visit ('" .. tostring(last) .. "') is wanted now")
Open("Not On The Plan")
Tick(0.1)
check(table.getn(G.calls) == 0, "a quest that is not on the plan got a call: " .. Calls())
Close()
if last then
  Open(last)
  Tick(0.1)
  check(table.getn(G.calls) == 0, "the last pick-up of the visit got a call: " .. Calls())
  Close()
end
check(CHAT == "", "unwanted quests were said: '" .. CHAT .. "'")

-- i. a quest that is too hard for you
Fresh()
local realHard = S.TooHard
S.TooHard = function(id)
  if id == id1 then return 3 end
  return realHard(id)
end
check(S.WantedAccepts()[norm1] == nil, "a too hard quest is wanted")
Open(T)
Tick(0.1)
S.TooHard = realHard
check(table.getn(G.calls) == 0, "a too hard quest got a call: " .. Calls())
Close()

-- j. a quest another player shares
Fresh()
G.units.npc = { name = "Friend", player = true }
Open(T)
Tick(0.1)
check(table.getn(G.calls) == 0, "a quest shared by a player got a call: " .. Calls())
Close()
G.units = {}

-- k. a title with a level tag: taken, and said without the tag
Fresh()
Open("[1] " .. T, T)
Tick(0.1)
check(table.getn(G.calls) == 1 and G.log[T] ~= nil, "a level-tagged title was not taken: " .. Calls())
Close()
check(CHAT == "accepted " .. T .. ".|", "the level-tagged title is said as '" .. CHAT .. "'")

-- l. the same title twice: once
Fresh()
Open(T)
Open(T)
Tick(0.1)
Tick(0.1)
check(table.getn(G.calls) == 1, "the same title shown twice made " .. table.getn(G.calls) .. " calls: " .. Calls())
G.log, G.order = {}, {}
QuestFrameDetailPanel:Show()
Fire("QUEST_DETAIL")
Tick(0.1)
check(table.getn(G.calls) == 1, "the same title shown again in the talk made " .. table.getn(G.calls) .. " calls: " .. Calls())
Close()

-- m. two quests in one talk: one chat line
Fresh()
Open(T)
Tick(0.1)
G.window = { title = T2 }
QuestFrameDetailPanel:Show()
Fire("QUEST_DETAIL")
Tick(0.1)
check(table.getn(G.calls) == 2, "two quests made " .. table.getn(G.calls) .. " calls: " .. Calls())
Close()
check(CHAT == "accepted " .. T .. " and " .. T2 .. ".|", "two quests are said as '" .. CHAT .. "'")

-- n. a full quest log: the call is made, the quest is not in the log, and the line says so
Fresh()
for i = 1, 20 do
  G.log["Filler " .. i] = { complete = false, objs = {} }
  table.insert(G.order, "Filler " .. i)
end
Open(T)
Tick(0.1)
check(table.getn(G.calls) == 1, "with a full log the calls are: " .. Calls())
check(G.log[T] == nil, "the quest got into a full log")
Close()
check(CHAT == "Your quest log is full.|", "a full log is said as '" .. CHAT .. "'")

-- o. a wrapper put on AcceptQuest after Auto.lua loaded (Recorder.lua does that in the game) is the one called
Fresh()
local fakeAccept = AcceptQuest
AcceptQuest = function()
  Call("wrapped")
  return fakeAccept()
end
Open(T)
Tick(0.1)
AcceptQuest = fakeAccept
check(G.calls[1] == "wrapped" and G.calls[2] == "AcceptQuest", "the wrapper was not called first: " .. Calls())
Close()

-- The end: nothing left behind for later sections.
S.Stop()
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.window, G.shift, G.units, G.calls = nil, false, {}, {}
QuestFrame:Hide()
QuestFrameDetailPanel:Hide()
`, "section 23");

// 24. Auto mode hands in the plan's finished quests: the progress window is completed, the reward window is taken when there is nothing or one
// thing to choose. Two or more rewards and a quest that asks for money are left to the player, said once. Shift, the ticks, no guide and a
// quest the plan does not hand in are never touched.
console.log("24. Auto mode hands in the plan's finished quests");
run(SECTION_START + `
G.race, G.class, G.faction = "Orc", "WARRIOR", "Horde"
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff }
ER.db.mode, ER.db.autoNextOff = "casual", true
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)

local function Occurs(s, sub)
  local n, at = 0, 1
  while true do
    local a, b = string.find(s, sub, at, true)
    if not a then return n end
    n = n + 1
    at = b + 1
  end
end
local function Calls() return table.concat(G.calls, ",") end
local function Hide()
  QuestFrame:Hide()
  QuestFrameDetailPanel:Hide()
  QuestFrameProgressPanel:Hide()
  QuestFrameRewardPanel:Hide()
end
local function Fresh()
  S.Stop()
  Tick(2)
  G.level, G.taxi, G.dead = 1, false, false
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  ER.db.autoOff, ER.db.autoquestOff = nil, nil
  G.calls, G.window, G.shift, G.units = {}, nil, false, {}
  Hide()
  Tick(2)
  G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
  check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
  Tick(2)
  CHAT = ""
end
local function Put(title, complete)
  G.log[title] = { complete = complete, objs = {} }
  table.insert(G.order, title)
end
local function OpenProgress(title, completable, cost)
  G.window = { title = title, completable = completable, cost = cost }
  QuestFrame:Show()
  QuestFrameProgressPanel:Show()
  Fire("QUEST_PROGRESS")
end
local function OpenReward(title, choices, cost)
  G.window = { title = title, choices = choices, cost = cost }
  QuestFrame:Show()
  QuestFrameProgressPanel:Hide()
  QuestFrameRewardPanel:Show()
  Fire("QUEST_COMPLETE")
end
local function Close()
  Hide()
  Tick(1.2)
end

Fresh()
local T
for n = 1, S.Count() do
  for _, e in ipairs(S.Step(n).elements) do
    if not T and e.kind == "T" and e.id and e.id ~= 0 then T = S.QuestTitle(e.id) end
  end
end
check(T ~= nil and S.HandInTitles()[S.NormTitle(T)] ~= nil, "the Durotar visit has no hand-in title")
local MONEY = "This quest takes money: finish it yourself."
local PICK = "Pick your reward for " .. T .. ", then press Complete Quest."

-- a. progress window: completable is completed a frame later, not completable is left alone
Put(T, true)
OpenProgress(T, true)
check(table.getn(G.calls) == 0, "CompleteQuest was called at once: " .. Calls())
Tick(0.1)
check(Calls() == "CompleteQuest", "a ready quest made the calls: " .. Calls())
Close()
check(CHAT == "", "a progress window alone said '" .. CHAT .. "'")
Fresh()
Put(T, false)
OpenProgress(T, false)
Tick(0.1)
check(table.getn(G.calls) == 0, "a quest that is not ready got a call: " .. Calls())
Close()
check(CHAT == "", "a quest that is not ready said '" .. CHAT .. "'")

-- b. progress window of a quest that asks for money: no call, one line even when the event comes twice
Fresh()
Put(T, true)
OpenProgress(T, true, 50)
OpenProgress(T, true, 50)
Tick(0.1)
check(table.getn(G.calls) == 0, "a quest that takes money got a call: " .. Calls())
check(Occurs(CHAT, MONEY) == 1, "the money line was said " .. Occurs(CHAT, MONEY) .. " times: '" .. CHAT .. "'")
Close()

-- c. reward window: nothing to choose -> 0, one thing -> 1
Fresh()
Put(T, true)
OpenReward(T, 0)
check(table.getn(G.calls) == 0, "GetQuestReward was called at once: " .. Calls())
Tick(0.1)
check(Calls() == "GetQuestReward:0", "no reward to choose made the calls: " .. Calls())
Close()
Fresh()
Put(T, true)
OpenReward(T, 1)
Tick(0.1)
check(Calls() == "GetQuestReward:1", "one reward made the calls: " .. Calls())
Close()
Fresh()
Put(T, true)
OpenReward(T, 1)
OpenReward(T, 1)
Tick(0.1)
Tick(0.1)
check(Calls() == "GetQuestReward:1", "the same reward window twice made the calls: " .. Calls())
Close()

-- d. two or more rewards: never picked, the window stays, one line however often the event comes
Fresh()
Put(T, true)
OpenReward(T, 2)
Tick(0.1)
check(table.getn(G.calls) == 0, "two rewards got a call: " .. Calls())
Close()
Fresh()
Put(T, true)
OpenReward(T, 2)
OpenReward(T, 2)
OpenReward(T, 3)
Tick(0.1)
Tick(0.1)
check(table.getn(G.calls) == 0, "two or more rewards got a call: " .. Calls())
check(G.log[T] ~= nil, "two or more rewards: the quest left the log")
check(QuestFrameRewardPanel:IsVisible(), "two or more rewards: the window was closed")
check(Occurs(CHAT, PICK) == 1, "the pick line was said " .. Occurs(CHAT, PICK) .. " times: '" .. CHAT .. "'")
Close()
check(Occurs(CHAT, "handed in") == 0, "two rewards said 'handed in': '" .. CHAT .. "'")
-- the next talk says it again
OpenReward(T, 2)
Tick(0.1)
check(Occurs(CHAT, PICK) == 2, "a new talk did not say the pick line again: '" .. CHAT .. "'")
Close()

-- e. a quest that asks for money at the reward window: no call, the money line
Fresh()
Put(T, true)
OpenReward(T, 0, 50)
OpenReward(T, 1, 50)
Tick(0.1)
check(table.getn(G.calls) == 0, "a reward window with a cost got a call: " .. Calls())
check(Occurs(CHAT, MONEY) == 1, "the money line at the reward window was said " .. Occurs(CHAT, MONEY) .. " times: '" .. CHAT .. "'")
Close()

-- f. the chat line: "handed in" only once the quest left the log
Fresh()
Put(T, true)
OpenReward(T, 0)
Tick(0.1)
check(G.log[T] == nil, "the quest did not leave the log")
Close()
check(CHAT == "handed in " .. T .. ".|", "the hand-in is said as '" .. CHAT .. "'")
Fresh()
Put(T, true)
local keepReward = GetQuestReward
GetQuestReward = function(n) Call("GetQuestReward:" .. math.floor(n)) QuestFrameRewardPanel:Hide() end
OpenReward(T, 0)
Tick(0.1)
GetQuestReward = keepReward
check(Calls() == "GetQuestReward:0", "the stuck quest made the calls: " .. Calls())
Close()
check(CHAT == "", "a quest still in the log was said as '" .. CHAT .. "'")

-- g. a hand-in and an accept in one talk: one line
Fresh()
Put(T, true)
local U
for norm, id in pairs(S.WantedAccepts()) do
  local title = S.QuestTitle(id)
  if not U and title and S.NormTitle(title) ~= S.NormTitle(T) then U = title end
end
check(U ~= nil, "no wanted quest to accept after the hand-in")
OpenReward(T, 0)
Tick(0.1)
G.window = { title = U }
QuestFrameRewardPanel:Hide()
QuestFrameDetailPanel:Show()
Fire("QUEST_DETAIL")
Tick(0.1)
Close()
check(CHAT == "handed in " .. T .. ", accepted " .. U .. ".|", "a hand-in and an accept are said as '" .. CHAT .. "'")

-- h. never handed in: a quest the plan does not hand in, no guide, Shift, the ticks, a window that is gone
local function Attempt(why, setup)
  for _, kind in ipairs({ "progress", "reward" }) do
    Fresh()
    local title = T
    if setup then title = setup() or T end
    if kind == "progress" then OpenProgress(title, true) else OpenReward(title, 0) end
    if why == "gone" then
      QuestFrameProgressPanel:Hide()
      QuestFrameRewardPanel:Hide()
    end
    Tick(0.1)
    check(table.getn(G.calls) == 0, why .. " (" .. kind .. "): a call was made: " .. Calls())
    Close()
    check(CHAT == "", why .. " (" .. kind .. "): the chat says '" .. CHAT .. "'")
    G.shift = false
    ER.db.autoOff, ER.db.autoquestOff = nil, nil
  end
end
Attempt("not on the plan", function() Put("Not On The Plan", true) return "Not On The Plan" end)
Attempt("no guide", function() Put(T, true) S.Stop() end)
Attempt("Shift at the event", function() Put(T, true) G.shift = true end)
Attempt("Auto mode off", function() Put(T, true) ER.db.autoOff = true end)
Attempt("quest part off", function() Put(T, true) ER.db.autoquestOff = true end)
-- the reward window case of "gone" needs the title still in the log
Attempt("gone", function() Put(T, true) end)

-- i. Shift pressed after the event but before the action runs
Fresh()
Put(T, true)
OpenReward(T, 0)
G.shift = true
Tick(0.1)
check(table.getn(G.calls) == 0, "Shift pressed before the hand-in, yet a call was made: " .. Calls())
Close()
G.shift = false

-- j. a wrapper put on GetQuestReward after Auto.lua loaded (Recorder.lua does that in the game) is the one called
Fresh()
Put(T, true)
local fakeReward = GetQuestReward
GetQuestReward = function(n)
  Call("wrapped")
  return fakeReward(n)
end
OpenReward(T, 0)
Tick(0.1)
GetQuestReward = fakeReward
check(G.calls[1] == "wrapped" and G.calls[2] == "GetQuestReward:0", "the wrapper was not called first: " .. Calls())
Close()

-- The end: nothing left behind for later sections.
S.Stop()
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
ER.db.autoOff, ER.db.autoquestOff = nil, nil
G.window, G.shift, G.units, G.calls = nil, false, {}, {}
G.log, G.order = {}, {}
Hide()
`, "section 24");

// 25. Auto mode picks the plan's quests in NPC menus: gossip and greeting windows. A finished hand-in first, then a pick-up the plan wants; one
// pick per window event, once per title per talk (a pick does not count against the cap); Shift at a menu keeps the quest window that opens from it. No other entry is touched.
console.log("25. Auto mode picks the plan's quests in NPC menus");
run(SECTION_START + `
G.race, G.class, G.faction = "Orc", "WARRIOR", "Horde"
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff }
ER.db.mode, ER.db.autoNextOff = "casual", true
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)

local function Calls() return table.concat(G.calls, ",") end
local function Hide()
  QuestFrame:Hide()
  QuestFrameDetailPanel:Hide()
  QuestFrameProgressPanel:Hide()
  QuestFrameRewardPanel:Hide()
  QuestFrameGreetingPanel:Hide()
  GossipFrame:Hide()
end
local function Fresh()
  S.Stop()
  Tick(2)
  G.level, G.taxi, G.dead = 1, false, false
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  ER.db.autoOff, ER.db.autoquestOff, ER.db.automenuOff = nil, nil, nil
  G.calls, G.window, G.shift, G.units, G.npc = {}, nil, false, {}, nil
  GetNumQuestLeaderBoards = nil
  Hide()
  Tick(2)
  G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
  check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
  Tick(2)
  CHAT = ""
end
local function Put(title, complete)
  G.log[title] = { complete = complete, objs = {} }
  table.insert(G.order, title)
end
local function Close()
  Hide()
  Tick(1.2)
end
local function Gossip(active, avail)
  G.npc = { gossip = { active = active, avail = avail } }
  GossipFrame:Show()
  Fire("GOSSIP_SHOW")
end
local function Greeting(active, avail)
  G.npc = { greeting = { active = active, avail = avail } }
  QuestFrame:Show()
  QuestFrameGreetingPanel:Show()
  Fire("QUEST_GREETING")
end

Fresh()
-- W: a quest wanted now. N and F: two quests the visit hands in (not W). X: not on the plan.
local W
for norm, id in pairs(S.WantedAccepts()) do
  if not W then W = S.QuestTitle(id) end
end
local hands = {}
for n = 1, S.Count() do
  for _, e in ipairs(S.Step(n).elements) do
    local t = e.kind == "T" and e.id and e.id ~= 0 and S.QuestTitle(e.id)
    if t and S.NormTitle(t) ~= S.NormTitle(W) then
      local seen = false
      for _, h in ipairs(hands) do if h == t then seen = true end end
      if not seen then table.insert(hands, t) end
    end
  end
end
local N, F, X = hands[1], hands[2], "Not On The Plan"
check(W ~= nil and N ~= nil and F ~= nil, "the Durotar visit has no wanted quest or fewer than two hand-ins")

-- a. active list: only the finished hand-in
Put(N, false)
Put(F, true)
Gossip({ { N, 1 }, { F, 1 } }, {})
Tick(0.1)
check(Calls() == "SelectGossipActiveQuest:2", "the active list made the calls: " .. Calls())
Close()

-- b. available list: only the wanted one
Fresh()
Gossip({}, { { X, 1 }, { W, 1 } })
Tick(0.1)
check(Calls() == "SelectGossipAvailableQuest:2", "the available list made the calls: " .. Calls())
Close()

-- c. a finished hand-in and a wanted quest: hand-in first, then the pick-up, then nothing
Fresh()
Put(F, true)
Gossip({ { F, 1 } }, { { W, 1 } })
Tick(0.1)
Fire("GOSSIP_SHOW")
Tick(0.1)
Fire("GOSSIP_SHOW")
Tick(0.1)
check(Calls() == "SelectGossipActiveQuest:1,SelectGossipAvailableQuest:1", "hand-in then pick-up made the calls: " .. Calls())
Close()

-- d. the same menu four times with one wanted title: one call
Fresh()
Gossip({}, { { W, 1 } })
for i = 1, 3 do
  Tick(0.1)
  Fire("GOSSIP_SHOW")
end
Tick(0.1)
check(Calls() == "SelectGossipAvailableQuest:1", "the same menu four times made the calls: " .. Calls())
Close()

-- e. menu picks do not count against the cap (the accept or hand-in behind each does): eight wanted titles offered, eight picks in one talk
Fresh()
local realWanted = S.WantedAccepts
S.WantedAccepts = function()
  local t = {}
  for i = 1, 8 do t["made up " .. i] = i end
  return t
end
local menu = {}
for i = 1, 8 do table.insert(menu, { "Made Up " .. i, 1 }) end
Gossip({}, menu)
for i = 1, 9 do
  Tick(0.1)
  Fire("GOSSIP_SHOW")
end
Tick(0.1)
S.WantedAccepts = realWanted
check(table.getn(G.calls) == 8, "eight wanted titles made " .. table.getn(G.calls) .. " picks: " .. Calls())
Close()

-- f. a level tag in front of the title
Fresh()
Gossip({}, { { "[5] " .. W, 1 } })
Tick(0.1)
check(Calls() == "SelectGossipAvailableQuest:1", "a level-tagged entry made the calls: " .. Calls())
Close()

-- g. a quest with no objectives counts as finished; one with objectives still to do does not
Fresh()
Put(N, false)
GetNumQuestLeaderBoards = function() return 0 end
Gossip({ { N, 1 } }, {})
Tick(0.1)
GetNumQuestLeaderBoards = nil
check(Calls() == "SelectGossipActiveQuest:1", "a quest with no objectives made the calls: " .. Calls())
Close()
Fresh()
Put(N, false)
GetNumQuestLeaderBoards = function() return 2 end
Gossip({ { N, 1 } }, {})
Tick(0.1)
GetNumQuestLeaderBoards = nil
check(table.getn(G.calls) == 0, "a quest with two objectives to do was picked: " .. Calls())
Close()

-- h. greeting window
Fresh()
Put(N, false)
Put(F, true)
Greeting({ N, F }, {})
Tick(0.1)
check(Calls() == "SelectActiveQuest:2", "the greeting active list made the calls: " .. Calls())
Close()
Fresh()
Greeting({}, { X, W })
Tick(0.1)
check(Calls() == "SelectAvailableQuest:2", "the greeting available list made the calls: " .. Calls())
Close()

-- i. nothing picked: no guide, the menu tick, the whole tick, Shift, a window that is gone, quests that are not on the plan
local function Nothing(why, setup, shown)
  Fresh()
  Put(F, true)
  if setup then setup() end
  Gossip({ { F, 1 } }, { { W, 1 } })
  if shown == false then GossipFrame:Hide() end
  Tick(0.1)
  check(table.getn(G.calls) == 0, why .. ": a call was made: " .. Calls())
  Close()
  G.shift = false
  ER.db.autoOff, ER.db.automenuOff, ER.db.autoquestOff = nil, nil, nil
end
Nothing("no guide", function() S.Stop() end)
Nothing("menu tick off", function() ER.db.automenuOff = true end)
Nothing("quest tick off", function() ER.db.autoquestOff = true end)
Nothing("Auto mode off", function() ER.db.autoOff = true end)
Nothing("Shift at the menu", function() G.shift = true end)
Nothing("window gone", nil, false)
Fresh()
Put(X, true)
Gossip({ { X, 1 } }, { { X .. " 2", 1 } })
Tick(0.1)
check(table.getn(G.calls) == 0, "quests that are not on the plan got a call: " .. Calls())
Close()

-- j. Shift pressed after the event but before the pick
Fresh()
Gossip({}, { { W, 1 } })
G.shift = true
Tick(0.1)
check(table.getn(G.calls) == 0, "Shift pressed before the pick, yet a call was made: " .. Calls())
Close()
G.shift = false

-- k. a menu that changed before the pick: another title at that place
Fresh()
Gossip({}, { { W, 1 } })
G.npc.gossip.avail = { { X, 1 } }
Tick(0.1)
check(table.getn(G.calls) == 0, "a changed menu still got a pick: " .. Calls())
Close()

-- l. Shift across windows: held at the menu, let go when the quest window opens from it; the whole talk stays yours
Fresh()
G.shift = true
Gossip({}, { { W, 1 } })
Tick(0.1)
G.shift = false
GossipFrame:Hide()
G.window = { title = W }
QuestFrame:Show()
QuestFrameDetailPanel:Show()
Fire("QUEST_DETAIL")
Tick(0.1)
check(table.getn(G.calls) == 0, "Shift at the menu, yet the quest window of the talk got a call: " .. Calls())
Close()
check(CHAT == "", "Shift at the menu, yet the chat says '" .. CHAT .. "'")
G.window = { title = W }
QuestFrame:Show()
QuestFrameDetailPanel:Show()
Fire("QUEST_DETAIL")
Tick(0.1)
check(Calls() == "AcceptQuest", "a new talk after Shift made the calls: " .. Calls())
Close()

-- m. end to end in one talk: the menu picks, the quest window opens, the quest is accepted, one line
Fresh()
Gossip({}, { { W, 1 } })
Tick(0.1)
check(Calls() == "SelectGossipAvailableQuest:1", "end to end: the pick made the calls: " .. Calls())
GossipFrame:Hide()
G.window = { title = W }
QuestFrame:Show()
QuestFrameDetailPanel:Show()
Fire("QUEST_DETAIL")
Tick(0.1)
check(Calls() == "SelectGossipAvailableQuest:1,AcceptQuest", "end to end: the calls are: " .. Calls())
Close()
check(CHAT == "accepted " .. W .. ".|", "end to end: the chat is '" .. CHAT .. "'")

-- The end: nothing left behind.
S.Stop()
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
ER.db.autoOff, ER.db.autoquestOff, ER.db.automenuOff = nil, nil, nil
G.window, G.shift, G.units, G.calls, G.npc = nil, false, {}, {}, nil
G.log, G.order = {}, {}
GetNumQuestLeaderBoards = nil
Hide()
`, "section 25");

// 26. Auto mode leaves alone what other addons do: AutoQuest (it always hands in; it accepts only when followTourGuide is off or a TourGuide is
// hooked, or when its settings are unreadable), Automaton (Gossip module on) and FastQuest (AutoComplete on) hand in. Easy Route does only the rest
// and says so once per session. LazyPig needs no rule. An addon table of any shape never raises an error.
console.log("26. Auto mode leaves alone what other addons do");
run(SECTION_START + `
G.race, G.class, G.faction = "Orc", "WARRIOR", "Horde"
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff }
ER.db.mode, ER.db.autoNextOff = "casual", true
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)
local A = ER.Auto

local function Occurs(s, sub)
  local n, at = 0, 1
  while true do
    local a, b = string.find(s, sub, at, true)
    if not a then return n end
    n = n + 1
    at = b + 1
  end
end
local function Calls() return table.concat(G.calls, ",") end
local function Hide()
  QuestFrame:Hide()
  QuestFrameDetailPanel:Hide()
  QuestFrameProgressPanel:Hide()
  QuestFrameRewardPanel:Hide()
  QuestFrameGreetingPanel:Hide()
  GossipFrame:Hide()
end
-- Every other addon gone and the once-per-session lines forgotten.
local function NoOthers()
  AutoQuest, Automaton, Automaton_Gossip, FQD, LPCONFIG = nil, nil, nil, nil, nil
  A.told = {}
end
local function Fresh()
  S.Stop()
  Tick(2)
  NoOthers()
  G.level, G.taxi, G.dead = 1, false, false
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  ER.db.autoOff, ER.db.autoquestOff, ER.db.automenuOff = nil, nil, nil
  G.calls, G.window, G.shift, G.units, G.npc = {}, nil, false, {}, nil
  Hide()
  Tick(2)
  G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
  check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
  Tick(2)
  CHAT = ""
end
local function Put(title, complete)
  G.log[title] = { complete = complete, objs = {} }
  table.insert(G.order, title)
end
local function Close()
  Hide()
  Tick(1.2)
end
local function OpenDetail(title)
  G.window = { title = title }
  QuestFrame:Show()
  QuestFrameDetailPanel:Show()
  Fire("QUEST_DETAIL")
end
local function OpenProgress(title)
  G.window = { title = title, completable = true }
  QuestFrame:Show()
  QuestFrameProgressPanel:Show()
  Fire("QUEST_PROGRESS")
end
local function OpenReward(title)
  G.window = { title = title, choices = 0 }
  QuestFrame:Show()
  QuestFrameProgressPanel:Hide()
  QuestFrameRewardPanel:Show()
  Fire("QUEST_COMPLETE")
end
local function Gossip(active, avail)
  G.npc = { gossip = { active = active, avail = avail } }
  GossipFrame:Show()
  Fire("GOSSIP_SHOW")
end
local function ACC(who) return who .. " is on, so Easy Route leaves quest accepting to it." end
local function HND(who) return who .. " is on, so Easy Route leaves handing in quests to it." end

Fresh()
local W
for norm, id in pairs(S.WantedAccepts()) do
  if not W then W = S.QuestTitle(id) end
end
local hands = {}
for n = 1, S.Count() do
  for _, e in ipairs(S.Step(n).elements) do
    local t = e.kind == "T" and e.id and e.id ~= 0 and S.QuestTitle(e.id)
    if t and S.NormTitle(t) ~= S.NormTitle(W) then
      local seen = false
      for _, h in ipairs(hands) do if h == t then seen = true end end
      if not seen then table.insert(hands, t) end
    end
  end
end
local N, F = hands[1], hands[2]
check(W ~= nil and N ~= nil and F ~= nil, "the Durotar visit has no wanted quest or fewer than two hand-ins")

-- The rules themselves, read from the tables.
NoOthers()
local o = A.Other()
check(not o.accepts and not o.handsIn and o.who == nil, "with no other addon the rules are not empty")
AutoQuest = { Settings = { followTourGuide = true } }
o = A.Other()
check(o.handsIn and not o.accepts and o.who == "AutoQuest", "AutoQuest with its defaults is read as accepts=" .. tostring(o.accepts) .. " handsIn=" .. tostring(o.handsIn))
AutoQuest.TG = {}
o = A.Other()
check(o.handsIn and o.accepts, "AutoQuest with a TourGuide is not read as accepting")
AutoQuest = { Settings = { followTourGuide = false } }
check(A.Other().accepts, "AutoQuest with followTourGuide off is not read as accepting")
AutoQuest = {}
o = A.Other()
check(o.accepts and o.handsIn, "AutoQuest with unreadable settings is not read as accepting and handing in")
AutoQuest = setmetatable({}, { __index = function() error("no reading here") end })
check(pcall(A.Other), "an AutoQuest that raises an error on reading raised it to the caller")
NoOthers()

-- a. AutoQuest with its defaults (no TourGuide): Easy Route accepts, AutoQuest hands in
Fresh()
AutoQuest = { Settings = { followTourGuide = true } }
OpenDetail(W)
Tick(0.1)
check(Calls() == "AcceptQuest", "AutoQuest defaults: the accept made the calls: " .. Calls())
Close()
check(CHAT == "accepted " .. W .. ".|", "AutoQuest defaults: the chat is '" .. CHAT .. "'")
Fresh()
AutoQuest = { Settings = { followTourGuide = true } }
Put(N, true)
OpenProgress(N)
Tick(0.1)
Close()
OpenReward(N)
Tick(0.1)
Close()
check(table.getn(G.calls) == 0, "AutoQuest defaults: a hand-in got a call: " .. Calls())
check(Occurs(CHAT, HND("AutoQuest")) == 1, "AutoQuest defaults: the hand-in line was said " .. Occurs(CHAT, HND("AutoQuest")) .. " times: '" .. CHAT .. "'")
check(Occurs(CHAT, ACC("AutoQuest")) == 0, "AutoQuest defaults: the accept line was said: '" .. CHAT .. "'")
OpenProgress(N)
Tick(0.1)
Close()
check(Occurs(CHAT, HND("AutoQuest")) == 1, "AutoQuest defaults: after two talks the hand-in line was said " .. Occurs(CHAT, HND("AutoQuest")) .. " times")
-- a gossip menu with a finished hand-in and a wanted quest: only the wanted one
Fresh()
AutoQuest = { Settings = { followTourGuide = true } }
Put(F, true)
Gossip({ { F, 1 } }, { { W, 1 } })
Tick(0.1)
Fire("GOSSIP_SHOW")
Tick(0.1)
check(Calls() == "SelectGossipAvailableQuest:1", "AutoQuest defaults: the menu made the calls: " .. Calls())
Close()
check(Occurs(CHAT, HND("AutoQuest")) == 1, "AutoQuest defaults: the menu hand-in line was said " .. Occurs(CHAT, HND("AutoQuest")) .. " times: '" .. CHAT .. "'")

-- b. AutoQuest with a TourGuide hooked: accepts left to it, said once over two talks
Fresh()
AutoQuest = { Settings = { followTourGuide = true }, TG = {} }
OpenDetail(W)
Tick(0.1)
check(table.getn(G.calls) == 0, "AutoQuest with a TourGuide: the accept got a call: " .. Calls())
Close()
OpenDetail(W)
Tick(0.1)
Close()
check(table.getn(G.calls) == 0, "AutoQuest with a TourGuide: the second talk got a call: " .. Calls())
check(Occurs(CHAT, ACC("AutoQuest")) == 1, "AutoQuest with a TourGuide: the accept line was said " .. Occurs(CHAT, ACC("AutoQuest")) .. " times: '" .. CHAT .. "'")
check(Occurs(CHAT, "accepted") == 0, "AutoQuest with a TourGuide: Easy Route said it accepted: '" .. CHAT .. "'")
Fresh()
AutoQuest = { Settings = { followTourGuide = true }, TG = {} }
Gossip({}, { { W, 1 } })
Tick(0.1)
check(table.getn(G.calls) == 0, "AutoQuest with a TourGuide: the wanted menu entry was picked: " .. Calls())
Close()
check(Occurs(CHAT, ACC("AutoQuest")) == 1, "AutoQuest with a TourGuide: the menu accept line was said " .. Occurs(CHAT, ACC("AutoQuest")) .. " times: '" .. CHAT .. "'")

-- c. AutoQuest with followTourGuide off, and with settings that cannot be read
Fresh()
AutoQuest = { Settings = { followTourGuide = false } }
OpenDetail(W)
Tick(0.1)
check(table.getn(G.calls) == 0, "AutoQuest with followTourGuide off: the accept got a call: " .. Calls())
Close()
check(Occurs(CHAT, ACC("AutoQuest")) == 1, "AutoQuest with followTourGuide off: the line was said " .. Occurs(CHAT, ACC("AutoQuest")) .. " times: '" .. CHAT .. "'")
Fresh()
AutoQuest = {}
OpenDetail(W)
Tick(0.1)
check(table.getn(G.calls) == 0, "AutoQuest with unreadable settings: the accept got a call: " .. Calls())
Close()
Put(N, true)
OpenReward(N)
Tick(0.1)
Close()
check(table.getn(G.calls) == 0, "AutoQuest with unreadable settings: the hand-in got a call: " .. Calls())
check(Occurs(CHAT, ACC("AutoQuest")) == 1 and Occurs(CHAT, HND("AutoQuest")) == 1, "AutoQuest with unreadable settings: the lines are '" .. CHAT .. "'")

-- d. Automaton with the Gossip module on: hand-ins left to it, accepts done here
Fresh()
Automaton_Gossip = {}
Automaton = { IsModuleActive = function(self, m) return m == "Gossip" end }
Put(N, true)
OpenReward(N)
Tick(0.1)
Close()
check(table.getn(G.calls) == 0, "Automaton on: the hand-in got a call: " .. Calls())
check(Occurs(CHAT, HND("Automaton")) == 1, "Automaton on: the line was said " .. Occurs(CHAT, HND("Automaton")) .. " times: '" .. CHAT .. "'")
OpenDetail(W)
Tick(0.1)
check(Calls() == "AcceptQuest", "Automaton on: the accept made the calls: " .. Calls())
Close()
-- the Gossip module off: Easy Route hands in
Fresh()
Automaton_Gossip = {}
Automaton = { IsModuleActive = function(self, m) return false end }
Put(N, true)
OpenReward(N)
Tick(0.1)
check(Calls() == "GetQuestReward:0", "Automaton with Gossip off: the hand-in made the calls: " .. Calls())
Close()
check(Occurs(CHAT, "Automaton") == 0, "Automaton with Gossip off: the chat names it: '" .. CHAT .. "'")
-- an Automaton that raises an error: no error, Easy Route hands in
Fresh()
Automaton_Gossip = {}
Automaton = { IsModuleActive = function(self, m) error("broken") end }
check(pcall(A.Other), "an Automaton that raises an error raised it to the caller")
Put(N, true)
OpenReward(N)
Tick(0.1)
check(Calls() == "GetQuestReward:0", "a broken Automaton: the hand-in made the calls: " .. Calls())
Close()
-- shapes that are not what we expect
Fresh()
Automaton_Gossip = {}
Automaton = {}
check(not A.Other().handsIn, "an Automaton without IsModuleActive counts as on")
Automaton = "text"
check(not A.Other().handsIn, "an Automaton that is a string counts as on")
Automaton = { IsModuleActive = function(self, m) return m == "Gossip" end }
Automaton_Gossip = nil
check(not A.Other().handsIn, "an Automaton without Automaton_Gossip counts as on")

-- e. FastQuest
Fresh()
FQD = { AutoComplete = true }
Put(N, true)
OpenReward(N)
Tick(0.1)
Close()
check(table.getn(G.calls) == 0, "FastQuest AutoComplete on: the hand-in got a call: " .. Calls())
check(Occurs(CHAT, HND("FastQuest")) == 1, "FastQuest AutoComplete on: the line was said " .. Occurs(CHAT, HND("FastQuest")) .. " times: '" .. CHAT .. "'")
Fresh()
FQD = { AutoComplete = false }
Put(N, true)
OpenReward(N)
Tick(0.1)
check(Calls() == "GetQuestReward:0", "FastQuest AutoComplete off: the hand-in made the calls: " .. Calls())
Close()

-- f. LazyPig alone: Easy Route does everything; another addon that took the window first leaves nothing to do
Fresh()
LPCONFIG = {}
check(not A.Other().accepts and not A.Other().handsIn, "LazyPig counts as handling something")
OpenDetail(W)
Tick(0.1)
check(Calls() == "AcceptQuest", "LazyPig alone: the accept made the calls: " .. Calls())
Close()
Put(N, true)
OpenReward(N)
Tick(0.1)
check(Calls() == "AcceptQuest,GetQuestReward:0", "LazyPig alone: the hand-in made the calls: " .. Calls())
Close()
check(Occurs(CHAT, "is on, so Easy Route leaves") == 0, "LazyPig alone: the chat says '" .. CHAT .. "'")
Fresh()
LPCONFIG = {}
OpenDetail(W)
QuestFrameDetailPanel:Hide()
Tick(0.1)
check(table.getn(G.calls) == 0, "LazyPig took the window first, yet a call was made: " .. Calls())
Close()
check(CHAT == "", "LazyPig took the window first, yet the chat says '" .. CHAT .. "'")

-- g. two addons at once: the first one named
Fresh()
AutoQuest = { Settings = { followTourGuide = true } }
FQD = { AutoComplete = true }
check(A.Other().who == "AutoQuest", "with AutoQuest and FastQuest the name is " .. tostring(A.Other().who))

-- The end: nothing left behind.
NoOthers()
S.Stop()
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
ER.db.autoOff, ER.db.autoquestOff, ER.db.automenuOff = nil, nil, nil
G.window, G.shift, G.units, G.calls, G.npc = nil, false, {}, {}, nil
G.log, G.order = {}, {}
Hide()
`, "section 26");

// 26b. Auto mode waits for AI_VoiceOver: with its option "stop the voice when the window closes" on and its voice playing, an automatic accept or
// hand-in waits for the voice (25 seconds at most, the window still open). With the option off, or a table of any other shape, one frame is enough.
console.log("26b. Auto mode waits for AI_VoiceOver");
run(SECTION_START + `
G.race, G.class, G.faction = "Orc", "WARRIOR", "Horde"
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff }
ER.db.mode, ER.db.autoNextOff = "casual", true
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)
local A = ER.Auto

local function Calls() return table.concat(G.calls, ",") end
local function Hide()
  QuestFrame:Hide()
  QuestFrameDetailPanel:Hide()
  QuestFrameProgressPanel:Hide()
  QuestFrameRewardPanel:Hide()
  GossipFrame:Hide()
end
local function NoVoice()
  VoiceOver, PLAYING = nil, nil
end
-- AI_VoiceOver as the research read it: the option in its saved profile and the sound queue.
local function VoiceWith(stop)
  VoiceOver = {
    Addon = { db = { profile = { Audio = { StopAudioOnDisengage = stop } } } },
    SoundQueue = { IsPlaying = function(self) return PLAYING end },
  }
end
local function Fresh()
  S.Stop()
  Tick(2)
  NoVoice()
  G.level, G.taxi, G.dead = 1, false, false
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  ER.db.autoOff, ER.db.autoquestOff, ER.db.automenuOff = nil, nil, nil
  G.calls, G.window, G.shift, G.units, G.npc = {}, nil, false, {}, nil
  Hide()
  Tick(2)
  G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
  check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
  Tick(2)
  CHAT = ""
end
local function Put(title, complete)
  G.log[title] = { complete = complete, objs = {} }
  table.insert(G.order, title)
end
local function Close()
  Hide()
  Tick(1.2)
end
local function OpenDetail(title)
  G.window = { title = title }
  QuestFrame:Show()
  QuestFrameDetailPanel:Show()
  Fire("QUEST_DETAIL")
end
local function OpenProgress(title)
  G.window = { title = title, completable = true }
  QuestFrame:Show()
  QuestFrameProgressPanel:Show()
  Fire("QUEST_PROGRESS")
end
local function OpenReward(title)
  G.window = { title = title, choices = 0 }
  QuestFrame:Show()
  QuestFrameProgressPanel:Hide()
  QuestFrameRewardPanel:Show()
  Fire("QUEST_COMPLETE")
end
local function Wait(times)
  for i = 1, times do Tick(0.1) end
end

Fresh()
local W
for norm, id in pairs(S.WantedAccepts()) do
  if not W then W = S.QuestTitle(id) end
end
local N
for n = 1, S.Count() do
  for _, e in ipairs(S.Step(n).elements) do
    local t = e.kind == "T" and e.id and e.id ~= 0 and S.QuestTitle(e.id)
    if t and not N and S.NormTitle(t) ~= S.NormTitle(W) then N = t end
  end
end
check(W ~= nil and N ~= nil, "the Durotar visit has no wanted quest or no hand-in")

-- The answer itself.
NoVoice()
check(A.VoiceQuiet() == true, "with no VoiceOver the answer is not 'quiet'")
VoiceWith(true)
PLAYING = true
check(A.VoiceQuiet() == false, "option on and the voice playing: the answer is 'quiet'")
PLAYING = false
check(A.VoiceQuiet() == true, "option on and the voice stopped: the answer is not 'quiet'")
VoiceWith(false)
PLAYING = true
check(A.VoiceQuiet() == true, "option off and the voice playing: the answer is not 'quiet'")
NoVoice()

-- a. option on, voice playing: no accept for a second, no chat line; the voice stops, one frame later one accept
Fresh()
VoiceWith(true)
PLAYING = true
OpenDetail(W)
Wait(10)
check(table.getn(G.calls) == 0, "the voice played, yet a call was made: " .. Calls())
check(CHAT == "", "while waiting the chat says '" .. CHAT .. "'")
PLAYING = false
Tick(0.1)
check(Calls() == "AcceptQuest", "after the voice stopped the calls are: " .. Calls())
Close()
check(CHAT == "accepted " .. W .. ".|", "after the wait the chat is '" .. CHAT .. "'")

-- b. the voice never stops: one accept at the 25-second cap, not before, the window still shown
Fresh()
VoiceWith(true)
PLAYING = true
OpenDetail(W)
Tick(0.1)
Tick(24)
check(table.getn(G.calls) == 0, "24 seconds in, with the voice playing, a call was made: " .. Calls())
Tick(2)
check(Calls() == "AcceptQuest", "after the cap the calls are: " .. Calls())
Close()
Fresh()
VoiceWith(true)
PLAYING = true
OpenDetail(W)
Tick(26)
check(Calls() == "AcceptQuest", "one jump of 26 seconds made the calls: " .. Calls())
Close()

-- c. the window closes while waiting: nothing is accepted, the queue is empty and the next talk works
Fresh()
VoiceWith(true)
PLAYING = true
OpenDetail(W)
Wait(3)
Hide()
Tick(26)
check(table.getn(G.calls) == 0, "the window was closed, yet a call was made: " .. Calls())
check(CHAT == "", "the window was closed, yet the chat says '" .. CHAT .. "'")
Tick(1.2)
PLAYING = false
OpenDetail(W)
Tick(0.1)
check(Calls() == "AcceptQuest", "the next talk after a closed window made the calls: " .. Calls())
Close()

-- d. the option off (its default): the one-frame wait is enough, whatever the voice does
Fresh()
VoiceWith(false)
PLAYING = true
OpenDetail(W)
Tick(0.1)
check(Calls() == "AcceptQuest", "option off: the calls are: " .. Calls())
Close()
Fresh()
VoiceWith(nil)
PLAYING = true
OpenDetail(W)
Tick(0.1)
check(Calls() == "AcceptQuest", "option not set: the calls are: " .. Calls())
Close()

-- e. tables of any other shape: no error, one frame is enough
local shapes = {
  { "an empty VoiceOver", function() VoiceOver = {} end },
  { "VoiceOver without a queue", function() VoiceOver = { Addon = { db = { profile = { Audio = { StopAudioOnDisengage = true } } } } } end },
  { "VoiceOver without a profile", function() VoiceOver = { Addon = { db = {} } } end },
  { "VoiceOver that is a string", function() VoiceOver = "text" end },
  { "a queue that raises an error", function()
      VoiceWith(true)
      VoiceOver.SoundQueue.IsPlaying = function(self) error("broken") end
    end },
}
for _, shape in ipairs(shapes) do
  Fresh()
  shape[2]()
  check(pcall(A.VoiceQuiet), shape[1] .. ": the answer raised an error")
  check(A.VoiceQuiet() == true, shape[1] .. ": the answer is not 'quiet'")
  OpenDetail(W)
  Tick(0.1)
  check(Calls() == "AcceptQuest", shape[1] .. ": the calls are: " .. Calls())
  Close()
end

-- f. hand-ins wait the same way: the reward window and the progress window
Fresh()
VoiceWith(true)
PLAYING = true
Put(N, true)
OpenReward(N)
Wait(10)
check(table.getn(G.calls) == 0, "the voice played, yet the hand-in got a call: " .. Calls())
check(CHAT == "", "while waiting for a hand-in the chat says '" .. CHAT .. "'")
PLAYING = false
Tick(0.1)
check(Calls() == "GetQuestReward:0", "after the voice stopped the hand-in made the calls: " .. Calls())
Close()
Fresh()
VoiceWith(true)
PLAYING = true
Put(N, true)
OpenProgress(N)
Wait(10)
check(table.getn(G.calls) == 0, "the voice played, yet the progress window got a call: " .. Calls())
PLAYING = false
Tick(0.1)
check(Calls() == "CompleteQuest", "after the voice stopped the progress window made the calls: " .. Calls())
Close()

-- g. a second action waits behind the first: a menu pick queued while an accept waits for the voice
Fresh()
VoiceWith(true)
PLAYING = true
OpenDetail(W)
Wait(3)
G.npc = { gossip = { active = {}, avail = { { W, 1 } } } }
GossipFrame:Show()
Fire("GOSSIP_SHOW")
Wait(3)
check(table.getn(G.calls) == 0, "two waiting actions: a call was made: " .. Calls())
PLAYING = false
Tick(0.1)
check(Calls() == "AcceptQuest", "two waiting actions: the first made the calls: " .. Calls())
Tick(0.1)
check(Calls() == "AcceptQuest,SelectGossipAvailableQuest:1", "two waiting actions: the second made the calls: " .. Calls())
Close()

-- The end: nothing left behind.
NoVoice()
S.Stop()
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
ER.db.autoOff, ER.db.autoquestOff, ER.db.automenuOff = nil, nil, nil
G.window, G.shift, G.units, G.calls, G.npc = nil, false, {}, {}, nil
G.log, G.order = {}, {}
Hide()
`, "section 26b");

// 27. Auto mode takes the flight on a fly step and sets the hearthstone on its step: the flight map opens on an open fly line and, one frame later,
// the one reachable place that fits the line's words is taken when the money is there; the innkeeper's option and the confirm popup are used only on
// a set-hearthstone line, at its inn and for its town. Anything else gets one plain line or nothing.
console.log("27. Auto mode takes the flight and sets the hearthstone on their steps");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level }
ER.db.mode, ER.db.autoNextOff = "hard", true

local function Calls() return table.concat(G.calls, ",") end
local function Hide()
  QuestFrame:Hide()
  QuestFrameGreetingPanel:Hide()
  GossipFrame:Hide()
  TaxiFrame:Hide()
  MerchantFrame:Hide()
end
local function Reset()
  Hide()
  G.calls, G.window, G.shift, G.npc, G.taxi, G.units = {}, nil, false, nil, false, {}
  G.nodes, G.money, G.bind = nil, nil, "Northshire Abbey"
  ER.db.autoOff, ER.db.autoflightOff, ER.db.autoinnOff, ER.db.automenuOff = nil, nil, nil, nil
  Tick(2)
  CHAT = ""
end
local function Said(text) return string.find(CHAT, text, 1, true) ~= nil end
local function Gossip(options)
  G.npc = { gossip = { active = {}, avail = {}, options = options } }
  GossipFrame:Show()
  Fire("GOSSIP_SHOW")
end

-- The Orc's first Durotar step is no fly step: the flight map and the flight master's menu do nothing there.
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 1
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)
Reset()
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
G.log, G.order, G.bags = {}, {}, {}
G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
Tick(2)
CHAT = ""
check(table.getn(S.OpenElements("F")) == 0, "the first Durotar step has an open fly line")
G.nodes, G.money = { { "Orgrimmar, Durotar", "REACHABLE", 50 } }, 1000
TaxiFrame:Show()
Fire("TAXIMAP_OPENED")
Tick(0.1)
TaxiFrame:Hide()
Tick(1.2)
check(table.getn(G.calls) == 0, "no fly step, yet the flight map made the calls: " .. Calls())
check(CHAT == "", "no fly step, yet the chat says '" .. CHAT .. "'")
Reset()
Gossip({ { "Show me where I can fly.", "taxi" } })
Tick(0.1)
check(table.getn(G.calls) == 0, "no fly step, yet the flight master's menu made the calls: " .. Calls())
Reset()
S.Stop()

-- The Human Redridge Mountains visit starts with the flight "Fly from Sentinel Hill to Stormwind." at Westfall.
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 1
local red
for _, info in ipairs(ER.RouteGuides()) do
  if info.visit.zone == "Redridge Mountains" then red = info end
end
check(red ~= nil, "the Human path has no Redridge Mountains visit")
local function Nodes(stormwind)
  return { { "Sentinel Hill, Westfall", "CURRENT", 0 }, { "Stormwind, Elwynn Forest", stormwind or "REACHABLE", 50 }, { "Darkshire, Duskwood", "NONE", 0 } }
end
local function StartFlight()
  Reset()
  S.Stop()
  Tick(2)
  ER.db.flightPaths = nil
  ER.db.guides, ER.db.done = {}, {}
  G.log, G.order, G.bags = {}, {}, {}
  G.zone, G.x, G.y = "Westfall", 56.55, 52.64
  check(S.Load(S.Key(red), true), "the Redridge Mountains visit did not load")
  Tick(2)
  CHAT = ""
end
local function OpenMap(nodes, money)
  G.nodes, G.money = nodes, money
  TaxiFrame:Show()
  Fire("TAXIMAP_OPENED")
end

-- a. the flight map opens on the fly step: one frame later the flight to the step's town is taken, said in one line
StartFlight()
check(table.getn(S.OpenElements("F")) == 1, "the first Redridge step has no open fly line")
OpenMap(Nodes(), 1000)
check(table.getn(G.calls) == 0, "the flight was taken in the same frame as the event: " .. Calls())
Tick(0.1)
check(Calls() == "TakeTaxiNode:2", "the flight map made the calls: " .. Calls())
Hide()
Tick(1.2)
check(Said("taking the flight to Stormwind."), "the chat does not say the flight: " .. CHAT)
check(not Said("handed in") and not Said("accepted"), "the flight line says more than the flight: " .. CHAT)

-- b. a place you cannot fly to yet: one line, no flight
for _, kind in ipairs({ "NONE", "DISTANT" }) do
  StartFlight()
  OpenMap(Nodes(kind), 1000)
  Tick(0.1)
  check(table.getn(G.calls) == 0, "Stormwind " .. kind .. ", yet the calls were: " .. Calls())
  check(Said("You do not have that flight path yet."), "Stormwind " .. kind .. ": the chat says '" .. CHAT .. "'")
end

-- c. too little money: one line, no flight
StartFlight()
OpenMap(Nodes(), 10)
Tick(0.1)
check(table.getn(G.calls) == 0, "10 copper for a 50 copper flight, yet the calls were: " .. Calls())
check(Said("You do not have enough money for that flight."), "too little money: the chat says '" .. CHAT .. "'")
StartFlight()
OpenMap(Nodes(), 50)
Tick(0.1)
check(Calls() == "TakeTaxiNode:2", "exactly enough money made the calls: " .. Calls())

-- d. two places fit equally well: the player picks
StartFlight()
OpenMap({ { "Sentinel Hill, Westfall", "CURRENT", 0 }, { "Stormwind, Elwynn Forest", "REACHABLE", 50 }, { "Stormwind, Stormwind City", "REACHABLE", 50 } }, 1000)
Tick(0.1)
check(table.getn(G.calls) == 0, "two equal places, yet the calls were: " .. Calls())
check(Said("Pick the flight yourself: more than one place matches Stormwind."), "two equal places: the chat says '" .. CHAT .. "'")
-- a place you cannot reach and a name that only contains the town do not count; one that starts with it does
StartFlight()
OpenMap({ { "Sentinel Hill, Westfall", "CURRENT", 0 }, { "Stormwind, Elwynn Forest", "NONE", 50 }, { "Old Stormwind Keep, Elwynn Forest", "REACHABLE", 50 },
  { "Stormwind Harbor, Stormwind City", "REACHABLE", 50 } }, 1000)
Tick(0.1)
check(Calls() == "TakeTaxiNode:4", "a place you cannot reach, a name that only contains it and one that starts with it: " .. Calls() .. " / " .. CHAT)

-- e. Shift, the ticks, a closed map
StartFlight()
G.shift = true
OpenMap(Nodes(), 1000)
G.shift = false
Tick(0.1)
check(table.getn(G.calls) == 0, "Shift at the flight map, yet the calls were: " .. Calls())
StartFlight()
ER.db.autoflightOff = true
OpenMap(Nodes(), 1000)
Tick(0.1)
check(table.getn(G.calls) == 0 and CHAT == "", "the flight tick is off, yet: " .. Calls() .. " / " .. CHAT)
StartFlight()
ER.db.autoOff = true
OpenMap(Nodes(), 1000)
Tick(0.1)
check(table.getn(G.calls) == 0 and CHAT == "", "auto mode is off, yet: " .. Calls() .. " / " .. CHAT)
StartFlight()
OpenMap(Nodes(), 1000)
TaxiFrame:Hide()
Tick(0.1)
check(table.getn(G.calls) == 0, "the map closed before the flight, yet the calls were: " .. Calls())
StartFlight()
OpenMap(Nodes(), 1000)
G.nodes = { { "Sentinel Hill, Westfall", "CURRENT", 0 }, { "Darkshire, Duskwood", "REACHABLE", 50 }, { "Stormwind, Elwynn Forest", "REACHABLE", 50 } }
Tick(0.1)
check(table.getn(G.calls) == 0, "the map changed before the flight, yet the calls were: " .. Calls())

-- f. the keys of a made-up RestedXP step
local rxp = { elements = { { kind = "F", dest = "Auberdine", text = "Fly to Darkshore" } } }
local keys = ER.Auto.FlightKeys(rxp)
check(table.getn(keys) == 2 and keys[1] == "Darkshore" and keys[2] == "Auberdine", "the keys of the RestedXP step: " .. table.concat(keys, "|"))
G.nodes = { { "Auberdine, Darkshore", "REACHABLE", 0 } }
local at, name, town = ER.Auto.PickNode(keys)
check(at == 1 and name == "Auberdine, Darkshore" and town == "Auberdine", "the node of the RestedXP step: " .. tostring(at) .. " " .. tostring(name) .. " " .. tostring(town))
keys = ER.Auto.FlightKeys({ elements = { { kind = "I", text = "Take the flight path to Menethil Harbor." }, { kind = "F", dest = "Wetlands" } } })
check(keys[1] == "Menethil Harbor" and keys[2] == "Wetlands", "the keys of the flight path words: " .. table.concat(keys, "|"))
G.nodes = { { "Menethil Harbor, Wetlands", "REACHABLE", 0 }, { "Dun Agrath, Wetlands", "REACHABLE", 0 } }
at = ER.Auto.PickNode(keys)
check(at == 1, "the words come before the place: " .. tostring(at))
at = ER.Auto.PickNode({ "Wetlands" })
check(at == nil, "two nodes in one zone for a zone key were not a tie")
G.nodes = nil

-- g. the flight master's menu: the flight option, on a fly step, with no quest line to pick
StartFlight()
Gossip({ { "Show me where I can fly.", "taxi" }, { "Let me browse your goods.", "vendor" } })
Tick(0.1)
check(Calls() == "SelectGossipOption:1", "the flight option made the calls: " .. Calls())
Hide()
Tick(1.2)
StartFlight()
ER.db.autoflightOff = true
Gossip({ { "Show me where I can fly.", "taxi" } })
Tick(0.1)
check(table.getn(G.calls) == 0, "the flight tick is off, yet the menu made the calls: " .. Calls())
StartFlight()
G.shift = true
Gossip({ { "Show me where I can fly.", "taxi" } })
G.shift = false
Tick(0.1)
check(table.getn(G.calls) == 0, "Shift at the menu, yet the calls were: " .. Calls())
StartFlight()
Gossip({ { "Let me browse your goods.", "vendor" }, { "Train me.", "trainer" } })
Tick(0.1)
check(table.getn(G.calls) == 0, "vendor and trainer options, yet the calls were: " .. Calls())
S.Stop()

-- g2. only the CURRENT step flies. A fly step that is only a side step, with a "Get the flight path" step (or any other step) as the
-- current one, takes no flight: opening the map just to learn the flight path must not fly you away.
StartFlight()
local flyStep = S.Current()
local sideFly = { n = 998, elements = { { kind = "F", dest = "Darkshire", text = "Fly to Darkshire" } } }
local getFp = { n = 999, elements = { { kind = "G", zone = "Westfall", x = 56.5, y = 52.6 }, { kind = "P", text = "Sentinel Hill" } } }
local walkOn = { n = 997, elements = { { kind = "I", text = "Walk to the road." } } }
local realCurrent, realOpen = S.Current, S.OpenElements
local function Stub(current, open)
  S.Current = function() return current end
  S.OpenElements = function(kind)
    local out = {}
    if kind == "F" then
      for _, step in ipairs(open) do
        for _, e in ipairs(step.elements) do
          if e.kind == "F" then table.insert(out, { step = step, e = e }) end
        end
      end
    end
    return out
  end
end
local function Unstub() S.Current, S.OpenElements = realCurrent, realOpen end
local FLYNODES = { { "Sentinel Hill, Westfall", "CURRENT", 0 }, { "Stormwind, Elwynn Forest", "REACHABLE", 50 }, { "Darkshire, Duskwood", "REACHABLE", 50 } }
Stub(getFp, { sideFly })
OpenMap(FLYNODES, 1000)
Tick(0.1)
check(table.getn(G.calls) == 0, "a Get the flight path step is current and a fly step is a side step, yet the calls were: " .. Calls())
check(not Said("taking the flight"), "the side fly step: the chat says '" .. CHAT .. "'")
Unstub()
StartFlight()
Stub(walkOn, { sideFly })
OpenMap(FLYNODES, 1000)
Tick(0.1)
check(table.getn(G.calls) == 0, "a step that is no fly step is current and a fly step is a side step, yet the calls were: " .. Calls())
Unstub()
-- a fly step that is current still flies, to its own place and not to the side step's
StartFlight()
Stub(flyStep, { sideFly, flyStep })
OpenMap(FLYNODES, 1000)
Tick(0.1)
check(Calls() == "TakeTaxiNode:2", "the current fly step beside a side fly step made the calls: " .. Calls())
Unstub()
S.Stop()

-- The innkeeper: a RestedXP step that sets the hearthstone to Goldshire.
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 6
local elwynn
for _, g in ipairs(S.Guides()) do
  if g.name == "6-11 Elwynn Forest" then elwynn = g end
end
check(elwynn ~= nil, "no 6-11 Elwynn Forest guide")
local function StartInn(n)
  Reset()
  S.Stop()
  Tick(2)
  ER.db.guides, ER.db.done = {}, {}
  G.log, G.order, G.bags = {}, {}, {}
  G.zone, G.x, G.y = "Elwynn Forest", 42, 65
  check(S.Load(S.Key(elwynn), true), "the Elwynn Forest guide did not load")
  S.Jump(n)
  Tick(2)
  CHAT = ""
end
local innStep, plainStep, gz, gx, gy
Reset()
S.Stop()
ER.db.guides, ER.db.done = {}, {}
check(S.Load(S.Key(elwynn), true), "the Elwynn Forest guide did not load")
for n = 1, S.Count() do
  local step = S.Step(n)
  local last, bind
  for _, e in ipairs(step.elements) do
    if e.kind == "G" then last = e end
    if e.kind == "B" and e.text and string.find(e.text, "Goldshire", 1, true) then bind = e end
  end
  if bind and last and not innStep then innStep, gz, gx, gy = n, last.zone, last.x, last.y end
end
check(innStep ~= nil, "no step sets the hearthstone to Goldshire")
StartInn(innStep)
plainStep = 2
check(S.Current() and S.Position() == innStep, "the guide is at step " .. tostring(S.Position()) .. " and not at the inn step " .. tostring(innStep))
check(table.getn(S.OpenElements("B")) == 1, "the inn step has " .. table.getn(S.OpenElements("B")) .. " open set-hearthstone lines")
local OPTIONS = { { "Make this inn your home.", "binder" }, { "Let me browse your goods.", "vendor" } }

-- h. at the inn: the option is picked, the popup for Goldshire is answered, one line says it
G.zone, G.x, G.y = gz, gx, gy
Tick(0.2)
Gossip(OPTIONS)
Tick(0.1)
check(Calls() == "SelectGossipOption:1", "the inn option made the calls: " .. Calls())
Fire("CONFIRM_BINDER", "Goldshire")
Tick(0.1)
check(Calls() == "SelectGossipOption:1,ConfirmBinder,StaticPopup_Hide:CONFIRM_BINDER", "the popup made the calls: " .. Calls())
Hide()
Tick(1.2)
check(Said("hearthstone set to Goldshire."), "the chat does not say the hearthstone: " .. CHAT)

-- i. not at the inn: no option; the popup of another town: nothing
StartInn(innStep)
G.zone, G.x, G.y = gz, gx + 20, gy
Tick(0.2)
local yards = S.DistanceTo(gz, gx + 20, gy) and S.DistanceTo(gz, gx, gy)
check(yards and yards > ER.Auto.N.BIND_YARDS, "the far place is only " .. tostring(yards) .. " yards from the inn")
Gossip(OPTIONS)
Tick(0.1)
check(table.getn(G.calls) == 0, "far from the inn, yet the menu made the calls: " .. Calls())
StartInn(innStep)
G.zone, G.x, G.y = gz, gx, gy
Tick(0.2)
Fire("CONFIRM_BINDER", "Stormwind City")
Tick(0.1)
check(table.getn(G.calls) == 0, "the popup for Stormwind City on the Goldshire step made the calls: " .. Calls())
StartInn(plainStep)
check(table.getn(S.OpenElements("B")) == 0, "step " .. plainStep .. " has an open set-hearthstone line")
G.zone, G.x, G.y = gz, gx, gy
Tick(0.2)
Gossip(OPTIONS)
Tick(0.1)
Fire("CONFIRM_BINDER", "Goldshire")
Tick(0.1)
check(table.getn(G.calls) == 0, "no set-hearthstone line, yet the calls were: " .. Calls())
StartInn(innStep)
ER.db.autoinnOff = true
G.zone, G.x, G.y = gz, gx, gy
Tick(0.2)
Gossip(OPTIONS)
Tick(0.1)
Fire("CONFIRM_BINDER", "Goldshire")
Tick(0.1)
check(table.getn(G.calls) == 0, "the inn tick is off, yet the calls were: " .. Calls())
StartInn(innStep)
G.zone, G.x, G.y = gz, gx, gy
Tick(0.2)
G.shift = true
Gossip(OPTIONS)
Fire("CONFIRM_BINDER", "Goldshire")
G.shift = false
Tick(0.1)
check(table.getn(G.calls) == 0, "Shift at the inn, yet the calls were: " .. Calls())
StartInn(innStep)
G.zone, G.x, G.y = gz, gx, gy
Tick(0.2)
Gossip({ { "Let me browse your goods.", "vendor" } })
Tick(0.1)
check(table.getn(G.calls) == 0, "only a vendor option, yet the calls were: " .. Calls())
-- the popup answered once in one talk
StartInn(innStep)
G.zone, G.x, G.y = gz, gx, gy
Tick(0.2)
Fire("CONFIRM_BINDER", "Goldshire")
Fire("CONFIRM_BINDER", "Goldshire")
Tick(0.1)
Tick(0.1)
check(Calls() == "ConfirmBinder,StaticPopup_Hide:CONFIRM_BINDER", "the popup twice made the calls: " .. Calls())

-- The end: nothing left behind.
Reset()
S.Stop()
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.level = was.level
G.nodes, G.money, G.npc, G.taxi, G.bind = nil, nil, nil, false, "Northshire Abbey"
G.log, G.order = {}, {}
Hide()
`, "section 27");

// 28. Auto mode sells grey items and repairs: at a vendor, items whose link is grey are sold one at a time (never a white, locked or quest item, each
// slot once), then the repair is paid only when a tenth of the money stays. One chat line says it; closing the vendor, Shift and the ticks stop it.
console.log("28. Auto mode sells grey items and repairs");
run(SECTION_START + `
local A = ER.Auto
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level }
ER.db.mode, ER.db.autoNextOff = "hard", true
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 6

local function Calls() return table.concat(G.calls, ",") end
local function Hide()
  QuestFrame:Hide()
  QuestFrameGreetingPanel:Hide()
  GossipFrame:Hide()
  TaxiFrame:Hide()
  MerchantFrame:Hide()
end
local function Reset()
  Hide()
  Tick(2)
  G.calls, G.window, G.shift, G.npc, G.taxi, G.units = {}, nil, false, nil, false, {}
  G.stuff, G.money, G.repairCost, G.canRepair = nil, nil, nil, nil
  G.log, G.order, G.bags = {}, {}, {}
  GetNumQuestLeaderBoards = nil
  ER.db.autoOff, ER.db.autosellOff = nil, nil
  S.Stop()
  Tick(2)
  CHAT = ""
end
local function Said(text) return string.find(CHAT, text, 1, true) ~= nil end
local function Sold() -- how many UseContainerItem calls
  local n = 0
  for _, c in ipairs(G.calls) do
    if string.find(c, "UseContainerItem:", 1, true) then n = n + 1 end
  end
  return n
end
local function Visit()
  MerchantFrame:Show()
  Fire("MERCHANT_SHOW")
end
local function Leave()
  MerchantFrame:Hide()
  Fire("MERCHANT_CLOSED")
  Tick(1.2)
end
-- n grey items of 1 copper in bag 0 (slots 1 to n) and nothing else.
local function Greys(n, price)
  G.stuff = { [0] = { size = 16 }, [1] = { size = 16 }, [2] = { size = 16 } }
  for i = 1, n do
    G.stuff[math.floor((i - 1) / 16)][math.mod(i - 1, 16) + 1] = { id = 1000 + i, name = "Junk " .. i, grey = true, count = 1, price = price or 1 }
  end
end

-- Money text.
check(A.Money(0) == "0 copper", "0 copper reads '" .. A.Money(0) .. "'")
check(A.Money(99) == "99 copper", "99 copper reads '" .. A.Money(99) .. "'")
check(A.Money(125) == "1 silver 25 copper", "125 reads '" .. A.Money(125) .. "'")
check(A.Money(900) == "9 silver", "900 reads '" .. A.Money(900) .. "'")
check(A.Money(10101) == "1 gold 1 silver 1 copper", "10101 reads '" .. A.Money(10101) .. "'")
check(A.Money(20000) == "2 gold", "20000 reads '" .. A.Money(20000) .. "'")

-- a. 30 grey items among a white one, three white ones, a locked grey one and a grey one a quest asks for
Reset()
G.stuff = { [0] = { size = 16 }, [1] = { size = 16 }, [2] = { size = 16 } }
local greySlots, keepSlots = {}, {}
local n = 0
for bag = 0, 2 do
  for slot = 1, 16 do
    n = n + 1
    local it
    if n <= 30 then
      it = { id = 1000 + n, name = "Junk " .. n, grey = true, count = 1, price = 1 }
      greySlots["UseContainerItem:" .. bag .. ":" .. slot] = true
    elseif n <= 33 then
      it = { id = 2000 + n, name = "Linen " .. n, grey = false, count = 5, price = 50 }
      keepSlots["UseContainerItem:" .. bag .. ":" .. slot] = "white"
    elseif n == 34 then
      it = { id = 3000, name = "Locked Junk", grey = true, count = 1, price = 7, locked = true }
      keepSlots["UseContainerItem:" .. bag .. ":" .. slot] = "locked"
    elseif n == 35 then
      it = { id = 3001, name = "Thing 1", grey = true, count = 1, price = 9 }
      keepSlots["UseContainerItem:" .. bag .. ":" .. slot] = "quest"
    end
    G.stuff[bag][slot] = it
  end
end
G.log["A Quest"] = { complete = false, objs = {} }
table.insert(G.order, "A Quest")
GetNumQuestLeaderBoards = function() return 1 end
G.money, G.repairCost = 1000, 0
Visit()
Tick(0.1)
check(Sold() == 1, "the first tick made " .. Sold() .. " sales")
Tick(0.05)
check(Sold() == 1, "half a tick later there were " .. Sold() .. " sales")
for i = 1, 40 do Tick(0.1) end
check(Sold() == 30, "the visit made " .. Sold() .. " sales")
local seen, twice = {}, nil
for _, c in ipairs(G.calls) do
  if seen[c] then twice = c end
  seen[c] = true
  check(greySlots[c], "a slot that is not a plain grey item was used: " .. c .. " " .. tostring(keepSlots[c]))
end
check(not twice, "the slot " .. tostring(twice) .. " was used twice")
check(table.getn(G.calls) == 30, "other calls were made: " .. Calls())
check(CHAT == "", "the chat said '" .. CHAT .. "' before the visit was over")
Tick(0.6)
Leave()
check(CHAT == "sold 30 grey items for 30 copper.|", "the chat says '" .. CHAT .. "'")
check(table.getn(G.calls) == 30, "after the visit the calls were: " .. Calls())
check(G.money == 1030, "the money is " .. tostring(G.money))
GetNumQuestLeaderBoards = nil

-- b. one grey item worth 125
Reset()
Greys(1, 125)
G.money = 1000
Visit()
for i = 1, 8 do Tick(0.1) end
Tick(0.6)
Leave()
check(CHAT == "sold 1 grey item for 1 silver 25 copper.|", "one grey item: the chat says '" .. CHAT .. "'")

-- c. repair only
Reset()
G.stuff = { [0] = { size = 16 } }
G.money, G.repairCost = 1000, 900
Visit()
Tick(0.1)
Tick(0.6)
Leave()
check(Calls() == "RepairAllItems", "repairing 900 of 1000 made the calls: " .. Calls())
check(CHAT == "repaired for 9 silver.|", "repairing 900 of 1000: the chat says '" .. CHAT .. "'")
Reset()
G.stuff = { [0] = { size = 16 } }
G.money, G.repairCost = 1000, 910
Visit()
Tick(0.1)
Tick(0.6)
Leave()
check(table.getn(G.calls) == 0, "repairing 910 of 1000 made the calls: " .. Calls())
check(CHAT == "not repaired: it costs 9 silver 10 copper, more than you can spare.|", "repairing 910 of 1000: the chat says '" .. CHAT .. "'")
Reset()
G.stuff = { [0] = { size = 16 } }
G.money, G.repairCost, G.canRepair = 1000, 100, false
Visit()
Tick(0.1)
Tick(0.6)
Leave()
check(table.getn(G.calls) == 0 and CHAT == "", "a vendor who does not repair: " .. Calls() .. " / " .. CHAT)
Reset()
G.stuff = { [0] = { size = 16 } }
G.money, G.repairCost = 0, 5
Visit()
Tick(0.1)
Tick(0.6)
Leave()
check(table.getn(G.calls) == 0, "repairing with no money made the calls: " .. Calls())

-- d. grey items and a repair in one visit: one line
Reset()
Greys(2, 1)
G.money, G.repairCost = 1000, 35
Visit()
for i = 1, 5 do Tick(0.1) end
Tick(0.6)
Leave()
check(Calls() == "UseContainerItem:0:1,UseContainerItem:0:2,RepairAllItems", "grey items and a repair made the calls: " .. Calls())
check(CHAT == "sold 2 grey items for 2 copper, repaired for 35 copper.|", "grey items and a repair: the chat says '" .. CHAT .. "'")

-- e. the vendor closes after 5 sales: no more, and the line counts only the items the vendor really took (one of the 5 was refused)
Reset()
Greys(30, 1)
G.stuff[0][3].refuse = true
G.money = 1000
Visit()
for i = 1, 5 do Tick(0.1) end
check(Sold() == 5, "5 ticks made " .. Sold() .. " sales")
MerchantFrame:Hide()
Fire("MERCHANT_CLOSED")
for i = 1, 20 do Tick(0.1) end
check(Sold() == 5, "after the vendor closed there were " .. Sold() .. " sales")
Tick(1.2)
check(not Said("repaired"), "the closed visit repaired: " .. CHAT)
check(CHAT == "sold 4 grey items for 4 copper.|", "the vendor closed mid-sale: the chat says '" .. CHAT .. "'")

-- e2. a vendor who will not buy an item: its slot is tried once and not again
Reset()
Greys(3, 1)
G.stuff[0][2].refuse = true
G.money = 1000
Visit()
for i = 1, 20 do Tick(0.1) end
Tick(0.6)
Leave()
check(Calls() == "UseContainerItem:0:1,UseContainerItem:0:2,UseContainerItem:0:3", "a vendor who refuses one item: the calls were " .. Calls())
check(CHAT == "sold 2 grey items for 2 copper.|", "a vendor who refuses one item: the chat says '" .. CHAT .. "'")

-- f. Shift and the ticks
Reset()
Greys(3, 1)
G.money, G.repairCost = 1000, 100
G.shift = true
Visit()
G.shift = false
for i = 1, 10 do Tick(0.1) end
Tick(0.6)
Leave()
check(table.getn(G.calls) == 0 and CHAT == "", "Shift at the vendor: " .. Calls() .. " / " .. CHAT)
Reset()
Greys(3, 1)
G.money, G.repairCost = 1000, 100
ER.db.autosellOff = true
Visit()
for i = 1, 10 do Tick(0.1) end
Tick(0.6)
Leave()
check(table.getn(G.calls) == 0 and CHAT == "", "the sell tick is off: " .. Calls() .. " / " .. CHAT)
Reset()
Greys(3, 1)
G.money, G.repairCost = 1000, 100
ER.db.autoOff = true
Visit()
for i = 1, 10 do Tick(0.1) end
Tick(0.6)
Leave()
check(table.getn(G.calls) == 0 and CHAT == "", "auto mode is off: " .. Calls() .. " / " .. CHAT)
-- Shift held in the middle of a visit stops it
Reset()
Greys(10, 1)
G.money, G.repairCost = 1000, 100
Visit()
for i = 1, 3 do Tick(0.1) end
G.shift = true
for i = 1, 10 do Tick(0.1) end
G.shift = false
Tick(0.6)
Leave()
check(Sold() == 3 and not string.find(Calls(), "RepairAllItems", 1, true), "Shift in the middle of a visit: " .. Calls())
-- the tick turned off in the middle of a visit stops it
Reset()
Greys(10, 1)
G.money = 1000
Visit()
for i = 1, 3 do Tick(0.1) end
ER.db.autosellOff = true
for i = 1, 10 do Tick(0.1) end
check(Sold() == 3, "the sell tick turned off in the middle of a visit: " .. Sold() .. " sales")

-- g. grey is told by the link colour alone (the game's quality number is -1 for every item here)
Reset()
G.stuff = { [0] = { size = 16, { id = 1, name = "Grey", grey = true, count = 1, price = 1 }, { id = 2, name = "White", grey = false, count = 1, price = 1 } } }
check(A.IsGrey(0, 1) == true, "a grey link is not grey")
check(A.IsGrey(0, 2) == false, "a white link is grey")
check(A.IsGrey(0, 3) == false, "an empty slot is grey")
local _, _, _, quality = GetContainerItemInfo(0, 1)
check(quality == -1, "the pretend quality of a grey item is " .. tostring(quality))

-- h. an item a line of the guide asks for is kept
local elwynn
for _, g in ipairs(S.Guides()) do
  if g.name == "6-11 Elwynn Forest" then elwynn = g end
end
check(elwynn ~= nil, "no 6-11 Elwynn Forest guide")
Reset()
check(S.Load(S.Key(elwynn), true), "the Elwynn Forest guide did not load")
local kStep, kItem
for i = 1, S.Count() do
  for _, e in ipairs(S.Step(i).elements) do
    if e.kind == "K" and e.item and e.item ~= 0 and not kStep then kStep, kItem = i, e.item end
  end
end
check(kStep ~= nil, "no K line in the Elwynn Forest guide")
S.Jump(kStep)
Tick(2)
check(table.getn(S.OpenElements("K")) >= 1, "the K step has no open K line")
G.stuff = { [0] = { size = 16, { id = kItem, name = "Wanted Thing", grey = true, count = 1, price = 4 }, { id = 77777, name = "Other Junk", grey = true, count = 1, price = 4 } } }
G.money = 1000
Visit()
for i = 1, 6 do Tick(0.1) end
Tick(0.6)
Leave()
check(Calls() == "UseContainerItem:0:2", "an item of an open K line: the calls were " .. Calls())

-- The end: nothing left behind.
Reset()
S.Stop()
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.level = was.level
G.log, G.order = {}, {}
Hide()
`, "section 28");

// 29. A hearth step's line in the step box becomes a "Use your hearthstone" button (a tip with the same button in Simple mode). Only a real click on it
// uses the hearthstone: with no click, nothing is ever used. A missing hearthstone or one that cools down is said in one plain line.
console.log("29. A hearth step becomes a button; only a click uses it");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, simple = ER.db.simple }
ER.db.mode, ER.db.autoNextOff = "hard", true
ER.db.simple = nil

local function Calls() return table.concat(G.calls, ",") end
local function Plain(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  return (string.gsub(s, "|r", ""))
end
local function Said(text) return string.find(CHAT, text, 1, true) ~= nil end
-- The shown line (button) of the step box whose plain text holds this; nil when none.
local function LineWith(text)
  for i = 1, 10 do
    local b = _G["EasyRouteTrackerLine" .. i]
    if b and b:IsShown() and string.find(Plain(b.text._text), text, 1, true) then return b end
  end
  return nil
end
local function Click(b)
  this = b
  b:GetScript("OnClick")()
end
local HEARTH = { [0] = { size = 16, [3] = { id = 6948, name = "Hearthstone", count = 1 } } }
local function Reset()
  G.calls, G.stuff, G.hearthStart, G.hearthDur, G.shift = {}, nil, nil, nil, false
  ER.db.autoOff, ER.db.simple = nil, nil
  ER.RemoveTip("hearth")
  CHAT = ""
end

-- The Elwynn Forest guide of a level 6 human has a step that sets off with "Hearth to Goldshire".
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 6
local elwynn
for _, g in ipairs(S.Guides()) do
  if g.name == "6-11 Elwynn Forest" then elwynn = g end
end
check(elwynn ~= nil, "no 6-11 Elwynn Forest guide")
local function Start(jumpTo)
  Reset()
  S.Stop()
  Tick(2)
  ER.db.guides, ER.db.done = {}, {}
  G.log, G.order, G.bags = {}, {}, {}
  G.zone, G.x, G.y = "Elwynn Forest", 42, 65
  check(ER.StartGuide(S.Key(elwynn), true), "the Elwynn Forest guide did not start")
  if jumpTo then S.Jump(jumpTo) end
  Tick(2)
  ER.StepsChanged()
end
Start()
local hearthStep
for n = 1, S.Count() do
  for _, e in ipairs(S.Step(n).elements) do
    if e.kind == "H" and e.text and string.find(e.text, "Hearth to Goldshire", 1, true) and not hearthStep then hearthStep = n end
  end
end
check(hearthStep ~= nil, "no step says Hearth to Goldshire")
Start(hearthStep)
check(S.Position() == hearthStep, "the guide is at step " .. S.Position() .. " and not at the hearth step " .. tostring(hearthStep))
check(table.getn(S.OpenElements("H")) == 1, "the hearth step has " .. table.getn(S.OpenElements("H")) .. " open hearth lines")

-- a. the line is a button; 30 seconds with the hearthstone in the bag and no click use nothing; one click uses it once
G.stuff = HEARTH
ER.StepsChanged()
local b = LineWith("Use your hearthstone")
check(b ~= nil, "the box has no 'Use your hearthstone' line: " .. ShownLines())
check(b and string.find(Plain(b.text._text), "(Hearth to Goldshire)", 1, true) ~= nil, "the line does not name the place: " .. Plain(b and b.text._text or ""))
check(b and b.line and b.line.hearth == true, "the line is not marked as the hearth button")
for i = 1, 30 do Tick(1) end
check(table.getn(G.calls) == 0, "30 seconds and no click, yet the calls were: " .. Calls())
b = LineWith("Use your hearthstone")
Click(b)
check(Calls() == "UseContainerItem:0:3", "one click made the calls: " .. Calls())
check(not Said("hearthstone"), "a good click said '" .. CHAT .. "'")

-- b. a hearthstone that cools down is not used; the line says how long
G.calls = {}
G.hearthStart, G.hearthDur = NOW - 60, 3600
Click(LineWith("Use your hearthstone"))
check(table.getn(G.calls) == 0, "a cooling hearthstone, yet the calls were: " .. Calls())
check(Said("Your hearthstone is not ready yet: about 59 minutes left."), "the cooldown line is missing: " .. CHAT)
-- one that is ready again is used
G.calls, CHAT = {}, ""
G.hearthStart, G.hearthDur = NOW - 4000, 3600
Click(LineWith("Use your hearthstone"))
check(Calls() == "UseContainerItem:0:3", "a hearthstone that is ready again made the calls: " .. Calls())
G.hearthStart, G.hearthDur = nil, nil

-- c. no hearthstone in the bags
G.calls, CHAT = {}, ""
G.stuff = { [0] = { size = 16, [1] = { id = 12345, name = "Other Thing", count = 1 } } }
Click(LineWith("Use your hearthstone"))
check(table.getn(G.calls) == 0, "no hearthstone, yet the calls were: " .. Calls())
check(Said("You have no hearthstone in your bags."), "the no-hearthstone line is missing: " .. CHAT)

-- d. auto mode off: the line is still the button and the click still works, and nothing happens by itself
G.calls, CHAT = {}, ""
G.stuff = HEARTH
ER.db.autoOff = true
ER.StepsChanged()
check(LineWith("Use your hearthstone") ~= nil, "with auto mode off the line is no longer the button")
for i = 1, 30 do Tick(1) end
check(table.getn(G.calls) == 0, "auto mode off and no click, yet the calls were: " .. Calls())
Click(LineWith("Use your hearthstone"))
check(Calls() == "UseContainerItem:0:3", "auto mode off: the click made the calls: " .. Calls())
ER.db.autoOff = nil

-- e. the line also reads right in the tooltip (the hint says nothing is done by itself)
local sawHint = false
GameTooltip.AddLine = function(self, text) if string.find(text or "", "Click to use your hearthstone. Easy Route never uses it by itself.", 1, true) then sawHint = true end end
this = LineWith("Use your hearthstone")
this:GetScript("OnEnter")()
check(sawHint, "the tooltip of the hearth line has no hint")

-- f. Simple mode: a tip with the button; nothing is used until the button is pressed
Start(hearthStep)
G.stuff = HEARTH
ER.db.simple = true
G.calls = {}
Tick(2)
check(ER.HasTip("hearth"), "Simple mode has no hearth tip")
local tipText, tipLabel, tipFn
for _, tip in ipairs(ER.TipsList()) do
  if tip.key == "hearth" then tipText, tipLabel, tipFn = tip.text, tip.buttons and tip.buttons[1] and tip.buttons[1].label, tip.buttons and tip.buttons[1] and tip.buttons[1].fn end
end
check(tipText == "Time to use your hearthstone.", "the tip says: " .. tostring(tipText))
check(tipLabel == "Use your hearthstone", "the tip button says: " .. tostring(tipLabel))
for i = 1, 30 do Tick(1) end
check(table.getn(G.calls) == 0, "Simple mode and no click, yet the calls were: " .. Calls())
check(tipFn ~= nil, "the tip has no button function")
if tipFn then tipFn() end
check(Calls() == "UseContainerItem:0:3", "the tip button made the calls: " .. Calls())
for i = 1, 30 do Tick(1) end
check(Calls() == "UseContainerItem:0:3", "after the button, 30 more seconds made more calls: " .. Calls())
-- a tip the player closed does not come back for the same step
ER.RemoveTip("hearth")
Tick(3)
check(not ER.HasTip("hearth"), "a closed hearth tip came back on the same step")
-- the tip button works with auto mode off
ER.db.autoOff = true
G.calls = {}
ER.RemoveTip("hearth")
Start(hearthStep)
G.stuff = HEARTH
ER.db.simple, ER.db.autoOff = true, true
Tick(2)
check(ER.HasTip("hearth"), "auto mode off: Simple mode has no hearth tip")
for _, tip in ipairs(ER.TipsList()) do
  if tip.key == "hearth" then tip.buttons[1].fn() end
end
check(Calls() == "UseContainerItem:0:3", "auto mode off: the tip button made the calls: " .. Calls())
ER.db.autoOff = nil

-- g. after the hearthstone is used the line and the tip are gone
Start(hearthStep)
G.stuff = HEARTH
ER.db.simple = true
Tick(2)
check(ER.HasTip("hearth"), "the tip is missing before the hearth")
Fire("SPELLCAST_START", "Hearthstone")
Fire("SPELLCAST_STOP")
Tick(2)
check(not ER.HasTip("hearth"), "the hearth tip stays after the hearthstone was used")
ER.db.simple = nil
ER.StepsChanged()
check(LineWith("Use your hearthstone") == nil, "the hearth button stays after the hearthstone was used: " .. ShownLines())

-- h. a step with no hearth line has no button and no tip
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 1
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)
Reset()
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
G.log, G.order, G.bags = {}, {}, {}
G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
G.stuff = HEARTH
ER.db.simple = true
Tick(3)
ER.StepsChanged()
check(LineWith("Use your hearthstone") == nil, "a step with no hearth line has the button: " .. ShownLines())
check(not ER.HasTip("hearth"), "a step with no hearth line has the tip")
check(table.getn(G.calls) == 0, "a step with no hearth line, yet the calls were: " .. Calls())

-- The end: nothing left behind.
Reset()
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff, ER.db.simple = was.mode, was.autoNextOff, was.simple
G.level = was.level
G.log, G.order = {}, {}
`, "section 29");

console.log("30. Friends' Hard quests are left out on Casual and Medium");
run(SECTION_START + `
G.race, G.class, G.faction = "Orc", "WARRIOR", "Horde"
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, hard = EasyRoute_Ratings and EasyRoute_Ratings.hard }
ER.db.mode, ER.db.autoNextOff = "casual", true

-- a. the real data file is loaded and holds the friends' Hard quests
check(type(EasyRoute_Ratings) == "table" and type(EasyRoute_Ratings.hard) == "table", "Data/Ratings.lua did not load")
check(EasyRoute_Ratings.hard[1054] == 1, "quest 1054 is not in the friends' Hard set")
check(EasyRoute_Ratings.hard[1034] == 1 and EasyRoute_Ratings.hard[55032] == 1, "1034 or 55032 is not in the friends' Hard set")

-- b. the table and its readers
check(S.LeftByKinds("h", "casual") and S.LeftByKinds("h", "medium"), "h is not left out on Casual and Medium")
check(not S.LeftByKinds("h", "hard"), "h is left out on Hard")
check(not S.LeftByKinds("s", "medium"), "an escort quest is left out on Medium")
check(S.LeftByKinds("e", "medium"), "an elite quest is kept on Medium")
check(not S.LeftByKinds("ck", "casual"), "the letters c and k leave a quest out")
check(S.LeftByKinds("d", "casual") and S.LeftByKinds("d", "medium") and S.LeftByKinds("d", "hard"), "the letter d does not leave a quest out on every difficulty")

-- c. the Durotar visit
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)
G.dead, G.taxi, G.level = false, false, 1
G.log, G.order, G.bags = {}, {}, {}
ER.db.guides, ER.db.done = {}, {}
S.Stop()
Tick(2)
G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
Tick(2)
local X
for _, e in ipairs(S.Current().elements) do
  if e.kind == "A" and e.id and e.id ~= 0 and not X then X = e.id end
end
if not X then
  for _, s in ipairs(S.Upcoming(10)) do
    for _, e in ipairs(s.elements) do
      if e.kind == "A" and e.id and e.id ~= 0 and not X and not S.LeftOut(e.id) then X = e.id end
    end
  end
end
check(X ~= nil, "no quest pick-up in the Durotar steps")
local function Wanted(id)
  for _, v in pairs(S.WantedAccepts()) do
    if v == id then return true end
  end
  return false
end
check(not S.LeftOut(X) and Wanted(X), "quest " .. tostring(X) .. " is not wanted before it is marked Hard")
EasyRoute_Ratings.hard[X] = 1
check(S.LeftOut(X) == true, "a Hard quest is kept on Casual")
check(not Wanted(X), "a Hard quest is still wanted on Casual")
ER.db.mode = "medium"
check(S.LeftOut(X) == true, "a Hard quest is kept on Medium")
ER.db.mode = "hard"
check(S.LeftOut(X) == false, "a Hard quest is left out on Hard")
ER.db.mode = "casual"
local title = S.QuestTitle(X)
G.log[title] = { complete = false, objs = {} }
table.insert(G.order, title)
check(S.LeftOut(X) == false, "a Hard quest that is in the log is left out on Casual")
G.log[title] = nil
G.order = {}
EasyRoute_Ratings.hard[X] = nil

-- d. a quest that waits for a Hard quest of the same visit is left out too
local ids = {}
for _, area in ipairs(areas) do
  for _, q in ipairs(area.q) do
    if q.id then ids[q.id] = true end
  end
end
local child, parent
for id in pairs(ids) do
  local row = ER.QuestRow(id)
  if not child and row and row.p and ids[row.p] and not S.InLog(id) and not S.TurnedIn(row.p) then child, parent = id, row.p end
end
if child then
  check(S.LeftOut(child) == false, "quest " .. child .. " is left out before its first part is marked Hard")
  EasyRoute_Ratings.hard[parent] = 1
  check(S.LeftOut(child) == true, "quest " .. child .. " waits for Hard quest " .. parent .. " and is kept on Casual")
  ER.db.mode = "hard"
  check(S.LeftOut(child) == false, "quest " .. child .. " is left out on Hard")
  ER.db.mode = "casual"
  EasyRoute_Ratings.hard[parent] = nil
else
  print("  (no quest of the Durotar visit waits for another one of it: chain case skipped)")
end

-- The end: nothing left behind.
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
G.log, G.order = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.level = was.level
`, "section 30");

console.log("31. Casual leaves out risky quests; Medium warns; escorts are never auto-accepted");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, faction = G.faction }
ER.db.mode, ER.db.autoNextOff = "casual", true
TESTED_LIST = ""

local function Modes(id)
  local out = {}
  for _, m in ipairs({ "casual", "medium", "hard" }) do
    ER.db.mode = m
    table.insert(out, S.LeftOut(id) and true or false)
  end
  return out
end
local function Same(got, want) return got[1] == want[1] and got[2] == want[2] and got[3] == want[3] end
local function Say(t)
  return "casual " .. tostring(t[1]) .. ", medium " .. tostring(t[2]) .. ", hard " .. tostring(t[3])
end
-- no letter that leaves a quest out on any difficulty (u, a cave, is only a warning)
local function Plain(id)
  return not string.find(S.Kinds(id), "[egdsvhm]")
end
local function PutInLog(id)
  local title = S.QuestTitle(id)
  G.log[title] = { complete = false, objs = {} }
  table.insert(G.order, title)
end
local function Reset()
  S.Stop()
  Tick(2)
  G.dead, G.taxi = false, false
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  ER.db.autoOff, ER.db.autoquestOff = nil, nil
  G.calls, G.window, G.shift, G.units = {}, nil, false, {}
  QuestFrame:Hide()
  QuestFrameDetailPanel:Hide()
  Tick(2)
  CHAT = ""
end

-- a. the table
check(S.LEAVE_OUT.casual == "egdsvhm", "S.LEAVE_OUT.casual is " .. tostring(S.LEAVE_OUT.casual))
check(S.LEAVE_OUT.medium == "egdhm", "S.LEAVE_OUT.medium is " .. tostring(S.LEAVE_OUT.medium))
check(S.LEAVE_OUT.hard == "d", "S.LEAVE_OUT.hard is " .. tostring(S.LEAVE_OUT.hard))

-- b. the casual route: one quest of each letter (the only left-out letter it has), on every difficulty, and with the quest in the log
local EXPECT = {
  g = { true, true, false }, d = { true, true, true }, s = { true, false, false },
  v = { true, false, false }, h = { true, true, false },
}
local ORDER = { "g", "d", "s", "v", "h" }
for _, who in ipairs({ { "Orc", "Horde" }, { "NightElf", "Alliance" } }) do
  G.race, G.class, G.faction = who[1], "WARRIOR", who[2]
  local tested = {}
  for _, info in ipairs(ER.RouteGuides()) do
    local flags = {}
    for _, area in ipairs(ER.RouteReader.ReadVisit(info.visit)) do
      for _, q in ipairs(area.q) do
        if q.id then flags[q.id] = q.flags end
      end
    end
    for _, letter in ipairs(ORDER) do
      if not tested[letter] then
        local pick
        for id, f in pairs(flags) do
          local only = string.gsub(f, "[^egdsvh]", "")
          if only == letter and (not pick or id < pick) then pick = id end
        end
        if pick then
          tested[letter] = true
          Reset()
          G.level = info.lo
          check(S.Load(S.Key(info), true), who[1] .. " " .. info.name .. " did not load")
          local got = Modes(pick)
          check(Same(got, EXPECT[letter]), who[1] .. " quest " .. pick .. " (" .. letter .. "): " .. Say(got) .. ", wanted " .. Say(EXPECT[letter]))
          PutInLog(pick)
          local inLog = Modes(pick)
          check(not inLog[1] and not inLog[2] and not inLog[3], who[1] .. " quest " .. pick .. " (" .. letter .. ") in the log is left out: " .. Say(inLog))
          G.log, G.order = {}, {}
          if not string.find(TESTED_LIST, letter, 1, true) then TESTED_LIST = TESTED_LIST .. letter end
          print("  " .. who[1] .. " " .. info.name .. ": " .. letter .. " quest " .. pick .. " -> " .. Say(got))
        end
      end
    end
  end
end

-- c. a Fast route guide (a RestedXP guide for an Orc): the same table by quest number, and a follow-up of a left-out quest
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 1
Reset()
local fast
for _, g in ipairs(S.Guides()) do
  if not g.route and not fast then fast = g end
end
check(fast ~= nil, "no Fast route guide for the Orc")
check(S.Load(S.Key(fast), true), "the Fast route guide did not load")
local kids = {}
for _, z in pairs(EasyRoute_Zones) do
  for _, q in ipairs(z.q) do
    if q.p then
      kids[q.p] = kids[q.p] or {}
      table.insert(kids[q.p], q.id)
    end
  end
end
local X, C
for n = 1, S.Count() do
  for _, e in ipairs(S.Step(n).elements) do
    if not X and e.kind == "A" and e.id and e.id ~= 0 and Plain(e.id) and not S.TooEasy(e.id) and kids[e.id] then
      for _, kid in ipairs(kids[e.id]) do
        if not C and Plain(kid) and not S.TooEasy(kid) then X, C = e.id, kid end
      end
    end
  end
end
check(X ~= nil and C ~= nil, "the Fast route guide has no quest with a follow-up and no letters")
local danger = EasyRoute_Route.danger.Horde
if X and C then
  local savedX = danger[X]
  danger[X] = "v"
  local got = Modes(X)
  check(Same(got, { true, false, false }), "Fast route quest " .. X .. " (v): " .. Say(got))
  local kid = Modes(C)
  check(Same(kid, { true, false, false }), "Fast route follow-up " .. C .. " of the v quest " .. X .. ": " .. Say(kid))
  danger[X] = "d"
  got = Modes(X)
  check(Same(got, { true, true, true }), "Fast route quest " .. X .. " (d): " .. Say(got))
  kid = Modes(C)
  check(Same(kid, { true, true, true }), "Fast route follow-up " .. C .. " of the d quest " .. X .. ": " .. Say(kid))
  -- the quest before it in the log: the way on is open
  PutInLog(X)
  kid = Modes(C)
  check(not kid[1] and not kid[2] and not kid[3], "Fast route follow-up " .. C .. " is left out while its first part is in the log: " .. Say(kid))
  got = Modes(X)
  check(not got[1] and not got[2] and not got[3], "Fast route quest " .. X .. " is left out while in the log: " .. Say(got))
  G.log, G.order = {}, {}
  danger[X] = savedX
  got = Modes(X)
  check(Same(got, { false, false, false }), "Fast route quest " .. X .. " (no letters): " .. Say(got))
  print("  Fast route: quest " .. X .. " and its follow-up " .. C .. " follow the table")
end

-- d. escorts: S.Escort, and Auto mode never accepts one
check(S.Escort(0) == false, "S.Escort(0) is not false")
local Y
Reset()
check(S.Load(S.Key(fast), true), "the Fast route guide did not load again")
for _, e in ipairs(S.Current().elements) do
  if not Y and e.kind == "A" and e.id and e.id ~= 0 and Plain(e.id) and not S.TooEasy(e.id) then Y = e.id end
end
check(Y ~= nil, "the first Fast route step has no Accept line without a leave-out letter")
if Y then
  local T = S.QuestTitle(Y)
  local norm = S.NormTitle(T)
  local function Occurs(s, sub)
    local n, at = 0, 1
    while true do
      local a, b = string.find(s, sub, at, true)
      if not a then return n end
      n = n + 1
      at = b + 1
    end
  end
  local function Open()
    G.window = { title = T }
    QuestFrame:Show()
    QuestFrameDetailPanel:Show()
    Fire("QUEST_DETAIL")
  end
  local NOTICE = "Escort quest: accept it yourself when you are ready."
  ER.db.mode = "medium"
  -- a plain quest is accepted (the test works in this guide)
  local savedY = danger[Y]
  check(S.Escort(Y) == false, "S.Escort is true for quest " .. Y .. " with no letters")
  check(S.WantedAccepts()[norm] == Y, "WantedAccepts has no entry for '" .. tostring(T) .. "' on Medium")
  Open()
  Tick(0.1)
  check(table.getn(G.calls) == 1 and G.calls[1] == "AcceptQuest", "a plain quest made the calls: " .. table.concat(G.calls, ","))
  check(Occurs(CHAT, NOTICE) == 0, "a plain quest said the escort line")
  -- the same quest as an escort
  Reset()
  check(S.Load(S.Key(fast), true), "the Fast route guide did not load a third time")
  ER.db.mode = "medium"
  danger[Y] = "s"
  check(S.Escort(Y) == true, "S.Escort is false for an s quest")
  danger[Y] = "v"
  check(S.Escort(Y) == false, "S.Escort is true for a v quest")
  danger[Y] = "s"
  check(S.LeftOut(Y) == false, "an escort quest is left out on Medium")
  check(S.WantedAccepts()[norm] == nil, "WantedAccepts has the escort quest")
  check(S.WantedAccepts(true)[norm] == Y, "WantedAccepts(true) has no entry for the escort quest")
  Open()
  Open()
  Tick(0.1)
  check(table.getn(G.calls) == 0, "an escort quest made the calls: " .. table.concat(G.calls, ","))
  check(G.log[T] == nil, "the escort quest reached the log")
  check(Occurs(CHAT, NOTICE) == 1, "the escort line was said " .. Occurs(CHAT, NOTICE) .. " times: '" .. CHAT .. "'")
  QuestFrame:Hide()
  QuestFrameDetailPanel:Hide()
  Tick(1.2)
  danger[Y] = savedY
end

-- The end: nothing left behind.
Reset()
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.level, G.race, G.faction = was.level, was.race, was.faction
`, "section 31");
const testedLetters = getString("TESTED_LIST");
for (const letter of ["g", "d", "s", "v", "h"]) jsCheck(testedLetters.indexOf(letter) >= 0, `section 31 found no route quest with the letter ${letter} to test (tested: ${testedLetters})`);

console.log("32. Survival warnings and the cave line show for the step");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, class = G.class, faction = G.faction,
  current = S.Current, side = S.Side }
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.autoNextOff, ER.db.guides, ER.db.done = "casual", true, {}, {}
S.Stop()
Tick(2)
CHAT = ""

local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  return (string.gsub(s, "|r", ""))
end
local function Modes(fn)
  for _, m in ipairs({ "casual", "medium", "hard" }) do
    ER.db.mode = m
    fn(m)
  end
  ER.db.mode = "casual"
end
local function Kinds(list)
  local out = {}
  for _, w in ipairs(list) do table.insert(out, w.kind) end
  return table.concat(out, ",")
end
local function Has(list, kind, line)
  for _, w in ipairs(list) do
    if w.kind == kind and (not line or w.line == line) then return w end
  end
  return nil
end
local GUIDES = { "restedxp", "rxp", "tourguide", "vanillaguide", "questie", "guidelime", "pfquest" }
local function NamesAGuide(text)
  local t = string.lower(text or "")
  for _, g in ipairs(GUIDES) do
    if string.find(t, g, 1, true) then return g end
  end
  return nil
end

-- a. the cave word rule
local WORDS = {
  { "Kill Kobolds in Fargodeep Mine", "mine" }, { "Clear the mines", "mine" }, { "Enter the crypt below", "crypt" },
  { "Go into the Ban'ethil Barrow Den", "crypt" }, { "Search the cave", "cave" }, { "Report to Gornek in The Den", nil },
  { "this one is mine", nil }, { "|cffff5722Grotto|r creatures", "cave" }, { "Kill the Scorpids in the mine", "mine" },
  { "Walk to the Catacombs", "crypt" }, { "Hollowed out trees", nil }, { "Go to the Stonecutter's Quarry", "mine" },
  { "Report to Gornek in The Den and go into the cave", "cave" }, { "none", nil }, { 5, nil },
}
for _, w in ipairs(WORDS) do
  check(S.CaveWord(w[1]) == w[2], "CaveWord(" .. tostring(w[1]) .. ") is " .. tostring(S.CaveWord(w[1])) .. ", wanted " .. tostring(w[2]))
end
check(S.CaveWord(nil) == nil, "CaveWord(nil) is not nil")
check(S.CaveLine("mine") == "Heads up: this goes into a mine, easy to pull too many and hard to run away.", "CaveLine(mine) is " .. S.CaveLine("mine"))
check(S.CaveLine("crypt") == "Heads up: this goes into a crypt, easy to pull too many and hard to run away.", "CaveLine(crypt) is " .. S.CaveLine("crypt"))

-- b. the merge on a hand-made step
check(S.Load(S.Key(ER.RouteGuides()[1]), true), "the Orc Durotar visit did not load")
local Q = 99991
local danger = EasyRoute_Route.danger.Horde
EasyRoute_Survival.Horde = EasyRoute_Survival.Horde or {}
EasyRoute_Survival.Horde.warn = EasyRoute_Survival.Horde.warn or {}
local warn = EasyRoute_Survival.Horde.warn
local caveword = EasyRoute_Route.caveword
local saved = { danger = danger[Q], warn = warn[Q], caveword = caveword[Q] }
local WARN1 = "Try to avoid the |cffff5722Burning Blade Fanatic|r, it hits hard."
local WARN2 = "The path back is long."
local RXP = "Try to avoid |cffff5722Zork Patrol|r here."
local function Hand(elements)
  local step = { n = 1, elements = elements }
  S.Current = function() return step end
  S.Side = function() return {} end
  return step
end
local function Reset(qdanger, qwarn, qcave)
  danger[Q], warn[Q], caveword[Q] = qdanger, qwarn, qcave
end

-- survival warnings: Casual and Medium, not Hard
Reset(nil, WARN1 .. "\\n" .. WARN2, nil)
Hand({ { kind = "A", id = Q, text = "Dummy" } })
Modes(function(m)
  local w = S.Warnings()
  if m == "hard" then
    check(Has(w, "survival") == nil, "Hard shows a survival warning: " .. Kinds(w))
  else
    check(Has(w, "survival", "Heads up: " .. WARN1) ~= nil, m .. " has no survival line for the first warning: " .. Kinds(w))
    check(Has(w, "survival", "Heads up: " .. WARN2) ~= nil, m .. " has no survival line for the second warning: " .. Kinds(w))
    check(table.getn(w) == 2, m .. " has " .. table.getn(w) .. " lines")
  end
end)
-- a K or C line of a quest that is not in the log is nothing to do, so it says nothing (section 40 has one in the log)
Hand({ { kind = "K", id = Q, text = "Dummy" } })
check(Has(S.Warnings(), "survival") == nil, "a K line of a quest not in the log gets a survival warning")
Hand({ { kind = "C", id = Q, text = "Dummy" } })
check(Has(S.Warnings(), "survival") == nil, "a C line of a quest not in the log gets a survival warning")
Hand({ { kind = "T", id = Q, text = "Dummy" } })
check(Has(S.Warnings(), "survival") == nil, "a T line gets a survival warning")

-- the tooltip's "Hard" knows the enemy of a survival warning
Hand({ { kind = "A", id = Q, text = "Dummy" } })
local function Named(name)
  for _, w in ipairs(S.WarnedEnemies()) do
    if w.name == name then return true end
  end
  return false
end
ER.db.mode = "casual"
check(Named("burning blade fanatic"), "WarnedEnemies does not hold burning blade fanatic on Casual")
ER.db.mode = "hard"
check(not Named("burning blade fanatic"), "WarnedEnemies holds a survival enemy on Hard")
ER.db.mode = "casual"

-- the cave line: the u letter, its word, and the step's own words
Reset("u", nil, "mine")
Hand({ { kind = "A", id = Q, text = "Dummy" } })
Modes(function(m)
  local w = S.Warnings()
  check(w[1] and w[1].kind == "cave" and w[1].line == S.CaveLine("mine"), m .. " cave line is " .. tostring(w[1] and w[1].line))
  check(w[1] and w[1].text == "this goes into a mine, easy to pull too many and hard to run away.", m .. " cave text is " .. tostring(w[1] and w[1].text))
end)
Reset("u", nil, nil)
check(Has(S.Warnings(), "cave", S.CaveLine("cave")) ~= nil, "a u quest with no word is not a cave")
Reset(nil, nil, nil)
Hand({ { kind = "A", id = Q, text = "Dummy" }, { kind = "I", text = "Kill Kobolds in Fargodeep Mine" } })
Modes(function(m)
  check(Has(S.Warnings(), "cave", S.CaveLine("mine")) ~= nil, m .. " has no cave line for a step that names a mine")
end)
Hand({ { kind = "T", id = Q, text = "Report to Gornek in The Den" } })
check(Has(S.Warnings(), "cave") == nil, "The Den made a cave line")
Hand({ { kind = "A", id = Q, text = "Dummy" } })
check(table.getn(S.Warnings()) == 0, "a plain step has warnings: " .. Kinds(S.Warnings()))

-- escort and safe-route lines: Medium only
local ESC = "Escort quest: the NPC is weak and mobs come in waves. Skip it if it goes wrong."
local SAFE = "The safe route skips this one. Take care."
Reset("s", nil, nil)
Modes(function(m)
  local w = S.Warnings()
  check((Has(w, "escort", ESC) ~= nil) == (m == "medium"), m .. " escort line: " .. Kinds(w))
  check(Has(w, "safe") == nil, m .. " has a safe-route line for an escort")
end)
Reset("v", nil, nil)
Modes(function(m)
  local w = S.Warnings()
  check((Has(w, "safe", SAFE) ~= nil) == (m == "medium"), m .. " safe-route line: " .. Kinds(w))
  check(Has(w, "escort") == nil, m .. " has an escort line for a safe-route quest")
end)

-- the cap of 2, the order, and the full list
Reset("us", WARN1 .. "\\n" .. WARN2, "crypt")
Hand({ { kind = "A", id = Q, text = "Dummy" }, { kind = "I", text = RXP } })
ER.db.mode = "medium"
check(Kinds(S.Warnings()) == "cave,survival", "the capped list is " .. Kinds(S.Warnings()))
check(Kinds(S.Warnings(true)) == "cave,survival,survival,escort,rxp", "the full list is " .. Kinds(S.Warnings(true)))
check(S.Warnings()[2].line == "Heads up: " .. WARN1, "the second line is " .. tostring(S.Warnings()[2].line))
ER.db.mode = "casual"
-- Casual leaves the escort out, so its cave and survival lines go with it
check(Kinds(S.Warnings(true)) == "rxp", "the full Casual list is " .. Kinds(S.Warnings(true)))
check(Named("zork patrol"), "the guide's own warning enemy is lost from WarnedEnemies")
ER.db.mode = "hard"
check(Kinds(S.Warnings(true)) == "cave,rxp", "the full Hard list is " .. Kinds(S.Warnings(true)))
Reset(nil, nil, nil)
Hand({ { kind = "I", text = RXP } })
check(Kinds(S.Warnings()) == "rxp" and S.Warnings()[1].line == "Heads up: " .. RXP, "the guide's own warning is " .. Kinds(S.Warnings()))
ER.db.mode = "casual"

-- no line names a guide, over these cases and over every survival warning of both factions
local seen = 0
for _, f in ipairs({ "Alliance", "Horde" }) do
  local t = EasyRoute_Survival[f] and EasyRoute_Survival[f].warn or {}
  for id, text in pairs(t) do
    for one in string.gfind(text, "[^\\n]+") do
      seen = seen + 1
      local g = NamesAGuide(one)
      check(g == nil, f .. " warning of quest " .. tostring(id) .. " names " .. tostring(g))
    end
  end
end
check(seen > 20, "only " .. seen .. " survival warnings were checked")
for _, w in ipairs({ S.CaveLine("mine"), S.CaveLine("crypt"), S.CaveLine("cave"), ESC, SAFE }) do
  check(NamesAGuide(w) == nil, "a warning line names a guide: " .. w)
end
print("  " .. seen .. " survival warnings checked for guide names")

-- c. the step box (a real step, the Fast route guide for the Orc)
S.Current, S.Side = was.current, was.side
Reset(nil, nil, nil)
S.Stop()
local fast
for _, g in ipairs(S.Guides()) do
  if not g.route and not fast then fast = g end
end
check(fast ~= nil, "no Fast route guide for the Orc")
check(ER.StartGuide(S.Key(fast), true), "the Fast route guide did not start")
CHAT = ""
local step = S.Current()
local Y
for _, e in ipairs(step.elements) do
  if not Y and e.kind == "A" and e.id and e.id ~= 0 then Y = e.id end
end
check(Y ~= nil, "the first Fast route step has no Accept line")
if Y then
  local savedY = { danger = danger[Y], warn = warn[Y], caveword = caveword[Y] }
  danger[Y], warn[Y], caveword[Y] = "u", "Beware of the |cffff5722Quillboar Brute|r here.", "mine"
  table.insert(step.elements, { kind = "I", text = "Try to avoid |cffff5722Zork Patrol|r on the road." })
  local function BoxLines()
    local out = {}
    for i = 1, 14 do
      local b = _G["EasyRouteTrackerLine" .. i]
      if b and b:IsShown() then table.insert(out, PlainText(b.text._text)) end
    end
    return out
  end
  local function Count(sub)
    local n = 0
    for _, l in ipairs(BoxLines()) do
      if string.find(l, sub, 1, true) then n = n + 1 end
    end
    return n
  end
  ER.db.mode = "casual"
  ER.StepsChanged()
  local box = table.concat(BoxLines(), " / ")
  check(Count("this goes into a mine, easy to pull too many and hard to run away.") == 1, "the cave line shows " .. Count("this goes into a mine") .. " times: " .. box)
  check(Count("Heads up: Beware of the Quillboar Brute here.") == 1, "the survival line shows " .. Count("Beware of the Quillboar Brute") .. " times: " .. box)
  check(Count("Try to avoid Zork Patrol on the road.") == 1, "the guide's own warning shows " .. Count("Try to avoid Zork Patrol") .. " times: " .. box)
  print("  box: " .. box)
  ER.db.mode = "hard"
  ER.StepsChanged()
  box = table.concat(BoxLines(), " / ")
  check(Count("this goes into a mine") == 1, "Hard lost the cave line: " .. box)
  check(Count("Beware of the Quillboar Brute") == 0, "Hard shows the survival line: " .. box)
  ER.db.mode = "casual"
  table.remove(step.elements)
  danger[Y], warn[Y], caveword[Y] = savedY.danger, savedY.warn, savedY.caveword
end

check(CHAT == "", "the warnings said something in chat: " .. CHAT)

-- the end: nothing left behind
danger[Q], warn[Q], caveword[Q] = saved.danger, saved.warn, saved.caveword
S.Current, S.Side = was.current, was.side
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.level, G.race, G.class, G.faction = was.level, was.race, was.class, was.faction
`, "section 32");

run(fs.readFileSync(path.join(ROOT, "Adapt.lua")), "Adapt.lua");

console.log("33. Walking into a cave says heads up once");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, class = G.class, faction = G.faction,
  zone = G.zone, sub = G.sub, minimapZone = G.minimapZone, current = S.Current, side = S.Side, simple = ER.db.simple }
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.sub, G.minimapZone = "", nil
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.autoNextOff, ER.db.guides, ER.db.done, ER.db.simple = "casual", true, {}, {}, nil
S.Stop()
Tick(2.1)

local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  return (string.gsub(s, "|r", ""))
end
local function TipText(key)
  for _, tip in ipairs(ER.TipsList()) do
    if tip.key == key then return PlainText(tip.text) end
  end
  return nil
end
local function CaveTips()
  local n = 0
  for _, tip in ipairs(ER.TipsList()) do
    if string.sub(tip.key, 1, 5) == "cave:" then n = n + 1 end
  end
  return n
end
local function Clear()
  ER.RemoveTips("cave:")
  ER.RemoveTips("warn:")
end
local function Walk(sub, minimap)
  G.sub, G.minimapZone = sub, minimap
  Tick(2.1)
end
Clear()

local infos = ER.RouteGuides()
check(ER.StartGuide(S.Key(infos[1]), true), "the Orc Durotar visit did not start")
check(S.Running(), "no guide is running")
Tick(2.1)
Clear()
CHAT = ""

-- a. walking into a mine: one tip, and not again while you stay
Walk("Fargodeep Mine")
local want = "Heads up: this goes into a mine, easy to pull too many and hard to run away."
check(ER.HasTip("cave:Fargodeep Mine"), "no tip for Fargodeep Mine")
check(TipText("cave:Fargodeep Mine") == want, "the Fargodeep Mine tip says " .. tostring(TipText("cave:Fargodeep Mine")))
ER.RemoveTip("cave:Fargodeep Mine")
Tick(2.1)
Tick(2.1)
check(not ER.HasTip("cave:Fargodeep Mine"), "the tip came back while still in the mine")

-- b. stepping out and straight back in says nothing; after 10 minutes away it says it again
Walk("Goldshire")
check(CaveTips() == 0, "Goldshire gave a cave tip")
Walk("Fargodeep Mine")
check(not ER.HasTip("cave:Fargodeep Mine"), "the tip came back after a step out of Fargodeep Mine")
Walk("Goldshire")
NOW = NOW + 601
Walk("Fargodeep Mine")
check(ER.HasTip("cave:Fargodeep Mine"), "no tip after 10 minutes away from Fargodeep Mine")
Clear()
-- b2. flying over a mine on a taxi says nothing
Walk("Goldshire")
NOW = NOW + 601
G.taxi = true
Walk("Fargodeep Mine")
check(not ER.HasTip("cave:Fargodeep Mine"), "a flight over Fargodeep Mine gave a tip")
G.taxi = false
Walk("Goldshire")
Clear()

-- c. the minimap name stands in when the zone text is empty
Walk("Goldshire")
Walk("", "Jasperlode Mine")
check(ER.HasTip("cave:Jasperlode Mine"), "no tip for Jasperlode Mine from the minimap name")
Clear()

-- d. a crypt is a crypt; a name not on the list gives nothing
G.zone = "Tirisfal Glades"
Walk("Agamand Family Crypt")
check(TipText("cave:Agamand Family Crypt") == "Heads up: this goes into a crypt, easy to pull too many and hard to run away.",
  "the crypt tip says " .. tostring(TipText("cave:Agamand Family Crypt")))
Clear()
Walk("Brill")
check(CaveTips() == 0, "Brill gave a cave tip")
Walk("agamand family crypt")
check(CaveTips() == 1, "a lower-case name gave " .. CaveTips() .. " tips")
Clear()
check(CHAT == "", "the cave tips said something in chat: " .. CHAT)

-- e. Simple mode: the survival warnings are tips; with the step box they are not
local Q = 99991
local warn = EasyRoute_Survival.Horde.warn
local savedWarn = warn[Q]
warn[Q] = "Beware of the |cffff5722Quillboar Brute|r here."
local number = 500
local function Hand()
  number = number + 1
  local step = { n = number, flags = {}, elements = { { kind = "A", id = Q, text = "Dummy" } } }
  S.Current = function() return step end
  S.Side = function() return {} end
end
Walk("Goldshire")
ER.SetSimple(true)
CHAT = ""
Hand()
Tick(2.1)
check(ER.SimpleShown(), "Simple mode did not open")
check(ER.HasTip("warn:1"), "Simple mode has no warning tip")
check(TipText("warn:1") == "Heads up: Beware of the Quillboar Brute here.", "the warning tip says " .. tostring(TipText("warn:1")))
ER.SetSimple(false)
Hand()
Tick(2.1)
check(not ER.HasTip("warn:1"), "the step box is up but a warning tip shows")
check(not ER.SimpleShown(), "Simple mode is still shown")
warn[Q] = savedWarn

-- f. with no guide running, walking into a cave says nothing
S.Current, S.Side = was.current, was.side
S.Stop()
Tick(2.1)
Walk("Goldshire")
Clear()
Walk("Fargodeep Mine")
check(not S.Running(), "a guide is still running")
check(CaveTips() == 0, "a cave tip showed with no guide running")
check(CHAT == "" or not string.find(CHAT, "Fargodeep", 1, true), "chat names the mine: " .. CHAT)

-- the end: nothing left behind
Clear()
G.sub, G.minimapZone, G.zone = was.sub, was.minimapZone, was.zone
ER.db.simple = was.simple
S.Stop()
Tick(2.1)
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.level, G.race, G.class, G.faction = was.level, was.race, was.class, was.faction
`, "section 33");

console.log("34. Every 3 levels the guide asks how it is going");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, class = G.class, faction = G.faction,
  zone = G.zone, sub = G.sub, minimapZone = G.minimapZone, simple = ER.db.simple, tipsOff = ER.db.tipsOff, checkinOff = ER.db.checkinOff,
  units = G.units, taxi = G.taxi, dead = G.dead }
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.sub, G.minimapZone = "", nil
G.log, G.order, G.bags, G.taxi, G.dead = {}, {}, {}, false, false
ER.db.mode, ER.db.autoNextOff, ER.db.guides, ER.db.done, ER.db.simple = "casual", true, {}, {}, nil
ER.db.tipsOff, ER.db.checkinOff = nil, nil
S.Stop()
Tick(2.1)

local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  return (string.gsub(s, "|r", ""))
end
local function TipOf(key)
  for _, tip in ipairs(ER.TipsList()) do
    if tip.key == key then return tip end
  end
  return nil
end
local function TipText(key)
  local tip = TipOf(key)
  return tip and PlainText(tip.text) or nil
end
local function Press(key, label)
  local tip = TipOf(key)
  for _, b in ipairs(tip and tip.buttons or {}) do
    if b.label == label then b.fn() return true end
  end
  return false
end
local function Labels(key)
  local tip, out = TipOf(key), {}
  for _, b in ipairs(tip and tip.buttons or {}) do table.insert(out, b.label) end
  return table.concat(out, "|")
end
local function Reset(level)
  ER.db.adapt[ER.Char()] = nil
  ER.RemoveTips("checkin")
  G.level = level or 1
end
ER.db.adapt = ER.db.adapt or {}
Reset(1)

local infos = ER.RouteGuides()
check(ER.StartGuide(S.Key(infos[1]), true), "the Orc Durotar visit did not start")
check(S.Running(), "no guide is running")
Tick(2.1)
Reset(1)
CHAT = ""

-- a. the question at level 6
G.level = 6
Tick(2.1)
check(ER.HasTip("checkin"), "no check-in at level 6")
check(TipText("checkin") == "Level 6: how is it going?", "the check-in says " .. tostring(TipText("checkin")))
check(Labels("checkin") == "Too easy|About right|Too hard", "the buttons are " .. Labels("checkin"))
check(TipOf("checkin").life == 300, "the check-in lasts " .. tostring(TipOf("checkin").life))
check(ER.AdaptShift() == 0 and S.Comfort() == 2, "the shift starts at " .. ER.AdaptShift())

-- b. Too easy
check(Press("checkin", "Too easy"), "no Too easy button")
check(ER.AdaptShift() == 1, "Too easy left the shift at " .. ER.AdaptShift())
check(S.Comfort() == 3, "Too easy left the comfort at " .. S.Comfort())
check(not ER.HasTip("checkin"), "the check-in is still there after an answer")
check(TipText("checkin:ok") == "Got it: quests up to 3 levels above you.", "the confirm says " .. tostring(TipText("checkin:ok")))
check(CHAT == "", "the check-in said something in chat: " .. CHAT)

-- c. not asked twice for one mark; a jump asks once; 3 and 60 never
ER.RemoveTips("checkin")
Tick(2.1)
Tick(2.1)
check(not ER.HasTip("checkin"), "level 6 was asked twice")
G.level = 11
Tick(2.1)
check(TipText("checkin") == "Level 9: how is it going?", "level 11 asked: " .. tostring(TipText("checkin")))
ER.RemoveTips("checkin")
Tick(2.1)
check(not ER.HasTip("checkin"), "level 9 was asked twice")
G.level = 12
Tick(2.1)
check(TipText("checkin") == "Level 12: how is it going?", "level 12 asked: " .. tostring(TipText("checkin")))
Reset(3)
Tick(2.1)
check(not ER.HasTip("checkin"), "asked at level 3")
Reset(60)
Tick(2.1)
check(not ER.HasTip("checkin"), "asked at level 60")
Reset(57)
Tick(2.1)
check(TipText("checkin") == "Level 57: how is it going?", "level 57 asked: " .. tostring(TipText("checkin")))

-- d. waits for combat, a flight and death; hidden tips or the tick off pass the mark
Reset(6)
G.units = { player = { combat = true } }
Tick(2.1)
check(not ER.HasTip("checkin"), "asked in combat")
G.units = nil
G.taxi = true
Tick(2.1)
check(not ER.HasTip("checkin"), "asked on a flight")
G.taxi = false
G.dead = true
Tick(2.1)
check(not ER.HasTip("checkin"), "asked while dead")
G.dead = false
Tick(2.1)
check(ER.HasTip("checkin"), "not asked once combat, flight and death were over")
Reset(6)
ER.db.tipsOff = true
Tick(2.1)
check(not ER.HasTip("checkin"), "asked with the tips hidden")
ER.db.tipsOff = nil
Tick(2.1)
check(not ER.HasTip("checkin"), "the mark came back after the tips were shown again")
Reset(6)
ER.db.checkinOff = true
Tick(2.1)
check(not ER.HasTip("checkin"), "asked with the tick off")
ER.db.checkinOff = nil
Tick(2.1)
check(not ER.HasTip("checkin"), "the mark came back after the tick was put on again")

-- e. no answer: the tip goes, nothing changes, the mark is done
Reset(6)
Tick(2.1)
check(ER.HasTip("checkin"), "no check-in for the no-answer case")
Tick(301)
check(not ER.HasTip("checkin"), "the check-in is still there after 300 seconds")
check(ER.AdaptShift() == 0, "no answer moved the shift to " .. ER.AdaptShift())
Tick(2.1)
check(not ER.HasTip("checkin"), "the mark was asked again after the tip ran out")

-- f. Too hard, down to -2 and no further; Casual has nothing easier to offer
Reset(6)
Tick(2.1)
Press("checkin", "Too hard")
check(ER.AdaptShift() == -1, "Too hard once: " .. ER.AdaptShift())
Reset(6)
ER.db.adapt[ER.Char()] = { shift = -1 }
Tick(2.1)
Press("checkin", "Too hard")
check(ER.AdaptShift() == -2, "Too hard twice: " .. ER.AdaptShift())
check(TipText("checkin:ok") == "Got it: quests up to 1 level above you.", "the low confirm says " .. tostring(TipText("checkin:ok")))
check(S.Comfort() == 1, "the comfort went to " .. S.Comfort())
ER.RemoveTips("checkin")
ER.db.adapt[ER.Char()].asked = 0
G.level = 9
Tick(2.1)
Press("checkin", "Too hard")
check(ER.AdaptShift() == -2, "a third Too hard moved it to " .. ER.AdaptShift())
check(not ER.HasTip("checkin"), "Casual offered an easier mode")
check(ER.Mode() == "casual", "the mode changed to " .. ER.Mode())
check(TipText("checkin:ok") == "Got it: quests up to 1 level above you.", "the third confirm says " .. tostring(TipText("checkin:ok")))

-- g. About right changes nothing
Reset(6)
ER.db.adapt[ER.Char()] = { shift = 1 }
Tick(2.1)
Press("checkin", "About right")
check(ER.AdaptShift() == 1, "About right moved the shift to " .. ER.AdaptShift())

-- h. at the edge: offer another difficulty
Reset(6)
ER.db.adapt[ER.Char()] = { shift = 2 }
Tick(2.1)
Press("checkin", "Too easy")
check(TipText("checkin") == "Try Medium?", "the edge says " .. tostring(TipText("checkin")))
check(Labels("checkin") == "Switch|No", "the edge buttons are " .. Labels("checkin"))
check(ER.AdaptShift() == 2, "the offer moved the shift to " .. ER.AdaptShift())
CHAT = ""
Press("checkin", "No")
check(ER.Mode() == "casual" and ER.AdaptShift() == 2, "No changed the mode or shift")
check(not ER.HasTip("checkin"), "the offer is still there after No")
Reset(6)
ER.db.adapt[ER.Char()] = { shift = 2 }
Tick(2.1)
Press("checkin", "Too easy")
Press("checkin", "Switch")
check(ER.Mode() == "medium", "Switch left the mode at " .. ER.Mode())
check(ER.AdaptShift() == 0, "Switch left the shift at " .. ER.AdaptShift())
check(TipText("checkin:ok") == "Got it: Medium from now on, quests up to 3 levels above you.", "the switch confirm says " .. tostring(TipText("checkin:ok")))
check(CHAT == "", "the switch said something in chat: " .. CHAT)
-- Hard, shift -2, Too hard -> Medium; Medium, shift +2, Too easy -> Hard
ER.db.mode = "hard"
Reset(6)
ER.db.adapt[ER.Char()] = { shift = -2 }
Tick(2.1)
Press("checkin", "Too hard")
check(TipText("checkin") == "Try Medium?", "Hard / too hard says " .. tostring(TipText("checkin")))
ER.db.mode = "medium"
Reset(6)
ER.db.adapt[ER.Char()] = { shift = 2 }
Tick(2.1)
Press("checkin", "Too easy")
check(TipText("checkin") == "Try Hard?", "Medium / too easy says " .. tostring(TipText("checkin")))
Press("checkin", "Switch")
check(ER.Mode() == "hard", "Switch to Hard left the mode at " .. ER.Mode())

-- i. a spoiled save does no harm
ER.db.adapt[ER.Char()] = { shift = "much", asked = "x", deaths = 5, hard = "yes" }
check(ER.AdaptShift() == 0, "a spoiled shift gave " .. tostring(ER.AdaptShift()))
ER.db.adapt[ER.Char()] = { shift = 9 }
check(ER.AdaptShift() == 2, "a shift of 9 gave " .. tostring(ER.AdaptShift()))

-- j. SetMode: the chat line only when not quiet
ER.db.mode = "casual"
CHAT = ""
ER.SetMode("hard", true)
check(CHAT == "" and ER.Mode() == "hard", "a quiet SetMode printed " .. CHAT)
ER.SetMode("medium")
check(string.find(CHAT, "mode is now", 1, true), "the plain SetMode printed nothing")

-- the end: nothing left behind
ER.RemoveTips("checkin")
S.Stop()
Tick(2.1)
ER.db.adapt[ER.Char()] = nil
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff, ER.db.simple = was.mode, was.autoNextOff, was.simple
ER.db.tipsOff, ER.db.checkinOff = was.tipsOff, was.checkinOff
G.units, G.taxi, G.dead = was.units, was.taxi, was.dead
G.sub, G.minimapZone, G.zone = was.sub, was.minimapZone, was.zone
G.level, G.race, G.class, G.faction = was.level, was.race, was.class, was.faction
`, "section 34");

console.log("35. Died twice or skipped: Hard for this character");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, class = G.class, faction = G.faction,
  zone = G.zone, simple = ER.db.simple, tipsOff = ER.db.tipsOff, checkinOff = ER.db.checkinOff, instance = G.instance,
  current = S.Current, side = S.Side, ratings = ER.db.ratings, GetRating = ER.GetRating, SetRating = ER.SetRating,
  Coloured = ER.Coloured, Suggest = ER.Suggest, Active = ER.Recorder.Active, InfoFor = ER.Recorder.InfoFor }
-- The rating store and the guess live in Core.lua, which this VM does not load: small stand-ins.
ER.GetRating = function(title) return ER.db.ratings[title] end
ER.SetRating = function(title, rating) ER.db.ratings[title] = { rating = rating } end
ER.Coloured = function(key) return string.upper(string.sub(key, 1, 1)) .. string.sub(key, 2) end
ER.Suggest = function() return "medium", nil, "a plain quest" end
ER.Recorder.Active = function() return {} end
ER.Recorder.InfoFor = function(title, row) return { pfid = row and row.pfid } end
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi, G.dead, G.instance = {}, {}, {}, false, false, nil
ER.db.mode, ER.db.autoNextOff, ER.db.guides, ER.db.done, ER.db.simple = "casual", true, {}, {}, nil
ER.db.checkinOff, ER.db.tipsOff = true, nil
ER.db.ratings = {}
S.Stop()
Tick(2.1)

local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  return (string.gsub(s, "|r", ""))
end
local function TipOf(key)
  for _, tip in ipairs(ER.TipsList()) do
    if tip.key == key then return tip end
  end
  return nil
end
local function TipText(key)
  local tip = TipOf(key)
  return tip and PlainText(tip.text) or nil
end
local function Press(key, label)
  local tip = TipOf(key)
  for _, b in ipairs(tip and tip.buttons or {}) do
    if b.label == label then b.fn() return true end
  end
  return false
end
local function Labels(key)
  local tip, out = TipOf(key), {}
  for _, b in ipairs(tip and tip.buttons or {}) do table.insert(out, b.label) end
  return table.concat(out, "|")
end
local function Mine()
  ER.AdaptShift() -- makes the saved data when there is none yet
  return ER.db.adapt[ER.Char()]
end
local function Fresh()
  ER.db.adapt[ER.Char()] = nil
  ER.RemoveTips("died:")
  ER.RemoveTips("skip")
  G.instance = nil
  G.log, G.order = {}, {}
  Fire("QUEST_LOG_UPDATE")
end
local function InLog(id)
  local t = S.QuestTitle(id)
  G.log[t] = { complete = false, objs = {} }
  table.insert(G.order, t)
  Fire("QUEST_LOG_UPDATE")
  return t
end
local function Dummy(elements, n)
  local step = { n = n or 900, flags = {}, elements = elements }
  S.Current = function() return step end
  S.Side = function() return {} end
  return step
end
ER.db.adapt = ER.db.adapt or {}
Fresh()

local infos = ER.RouteGuides()
check(ER.StartGuide(S.Key(infos[1]), true), "the Orc Durotar visit did not start")
check(S.Running(), "no guide is running")
Tick(2.1)

-- two real quests of the visit: Q (a step finishes it) and R (a step picks it up), and the steps they sit in
local Q, R, qStep, rStep
for n = 1, S.Count() do
  local step = S.Step(n)
  local quests, who = 0, nil
  for _, e in ipairs(step.elements) do
    if (e.kind == "A" or e.kind == "C" or e.kind == "K") and e.id and e.id ~= 0 then quests = quests + 1 who = who or e end
  end
  if quests == 1 and who then
    if not Q and (who.kind == "C" or who.kind == "K") and S.QuestTitle(who.id) then Q, qStep = who.id, n end
    if not R and who.kind == "A" and S.QuestTitle(who.id) and who.id ~= Q then R, rStep = who.id, n end
  end
end
check(Q ~= nil and R ~= nil, "no finish step and pick-up step with one quest each were found")
local titleQ, titleR = S.QuestTitle(Q), S.QuestTitle(R)
local QLine = { { kind = "C", id = Q, text = "Dummy" } }
CHAT = ""

-- a. the first death counts, the second makes it Hard
Fresh()
InLog(Q)
Dummy(QLine)
Fire("PLAYER_DEAD")
check(Mine().deaths[Q] == 1, "one death counted " .. tostring(Mine().deaths[Q]))
check(ER.LearnedHard(Q) == nil, "Hard after one death")
check(not ER.HasTip("died:" .. Q), "a tip after one death")
Fire("PLAYER_DEAD")
check(Mine().hard[Q] == "died", "two deaths gave " .. tostring(Mine().hard[Q]))
check(ER.LearnedHard(Q) == "died", "LearnedHard says " .. tostring(ER.LearnedHard(Q)))
check(string.find(S.Kinds(Q), "m", 1, true), "Kinds has no m: " .. S.Kinds(Q))
check(TipText("died:" .. Q) == "You died twice on " .. titleQ .. ". I will count it as Hard from now on. You can abandon it in your quest log.",
  "the died tip says " .. tostring(TipText("died:" .. Q)))
check(Labels("died:" .. Q) == "Skip it|Keep going", "the died buttons are " .. Labels("died:" .. Q))
check(not string.find(CHAT, "died twice", 1, true), "the died tip went to chat: " .. CHAT)
Fire("PLAYER_DEAD")
check(Mine().deaths[Q] == 3 and Mine().hard[Q] == "died", "a third death changed the mark")

-- b. in the log it stays; once it is out of the log it is left out on Casual and Medium, not on Hard
check(S.LeftOut(Q) == false, "a quest in the log is left out")
G.log, G.order = {}, {}
Fire("QUEST_LOG_UPDATE")
check(S.LeftOut(Q) == true, "Casual does not leave out the quest it died on")
ER.db.mode = "medium"
check(S.LeftOut(Q) == true, "Medium does not leave out the quest it died on")
ER.db.mode = "hard"
check(S.LeftOut(Q) == false, "Hard leaves out the quest it died on")
ER.db.mode = "casual"

-- c. Keep going removes the tip and changes nothing else
InLog(Q)
Press("died:" .. Q, "Keep going")
check(not ER.HasTip("died:" .. Q), "the tip is still there after Keep going")
check(Mine().hard[Q] == "died", "Keep going changed the mark")

-- d. Skip it moves the guide on and never touches the quest log
Fresh()
S.Current, S.Side = was.current, was.side
S.Jump(qStep)
check(S.Position() == qStep, "the jump went to " .. S.Position() .. " not " .. qStep)
InLog(Q)
Fire("PLAYER_DEAD")
Fire("PLAYER_DEAD")
check(ER.HasTip("died:" .. Q), "no died tip on the real step")
local at = S.Position()
Press("died:" .. Q, "Skip it")
check(S.Position() > at, "Skip it left the guide at step " .. S.Position())
check(G.log[titleQ] ~= nil, "Skip it took the quest out of the log")
check(not ER.HasTip("skip"), "Skipping the quest it died on said it was left out")

-- e. no charge: instance, no guide, finished quest, hand-in and travel steps
Fresh()
InLog(Q)
Dummy(QLine)
G.instance = true
Fire("PLAYER_DEAD")
Fire("PLAYER_DEAD")
check(Mine().deaths[Q] == nil and ER.LearnedHard(Q) == nil, "a death in an instance was charged")
G.instance = nil
G.log[titleQ].complete = true
Fire("QUEST_LOG_UPDATE")
Fire("PLAYER_DEAD")
Fire("PLAYER_DEAD")
check(Mine().deaths[Q] == nil, "a finished quest was charged")
G.log[titleQ].complete = false
Fire("QUEST_LOG_UPDATE")
Dummy({ { kind = "T", id = Q, text = "Dummy" } })
Fire("PLAYER_DEAD")
Fire("PLAYER_DEAD")
check(Mine().deaths[Q] == nil, "a hand-in step was charged")
Dummy({ { kind = "G", zone = "Durotar", x = 50, y = 50, text = "Go" }, { kind = "A", id = Q, text = "Dummy" } })
Fire("PLAYER_DEAD")
check(Mine().deaths[Q] == nil, "a travel step was charged")
Dummy(QLine)
S.Stop()
Fire("PLAYER_DEAD")
Fire("PLAYER_DEAD")
check(Mine().deaths[Q] == nil, "a death with no guide running was charged")
check(ER.StartGuide(S.Key(infos[1]), true), "the visit did not start again")
Tick(2.1)

-- f. skipping: the quests a step picks up
Fresh()
S.Current, S.Side = was.current, was.side
S.Jump(rStep)
check(S.Position() == rStep, "the jump went to " .. S.Position() .. " not " .. rStep)
S.Next(true)
check(Mine().hard[R] == "skip", "skipping the pick-up marked " .. tostring(Mine().hard[R]))
check(TipText("skip") == "Left out from now on: " .. titleR .. " (you skipped them).", "the skip tip says " .. tostring(TipText("skip")))
check(TipOf("skip").life == 20, "the skip tip lasts " .. tostring(TipOf("skip").life))
check(string.find(S.Kinds(R), "m", 1, true), "a skipped quest has no m")
check(not string.find(CHAT, "Left out from now on", 1, true), "the skip tip went to chat")
-- two quests, and one already marked "died" stays "died"
Fresh()
local R2 = Q
Mine().hard[R2] = "died"
ER.OnStepSkipped({ n = 901, flags = {}, elements = { { kind = "A", id = R, text = "x" }, { kind = "A", id = R2, text = "y" } } })
check(Mine().hard[R2] == "died", "a died mark became " .. tostring(Mine().hard[R2]))
check(TipText("skip") == "Left out from now on: " .. titleR .. " (you skipped them).", "one new quest says " .. tostring(TipText("skip")))
Fresh()
local other
for id, title in pairs(EasyRoute_GuideQuests) do
  if id ~= R and id ~= Q and title ~= titleR and title ~= titleQ and not S.InLog(id) and not S.TurnedIn(id) and not S.LeftOut(id) then other = id break end
end
check(other ~= nil, "no second quest found")
ER.OnStepSkipped({ n = 902, flags = {}, elements = { { kind = "A", id = R, text = "x" }, { kind = "A", id = other, text = "y" } } })
check(TipText("skip") == "Left out from now on: " .. titleR .. " and " .. S.QuestTitle(other) .. " (you skipped them).",
  "two quests say " .. tostring(TipText("skip")))
Fresh()
ER.OnStepSkipped({ n = 903, flags = {}, elements = { { kind = "T", id = R, text = "x" } } })
check(next(Mine().hard) == nil and not ER.HasTip("skip"), "skipping a hand-in marked something")
-- a quest already handed in or already in the log is not marked
Fresh()
ER.db.done[ER.Char()] = { [R] = true }
ER.OnStepSkipped({ n = 904, flags = {}, elements = { { kind = "A", id = R, text = "x" } } })
check(Mine().hard[R] == nil, "a handed-in quest was marked")
ER.db.done = {}
InLog(R)
ER.OnStepSkipped({ n = 905, flags = {}, elements = { { kind = "A", id = R, text = "x" } } })
check(Mine().hard[R] == nil, "a quest in the log was marked")

-- g. your own Hard rating counts
Fresh()
check(ER.LearnedHard(R) == nil, "R is Hard before anything")
ER.SetRating(titleR, "hard")
check(ER.LearnedHard(R) == "rated", "an own Hard rating gives " .. tostring(ER.LearnedHard(R)))
ER.SetRating(titleR, "easy")
check(ER.LearnedHard(R) == nil, "an own Easy rating gives " .. tostring(ER.LearnedHard(R)))
-- clicking the How hard line: medium -> hard sets the mark, hard -> easy takes a rated mark away, died stays
InLog(R)
Dummy({ { kind = "C", id = R, text = "Dummy" } })
ER.SetRating(titleR, "medium")
local line = ER.QuestRateLine(S.Current())
check(line and line.rate.rating == "medium" and line.rate.id == R, "the rate line is not medium for R")
ER.NextQuestRating(line.rate)
check(Mine().hard[R] == "rated", "moving to Hard marked " .. tostring(Mine().hard[R]))
line = ER.QuestRateLine(S.Current())
ER.NextQuestRating(line.rate)
check(Mine().hard[R] == nil and ER.GetRating(titleR, R).rating == "easy", "moving on to Easy left " .. tostring(Mine().hard[R]))
Mine().hard[R] = "died"
line = ER.QuestRateLine(S.Current())
ER.NextQuestRating(line.rate)
check(Mine().hard[R] == "died", "an Easy rating took away a died mark")

-- h. the How hard line says why
Fresh()
ER.db.ratings = {}
InLog(R)
Dummy({ { kind = "C", id = R, text = "Dummy" } })
local function Why()
  local l = ER.QuestRateLine(S.Current())
  return l and PlainText(l.text) or "no line"
end
Mine().hard[R] = "died"
check(string.find(Why(), "How hard: Hard (my guess: you died twice on it, click to change)", 1, true), "died line: " .. Why())
Mine().hard[R] = "skip"
check(string.find(Why(), "How hard: Hard (my guess: you skipped it, click to change)", 1, true), "skip line: " .. Why())
Mine().hard[R] = nil
local savedKinds = S.Kinds
S.Kinds = function(id) return id == R and "h" or "" end
check(string.find(Why(), "How hard: Hard (my guess: friends found it hard, click to change)", 1, true), "friends line: " .. Why())
S.Kinds = savedKinds
check(not string.find(Why(), "my guess:", 1, true), "a reason shows for a plain quest: " .. Why())
ER.SetRating(titleR, "easy")
Mine().hard[R] = "died"
check(string.find(Why(), "your answer, click to change", 1, true) and not string.find(Why(), "died", 1, true), "own answer line: " .. Why())

-- i. /er unskip brings everything back
Fresh()
Mine().hard[Q] = "died"
Mine().deaths[Q] = 2
ER.SkipQuest(R)
CHAT = ""
ER.ClearSkipped()
check(next(Mine().hard) == nil and next(Mine().deaths) == nil, "unskip left learned marks")
check(ER.LearnedHard(Q) == nil, "LearnedHard after unskip " .. tostring(ER.LearnedHard(Q)))
check(next(ER.db.skipped) == nil, "unskip left skipped quests")

-- the end: nothing left behind
Fresh()
S.Current, S.Side = was.current, was.side
S.Stop()
Tick(2.1)
ER.db.adapt[ER.Char()] = nil
ER.db.guides, ER.db.done, ER.db.skipped = {}, {}, {}
ER.db.ratings = was.ratings
ER.GetRating, ER.SetRating, ER.Coloured, ER.Suggest = was.GetRating, was.SetRating, was.Coloured, was.Suggest
ER.Recorder.Active, ER.Recorder.InfoFor = was.Active, was.InfoFor
ER.db.mode, ER.db.autoNextOff, ER.db.simple = was.mode, was.autoNextOff, was.simple
ER.db.tipsOff, ER.db.checkinOff = was.tipsOff, was.checkinOff
G.instance = was.instance
G.log, G.order = {}, {}
G.level, G.race, G.class, G.faction, G.zone = was.level, was.race, was.class, was.faction, was.zone
`, "section 35");

console.log("36. Chains whose walk is not worth it are left out on Casual");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, class = G.class, faction = G.faction, zone = G.zone, chains = EasyRoute_Chains }
ER.db.autoNextOff = true
CHAIN_DUMP = ""
local RACES = { { race = "Orc", faction = "Horde" }, { race = "Human", faction = "Alliance" } }

-- a. the data file and the reader
check(type(EasyRoute_Chains) == "table" and EasyRoute_Chains.version == 1, "Data/Chains.lua did not load")
check(type(ER.RouteReader.ReadChain) == "function" and ER.RouteReader.ReadChain("x") == nil, "ReadChain is missing or takes a non-table")
local function Nums(race)
  local out = {}
  for text in string.gfind(EasyRoute_Chains.races[race] or "", "[^,]+") do table.insert(out, tonumber(text)) end
  return out
end

-- b. a chain the worth rule leaves out on Casual and keeps on Medium and Hard
local pick
for _, r in ipairs(RACES) do
  if not pick then
    for _, n in ipairs(Nums(r.race)) do
      local wc, kc = ER._testChainVerdict(r.race, n, "casual", "WARRIOR")
      local wm = ER._testChainVerdict(r.race, n, "medium", "WARRIOR")
      local wh = ER._testChainVerdict(r.race, n, "hard", "WARRIOR")
      if not wc and kc >= 3 and wm and wh then
        pick = { race = r.race, faction = r.faction, n = n }
        break
      end
    end
  end
end
check(pick ~= nil, "no chain is left out on Casual by the worth rule")

-- c. quests in no chain's own part are never cut by the chain rule, on any difficulty
for _, r in ipairs(RACES) do
  G.race, G.faction = r.race, r.faction
  local own = {}
  for _, n in ipairs(Nums(r.race)) do
    for _, s in ipairs(ER.RouteReader.ReadChain(EasyRoute_Chains.chains[n]).steps) do own[s.id] = true end
  end
  local checked, bad = 0, 0
  for _, i in ipairs(ER.RouteGuides()) do
    for _, area in ipairs(ER.RouteReader.ReadVisit(i.visit)) do
      for _, q in ipairs(area.q) do
        if q.id and not own[q.id] then
          checked = checked + 1
          for _, m in ipairs({ "casual", "medium", "hard" }) do
            if ER._testChainCut(r.race, q.id, m, "WARRIOR") then bad = bad + 1 end
          end
        end
      end
    end
  end
  check(checked > 100, r.race .. ": only " .. checked .. " quests outside the chains")
  check(bad == 0, r.race .. ": " .. bad .. " quests outside the chains were cut by the chain rule")
end

if pick then
  local read = ER.RouteReader.ReadChain(EasyRoute_Chains.chains[pick.n])
  local X = read.steps[1].id
  local Y2 = read.steps[2].id
  G.race, G.class, G.faction = pick.race, "WARRIOR", pick.faction
  local info
  for _, i in ipairs(ER.RouteGuides()) do
    for _, area in ipairs(ER.RouteReader.ReadVisit(i.visit)) do
      for _, q in ipairs(area.q) do
        if q.id == X and not info then info = i end
      end
    end
  end
  check(info ~= nil, "the first step " .. X .. " is in no visit of the " .. pick.race .. " path")
  print("  chain left out on Casual: " .. X .. " " .. tostring(S.QuestTitle(X)) .. ", " .. table.getn(read.steps) .. " steps")
  if info then
    local areas = ER.RouteReader.ReadVisit(info.visit)
    G.dead, G.taxi, G.level = false, false, info.lo
    G.log, G.order, G.bags = {}, {}, {}
    ER.db.guides, ER.db.done = {}, {}
    S.Stop()
    Tick(2)
    G.zone, G.x, G.y = info.visit.zone, areas[1].x, areas[1].y
    check(ER.StartGuide(S.Key(info), true), "the visit of quest " .. X .. " did not start")
    Tick(2)

    -- d. Casual leaves the whole own part out, Medium and Hard keep it
    ER.db.mode = "casual"
    check(S.LeftOut(X) == true, "the first quest of the chain is kept on Casual")
    for _, s in ipairs(read.steps) do
      check(ER._testChainCut(pick.race, s.id, "casual", "WARRIOR") == true, "step " .. s.id .. " of the chain is kept on Casual")
    end
    ER.db.mode = "medium"
    check(S.LeftOut(X) == false, "the first quest of the chain is left out on Medium")
    ER.db.mode = "hard"
    check(S.LeftOut(X) == false, "the first quest of the chain is left out on Hard")
    for _, m in ipairs({ "medium", "hard" }) do
      for _, s in ipairs(read.steps) do
        check(ER._testChainCut(pick.race, s.id, m, "WARRIOR") == false, "step " .. s.id .. " of the chain is cut on " .. m)
      end
    end

    -- e. a chain you started stays: the first quest in the log, then handed in
    ER.db.mode = "casual"
    local title = S.QuestTitle(X)
    G.log[title] = { complete = false, objs = {} }
    table.insert(G.order, title)
    check(S.LeftOut(X) == false, "the first quest is left out on Casual while it is in the log")
    check(ER._testChainCut(pick.race, Y2, "casual", "WARRIOR") == false, "the second step is cut while the first is in the log")
    G.log, G.order = {}, {}
    ER.db.done[ER.Char()] = { [X] = true }
    check(not S.InLog(X) and S.TurnedIn(X), "the first quest is not handed in")
    check(ER._testChainCut(pick.race, Y2, "casual", "WARRIOR") == false, "the second step is cut after the first was handed in")
    ER.db.done = {}
    check(ER._testChainCut(pick.race, Y2, "casual", "WARRIOR") == true, "the second step is kept again once nothing is started")

    -- f. no data file: nothing is cut and nothing breaks
    EasyRoute_Chains = nil
    ER._testChainReset()
    check(S.LeftOut(X) == false, "the first quest is left out on Casual without Data/Chains.lua")
    check(ER._testChainCut(pick.race, Y2, "casual", "WARRIOR") == false, "a step is cut without Data/Chains.lua")
    EasyRoute_Chains = was.chains
    ER._testChainReset()
    check(S.LeftOut(X) == true, "the first quest is kept on Casual with Data/Chains.lua back")
  end
end

-- g. every verdict for the JS side to compare with
local parts = {}
for _, r in ipairs(RACES) do
  for _, n in ipairs(Nums(r.race)) do
    for _, m in ipairs({ "casual", "medium", "hard" }) do
      for _, c in ipairs({ "WARRIOR", "MAGE", "ROGUE", "PALADIN", "PRIEST", "none" }) do
        local token = c
        if c == "none" then token = false end
        local worth, kept, value, walk = ER._testChainVerdict(r.race, n, m, token)
        table.insert(parts, r.race .. " " .. n .. " " .. m .. " " .. c .. " " .. tostring(worth) .. " " .. kept .. " " .. string.format("%.6f", value) .. " " .. string.format("%.6f", walk))
      end
    end
  end
end
CHAIN_DUMP = table.concat(parts, "\\n")

-- The end: nothing left behind.
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
G.log, G.order = {}, {}
EasyRoute_Chains = was.chains
ER._testChainReset()
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.level, G.race, G.class, G.faction, G.zone = was.level, was.race, was.class, was.faction, was.zone
`, "section 36");
{
  // The JS judge must give what the game's judge gives, for every chain of the Orc and Human paths, on every difficulty and for six class cases.
  const CH = require("./lib/chains.js");
  const vm = newLuaVM();
  vm.run(fs.readFileSync(path.join(ROOT, "Data/Route.lua")), "Data/Route.lua");
  vm.run(fs.readFileSync(path.join(ROOT, "Data/Chains.lua")), "Data/Chains.lua");
  const route = vm.get("EasyRoute_Route");
  const chainData = vm.get("EasyRoute_Chains");
  const leaveOut = CH.readLeaveOut(fs.readFileSync(path.join(ROOT, "Steps.lua"), "utf8"));
  const flagsOfRace = (race) => {
    const out = {};
    for (const number of route.paths[race]) {
      const v = Array.isArray(route.visits) ? route.visits[number - 1] : route.visits[String(number)];
      for (const line of String(v.areas).split("\n")) {
        const f = line.split("\t");
        if (f[0] === "Q" && out[f[1]] === undefined) out[f[1]] = f[2] || "";
      }
    }
    return out;
  };
  const chainAt = (n) => Array.isArray(chainData.chains) ? chainData.chains[n - 1] : chainData.chains[String(n)];
  const flagTable = { Orc: flagsOfRace("Orc"), Human: flagsOfRace("Human") };
  let compared = 0;
  for (const line of getString("CHAIN_DUMP").split("\n")) {
    if (!line) continue;
    const [race, n, mode, cls, worth, kept, value, walk] = line.split(" ");
    const parsed = CH.parseChain(chainAt(Number(n)));
    const letter = cls === "none" ? "" : CH.CLASS_LETTERS[cls];
    const j = CH.judge(parsed, mode, letter, (i) => {
      const f = flagTable[race][String(parsed.steps[i].id)];
      return f === undefined || CH.leftBy(f, mode, leaveOut);
    });
    compared++;
    jsCheck(String(j.worth) === worth && j.kept === Number(kept) && Math.abs(j.value - Number(value)) < 1e-5 && Math.abs(j.walk - Number(walk)) < 1e-5,
      `the game and the build disagree on ${race} chain ${n} ${mode} ${cls}: game ${line}; build worth ${j.worth} kept ${j.kept} value ${j.value} walk ${j.walk}`);
  }
  jsCheck(compared > 1000, `only ${compared} chain verdicts were compared`);
  console.log(`  ${compared} verdicts agree between the game and the build`);
}

console.log("37. The step that starts a chain says what the end gives");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, class = G.class, faction = G.faction, zone = G.zone,
  simple = ER.db.simple, orcChains = EasyRoute_Chains.races.Orc }
local danger = EasyRoute_Route.danger.Horde
G.race, G.class, G.faction, G.level = "Orc", "WARRIOR", "Horde", 1
ER.db.mode, ER.db.autoNextOff, ER.db.simple = "casual", true, nil
local function Plain(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  return (string.gsub(s, "|r", ""))
end
local function Is(got, want, what)
  check(got == want, what .. ": '" .. tostring(got) .. "' is not '" .. tostring(want) .. "'")
end
local function Reset()
  S.Stop()
  Tick(2)
  G.dead, G.taxi, G.level = false, false, 1
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  ER.db.simple = nil
end
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)
local function StartCasual()
  Reset()
  G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
  check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
  Tick(2)
end
StartCasual()
ER._testChainReset()

-- the quests: A1 is the first quest of the first step that the rules keep; the others are clean quests of the Orc path
local A1
for _, e in ipairs(S.Current().elements) do
  if not A1 and e.kind == "A" and e.id and e.id ~= 0 and not S.LeftOut(e.id) then A1 = e.id end
end
check(A1 ~= nil, "the first step has no quest the rules keep")
local clean, seenQ = {}, {}
for _, i in ipairs(ER.RouteGuides()) do
  for _, area in ipairs(ER.RouteReader.ReadVisit(i.visit)) do
    for _, q in ipairs(area.q) do
      local id = q.id
      if id and id ~= A1 and not seenQ[id] and table.getn(clean) < 16 then
        seenQ[id] = true
        if not string.find((q.flags or "") .. S.Kinds(id), "[egdsvhmu]") and not S.LeftOut(id) then table.insert(clean, id) end
      end
    end
  end
end
check(table.getn(clean) >= 14, "only " .. table.getn(clean) .. " clean quests on the Orc path")
local A2, A3 = clean[1], clean[2]

-- one chain of the test: ids, xp each, real or not, minutes each, extra walking each, h, the end items text
local chains = EasyRoute_Chains.chains
local MADE = {}
local function Make(n, ids, o)
  o = o or {}
  local lines = {}
  for i, id in ipairs(ids) do
    local real = true
    if o.est and o.est[i] then real = false end
    local v = o.v and o.v[i] or (i == 1 and 12 or 3)
    table.insert(lines, id .. "\\t" .. (i == 1 and 600 or 300) .. "\\t" .. (real and "r" or "e") .. "\\t" .. v .. "\\t" .. (o.w or 0))
  end
  chains[n] = { l = 5, h = o.h or 1000, z = "Durotar", s = table.concat(lines, "\\n"), e = o.e or "r\\t2000\\t2\\tsword\\tWPHR" }
  MADE[n] = true
end
local function Use(list)
  EasyRoute_Chains.races.Orc = list
  ER._testChainReset()
end
local function Set(o)
  Make(9999, { A1, A2, A3 }, o)
  Use("9999")
end
local STEP = { elements = { { kind = "A", id = A1 } }, flags = {} }
local function Both(want, what)
  Is(ER.ChainLine(S.Current()), want, what .. " (the real step)")
  Is(ER.ChainLine(STEP), want, what)
end
CHAT = ""

-- a. the words
Set()
Both("Chain of 3: lots of xp and a nice sword at the end.", "warrior, lots of xp and a green sword")
G.class = "MAGE"
Both("Chain of 3: lots of xp.", "mage cannot use the sword")
G.class = "WARRIOR"
Set({ h = 5000 })
Is(ER.ChainLine(STEP), "Chain of 3: worth doing for the xp and a nice sword at the end.", "worth doing for the xp")
Set({ h = 5000, v = { 2, 1, 1 } })
Is(ER.ChainLine(STEP), "Chain of 3: ends with a nice sword.", "xp saves under 10 minutes")
G.class = "MAGE"
Is(ER.ChainLine(STEP), "Chain of 3.", "mage, xp saves under 10 minutes")
G.class = "WARRIOR"
Set({ h = 5000, v = { 2, 1, 1 }, e = "r\\t2000\\t3\\tsword\\tWPHR" })
Is(ER.ChainLine(STEP), "Chain of 3: ends with a really good sword.", "a blue sword")
Set({ h = 5000, v = { 2, 1, 1 }, e = "r\\t2000\\t4\\tsword\\tWPHR" })
Is(ER.ChainLine(STEP), "Chain of 3: ends with a great sword.", "a purple sword")
for _, pair in ipairs({ "gloves", "boots", "leggings", "shoulders", "bracers" }) do
  Set({ h = 5000, v = { 2, 1, 1 }, e = "r\\t2000\\t2\\t" .. pair .. "\\tWPHR" })
  Is(ER.ChainLine(STEP), "Chain of 3: ends with nice " .. pair .. ".", "green " .. pair .. " have no 'a'")
end
Set({ e = "r\\t2000\\t3\\tgloves\\tWPHR" })
Is(ER.ChainLine(STEP), "Chain of 3: lots of xp and really good gloves at the end.", "blue gloves with lots of xp")
-- at level 60 quests give no xp: no xp words (the quest is kept here only for the check)
local level60, leftOut60 = G.level, S.LeftOut
G.level, S.LeftOut = 60, function() return false end
Set()
Is(ER.ChainLine(STEP), "Chain of 3: ends with a nice sword.", "level 60 gets no xp words")
G.level, S.LeftOut = level60, leftOut60
Set({ h = 5000, v = { 2, 1, 1 }, e = "r\\t2000\\t1\\tsword\\tWPHR" })
Is(ER.ChainLine(STEP), "Chain of 3.", "a white sword is not mentioned")
Set({ h = 5000, v = { 2, 1, 1 }, e = "r\\t2000\\t2\\t\\tWPHR" })
Is(ER.ChainLine(STEP), "Chain of 3.", "a green item that is not gear is not mentioned")
local TOME = "r\\t90001\\t?\\t\\t\\tTome of Polymorph: Rodent"
Set({ h = 5000, v = { 2, 1, 1 }, e = TOME })
Is(ER.ChainLine(STEP), "Chain of 3: ends with Tome of Polymorph: Rodent.", "an unknown item that is the only reward (warrior)")
G.class = "MAGE"
Is(ER.ChainLine(STEP), "Chain of 3: ends with Tome of Polymorph: Rodent.", "an unknown item that is the only reward (mage)")
G.class = "WARRIOR"
Set({ h = 5000, v = { 2, 1, 1 }, e = TOME .. "\\nr\\t90002\\t?\\t\\t\\tOther Thing" })
Is(ER.ChainLine(STEP), "Chain of 3.", "two unknown items are not named")
Set({ est = { false, true, true } })
Is(ER.ChainLine(STEP), "Chain of 3: ends with a nice sword.", "mostly estimated xp gives no xp words")

-- b. a chain that is not worth its walk on Casual
Set({ w = 6 })
check(S.LeftOut(A1) == true, "the first quest is kept on Casual with a long walk")
Is(ER.ChainLine(STEP), nil, "Casual, a long walk for little")
ER.db.mode = "medium"
check(S.LeftOut(A1) == false, "the first quest is left out on Medium with a long walk")
Is(ER.ChainLine(STEP), "Chain of 3: lots of xp and a nice sword at the end.", "Medium keeps the long walk")
ER.db.mode = "casual"

-- c. a chain cut short by a hard quest at its end is not judged
Set()
local savedDanger = danger[A3]
danger[A3] = "e"
ER._testChainReset()
Is(ER.ChainLine(STEP), nil, "Casual, an elite makes the chain 2 steps")
ER.db.mode = "medium"
Is(ER.ChainLine(STEP), nil, "Medium, an elite makes the chain 2 steps")
ER.db.mode = "hard"
local hardLine = ER.ChainLine(STEP)
Is(string.sub(hardLine or "", 1, 10), "Chain of 3", "Hard counts all 3 steps")
danger[A3] = savedDanger
ER.db.mode = "casual"
ER._testChainReset()

-- d. several chains on one step: two lines, then how many more
local function Three(count)
  local firsts = {}
  local pos = 3
  local list = {}
  for k = 1, count do
    local n = 9999 - k + 1
    local a, b, c = clean[pos], clean[pos + 1], clean[pos + 2]
    pos = pos + 3
    Make(n, { a, b, c })
    table.insert(firsts, { kind = "A", id = a })
    table.insert(list, tostring(n))
  end
  Use(table.concat(list, ","))
  return { elements = firsts, flags = {} }
end
local function Split(text)
  local out = {}
  for line in string.gfind(text or "", "[^\\n]+") do table.insert(out, line) end
  return out
end
Set()
local many = Three(3)
local got = Split(ER.ChainLine(many))
Is(table.getn(got), 3, "three chains give this many lines")
check(string.sub(got[1] or "", 1, 9) == "Chain of " and string.sub(got[2] or "", 1, 9) == "Chain of ", "the first two lines are chains: " .. table.concat(got, " | "))
Is(got[3], "And 1 more chain.", "the third line")
many = Three(4)
got = Split(ER.ChainLine(many))
Is(table.getn(got), 3, "four chains give this many lines")
Is(got[3], "And 2 more chains.", "the third line of four")

-- e. a quest in the log or handed in gets no line
Set()
local title = S.QuestTitle(A1)
G.log[title] = { complete = false, objs = {} }
table.insert(G.order, title)
Is(ER.ChainLine(STEP), nil, "the first quest is in the log")
G.log, G.order = {}, {}
ER.db.done[ER.Char()] = { [A1] = true }
Is(ER.ChainLine(STEP), nil, "the first quest is handed in")
ER.db.done = {}
Is(ER.ChainLine(nil), nil, "no step")
Is(ER.ChainLine({ flags = {} }), nil, "a step with no elements")
Is(ER.ChainLine({ elements = { { kind = "K", id = A1 } }, flags = {} }), nil, "a step with no quest to take")

-- f. the step box holds the line once
Set()
StartCasual()
ER.StepsChanged()
Tick(2)
CHAT = ""
local want = "Chain of 3: lots of xp and a nice sword at the end."
local shown = Plain(ShownLines())
local count, from = 0, 1
while true do
  local s, e = string.find(shown, want, from, true)
  if not s then break end
  count = count + 1
  from = e + 1
end
Is(count, 1, "the box holds the chain line this many times (" .. shown .. ")")
check(CHAT == "", "the chain line said something in chat: " .. CHAT)

-- g. Simple mode: one tip with the key chain:<step>; with the step box it is not a tip
local key = "chain:" .. S.Current().n
check(not ER.HasTip(key), "a chain tip shows with the step box up")
ER.SetSimple(true)
Tick(2.1)
check(ER.HasTip(key), "Simple mode has no chain tip " .. key)
local tipText
for _, tip in ipairs(ER.TipsList()) do
  if tip.key == key then tipText = Plain(tip.text) end
end
Is(tipText, want, "the chain tip")
check(not string.find(CHAT, "Chain of", 1, true), "the chain tip said something in chat: " .. CHAT)
ER.SetSimple(false)
Tick(2.1)
check(not ER.HasTip(key), "the chain tip stays after Simple mode went off")
ER.RemoveTips("chain:")

-- h. a Fast route guide: every chain has its line there, and nothing is left out by the chain rule
Set({ w = 6 })
Reset()
G.zone = "Durotar"
CHAT = ""
local fast
for _, g in ipairs(S.Guides()) do
  if not g.route and not fast then fast = g end
end
check(fast ~= nil, "no Fast route guide for the Orc")
check(S.Load(S.Key(fast), true), "the Fast route guide did not load")
Tick(2)
CHAT = ""
check(not S.Info().route, "the Fast route guide is a casual route")
Is(ER.ChainLine(STEP), "Chain of 3: lots of xp and a nice sword at the end.", "Fast route, Casual, long walk")
check(ER.RouteLeftOut(A1) == false, "the chain rule left a quest out of the Fast route guide")
check(not string.find(CHAT, "Chain of", 1, true), "the Fast route line said something in chat: " .. CHAT)

-- the end: nothing left behind
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
G.log, G.order = {}, {}
for n in pairs(MADE) do chains[n] = nil end
EasyRoute_Chains.races.Orc = was.orcChains
danger[A3] = savedDanger
ER._testChainReset()
ER.db.simple = was.simple
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.level, G.race, G.class, G.faction, G.zone = was.level, was.race, was.class, was.faction, was.zone
`, "section 37");

console.log("38. The JS and Lua chain rules agree");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, class = G.class, faction = G.faction, zone = G.zone,
  simple = ER.db.simple }
ER.db.autoNextOff, ER.db.simple = true, nil
CHAIN38_DUMP = ""
CHAIN38_LINES = 0
CHAIN38_EASY = 0
local RACES = { { race = "Orc", faction = "Horde" }, { race = "Human", faction = "Alliance" } }
local MODES = { "casual", "medium", "hard" }
local CLASSES = { "WARRIOR", "MAGE" }
local out = {}
local function Nums(race)
  local list = {}
  for text in string.gfind(EasyRoute_Chains.races[race] or "", "[^,]+") do table.insert(list, tonumber(text)) end
  return list
end
local function Reset()
  S.Stop()
  Tick(2)
  G.dead, G.taxi = false, false
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
end

for _, r in ipairs(RACES) do
  G.race, G.faction, G.class = r.race, r.faction, "WARRIOR"
  ER.db.mode = "casual"
  ER._testChainReset()
  local nums = Nums(r.race)
  check(table.getn(nums) > 20, r.race .. ": only " .. table.getn(nums) .. " chains")

  -- a. every verdict, for the JS side to compare with
  for _, n in ipairs(nums) do
    for _, m in ipairs(MODES) do
      for _, c in ipairs(CLASSES) do
        local worth, kept = ER._testChainVerdict(r.race, n, m, c)
        table.insert(out, r.race .. " " .. n .. " " .. m .. " " .. c .. " " .. tostring(worth) .. " " .. kept)
      end
    end
  end

  -- b. no chain is half cut: all its steps are cut or none is, on every difficulty
  for _, n in ipairs(nums) do
    local read = ER.RouteReader.ReadChain(EasyRoute_Chains.chains[n])
    for _, m in ipairs(MODES) do
      local first = ER._testChainCut(r.race, read.steps[1].id, m, "WARRIOR")
      for _, s in ipairs(read.steps) do
        if ER._testChainCut(r.race, s.id, m, "WARRIOR") ~= first then
          check(false, r.race .. " chain " .. n .. " is half cut on " .. m .. " (step " .. s.id .. ")")
          break
        end
      end
    end
  end

  -- c. every chain Casual keeps for a warrior (3 or more steps) has its line at the pick-up of its first quest
  local firstVisit = {}
  for _, i in ipairs(ER.RouteGuides()) do
    for _, area in ipairs(ER.RouteReader.ReadVisit(i.visit)) do
      for _, q in ipairs(area.q) do
        if q.id and not firstVisit[q.id] then firstVisit[q.id] = i end
      end
    end
  end
  local byVisit, order = {}, {}
  for _, n in ipairs(nums) do
    local worth, kept = ER._testChainVerdict(r.race, n, "casual", "WARRIOR")
    if worth and kept >= 3 then
      local X = ER.RouteReader.ReadChain(EasyRoute_Chains.chains[n]).steps[1].id
      local info = firstVisit[X]
      check(info ~= nil, r.race .. " chain " .. n .. ": its first quest " .. X .. " is in no visit")
      if info then
        local key = S.Key(info)
        if not byVisit[key] then
          byVisit[key] = { info = info, list = {} }
          table.insert(order, key)
        end
        table.insert(byVisit[key].list, { n = n, X = X, kept = kept })
      end
    end
  end
  for _, key in ipairs(order) do
    local entry = byVisit[key]
    local info = entry.info
    local areas = ER.RouteReader.ReadVisit(info.visit)
    Reset()
    G.level, G.zone, G.x, G.y = info.lo, info.visit.zone, areas[1].x, areas[1].y
    ER.db.mode = "casual"
    check(ER.StartGuide(key, true), r.race .. " " .. info.name .. " did not start")
    Tick(2)
    for _, c in ipairs(entry.list) do
      local line = ER.ChainLine({ elements = { { kind = "A", id = c.X } }, flags = {} })
      local want = "Chain of " .. c.kept
      if S.TooEasy(c.X) then
        -- the first quest is grey at the first level of its visit: nobody picks it up there, so there is nothing to say
        CHAIN38_EASY = CHAIN38_EASY + 1
        check(line == nil, r.race .. " chain " .. c.n .. ": a quest that is too easy has the line '" .. tostring(line) .. "'")
      elseif line and string.sub(line, 1, string.len(want)) == want then
        CHAIN38_LINES = CHAIN38_LINES + 1
      else
        check(false, r.race .. " chain " .. c.n .. " (first quest " .. c.X .. ", " .. tostring(S.QuestTitle(c.X)) .. ", left out " .. tostring(S.LeftOut(c.X)) ..
          ") has the line '" .. tostring(line) .. "' and not '" .. want .. "...'")
      end
    end
  end
end
CHAIN38_DUMP = table.concat(out, "\\n")

-- the end: nothing left behind
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
G.log, G.order = {}, {}
ER._testChainReset()
ER.db.simple = was.simple
ER.db.mode, ER.db.autoNextOff = was.mode, was.autoNextOff
G.level, G.race, G.class, G.faction, G.zone = was.level, was.race, was.class, was.faction, was.zone
`, "section 38");
{
  // The same chains judged in the build (tools/lib/chains.js) and in the game (RouteRun.lua): worth and kept steps agree, for a warrior and a mage.
  const CH = require("./lib/chains.js");
  const vm = newLuaVM();
  vm.run(fs.readFileSync(path.join(ROOT, "Data/Route.lua")), "Data/Route.lua");
  vm.run(fs.readFileSync(path.join(ROOT, "Data/Chains.lua")), "Data/Chains.lua");
  const route = vm.get("EasyRoute_Route");
  const chainData = vm.get("EasyRoute_Chains");
  const leaveOut = CH.readLeaveOut(fs.readFileSync(path.join(ROOT, "Steps.lua"), "utf8"));
  const flagsOfRace = (race) => {
    const out = {};
    for (const number of route.paths[race]) {
      const v = Array.isArray(route.visits) ? route.visits[number - 1] : route.visits[String(number)];
      for (const line of String(v.areas).split("\n")) {
        const f = line.split("\t");
        if (f[0] === "Q" && out[f[1]] === undefined) out[f[1]] = f[2] || "";
      }
    }
    return out;
  };
  const chainAt = (n) => Array.isArray(chainData.chains) ? chainData.chains[n - 1] : chainData.chains[String(n)];
  const flagTable = { Orc: flagsOfRace("Orc"), Human: flagsOfRace("Human") };
  let agree = 0;
  let wrong = 0;
  for (const line of getString("CHAIN38_DUMP").split("\n")) {
    if (!line) continue;
    const [race, n, mode, cls, worth, kept] = line.split(" ");
    const parsed = CH.parseChain(chainAt(Number(n)));
    const j = CH.judge(parsed, mode, CH.CLASS_LETTERS[cls], (i) => {
      const f = flagTable[race][String(parsed.steps[i].id)];
      return f === undefined || CH.leftBy(f, mode, leaveOut);
    });
    if (String(j.worth) === worth && j.kept === Number(kept)) {
      agree++;
    } else {
      wrong++;
      if (wrong <= 5) jsCheck(false, `the game and the build disagree on ${race} chain ${n} ${mode} ${cls}: game worth ${worth} kept ${kept}; build worth ${j.worth} kept ${j.kept}`);
    }
  }
  jsCheck(wrong === 0, `${wrong} chain verdicts differ between the game and the build`);
  jsCheck(agree > 400, `only ${agree} chain verdicts were compared`);
  console.log(`  agree: ${agree} verdicts`);
  const lines = getNumber("CHAIN38_LINES");
  jsCheck(lines > 20, `only ${lines} kept chains were checked for their line`);
  const easy = getNumber("CHAIN38_EASY");
  jsCheck(easy <= 3, `${easy} kept chains start with a quest that is too easy at the first level of its visit`);
  console.log(`  lines: ${lines} kept chains, all with a line (${easy} more start with a quest that is already grey there)`);
}

// 39. Auto mode review fixes. A busy quest hub is done in one talk: the cap counts quests taken or handed in, not every window, and when it is
// reached the player is told once.
console.log("39. Auto mode review fixes");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, simple = ER.db.simple, race = G.race, class = G.class,
  faction = G.faction, zone = G.zone, x = G.x, y = G.y }
G.race, G.class, G.faction = "Orc", "WARRIOR", "Horde"
ER.db.mode, ER.db.autoNextOff, ER.db.simple = "casual", true, nil
local durotar = ER.RouteGuides()[1]
local areas = ER.RouteReader.ReadVisit(durotar.visit)

local function Calls() return table.concat(G.calls, ",") end
local function Said(text) return string.find(CHAT or "", text, 1, true) ~= nil end
local function Occurs(s, sub)
  local n, at = 0, 1
  while true do
    local a, b = string.find(s, sub, at, true)
    if not a then return n end
    n = n + 1
    at = b + 1
  end
end
local function CallCount(prefix)
  local n = 0
  for _, c in ipairs(G.calls) do
    if string.sub(c, 1, string.len(prefix)) == prefix then n = n + 1 end
  end
  return n
end
local function Hide()
  QuestFrame:Hide()
  QuestFrameDetailPanel:Hide()
  QuestFrameProgressPanel:Hide()
  QuestFrameRewardPanel:Hide()
  QuestFrameGreetingPanel:Hide()
  GossipFrame:Hide()
  TaxiFrame:Hide()
  MerchantFrame:Hide()
end
local function Fresh()
  S.Stop()
  Tick(2)
  G.level, G.taxi, G.dead = 1, false, false
  G.log, G.order, G.bags = {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  ER.db.autoOff, ER.db.autoquestOff, ER.db.automenuOff, ER.db.autoflightOff, ER.db.autoinnOff = nil, nil, nil, nil, nil
  G.calls, G.window, G.shift, G.units, G.npc = {}, nil, false, {}, nil
  Hide()
  Tick(2)
  G.zone, G.x, G.y = "Durotar", areas[1].x, areas[1].y
  check(ER.StartGuide(S.Key(durotar), true), "the Durotar zone did not start")
  Tick(2)
  CHAT = ""
end
local function Close()
  Hide()
  Tick(1.2)
end
local function Gossip(active, avail, options)
  G.npc = { gossip = { active = active, avail = avail, options = options } }
  GossipFrame:Show()
  Fire("GOSSIP_SHOW")
end
local function Detail(title)
  G.window = { title = title }
  GossipFrame:Hide()
  QuestFrame:Show()
  QuestFrameDetailPanel:Show()
  Fire("QUEST_DETAIL")
end
local function Progress(title)
  G.window = { title = title, completable = true }
  GossipFrame:Hide()
  QuestFrame:Show()
  QuestFrameProgressPanel:Show()
  Fire("QUEST_PROGRESS")
end
local function Reward(title)
  G.window = { title = title, choices = 0 }
  QuestFrame:Show()
  QuestFrameProgressPanel:Hide()
  QuestFrameRewardPanel:Show()
  Fire("QUEST_COMPLETE")
end
local CAP = "Easy Route stopped clicking for this talk: do the rest yourself."

-- a. a hub NPC with three finished hand-ins and three quests to take, all in one talk: everything is done, no cap line
Fresh()
local realWanted, realHand = S.WantedAccepts, S.HandInTitles
S.WantedAccepts = function() return { ["take 1"] = 1, ["take 2"] = 2, ["take 3"] = 3 } end
S.HandInTitles = function() return { ["hand 1"] = 1, ["hand 2"] = 2, ["hand 3"] = 3 } end
local hands, takes = { "Hand 1", "Hand 2", "Hand 3" }, { "Take 1", "Take 2", "Take 3" }
for _, h in ipairs(hands) do
  G.log[h] = { complete = true, objs = {} }
  table.insert(G.order, h)
end
local function Menu()
  local active, avail = {}, {}
  for _, h in ipairs(hands) do
    if G.log[h] then table.insert(active, { h, 1 }) end
  end
  for _, t in ipairs(takes) do
    if not G.log[t] then table.insert(avail, { t, 1 }) end
  end
  Gossip(active, avail)
  Tick(0.1)
end
for _, h in ipairs(hands) do
  Menu()
  Progress(h)
  Tick(0.1)
  Reward(h)
  Tick(0.1)
end
for _, t in ipairs(takes) do
  Menu()
  Detail(t)
  Tick(0.1)
end
check(CallCount("CompleteQuest") == 3 and CallCount("GetQuestReward") == 3, "three hand-ins at one NPC made the calls: " .. Calls())
check(CallCount("AcceptQuest") == 3, "three pick-ups after three hand-ins made the calls: " .. Calls())
check(CallCount("SelectGossip") == 6, "the six menu picks made the calls: " .. Calls())
check(not Said(CAP), "a hub of six quests reached the cap: " .. CHAT)
Close()

-- b. the cap still stops a talk that goes on and on, and says so once
Fresh()
S.WantedAccepts = function()
  local t = {}
  for i = 1, 15 do t["many " .. i] = i end
  return t
end
for i = 1, 15 do
  Detail("Many " .. i)
  Tick(0.1)
end
check(CallCount("AcceptQuest") == ER.Auto.N.MAX_ACTIONS, "fifteen quests in one talk made " .. CallCount("AcceptQuest") .. " accepts")
check(Occurs(CHAT, CAP) == 1, "the cap line was said " .. Occurs(CHAT, CAP) .. " times: " .. CHAT)
Close()
S.WantedAccepts, S.HandInTitles = realWanted, realHand

-- c. Simple mode's hearth tip: a press that could not use the hearthstone brings the tip back; a press that used it does not
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 6
local elwynn
for _, g in ipairs(S.Guides()) do
  if g.name == "6-11 Elwynn Forest" then elwynn = g end
end
check(elwynn ~= nil, "no 6-11 Elwynn Forest guide")
local HEARTH = { [0] = { size = 16, [3] = { id = 6948, name = "Hearthstone", count = 1 } } }
local function StartElwynn(jumpTo)
  Hide()
  S.Stop()
  Tick(2)
  ER.db.guides, ER.db.done = {}, {}
  G.log, G.order, G.bags = {}, {}, {}
  G.calls, G.stuff, G.hearthStart, G.hearthDur, G.shift = {}, nil, nil, nil, false
  G.zone, G.x, G.y = "Elwynn Forest", 42, 65
  check(ER.StartGuide(S.Key(elwynn), true), "the Elwynn Forest guide did not start")
  if jumpTo then S.Jump(jumpTo) end
  Tick(2)
  CHAT = ""
end
StartElwynn()
local hearthStep
for n = 1, S.Count() do
  for _, e in ipairs(S.Step(n).elements) do
    if e.kind == "H" and not hearthStep then hearthStep = n end
  end
end
check(hearthStep ~= nil, "the Elwynn Forest guide has no hearth step")
-- The tip's button as the tips box runs it: the tip goes first, then the button's work.
local function PressTip()
  local fn
  for _, tip in ipairs(ER.TipsList()) do
    if tip.key == "hearth" then fn = tip.buttons[1].fn end
  end
  ER.RemoveTip("hearth")
  if fn then fn() end
  return fn ~= nil
end
StartElwynn(hearthStep)
ER.db.simple = true
G.stuff = { [0] = { size = 16, [1] = { id = 12345, name = "Other Thing", count = 1 } } }
Tick(2)
check(ER.HasTip("hearth"), "Simple mode has no hearth tip on the hearth step")
check(PressTip(), "the hearth tip has no button")
check(Said("You have no hearthstone in your bags."), "no hearthstone: the chat says '" .. CHAT .. "'")
Tick(2)
check(ER.HasTip("hearth"), "the hearth tip did not come back after a press with no hearthstone")
G.stuff, G.hearthStart, G.hearthDur = HEARTH, NOW - 60, 3600
PressTip()
check(table.getn(G.calls) == 0, "a cooling hearthstone was used: " .. Calls())
Tick(2)
check(ER.HasTip("hearth"), "the hearth tip did not come back after a press while it cools down")
G.hearthStart, G.hearthDur = nil, nil
-- with the bank or a vendor open the hearthstone would go into the bank or be sold: not used, one plain line, the tip comes back
CreateFrame("Frame", "BankFrame")
for _, f in ipairs({ BankFrame, MerchantFrame }) do
  f:Show()
  CHAT = ""
  PressTip()
  check(table.getn(G.calls) == 0, "the hearthstone was used with a bank or vendor window open: " .. Calls())
  check(Said("Close the open window first, then use your hearthstone."), "a bank or vendor window open: the chat says '" .. CHAT .. "'")
  f:Hide()
  Tick(2)
  check(ER.HasTip("hearth"), "the hearth tip did not come back after a press with a bank or vendor window open")
end
BankFrame = nil
PressTip()
check(Calls() == "UseContainerItem:0:3", "a ready hearthstone made the calls: " .. Calls())
Tick(3)
check(not ER.HasTip("hearth"), "the hearth tip came back after the hearthstone was used")
ER.RemoveTip("hearth")
ER.db.simple = nil

-- d. the innkeeper popup can name the inn's part of town instead of the guide's town: after Easy Route picked "make this inn your home"
-- on the set-hearthstone step, the popup is answered whatever it names. Without that pick, too late, or on a step with no set-hearthstone
-- line, a popup with another name is left to the player; a popup that is already gone is never answered.
local innStep, plainStep, gz, gx, gy
for n = 1, S.Count() do
  local last, bind
  for _, e in ipairs(S.Step(n).elements) do
    if e.kind == "G" then last = e end
    if e.kind == "B" and e.text and string.find(e.text, "Goldshire", 1, true) then bind = e end
  end
  if bind and last and not innStep then innStep, gz, gx, gy = n, last.zone, last.x, last.y end
end
check(innStep ~= nil, "no step sets the hearthstone to Goldshire")
plainStep = 2
local OPTIONS = { { "Make this inn your home.", "binder" }, { "Let me browse your goods.", "vendor" } }
local function AtInnStep(n)
  StartElwynn(n or innStep)
  G.bind = "Northshire Abbey"
  G.zone, G.x, G.y = gz, gx, gy
  Tick(0.2)
  G.calls, CHAT = {}, ""
end
local function PickInn()
  Gossip({}, {}, OPTIONS)
  Tick(0.1)
  check(Calls() == "SelectGossipOption:1", "the inn option made the calls: " .. Calls())
  GossipFrame:Hide()
  G.calls = {}
end
AtInnStep()
PickInn()
Fire("CONFIRM_BINDER", "Lion's Pride Inn")
Tick(0.1)
check(Calls() == "ConfirmBinder,StaticPopup_Hide:CONFIRM_BINDER", "after Easy Route's pick, a popup with the inn's name made the calls: " .. Calls())
Tick(1.2)
check(Said("hearthstone set to Lion's Pride Inn."), "the chat does not say the hearthstone: " .. CHAT)
AtInnStep()
Fire("CONFIRM_BINDER", "Lion's Pride Inn")
Tick(0.1)
check(table.getn(G.calls) == 0, "a popup with another name and no pick by Easy Route made the calls: " .. Calls())
AtInnStep()
PickInn()
Tick(ER.Auto.N.BIND_TRUST + 1)
Fire("CONFIRM_BINDER", "Lion's Pride Inn")
Tick(0.1)
check(table.getn(G.calls) == 0, "a popup long after Easy Route's pick made the calls: " .. Calls())
AtInnStep()
PickInn()
S.Jump(plainStep)
Tick(0.2)
check(table.getn(S.OpenElements("B")) == 0, "step " .. plainStep .. " has an open set-hearthstone line")
Fire("CONFIRM_BINDER", "Lion's Pride Inn")
Fire("CONFIRM_BINDER", "Goldshire")
Tick(0.1)
Tick(0.1)
check(table.getn(G.calls) == 0, "a popup on a step with no set-hearthstone line made the calls: " .. Calls())
-- the popup was closed before the answer: nothing is confirmed
AtInnStep()
StaticPopup_Visible = function() return nil end
Fire("CONFIRM_BINDER", "Goldshire")
Tick(0.1)
check(table.getn(G.calls) == 0, "a popup that is gone made the calls: " .. Calls())
AtInnStep()
StaticPopup_Visible = function(which) if which == "CONFIRM_BINDER" then return "StaticPopup1" end end
Fire("CONFIRM_BINDER", "Goldshire")
Tick(0.1)
check(Calls() == "ConfirmBinder,StaticPopup_Hide:CONFIRM_BINDER", "a popup that is still shown made the calls: " .. Calls())
StaticPopup_Visible = nil
G.bind = "Northshire Abbey"

-- e. the flight master's menu opens the flight map only when the map would fly: the current step's fly line, not a side step's, and not on
-- a "get the flight path" step
StartElwynn()
local realCurrent, realOpen, realWantedE, realHandE = S.Current, S.OpenElements, S.WantedAccepts, S.HandInTitles
local function Unstub() S.Current, S.OpenElements, S.WantedAccepts, S.HandInTitles = realCurrent, realOpen, realWantedE, realHandE end
local function Stub(current, open)
  S.WantedAccepts = function() return {} end
  S.HandInTitles = function() return {} end
  S.Current = function() return current end
  S.OpenElements = function(kind)
    local out = {}
    if kind == "F" then
      for _, step in ipairs(open) do
        for _, e in ipairs(step.elements) do
          if e.kind == "F" then table.insert(out, { step = step, e = e }) end
        end
      end
    end
    return out
  end
end
local sideFly = { n = 998, elements = { { kind = "F", dest = "Darkshire", text = "Fly to Darkshire" } } }
local getFp = { n = 999, elements = { { kind = "G", zone = "Westfall", x = 56.5, y = 52.6 }, { kind = "P", text = "Sentinel Hill" } } }
local walkOn = { n = 997, elements = { { kind = "I", text = "Walk to the road." } } }
local flyNow = { n = 996, elements = { { kind = "F", dest = "Stormwind", text = "Fly to Stormwind" } } }
local TAXI = { { "Show me where I can fly.", "taxi" } }
for _, case in ipairs({ { "a get the flight path step", getFp }, { "a step with no fly line", walkOn } }) do
  Hide()
  Tick(1.2)
  G.calls = {}
  Stub(case[2], { sideFly })
  Gossip({}, {}, TAXI)
  Tick(0.1)
  check(table.getn(G.calls) == 0, case[1] .. " is current and a fly step is a side step, yet the flight master's menu made the calls: " .. Calls())
  Unstub()
end
Hide()
Tick(1.2)
G.calls = {}
Stub(flyNow, { sideFly, flyNow })
Gossip({}, {}, TAXI)
Tick(0.1)
check(Calls() == "SelectGossipOption:1", "a current fly step: the flight master's menu made the calls: " .. Calls())
Unstub()
Hide()
Tick(1.2)

-- f. an error inside auto mode never reaches the player but is kept, once, in the saved errors list
StartElwynn()
local realWantedF = S.WantedAccepts
S.WantedAccepts = function() error("broken on purpose") end
local before = type(ER.db.errors) == "table" and table.getn(ER.db.errors) or 0
local ok = pcall(function()
  for i = 1, 2 do
    Detail("Some Quest")
    Tick(0.1)
  end
end)
S.WantedAccepts = realWantedF
check(ok, "an error inside auto mode reached the caller")
local kept = 0
for _, line in ipairs(type(ER.db.errors) == "table" and ER.db.errors or {}) do
  if string.find(line, "EasyRoute Auto QUEST_DETAIL", 1, true) and string.find(line, "broken on purpose", 1, true) then kept = kept + 1 end
end
check(kept == 1, "the auto mode error was kept " .. kept .. " times (errors: " .. ((type(ER.db.errors) == "table" and table.getn(ER.db.errors) or 0) - before) .. " new)")
Hide()
Tick(1.2)

-- The end: nothing left behind.
Hide()
S.Stop()
Tick(2)
ER.db.guides, ER.db.done = {}, {}
ER.db.autoOff, ER.db.autoquestOff, ER.db.automenuOff, ER.db.autoflightOff, ER.db.autoinnOff = nil, nil, nil, nil, nil
ER.db.mode, ER.db.autoNextOff, ER.db.simple = was.mode, was.autoNextOff, was.simple
G.race, G.class, G.faction, G.level = was.race, was.class, was.faction, was.level
G.zone, G.x, G.y = was.zone, was.x, was.y
G.log, G.order, G.npc, G.window, G.stuff, G.calls = {}, {}, nil, nil, nil, {}
`, "section 39");

// 40. Phase 6 review fixes. Paging with ">" or /er next teaches nothing (only a real Skip marks quests Hard), and "<" then ">" never drops a
// quest; "Skip it" on the died-twice tip touches only the quest you died on; RestedXP's optional group steps no longer make solo quests
// group quests; warnings speak only of quests you are doing, in gold to the end; "Miners" is no mine; same-name quests tell their parts
// apart by level; on Hard the skip tip says "Marked as hard".
console.log("40. Phase 6 review fixes");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, class = G.class, faction = G.faction,
  zone = G.zone, simple = ER.db.simple, tipsOff = ER.db.tipsOff, checkinOff = ER.db.checkinOff, instance = G.instance,
  current = S.Current, side = S.Side }
G.race, G.class, G.faction, G.level, G.zone = "Orc", "WARRIOR", "Horde", 1, "Durotar"
G.log, G.order, G.bags, G.taxi, G.instance = {}, {}, {}, false, nil
G.npc, G.window = nil, nil
ER.db.mode, ER.db.autoNextOff, ER.db.guides, ER.db.done, ER.db.simple = "casual", true, {}, {}, nil
ER.db.checkinOff, ER.db.tipsOff = true, nil
ER.db.adapt = ER.db.adapt or {}
S.Stop()
Tick(2.1)

local function PlainText(s)
  s = string.gsub(s or "", "|c%x%x%x%x%x%x%x%x", "")
  return (string.gsub(s, "|r", ""))
end
local function TipOf(key)
  for _, tip in ipairs(ER.TipsList()) do
    if tip.key == key then return tip end
  end
  return nil
end
local function TipText(key)
  local tip = TipOf(key)
  return tip and PlainText(tip.text) or nil
end
local function Press(key, label)
  local tip = TipOf(key)
  for _, b in ipairs(tip and tip.buttons or {}) do
    if b.label == label then b.fn() return true end
  end
  return false
end
local function Hard()
  ER.AdaptShift() -- makes the saved data when there is none yet
  return ER.db.adapt[ER.Char()].hard
end
local function Fresh()
  ER.db.adapt[ER.Char()] = nil
  ER.RemoveTips("died:")
  ER.RemoveTips("skip")
  G.log, G.order = {}, {}
  Fire("QUEST_LOG_UPDATE")
end
local function InLog(id)
  local t = S.QuestTitle(id)
  G.log[t] = { complete = false, objs = {} }
  table.insert(G.order, t)
  Fire("QUEST_LOG_UPDATE")
  return t
end

local infos = ER.RouteGuides()
check(ER.StartGuide(S.Key(infos[1]), true), "the Orc Durotar visit did not start")
Tick(2.1)

-- R: a step that only picks up one quest. Q: a quest a step works on. O: a quest of a step that picks up two (qoStep); the check that
-- needs a step working on Q next to another quest adds a line for Q to that step (the route's steps work on one quest each).
local R, rStep, Q, O, qoStep
for n = 1, S.Count() do
  local step = S.Step(n)
  local list, seen = {}, {}
  for _, e in ipairs(step.elements) do
    if (e.kind == "A" or e.kind == "C" or e.kind == "K") and e.id and e.id ~= 0 and S.QuestTitle(e.id) and not seen[e.id] then
      seen[e.id] = true
      table.insert(list, e)
    end
  end
  if not R and table.getn(list) == 1 and list[1].kind == "A" then R, rStep = list[1].id, n end
  if not Q and table.getn(list) == 1 and (list[1].kind == "C" or list[1].kind == "K") then Q = list[1].id end
  if not O and table.getn(list) >= 2 and list[1].kind == "A" and S.Fits(step) then O, qoStep = list[1].id, n end
end
check(R ~= nil and Q ~= nil and O ~= nil and Q ~= O and R ~= O, "no pick-up step, finish step or step with two pick-ups in Durotar")

-- a. the > button and Steps.Next() (what /er next calls) page on and mark nothing; "<" then ">" drops nothing; Skip marks
Fresh()
S.Jump(rStep)
check(S.Position() == rStep, "the jump went to " .. S.Position() .. " not " .. rStep)
EasyRouteTrackerNext._scripts.OnClick()
check(S.Position() > rStep, "the > button did not move on from step " .. rStep)
check(Hard()[R] == nil, "the > button marked " .. S.QuestTitle(R) .. " as " .. tostring(Hard()[R]))
check(not ER.HasTip("skip"), "the > button said quests are left out")
for i = 1, 3 do
  EasyRouteTrackerPrev._scripts.OnClick()
  EasyRouteTrackerNext._scripts.OnClick()
end
S.Jump(rStep)
S.Next()
check(next(Hard()) == nil, "paging back and on marked a quest Hard")
check(not ER.HasTip("skip"), "paging back and on said quests are left out")
check(not S.LeftOut(R), S.QuestTitle(R) .. " is left out after paging")
S.Jump(rStep)
EasyRouteTrackerTick._scripts.OnClick()
check(Hard()[R] == "skip", "the Skip button marked " .. tostring(Hard()[R]))
check(TipText("skip") == "Left out from now on: " .. S.QuestTitle(R) .. " (you skipped them).", "the skip tip says " .. tostring(TipText("skip")))

-- b. Skip it on the died-twice tip: a quest of a side step leaves the step you are on alone
Fresh()
S.Jump(rStep)
InLog(Q)
local side = { n = 950, flags = {}, elements = { { kind = "C", id = Q, text = "Dummy" } } }
S.Side = function() return { side } end
Fire("PLAYER_DEAD")
Fire("PLAYER_DEAD")
S.Side = was.side
check(ER.HasTip("died:" .. Q), "no died tip for a side-step quest")
local at = S.Position()
Press("died:" .. Q, "Skip it")
check(S.Position() == at, "Skip it on a side-step quest moved the guide from step " .. at .. " to " .. S.Position())
check(Hard()[R] == nil, "Skip it marked the pick-up of the step you are on")
check(Hard()[Q] == "died", "the quest you died on is " .. tostring(Hard()[Q]))
check(not ER.HasTip("skip"), "Skip it said other quests are left out")
-- the quest is on the step you are on: the step moves on, its other quest is not marked
Fresh()
local qoElements = S.Step(qoStep).elements
table.insert(qoElements, { kind = "C", id = Q, text = "Dummy" })
S.Jump(qoStep)
InLog(Q)
Fire("PLAYER_DEAD")
Fire("PLAYER_DEAD")
check(ER.HasTip("died:" .. Q), "no died tip on the step with two quests")
at = S.Position()
Press("died:" .. Q, "Skip it")
check(S.Position() > at, "Skip it left the guide at step " .. S.Position())
check(Hard()[O] == nil, "Skip it marked the step's other quest " .. S.QuestTitle(O) .. " as " .. tostring(Hard()[O]))
check(not ER.HasTip("skip"), "Skip it said other quests are left out")
table.remove(qoElements)

-- c. solo quests that RestedXP also does in an optional group step are no group quests; one done only in a group step still is
Fresh()
local function Group(id) return string.find(S.Kinds(id), "g", 1, true) ~= nil end
check(EasyRoute_GuideQuests[1068] == "Shredding Machines" and EasyRoute_GuideQuests[6461] == "Blood Feeders", "the quest ids of the check changed")
for _, id in ipairs({ 1068, 1069, 6461, 846 }) do
  check(not Group(id), "Horde: " .. tostring(EasyRoute_GuideQuests[id]) .. " is still a group quest")
  check(not S.LeftByKinds(S.Kinds(id), "casual"), "Horde: " .. tostring(EasyRoute_GuideQuests[id]) .. " is still left out on Casual: " .. S.Kinds(id))
end
check(Group(673), "Horde: Foul Magics, done only in a group step, lost its group mark")
G.race, G.faction = "Human", "Alliance"
for _, id in ipairs({ 963, 465, 693 }) do
  check(not Group(id), "Alliance: " .. tostring(EasyRoute_GuideQuests[id]) .. " is still a group quest")
end
G.race, G.faction = "Orc", "Horde"

-- d. warnings speak only of quests you are doing
local warn = EasyRoute_Survival.Horde.warn
local W = 99992
local savedWarn = { w = warn[W], q = warn[Q], r = warn[R] }
warn[W] = "Beware of the |cffff5722Quillboar Brute|r here."
local wstep = { n = 951, flags = {}, elements = { { kind = "A", id = W, text = "Dummy" } } }
S.Current = function() return wstep end
S.Side = function() return {} end
local function Has(kind)
  for _, w in ipairs(S.Warnings(true)) do
    if w.kind == kind then return w end
  end
  return nil
end
check(Has("survival") ~= nil, "a quest you are about to pick up has no warning")
Hard()[W] = "skip"
check(Has("survival") == nil, "a quest Casual leaves out still warns")
ER.db.mode = "hard"
check(Has("survival") == nil, "Hard shows a survival warning")
ER.db.mode = "casual"
Hard()[W] = nil
warn[Q] = warn[W]
wstep.elements = { { kind = "C", id = Q, text = "Dummy" } }
check(Has("survival") == nil, "a quest that is not in the log warns on its finish line")
local titleQ = InLog(Q)
check(Has("survival") ~= nil, "a quest you are doing has no warning")
G.log[titleQ].complete = true
Fire("QUEST_LOG_UPDATE")
check(Has("survival") == nil, "a finished quest still warns")
G.log, G.order = {}, {}
Fire("QUEST_LOG_UPDATE")
-- a left-out quest's own words ("into the mine") give no cave line either
wstep.elements = { { kind = "A", id = W, text = "Accept a quest that goes into the mine" } }
check(Has("cave") ~= nil, "a pick-up into the mine has no cave line")
Hard()[W] = "skip"
check(Has("cave") == nil, "a left-out quest's words still give a cave line")
Hard()[W] = nil
S.Current, S.Side = was.current, was.side
-- the step box keeps the whole warning gold: the colour starts again after the red enemy name
warn[R] = warn[W]
S.Jump(rStep)
ER.StepsChanged()
local raw
for i = 1, 14 do
  local b = _G["EasyRouteTrackerLine" .. i]
  if b and b:IsShown() and string.find(b.text._text or "", "Quillboar Brute", 1, true) then raw = b.text._text end
end
check(raw ~= nil, "the step box has no survival line")
check(raw and string.find(raw, "|r" .. ER.GOLD .. " here.", 1, true) ~= nil, "the survival line is not gold after the enemy name: " .. tostring(raw))
warn[W], warn[Q], warn[R] = savedWarn.w, savedWarn.q, savedWarn.r

-- e. "mine" only as a whole word
for _, t in ipairs({ "Kill Kobold Miners", "Find Minerals", "Miner's Fortune", "Talk to Miner Hackett", "Kill the Miners", "a miner" }) do
  check(S.CaveWord(t) == nil, "'" .. t .. "' is taken for a mine")
end
for _, t in ipairs({ "Go into Fargodeep Mine", "Mine", "Enter the mine", "Follow the mine's tunnel", "Clear a mine." }) do
  check(S.CaveWord(t) == "mine", "'" .. t .. "' gives " .. tostring(S.CaveWord(t)))
end

-- h. on Hard nothing is left out, so the skip tip only says what it noted
Fresh()
ER.db.mode = "hard"
ER.OnStepSkipped({ n = 952, flags = {}, elements = { { kind = "A", id = R, text = "x" } } })
check(TipText("skip") == "Marked as hard for you: " .. S.QuestTitle(R) .. " (you skipped them).", "the Hard skip tip says " .. tostring(TipText("skip")))
ER.db.mode = "casual"
Fresh()

-- g. two quests with one name: with no number from pfQuest the log row's level tells part 1 (level 2) from part 2 (level 3)
S.Stop()
G.race, G.class, G.faction, G.zone = "NightElf", "WARRIOR", "Alliance", "Teldrassil"
check(ER.StartGuide("Alliance 1-20\\\\1-6 Shadowglen", true), "the Shadowglen guide did not start")
local T = "The Balance of Nature"
check(S.QuestTitle(456) == T and S.QuestTitle(457) == T, "456 and 457 are not both " .. T)
G.log, G.order = { [T] = { complete = false, objs = {}, qlevel = 2 } }, { T }
Fire("QUEST_LOG_UPDATE")
check(S.InLog(456) ~= nil, "part 1 (level 2) in the log does not count as part 1")
check(S.InLog(457) == nil, "part 1 (level 2) in the log counts as part 2")
G.log[T].qlevel = 3
check(S.InLog(456) == nil and S.InLog(457) ~= nil, "part 2 (level 3) in the log is not told apart")
G.log[T].qlevel = nil
check(S.InLog(456) ~= nil and S.InLog(457) ~= nil, "with no level known a part lost the log row")
G.log[T].qlevel, G.log[T].pfid = 2, 457
check(S.InLog(456) == nil and S.InLog(457) ~= nil, "pfQuest's number no longer decides")

-- the end: nothing left behind
S.Current, S.Side = was.current, was.side
S.Stop()
Tick(2.1)
Fresh()
ER.db.adapt[ER.Char()] = nil
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff, ER.db.simple = was.mode, was.autoNextOff, was.simple
ER.db.tipsOff, ER.db.checkinOff = was.tipsOff, was.checkinOff
G.instance = was.instance
G.log, G.order = {}, {}
G.level, G.race, G.class, G.faction, G.zone = was.level, was.race, was.class, was.faction, was.zone
`, "section 40");

// 41. Phase 7 review fixes. A chain quest that waits for a quest that is grey for you (so the route skips it) is left out too: the NPC would
// never offer it. Human, Wetlands at 28: The Greenwarden and Tramping Paws (level 21) are grey, so Fire Taboo and Blisters on The Land go too,
// until Tramping Paws is in your log.
console.log("41. Phase 7 review fixes");
run(SECTION_START + `
local was = { mode = ER.db.mode, autoNextOff = ER.db.autoNextOff, level = G.level, race = G.race, class = G.class, faction = G.faction,
  zone = G.zone, simple = ER.db.simple }
G.race, G.class, G.faction = "Human", "WARRIOR", "Alliance"
G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
ER.db.mode, ER.db.autoNextOff, ER.db.guides, ER.db.done, ER.db.simple = "casual", true, {}, {}, nil
S.Stop()
Tick(2.1)
ER._testChainReset()

local info
for _, i in ipairs(ER.RouteGuides()) do
  for _, area in ipairs(ER.RouteReader.ReadVisit(i.visit)) do
    for _, q in ipairs(area.q) do
      if q.id == 277 and not info then info = i end
    end
  end
end
check(info ~= nil and info.visit.zone == "Wetlands", "Fire Taboo (277) is not in a Human Wetlands visit")
if info then
  local areas = ER.RouteReader.ReadVisit(info.visit)
  G.level = info.lo
  G.zone, G.x, G.y = info.visit.zone, areas[1].x, areas[1].y
  check(ER.StartGuide(S.Key(info), true), "the Wetlands visit did not start")
  Tick(2.1)
  check(S.TooEasy(276), "Tramping Paws is not grey at level " .. G.level)
  check(S.LeftOut(276) == true, "Tramping Paws is not left out at level " .. G.level)
  check(S.LeftOut(277) == true, "Fire Taboo is kept though Tramping Paws before it is grey and not done")
  check(S.LeftOut(275) == true, "Blisters on The Land is kept though the chain before it is skipped")
  local t = S.QuestTitle(276)
  G.log[t] = { complete = false, objs = {} }
  table.insert(G.order, t)
  Fire("QUEST_LOG_UPDATE")
  check(S.LeftOut(277) == false, "Fire Taboo is left out though Tramping Paws is in the log")
  G.log, G.order = {}, {}
  Fire("QUEST_LOG_UPDATE")
end

-- the end: nothing left behind
S.Stop()
Tick(2.1)
ER._testChainReset()
ER.db.guides, ER.db.done = {}, {}
ER.db.mode, ER.db.autoNextOff, ER.db.simple = was.mode, was.autoNextOff, was.simple
G.log, G.order = {}, {}
G.level, G.race, G.class, G.faction, G.zone = was.level, was.race, was.class, was.faction, was.zone
`, "section 41");

const secs =(Date.now() - started) / 1000;
console.log("  (" + secs.toFixed(1) + " seconds)");
const luaFailures = getNumber("failures");
const total = luaFailures + jsFailures;
if (total === 0) {
  console.log("ALL ROUTE RUN CHECKS PASSED");
} else {
  console.log(total + " CHECK(S) FAILED");
  process.exit(1);
}
