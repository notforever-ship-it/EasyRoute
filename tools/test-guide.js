// Drives the windows (wizard, step window, guide menu, Settings, simple mode, tips box), the self-test and Core.lua through a mock of the game's UI, on the real data, in a Lua VM (fengari).
// It clicks the buttons and fails on any Lua error or missing text.
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

for (const f of ["Data/Quests.lua", "Data/Zones.lua", "Data/Mobs.lua", "Data/Guides.lua", "Data/ZoneSizes.lua", "Director.lua",
  "Steps.lua", "Arrow.lua", "Tracker.lua", "Simple.lua", "Adapt.lua", "Plates.lua", "Settings.lua", "Wizard.lua", "Selftest.lua"]) {
  run(fs.readFileSync(path.join(ROOT, f)), f);
}

run(`
local ER = EasyRoute
ER.RestartNeeded = function() end

print("8. The slash-command helpers")
ER.SetMode("medium")
check(ER.Mode() == "medium", "SetMode failed")
ER.SkipQuest(36)
ER.ClearSkipped()
check(next(ER.db.skipped) == nil, "ClearSkipped left something")

print("9. The in-game self-test runs and reports")
CHAT = ""
this, arg1 = "the chat box", "typed text"
ER.SelfTest()
check(this == "the chat box" and arg1 == "typed text", "the self-test left this/arg1 changed, which breaks the chat box that ran the command")
check(ER.db.selftest and ER.db.selftest.failed == 0, "self-test reported failures")
for _, line in ipairs(ER.db.selftest and ER.db.selftest.results or {}) do print("  " .. line) end
check(ERRHANDLER ~= nil, "error capture was not installed")
if ERRHANDLER then
  ERRHANDLER("Interface\AddOns\EasyRoute\Steps.lua:1: test error")
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
for i = 1, 3 do check(_G["EasyRouteWizardBtn" .. i]:IsShown(), "difficulty button " .. i .. " missing") end
check(not EasyRouteWizardBtn4:IsShown(), "there should be only three difficulty buttons")
check(string.find(EasyRouteWizardBtn3._text, "Hard") ~= nil, "third button should say Hard, says " .. EasyRouteWizardBtn3._text)
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

if failures == 0 then print("WINDOW CHECKS PASSED") else print(failures .. " WINDOW CHECK(S) FAILED") os.exit(1) end
`, "window");

// The real Core.lua needs its own Lua VM: it starts with EasyRoute = {}, so it cannot share the window VM above.
const C = lauxlib.luaL_newstate();
lualib.luaL_openlibs(C);

function runCore(code, name) {
  const buf = typeof code === "string" ? to_luastring(code) : code;
  if (lauxlib.luaL_loadbuffer(C, buf, buf.length, to_luastring(name)) !== 0 || lua.lua_pcall(C, 0, 0, 0) !== 0) {
    console.error("FAILED in " + name + ": " + to_jsstring(lua.lua_tostring(C, -1)));
    process.exit(1);
  }
}

runCore(`
table.getn = function(t) return #t end
string.gfind = string.gmatch
math.mod = math.fmod
unpack = unpack or table.unpack

failures = 0
function check(cond, msg) if not cond then failures = failures + 1 print("  FAIL: " .. msg) end end

LINES = {}
DEFAULT_CHAT_FRAME = { AddMessage = function(self, m) table.insert(LINES, m) end }
PARTY = {}
SendChatMessage = function(m, ch) table.insert(PARTY, m) end

ALLFRAMES = {}
local function newFrame(name)
  local f = { _scripts = {}, _shown = false, _text = "", _name = name, _h = 10, _w = 10 }
  setmetatable(f, { __index = function(t, k)
    if k == "SetScript" then return function(self, ev, fn) self._scripts[ev] = fn end end
    if k == "SetText" then return function(self, s) self._text = s or "" end end
    if k == "GetText" then return function(self) return self._text end end
    if k == "Show" then return function(self) self._shown = true end end
    if k == "Hide" then return function(self) self._shown = false end end
    if k == "IsShown" or k == "IsVisible" then return function(self) return self._shown end end
    if k == "GetScript" then return function(self, ev) return self._scripts[ev] end end
    if k == "GetName" then return function(self) return self._name end end
    if k == "RegisterEvent" then return function(self, ev) rawset(self, "_events", rawget(self, "_events") or {}) self._events[ev] = true end end
    if type(k) == "string" and string.find(k, "^%u") then return function(self) return newFrame() end end
    return nil
  end })
  if name then _G[name] = f end
  table.insert(ALLFRAMES, f)
  return f
end
CreateFrame = function(kind, name) return newFrame(name) end
UIParent = newFrame()
SlashCmdList = {}
getglobal = function(n) return _G[n] end
GetTime = function() return os.clock() end
time = os.time
date = os.date
UnitName = function() return "Tester" end
GetRealmName = function() return "Realm" end
UnitLevel = function() return 12 end
UnitClass = function() return "Warrior", "WARRIOR" end
UnitRace = function() return "Human", "Human" end
UnitFactionGroup = function() return "Alliance" end
GetZoneText = function() return "Elwynn Forest" end
GetSubZoneText = function() return "" end
GetPlayerMapPosition = function() return 0.5, 0.5 end
SetMapToCurrentZone = function() end
GetNumPartyMembers = function() return 0 end

function Fire(ev, a1)
  event, arg1 = ev, a1
  for _, f in ipairs(ALLFRAMES) do
    if rawget(f, "_events") and f._events[ev] and f._scripts.OnEvent then this = f f._scripts.OnEvent() end
  end
end
`, "core prelude");

for (const f of ["Core.lua", "Director.lua"]) {
  runCore(fs.readFileSync(path.join(ROOT, f)), f);
}

runCore(`
local ER = EasyRoute
local SLASH = SlashCmdList["EASYROUTE"]
local function has(line, text) return line ~= nil and string.find(line, text, 1, true) ~= nil end

print("0. Core: login line, command list, one-time switch")

-- a. an old 0.8.x save loses party chat and the chain popup once and keeps everything else
EasyRouteDB = { promptDefaultFixed = true, partyAnnounce = true, chainPopup = true, autoPrompt = false,
  ratings = { k = { rating = "easy", title = "Kept Quest" } }, journal = { { t = "turnin", title = "Kept Quest" } } }
Fire("VARIABLES_LOADED")
check(EasyRouteDB.partyAnnounce == false, "party chat should be off after the switch")
check(EasyRouteDB.chainPopup == false, "the chain popup should be off after the switch")
check(EasyRouteDB.tidy090 == true, "the switch did not set its flag")
check(EasyRouteDB.ratings.k.rating == "easy", "the switch touched a rating")
check(table.getn(EasyRouteDB.journal) == 1, "the switch touched the journal")
check(EasyRoute.db == EasyRouteDB, "EasyRoute.db is not the saved table")

-- b. it runs once
EasyRouteDB.partyAnnounce = true
Fire("VARIABLES_LOADED")
check(EasyRouteDB.partyAnnounce == true, "the switch ran a second time and undid a tick")
EasyRouteDB.partyAnnounce = false

-- c. a fresh install
EasyRouteDB = nil
Fire("VARIABLES_LOADED")
check(EasyRouteDB.partyAnnounce == false, "fresh install: party chat should start off")
check(EasyRouteDB.chainPopup == false, "fresh install: the chain popup should start off")
check(EasyRouteDB.autoPrompt == false, "fresh install: the tester tick should start off")
check(EasyRouteDB.tidy090 == true, "fresh install: the flag is missing")

-- d. the login line
LINES = {}
Fire("PLAYER_LOGIN")
local helpAt, restartAt, helpCount = nil, nil, 0
for i, line in ipairs(LINES) do
  if has(line, "/er help") then helpCount = helpCount + 1 helpAt = helpAt or i end
  if has(string.lower(line), "close the game completely") then restartAt = restartAt or i end
  check(not has(string.lower(line), "notebook"), "the login output says notebook: " .. line)
  check(not has(line, "rated so far"), "the login output still counts rated quests: " .. line)
end
check(helpCount == 1, "expected one login line with /er help, got " .. helpCount)
check(helpAt and has(LINES[helpAt], EasyRoute.VERSION) and has(LINES[helpAt], "0.9.0"), "the login line does not carry the version 0.9.0")
check(helpAt and restartAt and helpAt < restartAt, "the login line should come before the restart line")

-- e. an unknown word lists six commands in order
LINES = {}
SLASH("blah")
check(table.getn(LINES) == 1, "an unknown word should print exactly one line, got " .. table.getn(LINES))
local usage = LINES[1] or ""
local last = 0
for _, w in ipairs({ "/er settings", "/er arrow", "/er next", "/er stop", "/er help" }) do
  local at = string.find(usage, w, 1, true)
  check(at ~= nil and at > last, "the command list is missing or out of order at " .. w)
  last = at or last
end
local _, nEr = string.gsub(usage, "/er", "")
check(nEr == 6, "the command list should name six commands, found " .. nEr)
for _, w in ipairs({ "notebook", "/er go", "/er guides" }) do
  check(not has(usage, w), "the command list still mentions " .. w)
end

-- f. the old words still work
SLASH("party")
check(EasyRouteDB.partyAnnounce == true, "/er party did not turn party chat on")
SLASH("party")
check(EasyRouteDB.partyAnnounce == false, "/er party did not turn party chat off")
SLASH("chain")
check(EasyRouteDB.chainPopup == true, "/er chain did not turn the popup on")
SLASH("chain")
check(EasyRouteDB.chainPopup == false, "/er chain did not turn the popup off")

-- g. an old Everything save becomes Hard with the tester tick (the switch runs after the prompt fix)
EasyRouteDB = { mode = "everything" }
Fire("VARIABLES_LOADED")
check(EasyRouteDB.mode == "hard", "an old Everything save should become hard, got " .. tostring(EasyRouteDB.mode))
check(EasyRouteDB.autoPrompt == true, "an old Everything save should get the tester tick")
-- h. an old Hard save
EasyRouteDB = { mode = "normal" }
Fire("VARIABLES_LOADED")
check(EasyRouteDB.mode == "hard", "an old Hard save should become hard, got " .. tostring(EasyRouteDB.mode))
-- i. Casual stays Casual
EasyRouteDB = { mode = "casual" }
Fire("VARIABLES_LOADED")
check(EasyRouteDB.mode == "casual", "a Casual save changed to " .. tostring(EasyRouteDB.mode))
-- j. a save that skipped the switch still reads as Hard
EasyRouteDB = { mode = "normal", tidy090 = true, promptDefaultFixed = true }
Fire("VARIABLES_LOADED")
check(EasyRouteDB.mode == "normal", "the switch ran again and rewrote the mode")
check(EasyRoute.Mode() == "hard", "a stored normal should read as Hard")

-- k to n. /er mode speaks the new names
EasyRouteDB = { tidy090 = true, promptDefaultFixed = true }
Fire("VARIABLES_LOADED")
LINES = {}
SLASH("mode hard")
check(EasyRouteDB.mode == "hard", "/er mode hard did not save hard, got " .. tostring(EasyRouteDB.mode))
local sawHard = false
for _, line in ipairs(LINES) do if has(line, "Hard") then sawHard = true end end
check(sawHard, "/er mode hard said nothing with Hard in it")
SLASH("mode casual")
SLASH("mode normal")
check(EasyRouteDB.mode == "hard", "/er mode normal should still set Hard, got " .. tostring(EasyRouteDB.mode))
LINES = {}
SLASH("mode everything")
check(EasyRouteDB.mode == "hard", "/er mode everything changed the mode to " .. tostring(EasyRouteDB.mode))
check(table.getn(LINES) == 1 and has(LINES[1], "Ask me how hard each quest was"), "/er mode everything should print one line about the tick")
LINES = {}
SLASH("mode")
check(table.getn(LINES) == 1 and has(LINES[1], "Now: Hard"), "/er mode should say Now: Hard")

-- o. /er hard <quest> still rates, and does not touch the difficulty
local keep = EasyRoute.Recorder
EasyRoute.Recorder = { FindQuest = function() return "Wanted: Test Hogger", { qlevel = 10 } end, SelectedQuest = function() return nil end }
SLASH("hard Hogger")
local rated = false
for _, r in pairs(EasyRouteDB.ratings) do
  if r.title == "Wanted: Test Hogger" and r.rating == "hard" then rated = true end
end
check(rated, "/er hard <quest> did not rate the quest Hard")
check(EasyRouteDB.mode == "hard", "/er hard <quest> changed the difficulty")
EasyRouteDB.mode = "casual"
SLASH("hard Hogger")
check(EasyRouteDB.mode == "casual", "/er hard <quest> changed the difficulty from casual")
EasyRoute.Recorder = keep

-- p. plain /er: step box with a guide running, start screen with none
local keepSteps, keepTracker, keepWizard = EasyRoute.Steps, EasyRoute.ToggleTracker, EasyRoute.ToggleWizard
EasyRoute.ToggleWizard = function() WIZ = true end
EasyRoute.ToggleTracker = function() TRK = true end
WIZ, TRK = nil, nil
EasyRoute.Steps = { Running = function() return true end }
LINES = {}
SLASH("")
check(TRK == true, "plain /er did not show or hide the step box while a guide was running")
check(WIZ == nil, "plain /er opened the start screen while a guide was running")
for _, line in ipairs(LINES) do check(not has(line, "commands:"), "plain /er printed the command list") end
WIZ, TRK = nil, nil
EasyRoute.Steps = { Running = function() return false end }
LINES = {}
SLASH("")
check(WIZ == true, "plain /er did not open the start screen with no guide running")
check(TRK == nil, "plain /er showed or hid the step box with no guide running")
for _, line in ipairs(LINES) do check(not has(line, "commands:"), "plain /er printed the command list") end
EasyRoute.Steps, EasyRoute.ToggleTracker, EasyRoute.ToggleWizard = keepSteps, keepTracker, keepWizard
WIZ, TRK = nil, nil

-- /er go and /er area: one line, then the guide; the old window is gone
local keepWiz = EasyRoute.ToggleWizard
EasyRoute.ToggleWizard = function() WIZ = true end
for _, word in ipairs({ "go", "area" }) do
  WIZ, LINES = nil, {}
  SLASH(word)
  check(table.getn(LINES) == 1 and has(LINES[1], "that window is gone"), "/er " .. word .. " should print one line saying the window is gone, got " .. table.getn(LINES))
  check(WIZ == true, "/er " .. word .. " did not open the guide")
end
-- bare /er when the guide file did not load: the restart line, no notebook
EasyRoute.ToggleWizard = nil
LINES = {}
SLASH("")
local sawRestart = false
for _, line in ipairs(LINES) do
  if has(string.lower(line), "close the game completely") then sawRestart = true end
  check(not has(string.lower(line), "notebook"), "bare /er mentions the notebook: " .. line)
end
check(sawRestart, "bare /er without the guide file should give the restart line")
EasyRoute.ToggleWizard = keepWiz
WIZ = nil

if failures == 0 then print("CORE CHECKS PASSED") else print(failures .. " CORE CHECK(S) FAILED") os.exit(1) end
`, "core");

