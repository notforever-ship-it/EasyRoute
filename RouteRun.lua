-- Easy Route: the casual route in the game:
-- it turns each visit of the route plan (Data\Route.lua) into steps in the RestedXP step format (see the top of Steps.lua)
-- and offers the visits as guides of the group "Casual route". Steps.lua, the step box and the arrow work on them like
-- on any other guide. The steps depend on the race and the visit only, never on level or difficulty.

local ER = EasyRoute
ER.ROUTE_GROUP = "Casual route"

local TAB = "\t"
local GREEN_NPC = "|cff00ff25"
local ALIAS = { Undead = "Scourge" }
local HORDE = { Orc = true, Troll = true, Tauren = true, Scourge = true }

------------------------------------------------------------------------------------------------------
-- Step lines: the exact shapes Steps.lua reads
------------------------------------------------------------------------------------------------------

-- A tab or a line break inside a name would move every field after it.
local function Clean(s)
  local text = string.gsub(tostring(s or ""), "[\t\r\n]", " ")
  return text
end

local function Npc(name)
  return GREEN_NPC .. Clean(name) .. "|r"
end

local function LineS(flags)
  return "S" .. TAB .. TAB .. TAB .. (flags or "")
end

-- nil when the place is not known, so the step simply has no arrow place.
local function LineG(zone, x, y)
  if not x or not y or not zone then return nil end
  return "G" .. TAB .. TAB .. Clean(zone) .. TAB .. tostring(x) .. TAB .. tostring(y) .. TAB .. TAB .. TAB
end

local function LineI(text)
  return "I" .. TAB .. TAB .. Clean(text)
end

local function LineA(id)
  return "A" .. TAB .. TAB .. tostring(id) .. TAB
end

local function LineC(id)
  return "C" .. TAB .. TAB .. tostring(id) .. TAB .. TAB
end

local function LineT(id)
  return "T" .. TAB .. TAB .. tostring(id) .. TAB
end

-- Grind until a level: the step box shows the live xp line for an X element.
local function LineX(level)
  return "X" .. TAB .. TAB .. TAB .. tostring(level) .. TAB .. TAB .. TAB
end

------------------------------------------------------------------------------------------------------
-- One visit as steps
------------------------------------------------------------------------------------------------------

local function Row(id)
  return ER.QuestRow and ER.QuestRow(id) or nil
end

-- A quest waits for the quest before it (its row's p) when that quest is listed earlier in the same area.
-- Returns the waves in order, each a list of the area's quests in data order.
local function Waves(area)
  local wave, waves = {}, {}
  for _, q in ipairs(area.q) do
    if q.id then
      local row = Row(q.id)
      local p = row and row.p
      local w = 1
      if p and wave[p] then w = wave[p] + 1 end
      wave[q.id] = w
      if not waves[w] then waves[w] = {} end
      table.insert(waves[w], q)
    end
  end
  return waves
end

-- Where a quest starts: its own place when it is in the zone of the visit, else the place of the area.
local function GiverPlace(zone, area, row)
  local z = row and row.zone and EasyRoute_Zones and EasyRoute_Zones[row.zone]
  if z and row.x and row.y and string.lower(z.name or "") == string.lower(zone) then return row.x, row.y end
  return area.x, area.y
end

local function HasWork(q)
  return q.ox ~= nil or string.find(q.flags, "k", 1, true) ~= nil
end

local function Handed(q)
  return string.find(q.flags, "x", 1, true) ~= nil
end

-- The quests of the visit before this one that were left to be handed in here (flag x, hand-in place in this zone).
local function CarriedIn(zone, before)
  local list = {}
  if type(before) ~= "table" then return list end
  for _, area in ipairs(ER.RouteReader.ReadVisit(before)) do
    for _, q in ipairs(area.q) do
      if q.id and Handed(q) and q.hzone and string.lower(q.hzone) == string.lower(zone) then table.insert(list, q) end
    end
  end
  return list
end

-- The work of one wave, nearest first: quests whose work is around the area come first, in data order; then, from the
-- area (and then from the last place), the quest whose work place is nearest; work in another zone comes last.
local function WorkOrder(zone, area, wave)
  local out, far, other = {}, {}, {}
  for _, q in ipairs(wave) do
    if HasWork(q) then
      if not q.ox then
        table.insert(out, q)
      elseif q.ozone and string.lower(q.ozone) ~= string.lower(zone) then
        table.insert(other, q)
      else
        table.insert(far, q)
      end
    end
  end
  local x, y = area.x or 0, area.y or 0
  while table.getn(far) > 0 do
    local best, at = nil, 1
    for i, q in ipairs(far) do
      local d = ER.Steps.Yards(zone, x, y, q.ox, q.oy)
      if not best or d < best then best, at = d, i end
    end
    local q = table.remove(far, at)
    table.insert(out, q)
    x, y = q.ox, q.oy
  end
  for _, q in ipairs(other) do table.insert(out, q) end
  return out
end

-- The steps that ask for a grind: before a pick-up batch whose quests need a higher level than any grind step so far in this visit, and
-- at the end of a visit that is not a capital stop (the quests ran out). The levels come from Data\Route.lua (made with the xp model of
-- tools/build-route.js), so the steps are the same at any level and difficulty; a step the player has already reached ticks by itself.
local function GrindSteps(level, why)
  return LineS("title=Grind to level " .. tostring(level)), LineI(why), LineX(level)
end

local function GenVisit(info)
  local v = info.visit
  local zone = v.zone
  local areas = ER.RouteReader.ReadVisit(v)
  local out = {}
  local function Add(line)
    if line then table.insert(out, line) end
  end
  -- Quests left from the visit before (and from the one before a capital stop) are handed in first.
  local carried = {}
  if info.before2 then
    for _, q in ipairs(CarriedIn(zone, info.before2)) do table.insert(carried, q) end
  end
  for _, q in ipairs(CarriedIn(zone, info.before)) do table.insert(carried, q) end
  for _, q in ipairs(carried) do
    Add(LineS())
    if q.hx then Add(LineG(q.hzone or zone, q.hx, q.hy)) end
    Add(LineT(q.id))
  end
  local reached = 0
  for _, area in ipairs(areas) do
    for _, wave in ipairs(Waves(area)) do
      -- Pick up, one step for each giver.
      local byGiver, order = {}, {}
      for _, q in ipairs(wave) do
        local row = Row(q.id)
        local key = ((row and row.g) or area.who) .. "@" .. tostring((row and row.x) or area.x)
        if not byGiver[key] then
          byGiver[key] = { row = row, list = {} }
          table.insert(order, key)
        end
        table.insert(byGiver[key].list, q)
      end
      for _, key in ipairs(order) do
        local batch = byGiver[key]
        local need = 0
        for _, q in ipairs(batch.list) do
          if q.grind and q.grind > need then need = q.grind end
        end
        if need > reached then
          reached = need
          local s, i, g = GrindSteps(need, "Nothing to pick up here yet: grind mobs near you until level " .. need .. ".")
          Add(s)
          Add(i)
          Add(g)
        end
        local x, y = GiverPlace(zone, area, batch.row)
        Add(LineS())
        Add(LineG(zone, x, y))
        Add(LineI("Talk to " .. Npc((batch.row and batch.row.g) or area.who)))
        for _, q in ipairs(batch.list) do Add(LineA(q.id)) end
      end
      -- Do the work.
      for _, q in ipairs(WorkOrder(zone, area, wave)) do
        Add(LineS())
        if q.ox then Add(LineG(q.ozone or zone, q.ox, q.oy)) else Add(LineG(zone, area.x, area.y)) end
        Add(LineC(q.id))
      end
      -- Hand in, except the quests the next visit hands in.
      for _, q in ipairs(wave) do
        if not Handed(q) then
          Add(LineS())
          if q.hx then
            Add(LineG(q.hzone or zone, q.hx, q.hy))
          else
            local x, y = GiverPlace(zone, area, Row(q.id))
            Add(LineG(zone, x, y))
          end
          Add(LineT(q.id))
        end
      end
    end
  end
  if not v.stop then
    local s, i, g = GrindSteps(v.hi, "Out of quests here: grind mobs near you until level " .. tostring(v.hi) .. ", then the guide goes on.")
    Add(s)
    Add(i)
    Add(g)
  end
  return table.concat(out, "\n")
end

------------------------------------------------------------------------------------------------------
-- The visits of a race as guides
------------------------------------------------------------------------------------------------------

local cache = {}

local function InfosFor(race)
  race = ALIAS[race] or race
  if cache[race] then return cache[race] end
  local list = {}
  local route = EasyRoute_Route
  local path = route and route.paths and route.paths[race]
  if type(path) ~= "table" or type(route.visits) ~= "table" then return list end
  local seen = {}
  for i, number in ipairs(path) do
    local v = route.visits[number]
    if type(v) == "table" and v.zone then
      seen[v.zone] = (seen[v.zone] or 0) + 1
      local name = v.zone
      if seen[v.zone] > 1 then name = v.zone .. " " .. seen[v.zone] end
      local title = v.zone .. " " .. tostring(v.lo) .. "-" .. tostring(v.hi)
      if v.stop then title = v.zone .. " (short stop at " .. tostring(v.lo) .. ")" end
      local info = { name = name, title = title, group = ER.ROUTE_GROUP, faction = HORDE[race] and "Horde" or "Alliance",
        lo = v.lo, hi = v.hi, cond = "", route = true, race = race, visit = v, no = i, stop = v.stop }
      setmetatable(info, { __index = function(t, k)
        if k == "steps" then
          local text = GenVisit(t)
          rawset(t, "steps", text)
          return text
        end
        return nil
      end })
      table.insert(list, info)
    end
  end
  for i = 1, table.getn(list) - 1 do list[i].next = list[i + 1].name end
  -- A visit hands in what the visit before it left, and when that was a capital stop, what the visit before the stop left.
  for i = 2, table.getn(list) do
    list[i].before = list[i - 1].visit
    if list[i - 1].stop and i > 2 then list[i].before2 = list[i - 2].visit end
  end
  if table.getn(list) > 0 then cache[race] = list end
  return list
end

-- A red line for the step box when a quest the step picks up needs a higher level than you have (the plan runs ahead of you).
-- Works for any guide. nil when every quest to pick up is fine, in the log, handed in or left out.
function ER.NeedLevelLine(step)
  if not step or not step.elements then return nil end
  local S = ER.Steps
  local mine = UnitLevel("player") or 1
  local need = 0
  for _, e in ipairs(step.elements) do
    if e.kind == "A" and e.id and e.id ~= 0 and not S.InLog(e.id) and not S.TurnedIn(e.id) and not S.LeftOut(e.id) then
      local row = Row(e.id)
      if row and row.m and row.m > mine and row.m > need then need = row.m end
    end
  end
  if need == 0 then return nil end
  return "|cffff4040Needs level " .. need .. ":|r grind mobs near you until then."
end

------------------------------------------------------------------------------------------------------
-- Which quests of a visit are left out (asked by Steps.lua LeftOut for every quest, on every refresh)
------------------------------------------------------------------------------------------------------

-- Quest id -> the plan's flag letters, for the quests of the visit itself. Made once per visit and kept on the info.
local function FlagsOf(info)
  local made = rawget(info, "flagsOf")
  if made then return made end
  made = {}
  for _, area in ipairs(ER.RouteReader.ReadVisit(info.visit)) do
    for _, q in ipairs(area.q) do
      if q.id then made[q.id] = q.flags or "" end
    end
  end
  rawset(info, "flagsOf", made)
  return made
end

-- True when the casual route leaves this quest out: elite quests (flag e) on Casual and Medium, escort quests (flag s) on Casual.
-- Anything that is not a quest of the running casual-route visit (a RestedXP guide, a quest carried in) is never left out here.
function ER.RouteLeftOut(id)
  local info = ER.Steps.Info()
  if not info or not info.route then return false end
  local f = FlagsOf(info)[tonumber(id)]
  if f == nil then return false end
  local mode = ER.Mode()
  if mode ~= "hard" and string.find(f, "e", 1, true) then return true end
  if mode == "casual" and string.find(f, "s", 1, true) then return true end
  return false
end

-- The step text of a visit, made again each time (for tests); info.steps keeps its first result.
function ER.RouteGenerate(info)
  return GenVisit(info)
end

function ER.RouteInfosFor(race)
  return InfosFor(race)
end

-- The visits of this character's race, always the same tables (the guide menu compares them by identity).
function ER.RouteGuides()
  local _, race = UnitRace("player")
  return InfosFor(race or "")
end

function ER.RouteFind(key)
  for _, info in ipairs(ER.RouteGuides()) do
    if info.group .. "\\" .. info.name == key or info.name == key then return info end
  end
  return nil
end

ER.Loaded("RouteRun.lua")
