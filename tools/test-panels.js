// Checks the guide windows (Tracker.lua, Simple.lua, Adapt.lua) in a Lua VM (fengari) with a pretend game: where the quest list
// sits, the right-click "Skip quest" menu, and the grey "Why:" line under the current step. It cannot show how the windows look;
// it proves the code runs and the windows say and do the right things.
// Usage: node tools/test-panels.js

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

// The pretend game and the step player are shared with tools/test-steps.js.
const { PRELUDE, PLAYER } = require("./lib/fakegame.js");
run(PRELUDE, "prelude");

// What the panels need on top of the shared pretend game: frames that remember where they were put, the mouse, and abandoning a quest.
run(`
local realCreate = CreateFrame
CreateFrame = function(kind, name, parent, template)
  local f = realCreate(kind, name)
  rawset(f, "SetPoint", function(self, a, b, c, d, e) rawset(self, "_point", { a, b, c, d, e }) end)
  rawset(f, "RegisterForClicks", function(self, a, b) rawset(self, "_clicks", { a, b }) end)
  return f
end
GetCursorPosition = function() return 500, 400 end
UIParent.GetEffectiveScale = function() return 1 end
G.selected = nil
SelectQuestLogEntry = function(i) G.selected = i end
SetAbandonQuest = function() end
AbandonQuest = function()
  local t = G.selected and G.order[G.selected]
  if t then
    G.log[t] = nil
    table.remove(G.order, G.selected)
    Call("AbandonQuest:" .. t)
  end
end
`, "panel prelude");

for (const f of ["Data/Quests.lua", "Data/Zones.lua", "Data/Guides.lua", "Data/ZoneSizes.lua", "Data/Route.lua", "Data/Survival.lua", "Data/Ratings.lua",
  "Data/Chains.lua", "Director.lua", "Steps.lua", "RouteReader.lua", "RouteRun.lua", "Grind.lua", "Arrow.lua", "Tracker.lua", "Simple.lua", "Adapt.lua",
  "Plates.lua", "Settings.lua", "Wizard.lua"]) {
  run(fs.readFileSync(path.join(ROOT, f)), f);
}

run(PLAYER, "player");

run(`
local ER = EasyRoute
local S = ER.Steps
ER.db.autoNextOff = true

print("1. Simple mode: the quest list sits on the right, and an old spot on the left is forgotten once")
ER.db.simplePos = { point = "TOPLEFT", relPoint = "LEFT", x = 20, y = 180 }
ER.db.simpleRight = nil
local north
for _, g in ipairs(S.Guides()) do if g.name == "1-6 Northshire" then north = g end end
check(north ~= nil, "no Northshire guide for a Human")
ER.db.simple = true
check(ER.StartGuide(S.Key(north), true, true), "Northshire did not start")
check(ER.SimpleShown(), "simple mode did not show the quest list")
check(ER.db.simplePos == nil, "the old saved spot on the left was not forgotten")
check(ER.db.simpleRight == true, "the one-time move to the right was not remembered")
local p = EasyRouteSimple._point
check(p and p[1] == "TOPRIGHT" and p[3] == "TOPRIGHT" and p[4] == -40 and p[5] == -220,
  "the quest list is not where the step box sits: " .. tostring(p and table.concat({ tostring(p[1]), tostring(p[3]), tostring(p[4]), tostring(p[5]) }, " ")))
local tp = EasyRouteTracker._point
check(tp and tp[1] == p[1] and tp[4] == p[4] and tp[5] == p[5], "the step box and the quest list do not share a spot")
print("  quest list at " .. tostring(p and p[1]) .. " " .. tostring(p and p[4]) .. "," .. tostring(p and p[5]))

print("2. Right-click a quest: Skip quest leaves that quest out")
local function Click(button, which)
  this, arg1 = button, which or "LeftButton"
  button._scripts.OnClick()
end
local function ShownSteps()
  local out = {}
  for i = 1, 6 do
    local r = _G["EasyRouteTrackerRow" .. i]
    if r:IsShown() and r.step then table.insert(out, r) end
  end
  return out
end
local function QuestOf(step)
  for _, e in ipairs(step.elements) do
    -- The same quest the step box picks: the first pick-up, hand-in or quest work it shows. Only a pick-up is used here.
    if (e.kind == "A" or e.kind == "T" or e.kind == "C" or e.kind == "K") and e.id and e.id ~= 0 and S.Line(step, e) then
      if e.kind == "A" and not S.InLog(e.id) then return e.id end
      return nil
    end
  end
end
-- In the step box, on Hard (which keeps quests that are Hard for you), a quest in the list of what comes next.
ER.db.simple = nil
ER.db.mode = "hard"
G.level, G.log, G.order, G.bags = 1, {}, {}, {}
ER.db.guides, ER.db.done, ER.db.adapt = {}, {}, {}
check(ER.StartGuide(S.Key(north), true, true), "Northshire did not start again")
check(EasyRouteTrackerRow1._clicks and EasyRouteTrackerRow1._clicks[2] == "RightButtonUp", "the step box's list does not take right-clicks")
local row, id
for _, r in ipairs(ShownSteps()) do
  if not id then
    id = QuestOf(r.step)
    if id then row = r end
  end
end
check(row ~= nil, "no quest pick-up in the step box's list to skip")
if row then
  local title = S.QuestTitle(id)
  local stepN = row.step.n
  Click(row, "RightButton")
  check(EasyRouteSkipMenu and EasyRouteSkipMenu:IsShown(), "right-click did not open the menu")
  check(EasyRouteSkipMenuSkip._text == "Skip quest" and EasyRouteSkipMenuCancel._text == "Cancel", "the menu's buttons are not Skip quest and Cancel")
  check(S.Position() < stepN, "right-click jumped to the step instead of only opening the menu")
  Click(EasyRouteSkipMenuCancel)
  check(not EasyRouteSkipMenu:IsShown(), "Cancel did not close the menu")
  check(not S.LeftOut(id), "Cancel skipped the quest anyway")
  Click(row, "RightButton")
  Click(EasyRouteSkipMenuSkip)
  check(not EasyRouteSkipMenu:IsShown(), "Skip quest did not close the menu")
  check(ER.LearnedHard(id) == "skip", "the skipped quest does not count as Hard: " .. tostring(ER.LearnedHard(id)))
  check(S.LeftOut(id), "the skipped quest is not left out of the guide on Hard")
  for _, r in ipairs(ShownSteps()) do
    for _, e in ipairs(r.step.elements) do
      if e.kind == "A" and e.id == id then check(S.Line(r.step, e) == nil, "the step box still asks for the skipped quest") end
    end
  end
  check(string.find(table.concat((function() local t = {} for _, tip in ipairs(ER.TipsList()) do table.insert(t, tip.text) end return t end)(), " "),
    title, 1, true) ~= nil, "no tip says which quest was skipped")
  -- Only that quest: the other quests of the guide stay in.
  local others = 0
  for i = 1, S.Count() do
    for _, e in ipairs(S.Step(i).elements) do
      if e.kind == "A" and e.id and e.id ~= id and ER.LearnedHard(e.id) then others = others + 1 end
    end
  end
  check(others == 0, others .. " other quest(s) were marked as skipped too")
  print("  skipped " .. title .. " from the step box's list")
end

-- In simple mode, a quest that is in your quest log: it is abandoned and the guide moves past it.
ER.db.simple = true
ER.db.mode = "medium"
G.level, G.log, G.order, G.bags = 1, {}, {}, {}
ER.db.guides, ER.db.done, ER.db.adapt = {}, {}, {}
check(ER.StartGuide(S.Key(north), true, true), "Northshire did not start in simple mode")
local guard = 0
while S.Current() and guard < 40 do
  local cur = S.Current()
  local busy = false
  for _, e in ipairs(cur.elements) do if (e.kind == "C" or e.kind == "K") and e.id and S.InLog(e.id) then busy = true end end
  if busy then break end
  for _, e in ipairs(cur.elements) do if e.kind == "A" and e.id then G.log[S.QuestTitle(e.id)] = { complete = false, objs = {} } table.insert(G.order, S.QuestTitle(e.id)) end end
  if S.ByHand(cur) then S.Tick(cur.n) end
  local before = S.Position()
  S.Check()
  if S.Position() == before then S.Next() end
  guard = guard + 1
end
local cur = S.Current()
local work
for _, e in ipairs(cur and cur.elements or {}) do if (e.kind == "C" or e.kind == "K") and e.id and S.InLog(e.id) then work = work or e.id end end
check(work ~= nil, "no step with quest work in the log to test with")
ER.RefreshSimple()
check(EasyRouteSimpleRow1._clicks and EasyRouteSimpleRow1._clicks[2] == "RightButtonUp", "the quest list does not take right-clicks")
local qrow
for i = 1, 10 do
  local r = _G["EasyRouteSimpleRow" .. i]
  if r:IsShown() and r.quest and r.quest.id == work then qrow = r end
end
check(qrow ~= nil, "the quest being worked on is not in the quest list")
if qrow then
  local title = qrow.quest.title
  local stepN = cur.n
  Click(qrow, "RightButton")
  check(EasyRouteSkipMenu:IsShown(), "right-click in the quest list did not open the menu")
  local said = false
  for _, f in ipairs(ALLFRAMES) do if f._shown and string.find(f._text or "", "leaves your quest log", 1, true) then said = true end end
  check(said, "the menu does not say the quest leaves the quest log")
  Click(EasyRouteSkipMenuSkip)
  check(G.log[title] == nil, "the skipped quest is still in the quest log")
  local abandoned = false
  for _, c in ipairs(G.calls) do if c == "AbandonQuest:" .. title then abandoned = true end end
  check(abandoned, "the quest was not abandoned through the game")
  S.Check()
  check(S.Position() > stepN or not S.Current(), "the guide did not move past the skipped quest's step")
  for i = 1, 10 do
    local r = _G["EasyRouteSimpleRow" .. i]
    if r:IsShown() and r.quest then check(r.quest.title ~= title, "the skipped quest is still in the quest list") end
  end
  print("  skipped " .. title .. " from the quest list; the guide is on step " .. S.Position())
end

if failures > 0 then
  print(failures .. " check(s) FAILED")
  os.exit(1)
end
print("All panel checks passed.")
`, "test");
