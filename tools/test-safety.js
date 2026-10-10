// The safety checks of the guide engine (Steps.lua) in a Lua VM (fengari) with the pretend game of tools/lib/fakegame.js:
//   1. a quest the game will not offer yet (the quest before it is not handed in, or you are below its lowest level) is passed over,
//      but a step "hand in X, accept the next one" still waits for the accept;
//   2. a guide picked part-way through never starts past unfinished work on a quest in the log;
//   3. a hand-in of a quest that is not finished says what is left and the arrow goes to the objectives;
//   4. a saved place far ahead of the quest log goes back once per version, and Find my place does it on demand;
//   5. a sweep over the real guides of a few characters: pick-ups whose quest before is not handed in earlier in the guide (a report only).
// Fails only on 1 to 4. Usage: node tools/test-safety.js

const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

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

const { PRELUDE } = require("./lib/fakegame.js");
run(PRELUDE, "prelude");

for (const f of ["Data/Zones.lua", "Data/Guides.lua", "Data/ZoneSizes.lua", "Data/Route.lua", "Data/Survival.lua", "Data/Ratings.lua",
  "Data/Chains.lua", "Director.lua", "Steps.lua", "RouteReader.lua", "RouteRun.lua", "Settings.lua"]) {
  run(fs.readFileSync(path.join(ROOT, f)), f);
}

run(String.raw`
local ER = EasyRoute
local S = ER.Steps

-- Objectives in the pretend quest log: OBJ[title] = { { text, done }, ... }.
OBJ = {}
GetNumQuestLeaderBoards = function(i) local t = G.order[i] return t and OBJ[t] and #OBJ[t] or 0 end
GetQuestLogLeaderBoard = function(j, i)
  local t = G.order[i]
  local o = t and OBJ[t] and OBJ[t][j]
  if not o then return nil end
  return o[1], "monster", o[2] and 1 or nil
end
-- Where pfQuest says the Rear Guard Patrol's Bleeding Horrors are, and who takes it back.
ER.QuestFacts = function(id)
  if id ~= 356 then return nil end
  return { taker = { name = "Deputy Linnea", where = { map = "Tirisfal Glades", x = 65.5, y = 60.3 } },
    objectives = { ["bleeding horror"] = { kind = "monster", where = { map = "Tirisfal Glades", x = 77, y = 61 } } } }
end

local function Title(id) return S.QuestTitle(id) end
local function Take(id)
  local t = Title(id)
  if not G.log[t] then
    G.log[t] = { complete = false, objs = {} }
    table.insert(G.order, t)
  end
end
local function HandIn(id)
  local t = Title(id)
  G.log[t] = nil
  for i, o in ipairs(G.order) do if o == t then table.remove(G.order, i) break end end
  ER.OnTurnIn(t)
end

-- A small guide: Rear Guard Patrol (356, level 11, from level 6), The Prodigal Lich (405), The Lich's Identity (357, after 405) and
-- Return the Book (366, after 357, picked up where 357 is handed in, twice, as in the real 6-11 Tirisfal Glades), then 25 steps of walking.
local TAB = "\t"
local lines = {}
local function Add(...) table.insert(lines, table.concat({...}, TAB)) end
local function Place(x, y) Add("G", "", "Tirisfal Glades", x, y, "", "", "") end
Add("S", "", "", "") Place("65.5", "60.3") Add("A", "", "356", "Accept Rear Guard Patrol")
Add("S", "", "", "") Place("61.3", "50.8") Add("A", "", "405", "Accept The Prodigal Lich")
Add("S", "", "", "") Place("77", "61") Add("C", "", "356", "", "Kill Bleeding Horrors")
Add("S", "", "", "") Place("65.7", "68.8") Add("T", "", "405", "Turn in The Prodigal Lich") Add("A", "", "357", "Accept The Lich's Identity")
Add("S", "", "", "") Place("65.7", "68.8") Add("T", "", "357", "Turn in The Lich's Identity") Add("A", "", "366", "Accept Return the Book")
Add("S", "", "", "") Place("65.7", "68.8") Add("T", "", "357", "Turn in The Lich's Identity") Add("A", "", "366", "Accept Return the Book")
Add("S", "", "", "") Place("65.5", "60.3") Add("T", "", "356", "Turn in Rear Guard Patrol")
for i = 1, 25 do Add("S", "", "", "") Place(tostring(10 + i), "20") Add("I", "", "Walk to spot " .. i) end
local TEST = { group = "Test", name = "Safety", title = "Safety test", faction = "Horde", lo = 5, hi = 10, steps = table.concat(lines, "\n") }
table.insert(EasyRoute_Guides, TEST)
local KEY = S.Key(TEST)

local function Reset(level)
  S.Stop()
  G.race, G.class, G.faction, G.level = "Scourge", "WARRIOR", "Horde", level or 6
  G.zone, G.x, G.y, G.ready = "Durotar", 50, 50, true
  G.log, G.order, OBJ = {}, {}, {}
  ER.db.guides, ER.db.done, ER.db.mode = {}, {}, "hard"
end
local function Saved() return ER.db.guides[ER.Char()] end
local function Element(n, kind, id)
  for _, e in ipairs(S.Step(n).elements) do if e.kind == kind and e.id == id then return e end end
end

print("1. Quests the game will not offer yet")
Reset(6)
check(S.Load(KEY, true), "the test guide did not load")
check(S.Position() == 1, "a fresh start should be on step 1, it is on " .. S.Position())
Take(356) S.Check()
check(S.Position() == 2, "taking Rear Guard Patrol should move on to step 2, it is on " .. S.Position())
check(not S.NotYet(405), "The Prodigal Lich follows a quest this guide never hands in: it should still be offered")
Take(405) S.Check()
check(S.Position() == 3, "the kill step should come next, it is on " .. S.Position())
G.log["Rear Guard Patrol"].complete = true S.Check()
check(S.Position() == 4, "with the kills done the guide should be on step 4, it is on " .. S.Position())
check(S.NotYet(357), "The Lich's Identity needs The Prodigal Lich handed in first")
check(S.ElementDone(S.Step(4), Element(4, "A", 357)) == false, "in 'hand in X, accept the next one' the accept should still count")
check(S.Line(S.Step(4), Element(4, "A", 357)) ~= nil, "the accept in the same step as the hand-in should be shown")
HandIn(405) S.Check()
check(S.Position() == 4, "after the hand-in the step should wait for the accept, it is on " .. S.Position())
Take(357) S.Check()
check(S.Position() == 5, "with The Lich's Identity taken the guide should be on step 5, it is on " .. S.Position())
check(S.ElementDone(S.Step(5), Element(5, "A", 366)) == false, "Return the Book should count while The Lich's Identity is in the log")
HandIn(357) S.Check()
check(S.Position() == 5, "after handing in The Lich's Identity the step should wait for Return the Book, it is on " .. S.Position())
check(S.Line(S.Step(5), Element(5, "A", 366)) ~= nil, "Return the Book should be shown once its quest before is handed in")
Take(366) S.Check()
check(S.Position() == 7, "taking Return the Book should move on to step 7, it is on " .. S.Position())
-- Without The Lich's Identity (never taken): both Return the Book steps are passed over.
Reset(6)
S.Load(KEY, true)
Take(356) S.Check() Take(405) S.Check()
G.log["Rear Guard Patrol"].complete = true S.Check()
HandIn(405) S.Check()
check(S.Position() == 4, "should be waiting for The Lich's Identity on step 4, it is on " .. S.Position())
S.Next()
check(S.Position() == 7, "without The Lich's Identity both Return the Book steps should be passed over: on step " .. S.Position())
check(S.Passed(5) == "skip" and S.Passed(6) == "skip", "steps 5 and 6 should count as skipped: " .. tostring(S.Passed(5)) .. ", " .. tostring(S.Passed(6)))
check(S.NotYet(366), "Return the Book should not be offered without The Lich's Identity handed in")
-- Below the lowest level: passed over.
Reset(5)
S.Load(KEY, true)
check(S.NotYet(356), "Rear Guard Patrol needs level 6: at level 5 it should not be offered")
check(S.Position() == 2 and S.Passed(1) == "skip", "at level 5 the Rear Guard Patrol step should be passed over: on step " .. S.Position())
print("  quest before not handed in: passed over; hand in + accept in one step waits for the accept; level too low: passed over")

print("2. Starting part-way through")
Reset(6)
Take(356) Take(366)
ER.db.done[ER.Char()] = { [405] = true, [357] = true }
S.Load(KEY)
check(S.Position() == 3, "with Rear Guard Patrol 0/8 in the log the start should be the kill step 3, it is " .. S.Position())
G.log["Rear Guard Patrol"].complete = true
check(S.FindMyPlace() == 7, "with the kills done the place should be the hand-in at step 7, it is " .. tostring(S.Position()))
print("  starts on the kill step, not the hand-in far ahead")

print("3. Handing in a quest that is not finished")
Reset(6)
Take(356) Take(366)
ER.db.done[ER.Char()] = { [405] = true, [357] = true }
G.log["Rear Guard Patrol"].complete = true
S.Load(KEY)
check(S.Position() == 7, "should be on the Rear Guard Patrol hand-in, it is on " .. S.Position())
G.log["Rear Guard Patrol"].complete = false
OBJ["Rear Guard Patrol"] = { { "Bleeding Horror slain: 0/8", false } }
S.Check()
check(S.Position() == 7, "an unfinished hand-in should wait, it is on " .. S.Position())
local line = S.Line(S.Step(7), Element(7, "T", 356))
check(line and string.find(line.text, "Finish it first: Bleeding Horror slain: 0/8", 1, true) ~= nil,
  "the hand-in line should say what is left: " .. tostring(line and line.text))
local t = S.Target()
check(t and t.zone == "Tirisfal Glades" and t.x == 77 and t.y == 61, "the arrow should point at the Bleeding Horrors: " .. tostring(t and (t.x .. "," .. t.y)))
G.log["Rear Guard Patrol"].complete = true
OBJ["Rear Guard Patrol"] = { { "Bleeding Horror slain: 8/8", true } }
line = S.Line(S.Step(7), Element(7, "T", 356))
check(line and not string.find(line.text, "Finish", 1, true), "a finished quest should not say Finish it first: " .. tostring(line and line.text))
t = S.Target()
check(t and t.x == 65.5 and t.y == 60.3, "a finished quest's arrow should point at the hand-in: " .. tostring(t and (t.x .. "," .. t.y)))
-- A quest with no objectives to show (take a letter somewhere) is never told to be finished first.
G.log["Rear Guard Patrol"].complete = false
OBJ["Rear Guard Patrol"] = nil
line = S.Line(S.Step(7), Element(7, "T", 356))
check(line and not string.find(line.text, "Finish", 1, true), "a quest with no objectives should not say Finish it first: " .. tostring(line and line.text))
print("  says what is left, the arrow goes to the objectives; quiet once finished")

print("4. A saved place far ahead goes back")
local function Ahead(pos, synced)
  Reset(6)
  Take(356) Take(366)
  ER.db.done[ER.Char()] = { [405] = true, [357] = true }
  local passed = {}
  for i = 1, pos - 1 do passed[i] = "done" end
  ER.db.guides[ER.Char()] = { key = KEY, pos = pos, passed = passed, fired = {}, side = {}, synced = synced }
end
Ahead(30)
S.Load(KEY)
check(S.Position() == 3, "a saved place 27 steps past the unfinished kill step should go back to step 3, it is on " .. S.Position())
check(Saved().synced == ER.VERSION, "the check should be marked done for this version")
S.Jump(30)
S.Stop() S.Load(KEY)
check(S.Position() == 30, "the check runs once per version: a place picked by hand should stay, it is on " .. S.Position())
CHAT = ""
ER.FindMyPlace()
check(S.Position() == 3, "Find my place should go back to step 3, it is on " .. S.Position())
check(string.find(CHAT, "back on step 3 of 32", 1, true) ~= nil, "Find my place should say where it went: " .. CHAT)
Ahead(10)
S.Load(KEY)
check(S.Position() == 10, "a place only 7 steps ahead should stay, it is on " .. S.Position())
Ahead(30, ER.VERSION)
S.Load(KEY)
check(S.Position() == 30, "a place already checked for this version should stay, it is on " .. S.Position())
-- The quest log not read yet: wait for it, then check.
Ahead(30)
G.ready = false
S.Load(KEY)
check(S.Position() == 30 and Saved().synced == nil, "with the quest log not read yet nothing should move")
G.ready = true
S.Check()
check(S.Position() == 3, "once the quest log is read the place should go back to step 3, it is on " .. S.Position())
S.Stop()
check(S.FindMyPlace() == nil, "Find my place with no guide should do nothing")
CHAT = ""
ER.FindMyPlace()
check(string.find(CHAT, "Pick a guide", 1, true) ~= nil, "Find my place with no guide should say to pick one: " .. CHAT)
local buttons = ER.SettingsInfo().pages[1].buttons
local found = false
for _, b in ipairs(buttons) do if b == "Find my place" then found = true end end
check(found, "the Guide page of Settings should have a Find my place button")
print("  once per version, waits for the quest log; Find my place and its button")

print("4b. The class trainer only at levels 10, 20, 30 ...")
local tl = {}
local function TAdd(...) table.insert(tl, table.concat({...}, TAB)) end
TAdd("S", "", "", "") TAdd("G", "", "Tirisfal Glades", "61.59", "52.39", "", "", "") TAdd("I", "", "Talk to |cff00ff25Rupert|r") TAdd("V", "", "train", "Train your class spells")
TAdd("S", "", "", "") TAdd("G", "", "Tirisfal Glades", "61.59", "52.39", "", "", "") TAdd("I", "", "Talk to |cff00ff25Rupert|r") TAdd("V", "", "train", "Train [Shadow Bolt]") TAdd("A", "", "356", "Accept Rear Guard Patrol")
TAdd("S", "", "", "") TAdd("G", "", "Tirisfal Glades", "61.81", "52.82", "", "", "") TAdd("I", "", "Talk to |cff00ff25Neela|r") TAdd("V", "", "train", "Train [First Aid]")
TAdd("S", "", "", "") TAdd("G", "", "Tirisfal Glades", "61.59", "52.39", "", "", "") TAdd("I", "", "Talk to |cff00ff25Gina|r") TAdd("V", "", "train", "|cfffcdc00Use the|r [Grimoire of Blood Pact]")
local TRAIN = { group = "Test", name = "Trainer", title = "Trainer test", faction = "Horde", lo = 5, hi = 12, steps = table.concat(tl, "\n") }
table.insert(EasyRoute_Guides, TRAIN)
local function V(n) for _, e in ipairs(S.Step(n).elements) do if e.kind == "V" then return e end end end
Reset(7)
check(S.Load(S.Key(TRAIN), true), "the trainer test guide did not load")
check(not S.Fits(S.Step(1)), "at level 7 a step that is only a trainer visit should be passed over")
check(S.Fits(S.Step(2)) and S.Line(S.Step(2), V(2)) == nil, "at level 7 a step with a quest keeps the quest and drops the trainer line")
check(S.Fits(S.Step(3)) and S.Line(S.Step(3), V(3)) ~= nil, "First Aid is not class training and should stay")
check(S.Fits(S.Step(4)), "using a Grimoire is not a trainer visit and should stay")
Reset(10)
S.Load(S.Key(TRAIN), true)
check(S.Fits(S.Step(1)), "at level 10 the trainer visit should be there")
check(S.Title(S.Step(1)) == "Learn new spells from |cff00ff25Rupert|r", "the trainer step says " .. tostring(S.Title(S.Step(1))))
check(S.Title(S.Step(3)) == "Learn [First Aid] from |cff00ff25Neela|r", "the First Aid step says " .. tostring(S.Title(S.Step(3))))
S.Stop()
for i, g in ipairs(EasyRoute_Guides) do if g == TRAIN then table.remove(EasyRoute_Guides, i) break end end
print("  trainer visits only at 10, 20, 30 ...; First Aid and grimoires stay")

print("5. Sweep: pick-ups whose quest before is not handed in earlier in the guide (report only)")
-- The small test guide is not part of the sweep.
for i, g in ipairs(EasyRoute_Guides) do if g == TEST then table.remove(EasyRoute_Guides, i) break end end
local function ForMe(step)
  if not S.Applies(step.need) then return false end
  for _, nope in ipairs(step.nots) do if S.Applies(nope) then return false end end
  return true
end
local combos = { { "Scourge", "WARLOCK", "Horde" }, { "Scourge", "WARRIOR", "Horde" }, { "Human", "WARRIOR", "Alliance" }, { "Human", "MAGE", "Alliance" } }
local total = 0
for _, c in ipairs(combos) do
  Reset(1)
  G.race, G.class, G.faction = c[1], c[2], c[3]
  -- Every quest any guide of this character hands in.
  local anywhere, list = {}, {}
  for _, g in ipairs(S.Guides()) do
    if not g.route then
      table.insert(list, g)
      G.level = math.max(1, g.lo)
      S.Load(S.Key(g), true)
      for n = 1, S.Count() do
        local step = S.Step(n)
        if ForMe(step) then
          for _, e in ipairs(step.elements) do if e.kind == "T" then anywhere[e.id] = true end end
        end
      end
    end
  end
  local later, other, nowhere, examples = 0, 0, 0, {}
  for _, g in ipairs(list) do
    G.level = math.max(1, g.lo)
    S.Load(S.Key(g), true)
    local handed, inGuide, seen = {}, {}, {}
    for n = 1, S.Count() do
      local step = S.Step(n)
      if ForMe(step) then
        for _, e in ipairs(step.elements) do if e.kind == "T" then inGuide[e.id] = true end end
      end
    end
    for n = 1, S.Count() do
      local step = S.Step(n)
      if ForMe(step) then
        for _, e in ipairs(step.elements) do
          if e.kind == "T" then handed[e.id] = true
          elseif e.kind == "A" and not seen[e.id] then
            seen[e.id] = true
            local row = ER.QuestRow(e.id)
            local p = row and row.p
            if p and p ~= e.id and not handed[p] then
              local what
              if inGuide[p] then later = later + 1 what = "handed in later in the guide (kept: the guide knows the order)"
              elseif anywhere[p] then other = other + 1 what = "handed in by another guide"
              else nowhere = nowhere + 1 what = "in no guide (still offered)" end
              if #examples < 4 and inGuide[p] then
                table.insert(examples, g.title .. " step " .. n .. ": " .. tostring(S.QuestTitle(e.id)) .. " needs " .. tostring(S.QuestTitle(p) or p) .. ", " .. what)
              end
            end
          end
        end
      end
    end
  end
  local n = later + other + nowhere
  total = total + n
  print("  " .. c[1] .. " " .. c[2] .. ": " .. #list .. " guides, " .. n .. " pick-ups without their quest before earlier in the guide (" ..
    later .. " handed in later in the same guide, " .. other .. " by another guide, " .. nowhere .. " in no guide)")
  for _, x in ipairs(examples) do print("    " .. x) end
end
print("  sweep total: " .. total)
S.Stop()

if failures == 0 then print("ALL SAFETY CHECKS PASSED") else print(failures .. " CHECK(S) FAILED") os.exit(1) end
`, "tests");
