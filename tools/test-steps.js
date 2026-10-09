// Plays through the guides (Steps.lua on the real Data\Guides.lua) in a Lua VM (fengari) with a pretend game:
// for each step it does what the step asks (takes the quests, finishes them, hands them in, walks to the place,
// reaches the level, buys the item, uses the hearthstone ...) and checks that the guide moves on by itself.
// It also builds the step window, the guide menu, the wizard and the arrow and fails on any Lua error.
// It cannot show how the windows look; it proves the code runs and the guides can be followed to the end.
// Usage: node tools/test-steps.js [all]     ("all": every guide for every race and class, slower)

const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const ROOT = path.resolve(__dirname, "..");
const ALL = process.argv[2] === "all";
// Or name the characters to play: node tools/test-steps.js Human:PALADIN:Alliance Orc:SHAMAN:Horde
const PICK = !ALL && process.argv.length > 2
  ? "{ " + process.argv.slice(2).map((a) => "{ " + a.split(":").map((x) => JSON.stringify(x)).join(", ") + " }").join(", ") + " }"
  : null;
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

function run(code, name) {
  const buf = typeof code === "string" ? to_luastring(code) : code;
  if (lauxlib.luaL_loadbuffer(L, buf, buf.length, to_luastring(name)) !== 0 || lua.lua_pcall(L, 0, 0, 0) !== 0) {
    console.error("FAILED in " + name + ": " + to_jsstring(lua.lua_tostring(L, -1)));
    process.exit(1);
  }
}

run(`
table.getn = function(t) return #t end
string.gfind = string.gmatch
math.mod = math.fmod
math.atan2 = math.atan2 or function(y, x) return math.atan(y, x) end
unpack = unpack or table.unpack
local realGsub = string.gsub
string.gsub = function(s, p, r, n) return realGsub(s, p, r, n) end

failures = 0
function check(cond, msg) if not cond then failures = failures + 1 print("  FAIL: " .. msg) end end

-- The pretend game.
G = { level = 1, xp = 0, zone = "Elwynn Forest", sub = "", x = 48, y = 42, race = "Human", class = "WARRIOR",
  faction = "Alliance", log = {}, order = {}, bags = {}, taxi = false, bind = "Northshire Abbey", facing = 0 }

EasyRoute = { VERSION = "test", Loaded = function() end, GOLD = "|cffffd100", GREY = "|cff999999", WHITE = "|cffffffff", END = "|r", GREEN = "|cff40c040",
  RED = "|cffff4040", ORANGE = "|cffff9933",
  Print = function(m) CHAT = (CHAT or "") .. m .. "|" end,
  Char = function() return "Tester-Realm" end,
  Where = function() return G.zone, G.sub, G.x, G.y end,
  Log = function(kind, fields) fields = fields or {} fields.t = kind return fields end,
  db = { journal = {}, ratings = {}, mode = "medium" } }
BASE_LOG = EasyRoute.Log
EasyRoute.Recorder = { Known = function() return G.log end, Ready = function() return true end }

local function newFrame(name)
  local f = { _scripts = {}, _shown = false, _text = "", _name = name, _h = 10, _w = 10 }
  setmetatable(f, { __index = function(t, k)
    if k == "SetScript" then return function(self, ev, fn) self._scripts[ev] = fn end end
    if k == "SetText" then return function(self, s) self._text = s or "" end end
    if k == "GetText" then return function(self) return self._text end end
    if k == "Show" then return function(self) self._shown = true if self._scripts.OnShow then local old = this this = self self._scripts.OnShow() this = old end end end
    if k == "Hide" then return function(self) self._shown = false end end
    if k == "IsShown" or k == "IsVisible" then return function(self) return self._shown end end
    if k == "GetScript" then return function(self, ev) return self._scripts[ev] end end
    if k == "GetName" then return function(self) return self._name end end
    if k == "SetHeight" then return function(self, h) self._h = h end end
    if k == "GetHeight" then return function(self)
      if self._h == 0 then
        return 14 * math.ceil(math.max(1, string.len(self._text or "")) / math.max(1, math.floor((self._w or 280) / 6)))
      end
      return self._h
    end end
    if k == "SetWidth" then return function(self, w) self._w = w end end
    if k == "GetWidth" then return function(self) return self._w end end
    if k == "GetStringWidth" or k == "GetTextWidth" then return function(self) return string.len(self._text or "") * 6 end end
    if k == "GetFontString" then return function(self) return self end end
    if k == "GetPoint" then return function(self) return "CENTER", nil, "CENTER", 0, 0 end end
    if k == "SetTexCoord" then return function(self, a, b, c, d) self._coord = { a, b, c, d } end end
    if k == "GetChildren" then return function(self) return end end
    if k == "RegisterEvent" then return function(self, ev) rawset(self, "_events", rawget(self, "_events") or {}) self._events[ev] = true end end
    if type(k) == "string" and string.find(k, "^%u") then return function(self) return newFrame() end end
    return nil
  end })
  if name then _G[name] = f end
  table.insert(ALLFRAMES, f)
  return f
end
ALLFRAMES = {}
CreateFrame = function(kind, name) return newFrame(name) end
UIParent = newFrame()
Minimap = newFrame()
GameTooltip = newFrame()
UISpecialFrames = {}
DEFAULT_CHAT_FRAME = { AddMessage = function(self, m) CHAT = (CHAT or "") .. m .. "|" end }
getglobal = function(n) return _G[n] end
NOW = 1000
GetTime = function() return NOW end
time = os.time
date = os.date
GetZoneText = function() return G.zone end
GetSubZoneText = function() return G.sub end
UnitLevel = function() return G.level end
UnitXP = function() return G.xp end
UnitXPMax = function() return 1000 end
UnitRace = function() return G.race, G.race end
UnitClass = function() return G.class, G.class end
UnitFactionGroup = function() return G.faction end
UnitOnTaxi = function() return G.taxi end
UnitExists = function(u) return u == "pet" end
GetBindLocation = function() return G.bind end
GetPlayerFacing = function() return G.facing end
SetMapToCurrentZone = function() end

-- Quest log in the order quests were taken.
GetNumQuestLogEntries = function() return #G.order, #G.order end
GetQuestLogTitle = function(i)
  local t = G.order[i]
  if not t then return nil end
  return t, 10, nil, false, false, G.log[t].complete and 1 or nil
end
GetQuestLogLeaderBoard = function(j, i)
  local t = G.order[i]
  local q = t and G.log[t]
  if not q then return nil end
  local done = q.complete or (q.objs and q.objs[j])
  return "Thing " .. j .. ": " .. (done and "1/1" or "0/1"), "monster", done and 1 or nil
end
GetContainerNumSlots = function(bag) return bag == 0 and 16 or 0 end
GetContainerItemLink = function(bag, slot)
  local i = 0
  for id, n in pairs(G.bags) do
    i = i + 1
    if i == slot then return "|cffffffff|Hitem:" .. id .. ":0:0:0|h[Thing]|h|r" end
  end
end
GetContainerItemInfo = function(bag, slot)
  local i = 0
  for id, n in pairs(G.bags) do
    i = i + 1
    if i == slot then return "tex", n end
  end
end

function Fire(ev, a1)
  event, arg1 = ev, a1
  for _, f in ipairs(ALLFRAMES) do
    if rawget(f, "_events") and f._events[ev] and f._scripts.OnEvent then this = f f._scripts.OnEvent() end
  end
end
function Tick(seconds)
  NOW = NOW + (seconds or 1)
  for _, f in ipairs(ALLFRAMES) do
    if f._scripts.OnUpdate then this = f arg1 = seconds or 1 f._scripts.OnUpdate() end
  end
end
`, "prelude");

for (const f of ["Data/Zones.lua", "Data/Guides.lua", "Data/ZoneSizes.lua", "Director.lua", "Steps.lua", "Arrow.lua", "Tracker.lua",
  "Simple.lua", "Adapt.lua", "Plates.lua", "Settings.lua", "Wizard.lua"]) {
  run(fs.readFileSync(path.join(ROOT, f)), f);
}

run(`
local ER = EasyRoute
local S = ER.Steps

-- Doing what a step asks, in the pretend game.
local function Name(id) return S.QuestTitle(id) or ("quest " .. id) end
local function Take(id)
  local t = Name(id)
  if not G.log[t] then
    G.log[t] = { complete = false, objs = {} }
    table.insert(G.order, t)
  end
end
local function Drop(id)
  local t = Name(id)
  if G.log[t] then
    G.log[t] = nil
    for i, o in ipairs(G.order) do if o == t then table.remove(G.order, i) break end end
  end
  return t
end
local function HandIn(id)
  Take(id)
  local t = Drop(id)
  ER.Log("turnin", { title = t })
  ER.OnTurnIn(t)
end

function Satisfy(step)
  local last
  for _, e in ipairs(step.elements) do if e.kind == "G" then last = e end end
  if last then G.zone, G.x, G.y = last.zone, last.x, last.y end
  for _, e in ipairs(step.elements) do
    local k = e.kind
    if k == "A" then Take(e.id)
    elseif k == "C" then Take(e.id) G.log[Name(e.id)].complete = true
    elseif k == "T" then HandIn(e.id)
    elseif k == "K" then G.bags[e.item] = (e.count or 1) + 1 Fire("BAG_UPDATE") if e.id and e.id ~= 0 then Take(e.id) end
    elseif k == "X" and not e.skip and e.op ~= "<" then
      G.level = math.max(G.level, e.level + ((e.xp and e.xp ~= "" and string.sub(e.xp, 1, 1) ~= "-") and 1 or 0))
    elseif k == "R" then Drop(e.id)
    elseif k == "Z" then G.zone = e.zone
    elseif k == "F" then G.taxi = true
    elseif k == "P" then Fire("TAXIMAP_OPENED")
    elseif k == "V" then Fire(e.what == "vendor" and "MERCHANT_CLOSED" or "TRAINER_CLOSED")
    elseif k == "H" then Fire("SPELLCAST_START", "Hearthstone") Fire("SPELLCAST_STOP")
    elseif k == "B" then G.bind = "Somewhere " .. step.n
    elseif k == "M" then S.Tick(step.n)
    end
  end
  if S.ByHand(step) then S.Tick(step.n) end
end

-- Plays one guide from the top. Returns steps walked, and how many times it had to press > to get on.
function Play(key, quiet)
  G.log, G.order, G.bags, G.taxi = {}, {}, {}, false
  ER.db.guides, ER.db.done = {}, {}
  if not S.Load(key, true) then return 0, 0, "did not load" end
  local walked, stuck, where = 0, 0, {}
  local guard = 0
  while S.Current() and guard < 3000 do
    guard = guard + 1
    local before = S.Position()
    local step = S.Current()
    Satisfy(step)
    Tick(1)
    S.Check()
    G.taxi = false
    if S.Position() == before then
      stuck = stuck + 1
      if #where < 3 then
        local lines = {}
        for _, e in ipairs(step.elements) do table.insert(lines, e.kind .. ":" .. tostring(e.id or e.text or "")) end
        table.insert(where, "step " .. step.n .. " [" .. table.concat(lines, ", ") .. "]")
      end
      S.Next()
    end
    walked = walked + 1
  end
  return walked, stuck, table.concat(where, "; ")
end

print("1. Guides for a level 1 Human warrior")
local mine = S.Guides()
check(#mine > 20, "expected many Alliance guides, got " .. #mine)
for _, g in ipairs(mine) do check(g.faction == "Alliance", "a Horde guide is offered to an Alliance character: " .. g.name) end
local sug = S.Suggest()
check(sug[1] and sug[1].name == "1-6 Northshire", "level 1 Human should get Northshire first, got " .. tostring(sug[1] and sug[1].name))
print("  " .. #mine .. " guides; suggested: " .. tostring(sug[1] and sug[1].title))
local groups = S.Groups()
check(#groups >= 5, "expected 5 level groups, got " .. #groups)
print("  groups: " .. #groups .. ", first " .. groups[1].name)

print("2. Starting Northshire: first step, the arrow, a quest taken moves it on")
check(ER.StartGuide(S.Key(sug[1])), "the guide did not start")
check(EasyRouteTracker:IsShown(), "the step window did not open")
local first = S.Current()
check(first ~= nil, "no current step")
local t = S.Target()
check(t and t.zone == "Elwynn Forest", "the arrow has no place in Elwynn: " .. tostring(t and t.zone))
print("  step " .. S.Position() .. ": " .. S.Title(first) .. "  -> arrow at " .. (t and (t.zone .. " " .. t.x .. "," .. t.y) or "nothing"))
local shown = ""
for i = 1, 9 do local b = _G["EasyRouteTrackerLine" .. i] if b:IsShown() then shown = shown .. b.text._text .. " / " end end
check(string.find(shown, "A Threat Within") ~= nil, "the box does not show the first quest: " .. shown)
print("  box: " .. shown)
local pos = S.Position()
Satisfy(first)
Tick(1)
check(S.Position() > pos, "taking the quest did not move the guide on")
print("  after taking it: step " .. S.Position() .. ": " .. S.Title(S.Current()))

print("3. The arrow turns the right way")
Fire("PLAYER_LOGIN")
ER.db.arrowOff = nil
G.zone, G.x, G.y, G.facing = "Elwynn Forest", 50, 50, 0
S.Stop() S.Load(S.Key(sug[1]), true)
local function arrowTo(x, y)
  local cur = S.Current()
  local saved = S.Target
  S.Target = function() return { zone = "Elwynn Forest", x = x, y = y, text = "test" } end
  ER.ArrowUpdate()
  S.Target = saved
  local tex
  for _, f in ipairs(ALLFRAMES) do if rawget(f, "_coord") then tex = f._coord end end
  return tex
end
NOW = NOW + 1
local c = arrowTo(50, 30)
check(c and c[1] == 0 and c[3] == 0, "target due north, facing north: expected cell 0")
NOW = NOW + 1
c = arrowTo(30, 50)
check(c and c[1] == 0 and math.abs(c[3] - 2 / 8) < 1e-6, "target due west: expected cell 16 (a quarter turn left)")
NOW = NOW + 1
c = arrowTo(70, 50)
check(c and c[1] == 0 and math.abs(c[3] - 6 / 8) < 1e-6, "target due east: expected cell 48 (a quarter turn right)")
G.facing = math.pi / 2   -- facing west, target west: straight ahead
NOW = NOW + 1
c = arrowTo(30, 50)
check(c and c[1] == 0 and c[3] == 0, "facing west at a target to the west: expected straight ahead")
print("  north, west, east and facing it all point the right way")

print("4. Menu, wizard, next guide")
ER.ShowGuideMenu()
check(EasyRouteGuideMenu:IsShown(), "guide menu did not open")
check(EasyRouteGuideMenuGroup1:IsShown() and EasyRouteGuideMenuGuide1:IsShown(), "guide menu has no rows")
print("  menu: " .. EasyRouteGuideMenuGroup1.text._text .. " / " .. EasyRouteGuideMenuGuide1.text._text)
EasyRouteGuideMenuGuide1._scripts.OnClick()
ER.ShowWizard()
check(EasyRouteWizardFrame:IsShown(), "wizard did not open")
check(S.NextGuide() ~= nil, "Northshire has no next guide")
print("  next after " .. S.Info().title .. ": " .. tostring(S.NextGuide() and S.NextGuide().title))
-- Finishing a guide starts the next one by itself.
do
  local nextTitle = S.NextGuide().title
  local guard = 0
  while S.Current() and guard < 5000 do S.Next() guard = guard + 1 end
  S.Check()
  check(S.Info() and S.Info().title == nextTitle, "the next guide did not start by itself: " .. tostring(S.Info() and S.Info().title))
  print("  finished, now following: " .. tostring(S.Info() and S.Info().title))
end
-- The play-throughs below test one guide at a time.
ER.db.autoNextOff = true

print("5. Playing guides to the end")
local function playAll(race, class, faction, level)
  G.race, G.class, G.faction, G.level = race, class, faction, level or 1
  ER.db.mode = "medium"
  local total, stuckTotal, worst = 0, 0, {}
  for _, g in ipairs(S.Guides()) do
    G.level = math.max(1, g.lo)
    local walked, stuck, where = Play(S.Key(g), true)
    total = total + walked
    stuckTotal = stuckTotal + stuck
    if stuck > 0 then table.insert(worst, g.title .. " (" .. stuck .. "): " .. where) end
  end
  print("  " .. race .. " " .. class .. ": " .. #S.Guides() .. " guides, " .. total .. " steps followed, " .. stuckTotal .. " needed a push")
  for i = 1, math.min(#worst, ${ALL ? 40 : 6}) do print("    " .. worst[i]) end
  return stuckTotal, total
end
local combos = ${ALL ? `{
  { "Human", "WARRIOR", "Alliance" }, { "Human", "MAGE", "Alliance" }, { "Human", "PALADIN", "Alliance" }, { "Human", "ROGUE", "Alliance" },
  { "Human", "PRIEST", "Alliance" }, { "Human", "WARLOCK", "Alliance" }, { "Dwarf", "HUNTER", "Alliance" }, { "Gnome", "WARLOCK", "Alliance" },
  { "NightElf", "DRUID", "Alliance" }, { "NightElf", "HUNTER", "Alliance" }, { "Orc", "WARRIOR", "Horde" }, { "Orc", "HUNTER", "Horde" },
  { "Troll", "SHAMAN", "Horde" }, { "Troll", "MAGE", "Horde" }, { "Tauren", "DRUID", "Horde" }, { "Scourge", "PRIEST", "Horde" },
  { "Scourge", "ROGUE", "Horde" }, { "Orc", "WARLOCK", "Horde" } }` : PICK ? PICK : `{ { "Human", "WARRIOR", "Alliance" }, { "Orc", "HUNTER", "Horde" } }`}
local stuckAll, totalAll = 0, 0
for _, c in ipairs(combos) do
  local s, t = playAll(c[1], c[2], c[3])
  stuckAll, totalAll = stuckAll + s, totalAll + t
end
check(totalAll > 1000, "too few steps were followed: " .. totalAll)
check(stuckAll < totalAll * 0.05, "too many steps needed a push: " .. stuckAll .. " of " .. totalAll)

print("6. Casual leaves group quests out; Hard keeps them")
G.race, G.class, G.faction = "Human", "WARRIOR", "Alliance"
local grouped = 0
for _, g in ipairs(S.Guides()) do
  for line in string.gmatch(g.steps, "[^\\n]+") do
    if string.find(line, "^S\\t") and string.find(line, "group=1") then grouped = grouped + 1 end
  end
end
print("  steps marked as group quests (Alliance): " .. grouped)
check(grouped > 0, "no group steps found to test with")

print("7. Your level: grey quests left out, a late start, outlevelled")
check(S.GreyLevel(5) == 0 and S.GreyLevel(10) == 4 and S.GreyLevel(45) == 35, "grey levels are off: " .. S.GreyLevel(10) .. ", " .. S.GreyLevel(45))
G.race, G.class, G.faction = "Scourge", "WARLOCK", "Horde"
ER.db.mode = "casual"
local tir
for _, g in ipairs(S.Guides()) do if g.name == "1-6 Tirisfal Glades" then tir = g end end
check(tir ~= nil, "no Tirisfal Glades guide for an undead")
local function Fresh(level, fresh)
  G.level, G.log, G.order, G.bags = level, {}, {}, {}
  ER.db.guides, ER.db.done = {}, {}
  S.Load(S.Key(tir), fresh)
  Tick(1)
end
Fresh(1, true)
local low = S.Position()
Fresh(8, false)
local late = S.Position()
check(late > low, "a level 8 picking Tirisfal 1-6 should start past the grey quests: step " .. late .. ", level 1 starts at " .. low)
local cur = S.Current()
for _, e in ipairs(cur and cur.elements or {}) do
  if e.kind == "A" then check(not S.TooEasy(e.id), "the first step at level 8 picks up a grey quest: " .. tostring(S.QuestTitle(e.id))) end
end
print("  level 1 starts at step " .. low .. ", level 8 at step " .. late .. " (" .. (cur and S.Title(cur) or "-") .. ")")
check(S.Outlevelled(), "level 8 in a 1-6 guide should count as outlevelled")
Tick(2) Tick(2)
check(ER.HasTip("move"), "outlevelled, but no question about moving on")
Fresh(4, true)
check(not S.Outlevelled(), "level 4 in a 1-6 guide is not outlevelled")

print("8. Money on another character leaves the money-farming steps out")
ER.db.adapt = {}
local function MoneyBeside()
  for _, s in ipairs(S.Side()) do
    for _, e in ipairs(s.elements) do if S.MoneyText(e.text) then return true end end
  end
  return false
end
local function Walk()
  for i = 1, 40 do
    if MoneyBeside() then return true end
    local c = S.Current()
    if not c then return false end
    local before = S.Position()
    Satisfy(c) Tick(1) S.Check()
    if S.Position() == before then S.Next() end
  end
  return false
end
Fresh(1, true)
check(Walk(), "the money step never came up beside the current one")
Tick(2) Tick(2)
check(ER.HasTip("money"), "nobody asked whether there is money on another character")
ER.SetHasMoney(true)
Fresh(1, true)
check(not Walk(), "with money on another character the money step should be left out")
ER.SetHasMoney(false)

print("9. Enemies: Easy, Medium or Hard")
local keepLevel = UnitLevel
MOB = { name = "Duskbat", level = 10, kind = "normal" }
UnitExists = function() return true end
UnitIsPlayer = function() return false end
UnitCanAttack = function() return true end
UnitIsDead = function() return false end
UnitName = function(u) return MOB.name end
UnitLevel = function(u) if u == "player" then return G.level end return MOB.level end
UnitClassification = function() return MOB.kind end
G.level = 10
local function Rate(level, kind, mode)
  MOB.level, MOB.kind = level, kind or "normal"
  ER.db.mode = mode or "casual"
  local r = ER.RateEnemy("mouseover")
  return r and r[1]
end
check(Rate(10) == "Easy", "same level should be Easy, got " .. tostring(Rate(10)))
check(Rate(11) == "Medium", "1 above on Casual should be Medium, got " .. tostring(Rate(11)))
check(Rate(12) == "Hard", "2 above on Casual should be Hard, got " .. tostring(Rate(12)))
check(Rate(12, "normal", "hard") == "Medium", "2 above on Hard should be Medium, got " .. tostring(Rate(12, "normal", "hard")))
check(Rate(14, "normal", "hard") == "Hard", "4 above on Hard should be Hard")
check(Rate(9, "elite") == "Hard", "an elite should be Hard")
check(Rate(-1) == "Hard", "a skull level should be Hard")
local r = (function() Rate(3) return ER.RateEnemy("mouseover") end)()
check(r and r[1] == "Easy" and r[2] == "no experience", "a grey enemy should be Easy, no experience")
check(S.Singular("Young Wolves") == "young wolf" and S.Singular("Mangy Duskbats") == "mangy duskbat" and S.Singular("Duskbat") == "duskbat",
  "plural names are not made single")
print("  level 10, Casual: 10 Easy, 11 Medium, 12 Hard; Hard mode: 12 Medium, 14 Hard; elites Hard")
UnitLevel = keepLevel
ER.db.mode = "medium"

print("10. Skulls over the enemies a quest still needs")
GetNumQuestLeaderBoards = function(i) return G.order[i] and 1 or 0 end
G.log, G.order = { ["Skull Test"] = { complete = false, objs = {} } }, { "Skull Test" }
local skull
local nameText = { GetObjectType = function() return "FontString" end, GetText = function() return "Thing 1" end }
local levelText = { GetObjectType = function() return "FontString" end, GetText = function() return "12" end }
local border = { GetObjectType = function() return "Texture" end, GetTexture = function() return "Interface\\\\Tooltips\\\\Nameplate-Border" end }
local bar = { GetObjectType = function() return "StatusBar" end }
local plate = { GetObjectType = function() return "Button" end, GetName = function() return nil end,
  GetChildren = function() return bar end, GetRegions = function() return border, levelText, nameText end,
  IsVisible = function() return true end, CreateTexture = function() skull = CreateFrame("Frame") return skull end }
WorldFrame = { GetNumChildren = function() return 1 end, GetChildren = function() return plate end }
Tick(1.5)
check(skull ~= nil and skull:IsShown(), "no skull over an enemy the quest log needs")
G.log["Skull Test"].complete = true
Tick(1.5)
check(skull and not skull:IsShown(), "the skull stayed after the quest was complete")
WorldFrame, GetNumQuestLeaderBoards = nil, nil
G.log, G.order = {}, {}

print("11. A hand-in goes through one explicit list")
check(ER.Log == BASE_LOG, "ER.Log is still wrapped by another file")
check(type(ER.OnTurnIn) == "function", "ER.OnTurnIn is missing")
check(pcall(ER.OnTurnIn, nil), "ER.OnTurnIn(nil) raised an error")
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 1
ER.db.guides, ER.db.done = {}, {}
ER.db.autoNextOff = true
S.Load(S.Key(S.Suggest()[1]), true)
local handIn
local cur = S.Current()
local stepList = S.Upcoming(30)
if cur then table.insert(stepList, 1, cur) end
for _, st in ipairs(stepList) do
  for _, e in ipairs(st.elements) do
    if not handIn and e.kind == "T" then handIn = e end
  end
end
check(handIn ~= nil, "no hand-in step found near the start of the guide")
if handIn then
  check(not S.TurnedIn(handIn.id), "the quest was already handed in before the test")
  ER.OnTurnIn(S.QuestTitle(handIn.id))
  check(S.TurnedIn(handIn.id), "ER.OnTurnIn did not mark the quest as handed in")
end
S.Stop()
G.log, G.order = {}, {}
print("  hand-in marks the quest done through ER.OnTurnIn; ER.Log is the base function")

print("12. Accept steps tick by title; comfort and skip hooks")
S.Stop()
G.race, G.class, G.faction, G.level = "Human", "WARRIOR", "Alliance", 1
ER.db.mode, ER.db.done = "medium", {}
local function AcceptTicks(inLog, e)
  G.log = {}
  G.order = {}
  if inLog then
    G.log[inLog] = { complete = false, objs = {} }
    G.order = { inLog }
  end
  return S.ElementDone({ n = 0, elements = { e } }, e)
end
local wolves = { kind = "A", id = 33, text = "Accept Wolves Across The Border" }
check(AcceptTicks("Wolves Across The Border", wolves) == true, "Accept did not tick when the log spells the title with other capitals")
check(S.InLog(33) == nil, "S.InLog answered for a title spelled another way")
check(AcceptTicks('Wanted: "Hogger"', { kind = "A", id = 176, text = 'Accept Wanted:  "Hogger"' }) == true,
  "Accept did not tick when the data title has two spaces")
check(AcceptTicks("Wolves Across the Border", { kind = "A", id = 999999, text = "Accept Wolves Across The Border" }) == true,
  "Accept did not tick through the step's own words")
check(AcceptTicks("Wolves Across", wolves) == false, "a partial title ticked an Accept step")
check(AcceptTicks(nil, { kind = "A", id = 999999 }) == false, "an Accept with no title and no text ticked")
check(AcceptTicks("Wolves Across the Border", wolves) == true, "Accept did not tick on the exact title")
check(AcceptTicks("|cffffffffwolves  across the border|r", wolves) == true, "colour codes and double spaces stopped an Accept from ticking")
check(pcall(S.ElementDone, { n = 0, elements = {} }, { kind = "A" }), "an Accept with no id raised an error")
-- A title two quests of the guide share never ticks by title.
G.class = "PALADIN"
local sharedE
for _, g in ipairs(S.Guides()) do
  if not sharedE then
    S.Load(S.Key(g), true)
    local seen = {}
    for n = 1, S.Count() do
      for _, e in ipairs(S.Step(n).elements) do
        local t = (e.kind == "A" or e.kind == "T" or e.kind == "C") and S.QuestTitle(e.id)
        if t then
          if seen[t] and seen[t] ~= e.id and e.kind == "A" then sharedE = e end
          seen[t] = e.id
        end
      end
    end
  end
end
check(sharedE ~= nil, "no guide with a title shared by two quests was found for the paladin")
if sharedE then
  check(AcceptTicks(string.lower(S.QuestTitle(sharedE.id)), sharedE) == false, "a shared title ticked an Accept step by title")
end
S.Stop()
G.class = "WARRIOR"
ER.db.guides, ER.db.done = {}, {}
check(ER.AdaptShift and ER.AdaptShift() == 0, "ER.AdaptShift is missing or not 0")
check(ER.OnStepSkipped ~= nil and pcall(ER.OnStepSkipped, { n = 1, elements = {} }), "ER.OnStepSkipped is missing or raised an error")
ER.db.mode = "casual"
check(S.Comfort() == 2, "Casual comfort is not 2")
ER.db.mode = "medium"
check(S.Comfort() == 3, "Medium comfort is not 3")
ER.db.mode = "hard"
check(S.Comfort() == 4, "Hard comfort is not 4")
ER.db.mode = "medium"
G.log, G.order = {}, {}
print("  Accept ticks by tidied title; no partial match; shared titles stay number-only; comfort 2, 3, 4")

if failures == 0 then print("ALL STEP CHECKS PASSED") else print(failures .. " CHECK(S) FAILED") os.exit(1) end
`, "tests");
