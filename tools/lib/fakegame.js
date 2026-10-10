// The pretend game that the offline tests share, as two pieces of Lua text for a fengari VM:
//   PRELUDE: the Lua 5.0 names the game code expects (table.getn, string.gfind ...), the pretend character G, the pretend
//            quest log, bags, frames and units (G.units: "target", "mouseover" ... for UnitName, UnitReaction and the rest),
//            and the helpers Fire (send an event) and Tick (let time pass and run the OnUpdates).
//   PLAYER:  the step player: Satisfy(step) does what a step asks in the pretend game, Play(key) walks one guide to its end.
// Used by tools/test-steps.js and tools/test-route-run.js. Run PRELUDE first, then the game files, then PLAYER.

const PRELUDE = `
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
  faction = "Alliance", log = {}, order = {}, bags = {}, taxi = false, dead = false, bind = "Northshire Abbey", facing = 0, units = {} }

EasyRoute = { VERSION = "test", Loaded = function() end, GOLD = "|cffffd100", GREY = "|cff999999", WHITE = "|cffffffff", END = "|r", GREEN = "|cff40c040",
  RED = "|cffff4040", ORANGE = "|cffff9933",
  Print = function(m) CHAT = (CHAT or "") .. m .. "|" end,
  Char = function() return "Tester-Realm" end,
  Where = function() return G.zone, G.sub, G.x, G.y end,
  Log = function(kind, fields) fields = fields or {} fields.t = kind return fields end,
  db = { journal = {}, ratings = {}, mode = "medium" } }
BASE_LOG = EasyRoute.Log
-- G.ready is false while the quest log has not been read yet (a test sets it, then sets it true later); true by default.
EasyRoute.Recorder = { Known = function() return G.log end, Ready = function() return G.ready ~= false end }

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
    if k == "CreateFontString" then return function(self, name) return newFrame(name) end end
    if k == "GetPoint" then return function(self) return "CENTER", nil, "CENTER", 0, 0 end end
    if k == "SetTexCoord" then return function(self, a, b, c, d) self._coord = { a, b, c, d } end end
    if k == "GetChildren" then return function(self) return end end
    if k == "RegisterEvent" then return function(self, ev) rawset(self, "_events", rawget(self, "_events") or {}) self._events[ev] = true end end
    if k == "UnregisterEvent" then return function(self, ev) local events = rawget(self, "_events") if events then events[ev] = nil end end end
    if k == "UnregisterAllEvents" then return function(self) rawset(self, "_events", nil) end end
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
-- The flight map, as the 1.12 client answers it: G.nodes is a list of { name, type, cost } ("CURRENT", "REACHABLE", "DISTANT" or "NONE"; cost in copper, 0 when left out); empty by default.
NumTaxiNodes = function() return G.nodes and #G.nodes or 0 end
TaxiNodeName = function(i) return G.nodes and G.nodes[i] and G.nodes[i][1] or nil end
TaxiNodeGetType = function(i) return G.nodes and G.nodes[i] and G.nodes[i][2] or nil end
UnitIsDeadOrGhost = function() return G.dead end
UnitExists = function(u) return u == "pet" or (G.units ~= nil and G.units[u] ~= nil) end
-- Pretend units: G.units["target"] = { name, reaction, combat, attackable, controlled, player, dead, type, class }. A missing unit answers nil or false.
UnitName = function(u) local x = G.units and G.units[u] return x and x.name or nil end
UnitReaction = function(u, v) local x = G.units and G.units[u] return x and x.reaction or nil end
UnitAffectingCombat = function(u) local x = G.units and G.units[u] return x and x.combat and true or false end
UnitCanAttack = function(a, b) local x = G.units and G.units[b] return x and x.attackable and true or false end
UnitPlayerControlled = function(u) local x = G.units and G.units[u] return x and x.controlled and true or false end
UnitIsPlayer = function(u) local x = G.units and G.units[u] return x and x.player and true or false end
UnitIsDead = function(u) local x = G.units and G.units[u] return x and x.dead and true or false end
UnitCreatureType = function(u) local x = G.units and G.units[u] return x and x.type or nil end
UnitClassification = function(u) local x = G.units and G.units[u] return x and x.class or nil end
-- A group: G.party and G.raid are the number of other members (0 or nil: you are alone).
GetNumPartyMembers = function() return G.party or 0 end
GetNumRaidMembers = function() return G.raid or 0 end
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

-- The NPC windows (auto mode). G.window = { title = "...", logTitle = "..." } is the quest the open quest window offers (title is what
-- GetTitleText says, logTitle what AcceptQuest puts in the log, if different); G.shift is true while Shift is held; G.calls lists what
-- the game was asked to do ("AcceptQuest" ...). All of it is inert while the G.* fields are unset.
G.calls = {}
function Call(s) table.insert(G.calls, s) end
IsShiftKeyDown = function() return G.shift and true or false end
GetTitleText = function() return G.window and G.window.title or nil end
for _, name in ipairs({ "QuestFrame", "QuestFrameDetailPanel", "QuestFrameProgressPanel", "QuestFrameRewardPanel", "QuestFrameGreetingPanel",
  "GossipFrame", "MerchantFrame", "TaxiFrame" }) do
  CreateFrame("Frame", name)
end
AcceptQuest = function()
  Call("AcceptQuest")
  local w = G.window
  local t = w and (w.logTitle or w.title)
  if t and not G.log[t] and #G.order < 20 then
    G.log[t] = { complete = false, objs = {} }
    table.insert(G.order, t)
  end
  QuestFrameDetailPanel:Hide()
end
-- The progress and reward panels: G.window.completable (the game says the quest is ready), .choices (rewards to choose from), .cost (money it asks).
IsQuestCompletable = function() return G.window and G.window.completable and 1 or nil end
CompleteQuest = function() Call("CompleteQuest") end
GetNumQuestChoices = function() return G.window and G.window.choices or 0 end
GetQuestMoneyToGet = function() return G.window and G.window.cost or 0 end
GetQuestReward = function(n)
  Call("GetQuestReward:" .. math.floor(n))
  local w = G.window
  local t = w and (w.logTitle or w.title)
  if t and G.log[t] then
    G.log[t] = nil
    for i, o in ipairs(G.order) do if o == t then table.remove(G.order, i) break end end
  end
  QuestFrameRewardPanel:Hide()
end

-- The NPC menus: G.npc.gossip = { avail = { { title, level } ... }, active = { ... } } and G.npc.greeting = { avail = { title ... }, active = { ... } }.
-- Selecting an entry is only written down as a call ("SelectGossipActiveQuest:2").
local function Flat(list)
  local out = {}
  for _, q in ipairs(list or {}) do
    table.insert(out, q[1])
    table.insert(out, q[2])
  end
  return unpack(out)
end
GetGossipAvailableQuests = function() return Flat(G.npc and G.npc.gossip and G.npc.gossip.avail) end
GetGossipActiveQuests = function() return Flat(G.npc and G.npc.gossip and G.npc.gossip.active) end
local function Greeting(which) return G.npc and G.npc.greeting and G.npc.greeting[which] or {} end
GetNumAvailableQuests = function() return #Greeting("avail") end
GetNumActiveQuests = function() return #Greeting("active") end
GetAvailableTitle = function(i) return Greeting("avail")[i] end
GetActiveTitle = function(i) return Greeting("active")[i] end
for _, name in ipairs({ "SelectGossipAvailableQuest", "SelectGossipActiveQuest", "SelectAvailableQuest", "SelectActiveQuest", "SelectGossipOption" }) do
  _G[name] = function(i) Call(name .. ":" .. math.floor(i)) end
end
-- The other gossip choices are G.npc.gossip.options = { { text, type } ... } (type "binder", "taxi", "vendor" ...).
GetGossipOptions = function() return Flat(G.npc and G.npc.gossip and G.npc.gossip.options) end

-- Money, flights and the innkeeper. G.money is what the character holds; the third value of a G.nodes entry is what that flight costs.
-- Taking a flight puts the character on the taxi (G.taxi). All of it is inert while the G.* fields are unset.
GetMoney = function() return G.money or 0 end
TaxiNodeCost = function(i) return G.nodes and G.nodes[i] and G.nodes[i][3] or 0 end
TakeTaxiNode = function(i)
  Call("TakeTaxiNode:" .. math.floor(i))
  G.taxi = true
end
ConfirmBinder = function() Call("ConfirmBinder") end
StaticPopup_Hide = function(which) Call("StaticPopup_Hide:" .. which) end

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
`;

const PLAYER = `
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
    elseif k == "F" then Fire("TAXIMAP_OPENED") G.taxi = true
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
`;

module.exports = { PRELUDE, PLAYER };
