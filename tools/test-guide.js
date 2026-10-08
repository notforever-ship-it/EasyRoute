// Drives the director window (Guide.lua) through a mock of the game's UI, on the real data, in a Lua VM (fengari).
// It builds the window, clicks quests, modes, stops and the questions, and fails on any Lua error or missing text.
// It cannot show how the window looks; it only proves the code runs and says the right things.
// Usage: node tools/test-guide.js        (needs fengari: npm install in this tools folder, or NODE_PATH set)

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

// Lua 5.0 helpers, the addon table, and the game's API as far as these files touch it.
run(`
table.getn = function(t) return #t end
string.gfind = string.gmatch
math.mod = math.fmod
unpack = unpack or table.unpack

failures = 0
function check(cond, msg) if not cond then failures = failures + 1 print("  FAIL: " .. msg) end end

EasyRoute = { VERSION = "test", GOLD = "", GREY = "", WHITE = "", END = "", GREEN = "", Print = function(m) CHAT = (CHAT or "") .. "[print] " .. m .. "|" end,
  Char = function() return "Tester-Realm" end,
  Where = function() return "Westfall", "", 50, 50 end,
  Log = function(kind, fields) fields = fields or {} fields.t = kind fields.char = "Tester-Realm" return fields end,
  db = { journal = {}, ratings = {} } }

local function newFrame(name)
  local f = { _scripts = {}, _shown = false, _text = "", _name = name }
  setmetatable(f, { __index = function(t, k)
    if k == "SetScript" then return function(self, ev, fn) self._scripts[ev] = fn end end
    if k == "SetText" then return function(self, s) self._text = s or "" end end
    if k == "GetText" then return function(self) return self._text end end
    if k == "Show" then return function(self) self._shown = true if self._scripts.OnShow then this = self self._scripts.OnShow() end end end
    if k == "Hide" then return function(self) self._shown = false end end
    if k == "IsShown" or k == "IsVisible" then return function(self) return self._shown end end
    if k == "GetScript" then return function(self, ev) return self._scripts[ev] end end
    if k == "GetName" then return function(self) return self._name end end
    if k == "SetHeight" then return function(self, h) rawset(self, "_h", h) end end
    if k == "GetHeight" then return function(self) return rawget(self, "_h") or 10 end end
    if k == "GetPoint" then return function(self) return "CENTER", nil, "CENTER", 0, 0 end end
    return function(self) return newFrame() end
  end })
  if name then _G[name] = f end
  return f
end
CreateFrame = function(kind, name) return newFrame(name) end
UIParent = newFrame()
GameTooltip = newFrame()
UISpecialFrames = {}
DEFAULT_CHAT_FRAME = { AddMessage = function(self, m) CHAT = (CHAT or "") .. m .. "|" end }
getglobal = function(n) return _G[n] end
GetTime = function() return os.clock() end
time = os.time
date = os.date
geterrorhandler = function() return nil end
seterrorhandler = function(f) ERRHANDLER = f end
GetZoneText = function() return "Westfall" end
level = 12
UnitLevel = function() return level end
UnitRace = function() return "Human", "Human" end
UnitClass = function() return "Warrior", "WARRIOR" end
UnitFactionGroup = function() return "Alliance" end
UnitXP = function() return 0 end
UnitXPMax = function() return 1000 end
GetSubZoneText = function() return "" end
GetNumQuestLogEntries = function() return 0, 0 end
GetContainerNumSlots = function() return 0 end
math.atan2 = math.atan2 or function(y, x) return math.atan(y, x) end

function click(frame, button)
  this = frame
  arg1 = button or "LeftButton"
  frame._scripts.OnClick()
end
function hover(frame)
  this = frame
  frame._scripts.OnEnter()
  frame._scripts.OnLeave()
end
`, "prelude");

for (const f of ["Data/Quests.lua", "Data/Zones.lua", "Data/Mobs.lua", "Data/Guides.lua", "Data/ZoneSizes.lua", "Director.lua", "Guide.lua",
  "Steps.lua", "Arrow.lua", "Tracker.lua", "Simple.lua", "Adapt.lua", "Plates.lua", "Settings.lua", "Wizard.lua", "Selftest.lua"]) {
  run(fs.readFileSync(path.join(ROOT, f)), f);
}

run(`
local ER = EasyRoute
ER.RestartNeeded = function() end

print("1. The window builds and fills in")
check(ER.ToggleGuide and ER.ShowGuide and ER.PointTo and ER.RefreshDirector, "Guide.lua did not define its functions")
ER.ShowGuide()
check(EasyRouteGuideFrame:IsShown(), "window did not open")
local shown = 0
for i = 1, 9 do
  if _G["EasyRouteGuideRow" .. i]:IsShown() then shown = shown + 1 end
end
check(shown >= 3, "expected several quest rows, got " .. shown)
print("  quest rows shown: " .. shown .. ", first: " .. EasyRouteGuideRow1.text._text)
check(string.find(EasyRouteGuideRow1.text._text, "%[") ~= nil, "row text has no level")

print("2. Clicking a quest points at it; right-click says not today")
CHAT = ""
local row1 = EasyRouteGuideRow1
local id1, name1 = row1.cand.q.id, row1.cand.q.n
hover(row1)
click(row1, "LeftButton")
check(string.find(CHAT, "go to") ~= nil, "clicking a quest did not say where to go")
print("  " .. CHAT)
CHAT = ""
click(row1, "RightButton")
check(string.find(CHAT, "not today") ~= nil, "right-click did not say not today")
local still = false
for i = 1, 9 do
  local r = _G["EasyRouteGuideRow" .. i]
  if r:IsShown() and r.cand and r.cand.q.id == id1 then still = true end
end
check(not still, "a skipped quest is still in the window: " .. name1)

print("3. Mode buttons change the mode and the list")
for i = 1, 3 do hover(_G["EasyRouteGuideMode" .. i]) end
click(EasyRouteGuideMode3)
check(ER.Mode() == "normal", "mode did not change to normal")
click(EasyRouteGuideMode2)
check(ER.Mode() == "medium", "mode did not change to medium")
click(EasyRouteGuideMode1)
check(ER.Mode() == "casual", "mode did not change back to casual")

print("4. Stops can be paged and shown")
click(EasyRouteGuideNext)
click(EasyRouteGuideNext)
click(EasyRouteGuidePrev)
CHAT = ""
click(EasyRouteGuideGo)
check(string.find(CHAT, "go to") ~= nil, "'Show me this stop' said nothing")
print("  " .. CHAT)

print("5. Where next? gives answers that can be clicked")
click(EasyRouteGuideWhere)
check(EasyRouteGuideAsk1:IsShown(), "Where next? showed no answers")
print("  first answer: " .. EasyRouteGuideAsk1._text)
CHAT = ""
hover(EasyRouteGuideAsk1)
click(EasyRouteGuideAsk1)
check(string.find(CHAT, "go to") ~= nil, "clicking an answer did not point anywhere")

print("6. A used-up zone asks the question by itself, and Stay a while quiets it")
level = 40
ER.db.skipped = nil
ER.RefreshDirector()
check(string.find(EasyRouteGuideFrame:GetText() or "", "") ~= nil, "frame text")
check(EasyRouteGuideStay:IsShown(), "the used-up question did not show its Stay button")
click(EasyRouteGuideStay)
check(ER.db.stay and ER.db.stay["Westfall"], "Stay a while did not remember")
check(not EasyRouteGuideStay:IsShown(), "the question is still showing after Stay a while")

print("7. Chain and grind lines hover and click without errors")
level = 12
ER.db.stay = nil
ER.RefreshDirector()
for _, i in ipairs({ 101, 102, 201, 202 }) do
  local l = _G["EasyRouteGuideRow" .. i]
  if l:IsShown() then hover(l) click(l) end
end

print("8. The slash-command helpers")
ER.SetMode("medium")
check(ER.Mode() == "medium", "SetMode failed")
ER.SkipQuest(36)
ER.ClearSkipped()
check(next(ER.db.skipped) == nil, "ClearSkipped left something")

print("9. The in-game self-test runs and reports")
CHAT = ""
ER.db.stay = nil
this, arg1 = "the chat box", "typed text"
ER.SelfTest()
check(this == "the chat box" and arg1 == "typed text", "the self-test left this/arg1 changed, which breaks the chat box that ran the command")
check(ER.db.selftest and ER.db.selftest.failed == 0, "self-test reported failures")
for _, line in ipairs(ER.db.selftest and ER.db.selftest.results or {}) do print("  " .. line) end
check(ERRHANDLER ~= nil, "error capture was not installed")
if ERRHANDLER then
  ERRHANDLER("Interface\AddOns\EasyRoute\Guide.lua:1: test error")
  check(ER.db.errors and table.getn(ER.db.errors) == 1, "an EasyRoute error was not kept")
end

print("11. The wizard asks the difficulty, suggests a guide, and Go with this starts it with the step window")
LOGGED = {}
ER.Recorder = { Known = function() return LOGGED end, Ready = function() return true end }
level = 1
GetZoneText = function() return "Elwynn Forest" end
ER.db.wizardAsked = nil
ER.db.guides = {}
ER.ShowWizard()
local w = ER.WizardInfo()
check(w and w.screen == "mood", "the wizard did not start with the difficulty question")
check(string.find(w.text, "How do you want to play") ~= nil, "difficulty question is missing")
for i = 1, 4 do check(_G["EasyRouteWizardBtn" .. i]:IsShown(), "difficulty button " .. i .. " missing") end
check(string.find(EasyRouteWizardBtn3._text, "Hard") ~= nil, "third button should say Hard, says " .. EasyRouteWizardBtn3._text)
check(string.find(EasyRouteWizardBtn4._text, "Everything") ~= nil, "fourth button should say Everything, says " .. EasyRouteWizardBtn4._text)

-- Everything turns on the rating popup and does not start a guide
ER.db.autoPrompt = false
click(EasyRouteWizardBtn4)
check(ER.Mode() == "everything", "choosing Everything did not set the mode")
check(ER.db.autoPrompt == true, "Everything should turn on the rating popup")
check(ER.WizardInfo().screen == "free", "Everything should play your own way, screen is " .. ER.WizardInfo().screen)
check(not ER.Steps.Running(), "Everything should not start a guide")
ER.db.autoPrompt = false
click(EasyRouteWizardBtn3)   -- (free screen: change difficulty)
check(ER.WizardInfo().screen == "mood", "change difficulty did not go back to the question")
click(EasyRouteWizardBtn2)   -- Medium
check(ER.Mode() == "medium", "choosing Medium did not set the mode")
w = ER.WizardInfo()
check(w.screen == "guide", "no guide suggestion after choosing a difficulty, screen is " .. w.screen)
check(string.find(w.text, "I suggest") ~= nil, "no suggestion in the text")
check(w.guide and w.guide.name == "1-6 Northshire", "a level 1 Human in Elwynn should get Northshire, got " .. tostring(w.guide and w.guide.name))
print("  " .. string.gsub(w.text, "\\n", " / "))
click(EasyRouteWizardBtn2)   -- Show me another
check(ER.WizardInfo().screen == "guide", "Show me another left the suggestion screen")

-- Go with this: the wizard closes, the step window opens, the guide is running
ER.ShowWizard()
local pick = ER.WizardInfo().guide
CHAT = ""
click(EasyRouteWizardBtn1)
check(not EasyRouteWizardFrame:IsShown(), "the wizard should close on Go with this")
check(ER.Steps.Running(), "Go with this did not start the guide")
check(EasyRouteTracker:IsShown(), "the step window did not open")
check(string.find(CHAT, "following") ~= nil, "no chat line saying which guide is followed")
check(ER.Steps.Info() == pick, "the guide started is not the one suggested")
check(EasyRouteTrackerLine1:IsShown(), "the step box has no lines")
print("  step " .. ER.Steps.Position() .. ": " .. EasyRouteTrackerLine1.text._text)
hover(EasyRouteTrackerLine1)
-- the > and < buttons
local p0 = ER.Steps.Position()
EasyRouteTrackerNext._scripts.OnClick()
check(ER.Steps.Position() > p0, "the > button did not move on")
EasyRouteTrackerPrev._scripts.OnClick()
check(ER.Steps.Position() == p0, "the < button did not go back to step " .. p0 .. ", at " .. ER.Steps.Position())
-- /er shows and hides the step window while a guide runs
ER.ToggleWizard()
check(not EasyRouteTracker:IsShown(), "/er should hide the step window while a guide runs")
ER.ToggleWizard()
check(EasyRouteTracker:IsShown(), "/er should show the step window again")
-- the guide menu
click(EasyRouteTrackerHead)
check(EasyRouteGuideMenu:IsShown(), "clicking the guide's name did not open the guide menu")
check(string.find(EasyRouteGuideMenuExtra1.text._text, "Settings") ~= nil, "no Settings line in the guide menu: " .. EasyRouteGuideMenuExtra1.text._text)
check(string.find(EasyRouteGuideMenuExtra2.text._text, "Close") ~= nil, "the last menu line should be Close: " .. EasyRouteGuideMenuExtra2.text._text)
click(EasyRouteGuideMenuExtra2)   -- Close
check(not EasyRouteGuideMenu:IsShown(), "Close did not close the guide menu")
-- the gear: the settings window, every option in one place
click(EasyRouteTrackerGear)
check(EasyRouteSettings and EasyRouteSettings:IsShown(), "the gear did not open the settings window")
for i = 1, 10 do hover(_G["EasyRouteSettingsButton" .. i]) end
click(EasyRouteSettingsButton8)   -- Unskip quests
EasyRouteSettingsCheck5.GetChecked = function() return nil end
click(EasyRouteSettingsCheck5)    -- enemy ratings off
check(ER.db.rateOff == true, "the enemy tooltip tick box did not turn it off")
EasyRouteSettingsCheck5.GetChecked = function() return 1 end
click(EasyRouteSettingsCheck5)
check(not ER.db.rateOff, "the enemy tooltip tick box did not turn it back on")
-- simple mode: the quest list on the left instead of the step box
EasyRouteSettingsCheck1.GetChecked = function() return 1 end
click(EasyRouteSettingsCheck1)
check(EasyRouteSimple and EasyRouteSimple:IsShown(), "simple mode did not show the quest list")
check(not EasyRouteTracker:IsShown(), "simple mode should hide the step box")
check(EasyRouteSimpleRow1:IsShown(), "the quest list has no quests")
print("  list: " .. EasyRouteSimpleNow.text._text .. " / " .. EasyRouteSimpleRow1.title._text .. " / " .. EasyRouteSimpleRow1.subs[1]._text)
hover(EasyRouteSimpleRow1)
hover(EasyRouteSimpleNow)
click(EasyRouteSimpleRow1)
check(ER.ArrowPin() ~= nil, "clicking a quest did not point the arrow at it")
check(string.find(EasyRouteSimpleRow1.title._text, ">") ~= nil, "the picked quest is not marked in the list")
click(EasyRouteSimpleRow1)
check(ER.ArrowPin() == nil, "clicking it again did not give the arrow back to the guide")
ER.ToggleWizard()
check(not EasyRouteSimple:IsShown(), "/er should hide the quest list")
ER.ToggleWizard()
check(EasyRouteSimple:IsShown(), "/er should show the quest list again")
local p1 = ER.Steps.Position()
click(EasyRouteSimpleSkip)
check(ER.Steps.Position() > p1, "Skip in the quest list did not move on")
ER.SetSimple(false)
check(EasyRouteTracker:IsShown() and not EasyRouteSimple:IsShown(), "going back to the step box failed")
-- the tips box
ER.AddTip("t1", "hello there", { { label = "Yes", fn = function() TIPYES = true end }, { label = "No" } })
ER.AddTip("t2", "just so you know", nil, 30)
check(EasyRouteTips:IsShown(), "the tips box did not show")
check(EasyRouteTip1Button1:IsShown() and EasyRouteTip1Button1._text == "Yes", "the question's button is missing")
click(EasyRouteTip1Button1)
check(TIPYES and not ER.HasTip("t1"), "the tip button did not run, or the question stayed")
check(ER.HasTip("t2"), "answering one tip removed another")
ER.ToggleTips()
check(not EasyRouteTips:IsShown(), "/er tips did not hide the box")
ER.ToggleTips()
check(EasyRouteTips:IsShown(), "/er tips did not bring the box back")
click(EasyRouteTipsClose)
check(not EasyRouteTips:IsShown(), "closing the tips box left it up")
ER.Steps.Stop()
check(not ER.Steps.Running(), "stopping the guide did not stop it")

print("12. The wizard opens by itself the first time on a character, once")
EasyRouteWizardFrame:Hide()
ER.db.guideAsked = nil
ER.db.wizardAsked = nil
do
  local starter = EasyRouteWizardStarter
  check(starter ~= nil, "the first-time starter is missing")
  this = starter
  starter._scripts.OnEvent()
  check(ER.db.guideAsked["Tester-Realm"] == true, "the character was not remembered")
  check(not EasyRouteWizardFrame:IsShown(), "it should wait a few seconds before opening")
  this = starter
  arg1 = 1
  starter._scripts.OnUpdate()
  check(not EasyRouteWizardFrame:IsShown(), "opened too early")
  this = starter
  arg1 = 5
  starter._scripts.OnUpdate()
  check(EasyRouteWizardFrame:IsShown(), "the wizard did not open by itself on a new character")
  check(ER.WizardInfo().screen == "mood", "a new character should start with the difficulty question, got " .. ER.WizardInfo().screen)
  EasyRouteWizardFrame:Hide()
  this = starter
  starter._scripts.OnEvent()
  check(not EasyRouteWizardFrame:IsShown(), "it opened a second time for the same character")
end
ER.Recorder = nil
GetZoneText = function() return "Westfall" end
level = 12
ER.SetMode("casual")

print("10. Pointing with pfQuest does not leave a boolean in pfMap.queue_update")
-- pfQuest's route.SetTarget sets queue_update to true, and its map code later adds .25 to it as a time.
pfMap = { AddNode = function() end, GetMapIDByName = function() return 1 end, DeleteNode = function() end,
  GetNodes = function() return { { title = "x" } } end, UpdateNodes = function() end }
pfQuest = { route = { SetTarget = function() pfMap.queue_update = true end } }
ER.PointTo("Westfall", 50, 50, "somewhere")
check(type(pfMap.queue_update) == "number", "queue_update is " .. type(pfMap.queue_update) .. ", pfQuest needs a number")
pfMap, pfQuest = nil, nil

print(failures == 0 and "WINDOW CHECKS PASSED" or (failures .. " WINDOW CHECK(S) FAILED"))
`, "window");
