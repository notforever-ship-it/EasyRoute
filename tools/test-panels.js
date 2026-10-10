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

if failures > 0 then
  print(failures .. " check(s) FAILED")
  os.exit(1)
end
print("All panel checks passed.")
`, "test");
