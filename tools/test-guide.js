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

EasyRoute = { VERSION = "test", Loaded = function() end, GOLD = "", GREY = "", WHITE = "", END = "", GREEN = "", Print = function(m) CHAT = (CHAT or "") .. "[print] " .. m .. "|" end,
  Char = function() return "Tester-Realm" end,
  Where = function() return "Westfall", "", 50, 50 end,
  Log = function(kind, fields) fields = fields or {} fields.t = kind fields.char = "Tester-Realm" return fields end,
  db = { journal = {}, ratings = {} } }

local function newFrame(name)
  local f = { _scripts = {}, _shown = false, _text = "", _name = name }
  setmetatable(f, { __index = function(t, k)
    if k == "SetScript" then return function(self, ev, fn) self._scripts[ev] = fn end end
    if k == "SetText" then return function(self, s) self._text = s or "" if s and string.len(s) > 800 then LONGEST_TEXT = s end end end
    if k == "GetText" then return function(self) return self._text end end
    if k == "Show" then return function(self) self._shown = true if self._scripts.OnShow then this = self self._scripts.OnShow() end end end
    if k == "Hide" then return function(self) self._shown = false end end
    if k == "IsShown" or k == "IsVisible" then return function(self) return self._shown end end
    if k == "GetScript" then return function(self, ev) return self._scripts[ev] end end
    if k == "GetName" then return function(self) return self._name end end
    if k == "SetHeight" then return function(self, h) rawset(self, "_h", h) end end
    if k == "GetHeight" then return function(self)
      local h = rawget(self, "_h")
      if h == 0 then
        return 14 * math.ceil(math.max(1, string.len(self._text or "")) / math.max(1, math.floor((rawget(self, "_w") or 280) / 6)))
      end
      return h or 10
    end end
    if k == "SetWidth" then return function(self, w) rawset(self, "_w", w) end end
    if k == "GetStringWidth" or k == "GetTextWidth" then return function(self) return string.len(self._text or "") * 6 end end
    if k == "GetFontString" then return function(self) return self end end
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

for (const f of ["Data/Quests.lua", "Data/Zones.lua", "Data/Mobs.lua", "Data/Guides.lua", "Data/ZoneSizes.lua", "Data/Route.lua", "Director.lua",
  "Steps.lua", "RouteReader.lua", "RouteRun.lua", "Arrow.lua", "Tracker.lua", "Simple.lua", "Adapt.lua", "Plates.lua", "Settings.lua", "Wizard.lua", "Selftest.lua", "Help.lua", "Share.lua"]) {
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
check(EasyRouteWizardFrame:GetHeight() >= 400, "the wizard should be at least 400 tall")
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
check(w.guide and w.guide.route and w.guide.name == "Elwynn Forest", "a level 1 Human in Elwynn should get the casual Elwynn Forest zone first, got " .. tostring(w.guide and w.guide.name))
check(string.find(w.text, "Casual route", 1, true) ~= nil, "the suggestion does not show the Casual route group: " .. w.text)
check(string.find(w.foot, "Fast route by RestedXP", 1, true) ~= nil and string.find(w.foot, "Casual route by Easy Route", 1, true) ~= nil, "the footer does not credit both routes: " .. tostring(w.foot))
check(ER.GroupLabel("RestedXP Alliance 1-20") == "Fast route (RestedXP) 1-20" and ER.GroupLabel("RestedXP Horde 50-60") == "Fast route (RestedXP) 50-60", "the RestedXP group label is wrong: " .. tostring(ER.GroupLabel("RestedXP Alliance 1-20")))
check(ER.GroupLabel("Casual route") == "Casual route" and ER.GroupLabel(nil) == nil, "other group names must stay as they are")
print("  " .. string.gsub(w.text, "\\n", " / "))
click(EasyRouteWizardBtn2)   -- Show me another
check(ER.WizardInfo().screen == "guide", "Show me another left the suggestion screen")

-- Settings, Change difficulty: lands on the difficulty question even though this character has been asked before
do
  EasyRouteWizardFrame:Hide()
  ER.db.wizardAsked = ER.db.wizardAsked or {}
  ER.db.wizardAsked[ER.Char()] = true
  ER.ShowWizardMood()
  check(EasyRouteWizardFrame:IsShown(), "Change difficulty did not open the wizard")
  check(ER.WizardInfo().screen == "mood", "Change difficulty landed on " .. ER.WizardInfo().screen .. ", not the difficulty question")
  EasyRouteWizardFrame:Hide()
  ER.ShowWizard()
  check(ER.WizardInfo().screen ~= "mood" or not ER.db.wizardAsked[ER.Char()], "opening the wizard again should skip the question")
end

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
print("11b. Text is measured, never cut off")
do
  local fs = CreateFrame("Frame")
  check(ER.FitHeight(fs, string.rep("word ", 40), 280, 14) > ER.FitHeight(fs, "short", 280, 14), "a long text should be taller than a short one")
  check(ER.FitHeight(fs, "", 280, 14) == 14, "an empty text should still get the minimum height")
  fs.GetHeight = function() return 0 end
  check(ER.FitHeight(fs, string.rep("word ", 40), 280, 14) > 14, "the width fallback gave no extra height for a long text")
  -- the fallback counts lines by font size, never by the minimum height
  fs.GetFont = function() return "Fonts\FRIZQT__.TTF", 12 end
  check(ER.FitHeight(fs, string.rep("word ", 40), 120, 40) == 12 * 14, "the fallback height should be 12 lines of 14, got " .. ER.FitHeight(fs, string.rep("word ", 40), 120, 40))
  check(ER.FitHeight(fs, string.rep("word ", 40), 120, 100) == 12 * 14, "a big minimum height must not multiply per line in the fallback")
  check(ER.FitHeight(fs, "short", 280, 100) == 100, "the minimum height is still the floor of the fallback result")
  check(EasyRouteTrackerLine1:GetHeight() >= 16, "a step line should be at least one line tall plus the gap")
  local tw = CreateFrame("Frame")
  ER.FitLine(tw, string.rep("long ", 30), 120)
  check(string.len(tw._text) * 6 <= 120 + 18 and string.find(tw._text, "%.%.%.$") ~= nil, "FitLine did not trim at a word")
  check(tw._w == 120, "FitLine did not restore the width")
end
-- the > and < buttons
local p0 = ER.Steps.Position()
EasyRouteTrackerNext._scripts.OnClick()
local p1 = ER.Steps.Position()
check(p1 > p0, "the > button did not move on")
EasyRouteTrackerPrev._scripts.OnClick()
-- The guide may have passed steps that were already done (a hand-in of a quest that is not in the log), so < lands on the step before.
check(ER.Steps.Position() < p1 and ER.Steps.Position() >= p0, "the < button did not go back from step " .. p1 .. ", at " .. ER.Steps.Position())
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
for i = 1, 11 do CreateFrame("Frame", "EasyRouteSettingsCheck" .. i .. "Text") end   -- the tick labels the game's template makes
click(EasyRouteTrackerGear)
check(EasyRouteSettings and EasyRouteSettings:IsShown(), "the gear did not open the settings window")
check(EasyRouteSettingsCheck6Text:GetHeight() > 16, "a tick label that wraps should be measured taller than one line")
check(EasyRouteSettingsCheck2Text:GetHeight() == 16, "a short tick label should stay one line")
check(EasyRouteSettings:GetHeight() > 580, "a wrapping tick label should make the Settings window taller")
local si = ER.SettingsInfo()
check(si and table.getn(si.groups) == 2, "Settings should have two groups")
check(si.groups[1].title == "The guide" and si.groups[2].title == "Feedback (for testers)", "the group titles are wrong")
check(si.groups[1].checks == 8 and si.groups[1].buttons == 5, "'The guide' should have 8 ticks and 5 buttons")
check(si.groups[2].checks == 3 and si.groups[2].buttons == 3, "'Feedback (for testers)' should have 3 ticks and 3 buttons")
for i = 1, 8 do hover(_G["EasyRouteSettingsButton" .. i]) end
check(_G["EasyRouteSettingsButton9"] == nil, "there should be only 8 buttons in Settings")
check(_G["EasyRouteSettingsCheck11"] ~= nil and _G["EasyRouteSettingsCheck12"] == nil, "there should be 11 ticks in Settings")
check(EasyRouteSettings:GetHeight() > 300, "the Settings window should grow to hold both groups")
local keepPrompt, keepParty = ER.db.autoPrompt, ER.db.partyAnnounce
EasyRouteSettingsCheck7.GetChecked = function() return nil end
click(EasyRouteSettingsCheck7)    -- go on to the next guide: off
check(ER.db.autoNextOff == true, "unticking 'Go straight on to the next guide' did not set autoNextOff")
EasyRouteSettingsCheck7.GetChecked = function() return 1 end
click(EasyRouteSettingsCheck7)
check(not ER.db.autoNextOff, "ticking 'Go straight on to the next guide' did not clear autoNextOff")
EasyRouteSettingsCheck9.GetChecked = function() return 1 end
click(EasyRouteSettingsCheck9)    -- ask how hard each quest was
check(ER.db.autoPrompt == true, "ticking 'Ask me how hard each quest was' did not turn it on")
EasyRouteSettingsCheck9.GetChecked = function() return nil end
click(EasyRouteSettingsCheck9)
check(ER.db.autoPrompt == false, "unticking 'Ask me how hard each quest was' did not turn it off")
EasyRouteSettingsCheck10.GetChecked = function() return 1 end
click(EasyRouteSettingsCheck10)   -- party chat
check(ER.db.partyAnnounce == true, "ticking the party chat tick did not turn it on")
EasyRouteSettingsCheck10.GetChecked = function() return nil end
click(EasyRouteSettingsCheck10)
check(ER.db.partyAnnounce == false, "unticking the party chat tick did not turn it off")
ER.db.autoPrompt, ER.db.partyAnnounce = keepPrompt, keepParty
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
check(EasyRouteSimpleNow:GetHeight() >= 16, "the Now line should be at least one line tall plus the gap")
check(EasyRouteSimpleRow1:GetHeight() >= EasyRouteSimpleRow1.title:GetHeight(), "a quest row should hold its title")
check(EasyRouteSimple:GetHeight() > 48, "the quest list should grow to fit its rows")
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
local shortTips = EasyRouteTips:GetHeight()
ER.AddTip("t3", string.rep("a long tip ", 25))
check(EasyRouteTips:GetHeight() > shortTips, "a long tip should make the tips box taller")
ER.RemoveTip("t3")
ER.ToggleTips()
check(not EasyRouteTips:IsShown(), "/er tips did not hide the box")
ER.ToggleTips()
check(EasyRouteTips:IsShown(), "/er tips did not bring the box back")
click(EasyRouteTipsClose)
check(not EasyRouteTips:IsShown(), "closing the tips box left it up")
-- a finished guide hands over to the next one with exactly one chat line
ER.db.autoNextOff = nil
CHAT = ""
check(ER.AutoNextGuide(), "AutoNextGuide did not start the next guide")
local _, said = string.gsub(CHAT, "Easy Route:", "")
check(said == 1, "starting the next guide by itself should print one Easy Route line, got " .. said)
check(string.find(CHAT, "Now following", 1, true) ~= nil, "the next-guide line does not say Now following: " .. CHAT)
ER.Steps.Stop()
check(not ER.Steps.Running(), "stopping the guide did not stop it")

print("12. The wizard waits to be asked")
EasyRouteWizardFrame:Hide()
ER.db.wizardAsked = nil
check(EasyRouteWizardStarter == nil, "the wizard still has a first-login starter: it must only open from /er, the gear or Settings")
check(not EasyRouteWizardFrame:IsShown(), "the wizard is open although nobody asked for it")
ER.ShowWizardMood()
EasyRouteWizardFrame:Hide()
ER.ShowWizard()
check(EasyRouteWizardFrame:IsShown(), "ER.ShowWizard did not open the wizard")
check(ER.WizardInfo().screen == "mood", "a character not asked before should get the difficulty question, got " .. ER.WizardInfo().screen)
EasyRouteWizardFrame:Hide()
print("13. Help and the notice")
LONGEST_TEXT = nil
ER.ShowHelp()
check(EasyRouteHelpFrame:IsShown(), "the Help window did not open")
check(LONGEST_TEXT ~= nil, "the Help text was not set")
for _, words in ipairs({ "Fast route (RestedXP)", "Stuck? Skip this step", "casual route", "where you are in the plan", "TourGuide", "VanillaGuide" }) do
  check(LONGEST_TEXT and string.find(LONGEST_TEXT, words, 1, true) ~= nil, "the Help text does not say: " .. words)
end
check(EasyRouteHelpFrame:GetHeight() > 200, "the Help window should be sized from its text")
EasyRouteHelpFrame:Hide()
ER.ShowNotice()
check(EasyRouteNoticeFrame:IsShown(), "the first-login notice did not open")
check(EasyRouteNoticeFrame:GetHeight() > 150, "the notice should be sized from its text")
EasyRouteNoticeFrame:Hide()

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
GetAddOnMetadata = function() return EasyRoute.VERSION end
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

for (const f of ["Core.lua", "Recorder.lua", "Director.lua"]) {
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
  if has(line, "did not load") then restartAt = restartAt or i end
  check(not has(string.lower(line), "notebook"), "the login output says notebook: " .. line)
  check(not has(line, "rated so far"), "the login output still counts rated quests: " .. line)
end
check(helpCount == 1, "expected one login line with /er help, got " .. helpCount)
check(helpAt and has(LINES[helpAt], EasyRoute.VERSION) and has(LINES[helpAt], "0.9.1"), "the login line does not carry the version 0.9.1")
check(helpAt and restartAt and helpAt < restartAt, "the login line should come before the line about files that did not load")

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
-- with a guide running, go and area show the step box (never hide it) and wizard opens the start screen
do
  local keepSteps2, keepShow, keepToggle, keepShowWiz = EasyRoute.Steps, EasyRoute.ShowTracker, EasyRoute.ToggleTracker, EasyRoute.ShowWizard
  EasyRoute.Steps = { Running = function() return true end }
  EasyRoute.ShowTracker = function() SHOWN = (SHOWN or 0) + 1 end
  EasyRoute.ToggleTracker = function() TOGGLED = true end
  EasyRoute.ShowWizard = function() WIZSHOWN = true end
  for _, word in ipairs({ "go", "area" }) do
    SHOWN, TOGGLED, WIZ = nil, nil, nil
    SLASH(word)
    check(SHOWN == 1, "/er " .. word .. " with a guide running did not show the step box")
    check(TOGGLED == nil, "/er " .. word .. " with a guide running toggled the step box")
    check(WIZ == nil, "/er " .. word .. " with a guide running opened the start screen")
  end
  SHOWN, TOGGLED, WIZ, WIZSHOWN = nil, nil, nil, nil
  SLASH("wizard")
  check(WIZSHOWN == true and TOGGLED == nil and WIZ == nil, "/er wizard with a guide running should open the start screen")
  EasyRoute.Steps, EasyRoute.ShowTracker, EasyRoute.ToggleTracker, EasyRoute.ShowWizard = keepSteps2, keepShow, keepToggle, keepShowWiz
  SHOWN, TOGGLED, WIZ, WIZSHOWN = nil, nil, nil, nil
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

-- Chat on a pick-up or a hand-in: quiet unless the tester tick is on; party chat only when ticked
local R = EasyRoute.Recorder
local function lastJournal() return EasyRouteDB.journal[table.getn(EasyRouteDB.journal)] end
EasyRouteDB = nil
Fire("VARIABLES_LOADED")
GetNumPartyMembers = function() return 2 end

-- q. tick off, party off: nothing printed, nothing said, but the hand-in is recorded
LINES, PARTY = {}, {}
R.OnRemove("Wolves Across the Border", { qlevel = 5 }, true)
check(table.getn(LINES) == 0, "a hand-in with the tester tick off should print nothing, got " .. table.getn(LINES) .. ": " .. tostring(LINES[1]))
check(table.getn(PARTY) == 0, "a hand-in with party chat off said something in party chat")
check(lastJournal() and lastJournal().t == "turnin", "the hand-in was not written to the journal")
check(EasyRoute.IsDone({ n = "Wolves Across the Border" }), "the hand-in was not marked done")

-- r. tick on, not rated: exactly one short line
EasyRouteDB.autoPrompt = true
LINES = {}
R.OnRemove("Unrated Quest", { qlevel = 5 }, true)
check(table.getn(LINES) == 1, "a hand-in with the tester tick on should print one line, got " .. table.getn(LINES))
check(has(LINES[1], "Unrated Quest") and has(LINES[1], "Not rated yet."), "the hand-in line is missing the title or Not rated yet.: " .. tostring(LINES[1]))
check(not has(LINES[1], "/er"), "the hand-in line still points at /er: " .. tostring(LINES[1]))

-- s. tick on, rated before: one line that says Rated
EasyRoute.SetRating("Rated Quest", "easy")
LINES = {}
R.OnRemove("Rated Quest", { qlevel = 5 }, true)
check(table.getn(LINES) == 1 and has(LINES[1], "Rated"), "a rated quest should give one line with Rated, got " .. table.getn(LINES))

-- t. party chat only when ticked
EasyRouteDB.autoPrompt = false
EasyRouteDB.partyAnnounce = true
PARTY = {}
R.OnRemove("Party Quest", { qlevel = 5 }, true)
check(table.getn(PARTY) == 1, "party chat is ticked and in a party: expected one party line, got " .. table.getn(PARTY))
EasyRouteDB.partyAnnounce = false
PARTY = {}
R.OnRemove("Quiet Party Quest", { qlevel = 5 }, true)
check(table.getn(PARTY) == 0, "party chat is off: nothing should be said in party")

-- u. an abandoned quest prints nothing and is not done
LINES = {}
R.OnRemove("Dropped Quest", {}, false)
check(table.getn(LINES) == 0, "an abandoned quest printed " .. table.getn(LINES) .. " line(s)")
check(not EasyRoute.IsDone({ n = "Dropped Quest" }), "an abandoned quest was marked done")

-- v. the chain line needs the tester tick; the popup needs its own tick
local keepChain = R.Chain
R.Chain = function() return 2, 5, "Next One" end
EasyRouteDB.autoPrompt = false
LINES = {}
R.OnAccept("Chain Quest", { qlevel = 5, pfid = 123 })
check(table.getn(LINES) == 0, "the chain line showed with the tester tick off")
EasyRouteDB.autoPrompt = true
LINES = {}
R.OnAccept("Chain Quest", { qlevel = 5, pfid = 123 })
check(table.getn(LINES) == 1 and has(LINES[1], "step 2 of 5"), "the chain line should show once with the tick on, got " .. table.getn(LINES))
EasyRoute.ShowChainNotice = function() POPUP = true end
R.Chain = function() return 1, 5, "Next" end
EasyRouteDB.autoPrompt = false
POPUP = nil
R.OnAccept("First Chain Quest", { qlevel = 5, pfid = 124 })
check(POPUP == nil, "the chain popup showed with its tick off")
EasyRouteDB.chainPopup = true
R.OnAccept("First Chain Quest", { qlevel = 5, pfid = 124 })
check(POPUP == true, "the chain popup did not show with its tick on")
EasyRouteDB.chainPopup = false
EasyRoute.ShowChainNotice = nil
R.Chain = keepChain
POPUP = nil

-- w to aa. The restart line comes from the files that did not say they loaded, not from a hand-kept list
local BS = string.char(92)
local function listed(list, name)
  for _, n in ipairs(list) do if n == name then return true end end
  return false
end
local function sawRestart(lines)
  for _, line in ipairs(lines) do
    if has(string.lower(line), "close the game completely") then return true end
  end
  return false
end

-- w. Core, Recorder and Director ran in this VM; nothing else did
local m = EasyRoute.MissingFiles()
check(listed(m, "Steps.lua"), "Steps.lua should be listed missing")
check(listed(m, "Data" .. BS .. "Guides.lua"), "Data" .. BS .. "Guides.lua should be listed missing")
check(not listed(m, "Core.lua"), "Core.lua stamped itself but is listed missing")
check(not listed(m, "Recorder.lua"), "Recorder.lua stamped itself but is listed missing")
check(not listed(m, "Director.lua"), "Director.lua stamped itself but is listed missing")

-- x. login with files missing while the .toc matches: say which files did not load, not the restart line
LINES = {}
Fire("PLAYER_LOGIN")
check(not sawRestart(LINES), "files that errored on load should not get the restart line")
local sawName = false
for _, line in ipairs(LINES) do
  if has(line, "Quests.lua") and has(line, "and ") and has(line, " more did not load") and has(string.lower(line), "screenshot") then sawName = true end
end
check(sawName, "login with files missing should say which file did not load")
-- one missing file: its name alone
do
  local saved = {}
  for k, v in pairs(EasyRoute.loaded) do saved[k] = v end
  for _, name in ipairs(EasyRoute.MissingFiles()) do
    local _, _, base = string.find(name, "^Data" .. BS .. "(.+)%.lua$")
    if base then _G["EasyRoute_" .. base] = {} else EasyRoute.Loaded(name) end
  end
  EasyRoute.loaded["Plates.lua"] = nil
  LINES = {}
  Fire("PLAYER_LOGIN")
  local one = false
  for _, line in ipairs(LINES) do
    if has(line, "Plates.lua did not load") and not has(line, ",") then one = true end
  end
  check(one, "one missing file should be named on its own")
  check(not sawRestart(LINES), "one file that errored should not get the restart line")
  EasyRoute.Loaded("Plates.lua")
end

-- y. every file stamped: nothing missing (twice, no side effects) and no restart line
for _, name in ipairs(EasyRoute.MissingFiles()) do
  local _, _, base = string.find(name, "^Data" .. BS .. "(.+)%.lua$")
  if base then _G["EasyRoute_" .. base] = {} else EasyRoute.Loaded(name) end
end
check(table.getn(EasyRoute.MissingFiles()) == 0, "everything is marked loaded but files are still listed missing")
check(table.getn(EasyRoute.MissingFiles()) == 0, "the second call to MissingFiles gave a different answer")
LINES = {}
Fire("PLAYER_LOGIN")
check(not sawRestart(LINES), "login with every file loaded still gave the restart line")

-- z. the game holds a .toc of another version: one entry, and the restart line
GetAddOnMetadata = function() return "0.8.2" end
m = EasyRoute.MissingFiles()
check(table.getn(m) == 1, "an old .toc should give exactly one entry, got " .. table.getn(m))
check(m[1] ~= nil and string.find(m[1], "^EasyRoute%.toc") ~= nil, "the old .toc entry should start with EasyRoute.toc, got " .. tostring(m[1]))
LINES = {}
Fire("PLAYER_LOGIN")
check(sawRestart(LINES), "login with an old .toc should give the restart line")
-- no version from the game: only the stamps decide
GetAddOnMetadata = nil
check(table.getn(EasyRoute.MissingFiles()) == 0, "with no GetAddOnMetadata the list should be empty")
GetAddOnMetadata = function() return EasyRoute.VERSION end

-- z2. a stray carriage return after the version, and a call that raises an error
GetAddOnMetadata = function() return EasyRoute.VERSION .. string.char(13) end
check(table.getn(EasyRoute.MissingFiles()) == 0, "a version ending in a carriage return should still match")
GetAddOnMetadata = function() error("no such addon") end
local okCall, listAfterError = pcall(EasyRoute.MissingFiles)
check(okCall, "MissingFiles raised an error when GetAddOnMetadata raised one")
check(okCall and table.getn(listAfterError) == 0, "a failing GetAddOnMetadata should leave the list empty")
GetAddOnMetadata = function() return EasyRoute.VERSION end

-- aa. names are matched whole: Steps does not count for Steps.lua
EasyRoute.loaded["Steps.lua"] = nil
EasyRoute.Loaded("Steps")
check(listed(EasyRoute.MissingFiles(), "Steps.lua"), "a stamp Steps should not count for Steps.lua")
EasyRoute.Loaded("Steps.lua")
check(not listed(EasyRoute.MissingFiles(), "Steps.lua"), "Steps.lua stamped but still listed missing")

if failures == 0 then print("CORE CHECKS PASSED") else print(failures .. " CORE CHECK(S) FAILED") os.exit(1) end
`, "core");

