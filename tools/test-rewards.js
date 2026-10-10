// Auto mode at a hand-in with rewards to choose from, in the pretend game (tools/lib/fakegame.js) with a pretend guide.
// None of the rewards fits the character: the one that sells for the most is taken (Data/Prices.lua), or with no price known the best
// quality. One that fits, a tooltip that cannot be read, Shift and the hand-in tick: nothing is taken and the player picks, as before.
// Usage: node tools/test-rewards.js        (needs fengari: npm install in this tools folder)

const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");
const { PRELUDE } = require("./lib/fakegame.js");

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

run(PRELUDE, "prelude");
run(fs.readFileSync(path.join(ROOT, "Data", "Prices.lua")), "Data/Prices.lua");

// The pretend reward choices: G.items[i] = { id, name, quality, usable, lines = { { left, lc, right, rc } ... } } (lc/rc: { r, g, b }).
// A hidden tooltip shows an item's lines through the global line objects <name>TextLeftN / TextRightN, as GameTooltipTemplate does.
run(`
G.items = {}
GetQuestItemInfo = function(kind, i)
  local it = kind == "choice" and G.items[i]
  if not it then return nil end
  return it.name, "icon", 1, it.quality, it.usable
end
GetQuestItemLink = function(kind, i)
  local it = kind == "choice" and G.items[i]
  if not it then return nil end
  return "|cff1eff00|Hitem:" .. it.id .. ":0:0:0|h[" .. it.name .. "]|h|r"
end
local function Line(name)
  local o = { t = nil, c = { 1, 1, 1 } }
  o.GetText = function(self) return self.t end
  o.GetTextColor = function(self) return self.c[1], self.c[2], self.c[3] end
  _G[name] = o
  return o
end
local realCreate = CreateFrame
CreateFrame = function(kind, name, parent, template)
  if kind ~= "GameTooltip" then return realCreate(kind, name) end
  local tip = { n = 0 }
  for l = 1, 30 do Line(name .. "TextLeft" .. l) Line(name .. "TextRight" .. l) end
  tip.SetOwner = function(self) end
  tip.Hide = function(self) end
  tip.ClearLines = function(self)
    self.n = 0
    for l = 1, 30 do _G[name .. "TextLeft" .. l].t, _G[name .. "TextRight" .. l].t = nil, nil end
  end
  tip.SetQuestItem = function(self, kind, i)
    local it = G.items[i]
    if not it or it.unread then return end
    for l, line in ipairs(it.lines or {}) do
      local left, right = _G[name .. "TextLeft" .. l], _G[name .. "TextRight" .. l]
      left.t, left.c = line[1], line[2] or { 1, 1, 1 }
      right.t, right.c = line[3], line[4] or { 1, 1, 1 }
    end
    self.n = table.getn(it.lines or {})
  end
  tip.NumLines = function(self) return self.n end
  _G[name] = tip
  return tip
end

-- A pretend guide that hands in one quest.
EasyRoute.Steps = {
  Running = function() return true end,
  NormTitle = function(t) return string.lower(t or "") end,
  HandInTitles = function() return { ["the test quest"] = true } end,
  WantedAccepts = function() return {} end,
  OpenElements = function() return {} end,
  Current = function() return nil end,
}
`, "pretend rewards");
run(fs.readFileSync(path.join(ROOT, "Auto.lua")), "Auto.lua");

run(`
local ER = EasyRoute
local A = ER.Auto
local T = "The Test Quest"
local PICK = "Pick your reward for " .. T .. ", then press Complete Quest."
local RED, WHITE = { 1, 0.125, 0.125 }, { 1, 1, 1 }
local function Calls() return table.concat(G.calls, ",") end
local function Has(sub) return string.find(CHAT or "", sub, 1, true) ~= nil end

check(type(EasyRoute_Prices) == "table", "Data/Prices.lua did not load")
local count = 0
for id, copper in pairs(EasyRoute_Prices or {}) do
  count = count + 1
  if type(id) ~= "number" or type(copper) ~= "number" or copper <= 0 then check(false, "a bad price entry: " .. tostring(id)) break end
end
check(count > 500, "Data/Prices.lua has only " .. count .. " prices")
EasyRoute_Prices[900001] = 150
EasyRoute_Prices[900002] = 2400
EasyRoute_Prices[900003] = 80

local function Item(id, name, quality, usable, lines)
  return { id = id, name = name, quality = quality, usable = usable, lines = lines }
end
local PLATE = { { "Plate Helm", WHITE }, { "Head", WHITE, "Plate", RED } }
local MAGE = { { "Silk Robe", WHITE }, { "Classes: Mage", RED } }
local LEVEL = { { "Fine Sword", WHITE }, { "One-Hand", WHITE, "Sword", WHITE }, { "Requires Level 30", RED } }

local function Close()
  QuestFrame:Hide()
  QuestFrameRewardPanel:Hide()
  Tick(1.2)
  Tick(1.2)
end
local function Open(items, shiftLater)
  Close()
  ER.db.autoOff, ER.db.autoquestOff = nil, nil
  G.calls, G.shift, CHAT = {}, false, ""
  G.log, G.order = { [T] = { complete = true, objs = {} } }, { T }
  G.items = items
  G.window = { title = T, choices = table.getn(items) }
  QuestFrame:Show()
  QuestFrameRewardPanel:Show()
end
local function Go(shiftLater)
  Fire("QUEST_COMPLETE")
  if shiftLater then G.shift = true end
  Tick(0.1)
  Tick(0.1)
end

print("1. None of the rewards fits: the one that sells for the most is taken")
Open({ Item(900001, "Plate Helm", 2, nil, PLATE), Item(900002, "Silk Robe", 2, nil, MAGE), Item(900003, "Plate Boots", 3, nil, PLATE) })
local pick, link, why = A.PickUnfit(3)
check(pick == 2 and why == "sells for the most", "PickUnfit answered " .. tostring(pick) .. " " .. tostring(why))
Go()
check(Calls() == "GetQuestReward:2", "none usable made the calls: " .. Calls())
check(Has(T .. ": none of the rewards fit you, took |cff1eff00|Hitem:900002:0:0:0|h[Silk Robe]|h|r (sells for the most)."), "the line is '" .. tostring(CHAT) .. "'")
check(not Has(PICK), "the pick line was said too: '" .. tostring(CHAT) .. "'")
Close()
check(Has("handed in " .. T .. "."), "the hand-in was not said: '" .. tostring(CHAT) .. "'")

print("2. One reward fits: nothing is taken, the player picks")
Open({ Item(900001, "Plate Helm", 2, nil, PLATE), Item(900002, "Fine Sword", 2, nil, LEVEL) })
check(A.PickUnfit(2) == nil, "a reward whose only red line is the level counted as not fitting")
Go()
check(table.getn(G.calls) == 0, "one usable reward made the calls: " .. Calls())
check(Has(PICK), "the pick line was not said: '" .. tostring(CHAT) .. "'")
check(QuestFrameRewardPanel:IsVisible(), "the window was closed")
Open({ Item(900001, "Plate Helm", 2, nil, PLATE), Item(900002, "Silk Robe", 2, 1, MAGE) })
Go()
check(table.getn(G.calls) == 0, "a reward the game calls usable was not left to the player: " .. Calls())
check(Has(PICK), "the pick line was not said when the game calls one usable")

print("3. No price known: the best quality, and with no best the player picks")
Open({ Item(800001, "Plate Helm", 2, nil, PLATE), Item(800002, "Silk Robe", 3, nil, MAGE) })
Go()
check(Calls() == "GetQuestReward:2", "no price made the calls: " .. Calls())
check(Has("took |cff1eff00|Hitem:800002:0:0:0|h[Silk Robe]|h|r (the best of them)."), "the quality line is '" .. tostring(CHAT) .. "'")
Open({ Item(800001, "Plate Helm", 2, nil, PLATE), Item(800002, "Silk Robe", 2, nil, MAGE) })
Go()
check(table.getn(G.calls) == 0, "no price and the same quality made the calls: " .. Calls())
check(Has(PICK), "the pick line was not said with no price and the same quality")

print("4. Shift, the hand-in tick and a tooltip that cannot be read: nothing is taken")
local NONE = function() return { Item(900001, "Plate Helm", 2, nil, PLATE), Item(900002, "Silk Robe", 2, nil, MAGE) } end
Open(NONE())
G.shift = true
Go()
check(table.getn(G.calls) == 0, "Shift at the window made the calls: " .. Calls())
Open(NONE())
Go(true)
check(table.getn(G.calls) == 0, "Shift before the click made the calls: " .. Calls())
Open(NONE())
ER.db.autoquestOff = true
Go()
check(table.getn(G.calls) == 0, "the hand-in tick off made the calls: " .. Calls())
ER.db.autoquestOff = nil
local unread = NONE()
unread[1].unread = true
Open(unread)
Go()
check(table.getn(G.calls) == 0, "a tooltip with no lines made the calls: " .. Calls())
check(Has(PICK), "the pick line was not said when a tooltip had no lines")
Close()

if failures > 0 then error(failures .. " check(s) failed") end
print("All reward checks passed.")
`, "reward checks");
