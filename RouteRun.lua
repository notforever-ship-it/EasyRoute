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

-- Levels past the zone's top level before its unstarted quests drop (and the zone is passed over): one, so the zone stays whole at its top
-- level, where the route's own "Grind to level N" step puts you before the quests that need level N.
local AHEAD_SLACK = 1

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

-- Leave the step out while you stand in any of these zones (a W element with an empty flag).
local function LineW(names)
  return "W" .. TAB .. TAB .. Clean(names) .. TAB
end

-- Leave the step out once your level is above this one (an L element).
local function LineL(level)
  return "L" .. TAB .. TAB .. tostring(level) .. TAB
end

-- Done while you are on a taxi.
local function LineF(dest)
  return "F" .. TAB .. TAB .. Clean(dest) .. TAB
end

-- Done when the flight map opens (you talked to a flight master).
local function LineP(name)
  return "P" .. TAB .. TAB .. Clean(name) .. TAB
end

-- Done when the zone or sub-zone you stand in has this name.
local function LineZ(zone)
  return "Z" .. TAB .. TAB .. Clean(zone) .. TAB
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
-- flags (optional): more flags of the S line, "grind=<level>" or "grind=end" and "at=<x>,<y>"; Grind.lua picks the spot from them.
local function GrindSteps(level, why, flags)
  return LineS("title=Grind to level " .. tostring(level) .. (flags and (";" .. flags) or "")), LineI(why), LineX(level)
end

-- The flag that says where a grind step is anchored (the giver it comes before, or the last area of the visit); empty without a place.
local function AtFlag(x, y)
  if not x or not y then return "" end
  return ";at=" .. tostring(x) .. "," .. tostring(y)
end

-- The flight masters of a faction in a zone (Data\Route.lua flights): a list of { name, x, y }, empty when there are none.
local function FlightList(faction, zone)
  local out = {}
  local route = EasyRoute_Route
  local text = type(route) == "table" and type(route.flights) == "table" and route.flights[faction .. "|" .. zone]
  if type(text) ~= "string" then return out end
  for line in string.gfind(text, "[^\n]+") do
    local _, _, fx, fy, name = string.find(line, "^([^\t]*)\t([^\t]*)\t(.*)$")
    fx, fy = tonumber(fx), tonumber(fy)
    if fx and fy and name and name ~= "" then table.insert(out, { name = name, x = fx, y = fy }) end
  end
  return out
end

-- The "Get the flight path" step for one flight master: its place, who to talk to, done when the flight map opens.
-- names: the zones in which the step is left out (a W element), or nil. gate: the level gate line of a zone you are past, or nil.
-- stayAway: the step of a zone's own flight master is left out when you are past that zone and do not stand in it (ER.RouteStepOut);
-- while you stand in it, it stays, even when you have out-levelled the zone.
local function FlightPathStep(zone, fm, names, Add, gate, stayAway)
  Add(LineS("title=Get the flight path" .. (stayAway and (";rt=away:" .. Clean(zone)) or "")))
  Add(gate)
  if names then Add(LineW(names)) end
  Add(LineG(zone, fm.x, fm.y))
  Add(LineI("Talk to " .. Npc(fm.name) .. " to get the flight path here."))
  Add(LineP(fm.name))
end

-- The towns of a flight leg's words "Fly from X to Y.": X and Y, or nothing when the words are different.
local function FlyTowns(text)
  local _, _, from, to = string.find(tostring(text or ""), "^Fly from (.-) to (.-)%.$")
  return from, to
end

-- The way here from the visit before, one step for each leg (Data\Route.lua travel, made from tools/route-travel.js): the arrow points at the
-- leg's place in the zone the leg starts in, else at the first area of this visit. A step is left out while you stand in the zone it ends
-- in, in any zone a later leg ends in, or in this zone, so a player who is already further on never sees it.
-- Two more ways out. A zone you are past (above its top level, the ahead rule) has no way to it at all: every step carries a level gate.
-- And a player who is not on the way from the zone before (the zone before was passed over, or the player went somewhere else) first gets one
-- plain "Head to <zone>" step, left out in the zone before, in every zone the legs pass and in this zone, so the legs start where they are meant to.
local function TravelSteps(info, areas, Add)
  local before, zone = info.before, info.visit.zone
  if type(before) ~= "table" or not before.zone then return end
  local route = EasyRoute_Route
  local entry = type(route) == "table" and type(route.travel) == "table" and route.travel[info.faction .. "|" .. before.zone .. ">" .. zone]
  local legs = ER.RouteReader.ReadTravel(entry)
  local count = table.getn(legs)
  if count == 0 then return end
  local gate = nil
  if not info.stop and info.hi then gate = LineL(info.hi + AHEAD_SLACK - 1) end
  -- The zones of the way: where it starts, what the legs touch, where it ends.
  local way, seenWay = {}, {}
  local function OnTheWay(name)
    if name and name ~= "" and not seenWay[name] then
      seenWay[name] = true
      table.insert(way, name)
    end
  end
  OnTheWay(before.zone)
  for _, leg in ipairs(legs) do
    OnTheWay(leg.zone)
    OnTheWay(leg.tick)
  end
  OnTheWay(zone)
  Add(LineS("title=Go to " .. zone))
  Add(gate)
  Add(LineW(table.concat(way, ",")))
  if areas[1] then Add(LineG(zone, areas[1].x, areas[1].y)) end
  Add(LineI("Head to " .. zone .. ": the arrow points the way."))
  Add(LineZ(zone))
  for i = 1, count do
    local leg = legs[i]
    local names, seen = {}, {}
    for j = i, count do
      if not seen[legs[j].tick] then
        seen[legs[j].tick] = true
        table.insert(names, legs[j].tick)
      end
    end
    if not seen[zone] then table.insert(names, zone) end
    -- A flight is only offered to a player who has the flight path of the town it lands in (ER.RouteStepOut); the others get the same
    -- way as a ride or a walk to the zone it lands in, with the arrow on the flight master there.
    local _, landing = FlyTowns(leg.text)
    local flight = leg.kind == "fly" and landing
    Add(LineS("title=Go to " .. zone .. (flight and (";rt=fp:" .. Clean(landing)) or "")))
    Add(gate)
    Add(LineW(table.concat(names, ",")))
    if leg.x then
      Add(LineG(leg.zone, leg.x, leg.y))
    elseif areas[1] then
      Add(LineG(zone, areas[1].x, areas[1].y))
    end
    Add(LineI(leg.text))
    if leg.kind == "fly" then Add(LineF(leg.to)) else Add(LineZ(leg.tick)) end
    if flight then
      Add(LineS("title=Go to " .. zone .. ";rt=nofp:" .. Clean(landing)))
      Add(gate)
      Add(LineW(table.concat(names, ",")))
      local at = nil
      for _, fm in ipairs(FlightList(info.faction, leg.tick)) do
        if fm.name == leg.to then at = fm end
      end
      if at then
        Add(LineG(leg.tick, at.x, at.y))
      elseif areas[1] then
        Add(LineG(zone, areas[1].x, areas[1].y))
      end
      Add(LineI("You do not have the flight path to " .. landing .. " yet: ride or walk to " .. leg.tick .. "; the arrow points the way."))
      Add(LineZ(leg.tick))
    end
    -- A leg that passes a town whose flight path a later flight lands on: get it now (the builder checks that every flight has one).
    if leg.learn then
      local later = {}
      for j = i + 1, count do table.insert(later, legs[j].tick) end
      table.insert(later, zone)
      for _, fm in ipairs(FlightList(info.faction, leg.tick)) do
        if fm.name == leg.learn then FlightPathStep(leg.tick, fm, table.concat(later, ","), Add, gate) end
      end
    end
  end
end

-- The flight paths a zone teaches: in the first visit of a zone (not a named second visit), each flight master of the faction in that zone gets a
-- "Get the flight path" step right after the steps of the area nearest to it, when that area is at most FP_NEAR yards away. Farther ones get no step.
-- tools/build-route.js holds the same rule and the same number (FP_NEAR): it stops the build when a flight lands on a flight path that no
-- step teaches, so the two must not differ.
local FP_NEAR = 600

-- Area number -> list of { name, x, y } of the flight masters taught after that area.
local function FlightPaths(info, areas)
  local out = {}
  local v = info.visit
  if v.again then return out end
  for _, fm in ipairs(FlightList(info.faction, v.zone)) do
    local best, at = nil, nil
    for i, area in ipairs(areas) do
      if area.x and area.y then
        local d = ER.Steps.Yards(v.zone, fm.x, fm.y, area.x, area.y)
        if not best or d < best then best, at = d, i end
      end
    end
    if best and best <= FP_NEAR then
      if not out[at] then out[at] = {} end
      table.insert(out[at], fm)
    end
  end
  return out
end

local function GenVisit(info)
  local v = info.visit
  local zone = v.zone
  local areas = ER.RouteReader.ReadVisit(v)
  local out = {}
  local function Add(line)
    if line then table.insert(out, line) end
  end
  local teach = FlightPaths(info, areas)
  TravelSteps(info, areas, Add)
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
  for areaNo, area in ipairs(areas) do
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
        local x, y = GiverPlace(zone, area, batch.row)
        if need > reached then
          reached = need
          local s, i, g = GrindSteps(need, "Nothing to pick up here yet: grind mobs near you until level " .. need .. ".",
            "grind=" .. need .. AtFlag(x, y))
          Add(s)
          Add(i)
          Add(g)
        end
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
    for _, fm in ipairs(teach[areaNo] or {}) do FlightPathStep(zone, fm, nil, Add, nil, true) end
  end
  if not v.stop then
    local lastX, lastY
    for _, area in ipairs(areas) do
      if area.x and area.y then lastX, lastY = area.x, area.y end
    end
    local s, i, g = GrindSteps(v.hi, "Out of quests here: grind mobs near you until level " .. tostring(v.hi) .. ", then the guide goes on.",
      "grind=end" .. AtFlag(lastX, lastY))
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
-- The second table holds the quests the route grinds you up for: their grind mark or their own minimum level is the zone's top level,
-- so they stay even when you are above it.
local function FlagsOf(info)
  local made = rawget(info, "flagsOf")
  if made then return made, rawget(info, "staysOf") end
  made = {}
  local stays = {}
  for _, area in ipairs(ER.RouteReader.ReadVisit(info.visit)) do
    for _, q in ipairs(area.q) do
      if q.id then
        made[q.id] = q.flags or ""
        local row = Row(q.id)
        if info.hi and ((q.grind and q.grind >= info.hi) or (row and row.m and row.m >= info.hi)) then stays[q.id] = true end
      end
    end
  end
  rawset(info, "flagsOf", made)
  rawset(info, "staysOf", stays)
  return made, stays
end

-- True when the difficulty alone leaves a quest with these flags out: elite quests (flag e) on Casual and Medium, escort quests
-- (flag s) on Casual. The position line counts with the same rule.
local function LeftByDifficulty(flags, mode)
  if mode ~= "hard" and string.find(flags, "e", 1, true) then return true end
  if mode == "casual" and string.find(flags, "s", 1, true) then return true end
  return false
end

-- Quest id -> the plan's flag letters, for every quest on a race's whole path (the first visit that lists it). Made once per race.
local pathFlags = {}
local function PathFlags(info)
  local made = pathFlags[info.race]
  if made then return made end
  made = {}
  for _, other in ipairs(InfosFor(info.race)) do
    for _, area in ipairs(ER.RouteReader.ReadVisit(other.visit)) do
      for _, q in ipairs(area.q) do
        if q.id and made[q.id] == nil then made[q.id] = q.flags or "" end
      end
    end
  end
  pathFlags[info.race] = made
  return made
end

-- True when a quest waits for a quest before it that the difficulty leaves out (a quest after an escort on Casual): the NPC would never offer it.
-- The chain is followed up as far as it is on the route; a quest in your log or handed in ends the walk, because then the way on is open.
local function ChainOut(id, mode, flags, info)
  local all = PathFlags(info)
  local at = id
  for _ = 1, 20 do
    local row = Row(at)
    local p = row and row.p
    if not p then return false end
    if ER.Steps.InLog(p) or ER.Steps.TurnedIn(p) then return false end
    local pf = flags[p]
    if pf == nil then pf = all[p] end
    if pf == nil then return false end
    if LeftByDifficulty(pf, mode) then return true end
    at = p
  end
  return false
end

-- True when the difficulty leaves this quest of the visit out: its own flags, or the flags of a quest it waits for.
local function LeftByDifficultyHere(id, f, mode, flags, info)
  return LeftByDifficulty(f, mode) or ChainOut(id, mode, flags, info)
end

-- True when the casual route leaves this quest out: the difficulty rule above (also for a quest that waits for one the difficulty leaves out),
-- and every quest you have not started once you are above the top level of the zone (a short capital stop never ends this way),
-- except the quests the route grinds you up for.
-- Anything that is not a quest of the running casual-route visit (a RestedXP guide, a quest carried in) is never left out here.
function ER.RouteLeftOut(id)
  local info = ER.Steps.Info()
  if not info or not info.route then return false end
  id = tonumber(id)
  local flags, stays = FlagsOf(info)
  local f = flags[id]
  if f == nil then return false end
  local mode = ER.Mode()
  if LeftByDifficultyHere(id, f, mode, flags, info) then return true end
  if not info.stop and info.hi and (UnitLevel("player") or 1) >= info.hi + AHEAD_SLACK then
    if stays[id] then return false end
    -- Remembered for this session only: the line that says why the zone ended (ER.RouteNextLine).
    if not ER.Steps.TurnedIn(id) then info.ahead = true end
    return true
  end
  return false
end

-- True when a casual-route zone is one you are past: not a short stop, and your level is above its top level (the ahead rule).
local function PastVisit(info, level)
  if type(info) ~= "table" or not info.route or info.stop or not info.hi then return false end
  return (level or UnitLevel("player") or 1) >= info.hi + AHEAD_SLACK
end

-- The flight masters of a faction by name, and the town each one flies from or to (from the fly legs of Data\Route.lua travel, whose words say
-- "Fly from X to Y."): the flight master you land at is Y, the one at the start place of the leg is X. Made once per faction.
local townOf = {}
local function TownMap(faction)
  if townOf[faction] then return townOf[faction] end
  local map = {}
  local route = EasyRoute_Route
  if type(route) == "table" and type(route.travel) == "table" then
    for key, entry in pairs(route.travel) do
      if string.sub(key, 1, string.len(faction) + 1) == faction .. "|" then
        for _, leg in ipairs(ER.RouteReader.ReadTravel(entry)) do
          if leg.kind == "fly" then
            local from, to = FlyTowns(leg.text)
            if to and leg.to then map[leg.to] = to end
            if from and leg.x and leg.zone then
              local best, name = nil, nil
              for _, fm in ipairs(FlightList(faction, leg.zone)) do
                local d = ER.Steps.Yards(leg.zone, fm.x, fm.y, leg.x, leg.y)
                if not best or d < best then best, name = d, fm.name end
              end
              if name and best <= 300 then map[name] = from end
            end
          end
        end
      end
    end
  end
  townOf[faction] = map
  return map
end

-- The flight paths this character is known to have, kept in the saved variables: ER.db.flightPaths[char] = { nodes = { [node name] = true },
-- towns = { [lower case town] = true } }. nodes: whatever the flight map listed when it opened (1.12: NumTaxiNodes, TaxiNodeName and
-- TaxiNodeGetType, "NONE" is a place you cannot use). towns: what the route itself taught on this character: the flight master of a
-- "Get the flight path" step, and the one a flight took off from. Called by Steps.lua when the flight map opens, before the step is marked.
function ER.RouteTaxiOpened()
  if not ER.db or not ER.Steps then return end
  if type(ER.db.flightPaths) ~= "table" then ER.db.flightPaths = {} end
  local who = ER.Char()
  local mine = ER.db.flightPaths[who]
  if type(mine) ~= "table" then
    mine = {}
    ER.db.flightPaths[who] = mine
  end
  if type(mine.nodes) ~= "table" then mine.nodes = {} end
  if type(mine.towns) ~= "table" then mine.towns = {} end
  if NumTaxiNodes and TaxiNodeName then
    for i = 1, tonumber(NumTaxiNodes()) or 0 do
      local name = TaxiNodeName(i)
      local kind = TaxiNodeGetType and TaxiNodeGetType(i) or nil
      if type(name) == "string" and name ~= "" and kind ~= "NONE" then mine.nodes[name] = true end
    end
  end
  local S = ER.Steps
  local map = TownMap(UnitFactionGroup("player") or "Alliance")
  local list = S.Side()
  if S.Current() then table.insert(list, S.Current()) end
  for _, step in ipairs(list) do
    local flies = false
    for _, e in ipairs(step.elements) do
      if e.kind == "F" then flies = true end
    end
    for _, e in ipairs(step.elements) do
      if e.kind == "P" and e.name and map[e.name] then mine.towns[string.lower(map[e.name])] = true end
      if flies and e.kind == "I" and e.text then
        local from = FlyTowns(e.text)
        if from then mine.towns[string.lower(from)] = true end
      end
    end
  end
end

-- Does this character have the flight path of a town? True when nothing is known about its flight paths yet (a character that has never opened
-- a flight map since Easy Route began keeping them): the route's own "Get the flight path" steps are trusted then.
local function FlightKnown(town)
  local mine = ER.db and type(ER.db.flightPaths) == "table" and ER.db.flightPaths[ER.Char()] or nil
  if type(mine) ~= "table" then return true end
  local any = false
  local want = string.lower(tostring(town))
  if type(mine.towns) == "table" then
    for name in pairs(mine.towns) do
      any = true
      if name == want then return true end
    end
  end
  if type(mine.nodes) == "table" then
    for name in pairs(mine.nodes) do
      any = true
      if string.find(string.lower(name), want, 1, true) then return true end
    end
  end
  return not any
end

-- Asked by Steps.lua Fits for a step with an rt flag (set by the generator, never by a guide): true when the step is not for you now.
--   away:<zone>  the zone running is one you are past and you do not stand in <zone>
--   fp:<town>    the flight to <town> (left out when this character has not got that flight path)
--   nofp:<town>  the ride or walk to the same place (left out when it has)
function ER.RouteStepOut(step)
  local rt = step and step.flags and step.flags.rt
  if type(rt) ~= "string" then return false end
  local _, _, kind, arg = string.find(rt, "^(%a+):(.*)$")
  if kind == "away" then
    if not PastVisit(ER.Steps.Info()) then return false end
    return string.lower(GetZoneText() or "") ~= string.lower(arg)
  end
  if kind == "fp" then return not FlightKnown(arg) end
  if kind == "nofp" then return FlightKnown(arg) end
  return false
end

-- The one chat line for the move from one visit to the next; nil when either is not a casual-route visit.
-- skipped: the zones passed over on the way (ER.RouteSkipPast), or nil.
function ER.RouteNextLine(prev, nxt, skipped)
  if type(prev) ~= "table" or type(nxt) ~= "table" or not prev.route or not nxt.route then return nil end
  if type(skipped) == "table" and table.getn(skipped) > 0 then
    local what = skipped[1].visit and skipped[1].visit.zone or skipped[1].name
    if table.getn(skipped) > 1 then what = table.getn(skipped) .. " zones" end
    return "You are ahead of the plan: skipping " .. tostring(what) .. ", moving on to " .. tostring(nxt.visit and nxt.visit.zone or nxt.name) .. "."
  end
  if prev.ahead then
    return "You are ahead of the plan: moving on to " .. tostring(nxt.visit and nxt.visit.zone or nxt.name) .. "."
  end
  return tostring(prev.visit and prev.visit.zone or prev.name) .. " is done. Now following " .. tostring(nxt.title or nxt.name) .. "."
end

------------------------------------------------------------------------------------------------------
-- Where you are in the plan
------------------------------------------------------------------------------------------------------

-- The line is worked out again after this many seconds, or at once when the step, the difficulty, the level or the zone changes.
-- The step box asks for it on every refresh, so most asks get the kept text.
local LINE_EVERY = 2
local kept = {}

local function InfoNamed(info, name)
  for _, other in ipairs(InfosFor(info.race)) do
    if other.name == name then return other end
  end
  return nil
end

-- The zone to start when the one before it ended: the zone itself, or, for a player who is past it (above its top level), the first zone
-- after it that is not passed over the same way. A short stop is never passed over. Returns that zone and the list of the zones passed over
-- (nil when none). The last zone of the path is the end of the walk, so it is returned even when the player is past it.
function ER.RouteSkipPast(first)
  if type(first) ~= "table" or not first.route then return first, nil end
  local at, skipped = first, nil
  while PastVisit(at) do
    local nxt = at.next and InfoNamed(at, at.next)
    if not nxt then break end
    skipped = skipped or {}
    table.insert(skipped, at)
    at = nxt
  end
  return at, skipped
end

-- The zone's own quests for this character: the ones the difficulty keeps and the next zone does not hand in (flag x). A quest is done when
-- it is handed in, or when the route leaves it out now (it went grey, or you are ahead of the zone) and it is not in your log.
local function CountQuests(info)
  local S = ER.Steps
  local flags = FlagsOf(info)
  local mode = ER.Mode()
  local total, done = 0, 0
  for id, f in pairs(flags) do
    if not string.find(f, "x", 1, true) and not LeftByDifficultyHere(id, f, mode, flags, info) then
      total = total + 1
      if S.TurnedIn(id) or S.LeftOut(id) then done = done + 1 end
    end
  end
  return done, total
end

local function Work(info)
  local done, total = CountQuests(info)
  local v = info.visit
  local where = v.zone .. " (" .. tostring(v.lo) .. "-" .. tostring(v.hi) .. ")"
  local shortHead, shortEnd = v.zone, ": " .. done .. "/" .. total .. " done"
  if info.stop then
    where = v.zone .. " (short stop at " .. tostring(v.lo) .. ")"
    shortEnd = ": stop"
  end
  local count = done .. " of " .. total .. (total == 1 and " quest done." or " quests done.")
  local nxt = info.next and InfoNamed(info, info.next)
  local tail = "This is the last zone of the route."
  if nxt then tail = "Next: " .. tostring(nxt.visit and nxt.visit.zone or nxt.name) .. " at " .. tostring(nxt.lo) .. "." end
  return where .. ": " .. count .. " " .. tail, shortHead, shortEnd
end

-- The long text, the zone name and the short ending (": 12/20 done"), from the kept ones when nothing changed in the last LINE_EVERY
-- seconds. nil unless a casual-route zone runs.
local function LineTexts()
  local S = ER.Steps
  local info = S and S.Info()
  if not info or not info.route or not info.visit then return nil end
  local now = GetTime()
  local pos, mode, level, zone = S.Position(), ER.Mode(), UnitLevel("player") or 1, GetZoneText() or ""
  if kept.info == info and kept.pos == pos and kept.mode == mode and kept.level == level and kept.zone == zone
    and kept.at and now >= kept.at and now - kept.at < LINE_EVERY then
    return kept.long, kept.head, kept.tail
  end
  kept.info, kept.pos, kept.mode, kept.level, kept.zone, kept.at = info, pos, mode, level, zone, now
  kept.long, kept.head, kept.tail = Work(info)
  return kept.long, kept.head, kept.tail
end

-- "Durotar (1-10): 12 of 20 quests done. Next: Orgrimmar at 10." for the step box and the guide menu; nil when no casual-route zone runs.
function ER.RouteLine()
  local long = LineTexts()
  return long
end

-- "Durotar: 12/20 done" for Simple mode ("Orgrimmar: stop" for a stop), then the zone name and the ending apart: the name line trims the
-- zone name when it is too long (ER.FitLine) and always keeps the numbers.
function ER.RouteShort()
  local _, head, tail = LineTexts()
  if not head then return nil end
  return head .. tail, head, tail
end

------------------------------------------------------------------------------------------------------
-- Stuck? Skip this step
------------------------------------------------------------------------------------------------------

-- A watcher for any running guide. It keeps the time of the last progress; with 10 minutes of none it only raises a flag, which shows a
-- line in the step box (Tracker.lua) or a tip in Simple mode. The guide never skips a step by itself: only a click on that line or
-- tip button calls Steps.Next.
local STUCK_AFTER = 600   -- seconds without progress
local STUCK_WALK = 60     -- yards from the last place noted that count as a walk
local STUCK_STEP = 2      -- seconds between two looks
local stuck = { on = false }

-- Anything that changes when you make progress: the step, level, xp, the number of quest log entries, and the objectives of the quests
-- the step is about.
local function ProgressToken(S)
  local parts = { tostring(S.Position()), tostring(UnitLevel("player") or 0), tostring(UnitXP("player") or 0),
    tostring((GetNumQuestLogEntries()) or 0) }
  local step = S.Current()
  if step then
    for _, e in ipairs(step.elements) do
      if (e.kind == "A" or e.kind == "C" or e.kind == "T") and e.id and e.id ~= 0 then
        for _, o in ipairs(S.Objectives(S.QuestTitle(e.id))) do
          table.insert(parts, o.text .. (o.done and "+" or "-"))
        end
      end
    end
  end
  return table.concat(parts, "|")
end

local function StuckOff()
  if not stuck.on then return end
  stuck.on = false
  if ER.RemoveTip then ER.RemoveTip("stuck") end
  if ER.StepsChanged then ER.StepsChanged() end
end

local function StuckOn(S)
  stuck.on = true
  stuck.pos = S.Position()
  if ER.StepsChanged then ER.StepsChanged() end
  if ER.db and ER.db.simple and ER.AddTip then
    ER.AddTip("stuck", "Stuck? This step has not moved on for 10 minutes.", { { label = "Skip this step", fn = function() ER.Steps.Next() end } })
  end
end

-- Start the clock again from now, here.
local function StuckRestart(now, token, zone, x, y)
  stuck.at, stuck.last, stuck.token, stuck.zone, stuck.x, stuck.y = now, now, token, zone, x, y
  StuckOff()
end

local function StuckLook()
  local S = ER.Steps
  local now = GetTime()
  if not (S and S.Running() and S.Current()) then
    stuck.at = nil
    StuckOff()
    return
  end
  local token = ProgressToken(S)
  local zone, x, y = S.Here()
  if not stuck.at or now < stuck.last then
    StuckRestart(now, token, zone, x, y)
    return
  end
  local gap = now - stuck.last
  stuck.last = now
  -- Time spent dead or on a flight does not count: the clock moves forward by as much as has passed.
  if (UnitIsDeadOrGhost and UnitIsDeadOrGhost("player")) or (UnitOnTaxi and UnitOnTaxi("player")) then
    stuck.at = stuck.at + gap
    return
  end
  local progress = token ~= stuck.token
  if not progress and zone and zone ~= "" and x and y and not (x == 0 and y == 0) then
    if zone ~= stuck.zone or not stuck.x then
      progress = true
    elseif (S.Yards(zone, stuck.x, stuck.y, x, y)) > STUCK_WALK then
      progress = true
    end
  end
  if progress then
    StuckRestart(now, token, zone, x, y)
  elseif not stuck.on and now - stuck.at >= STUCK_AFTER then
    StuckOn(S)
  end
end

-- For the quick checks only: seconds without progress as of the last look; 0 with no guide or no step.
function ER._testStuckFor()
  if not stuck.at then return 0 end
  return stuck.last - stuck.at
end

-- True once the watcher has seen 10 minutes without progress on the step now showing.
function ER.IsStuck()
  return stuck.on and ER.Steps and ER.Steps.Position() == stuck.pos or false
end

local watch = CreateFrame("Frame", "EasyRouteStuckWatch")
watch.wait = STUCK_STEP
watch:SetScript("OnUpdate", function()
  this.wait = this.wait + arg1
  if this.wait < STUCK_STEP then return end
  this.wait = 0
  StuckLook()
end)

-- For the quick checks only: the step text of a visit, made again each time; info.steps keeps its first result.
function ER._testGenerate(info)
  return GenVisit(info)
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

------------------------------------------------------------------------------------------------------
-- Starting the casual route by itself
------------------------------------------------------------------------------------------------------

-- The visit of this character's path that fits a level: the first one that is not a stop with level below its top level, or a stop
-- with level at or below its top level; past the end of the path, the last visit. nil when the race has no path.
function ER.RouteVisitFor(level)
  local infos = ER.RouteGuides()
  local count = table.getn(infos)
  if count == 0 then return nil end
  level = tonumber(level) or 1
  for _, info in ipairs(infos) do
    if info.stop then
      if level <= info.hi then return info end
    elseif level < info.hi then
      return info
    end
  end
  return infos[count]
end

-- A player who follows a RestedXP guide is told once, per character, that the casual route exists.
local function RouteHint()
  if type(ER.db.routeTold) ~= "table" then ER.db.routeTold = {} end
  local who = ER.Char()
  if ER.db.routeTold[who] then return end
  ER.db.routeTold[who] = true
  ER.Print("The new casual route is in the guide menu.")
end

-- Run once per login by the starter below. Never takes a guide away from the player: a running or saved RestedXP guide and a guide
-- stopped on purpose are left alone, a saved difficulty is never changed. A new character (nothing saved) starts the zone of its
-- race's path that fits its level, with one chat line.
function ER.RouteAutoStart()
  if not ER.db or not ER.Steps then return end
  if table.getn(ER.RouteGuides()) == 0 then return end
  local running = ER.Steps.Info()
  -- The saved guide comes back first (the step window's own starter does the same, a moment later or in the same frame): what the
  -- player was following must never be judged from "nothing is running yet".
  if not running and ER.Steps.Resume() then
    running = ER.Steps.Info()
    if ER.ShowTracker then ER.ShowTracker() end
  end
  if running then
    if not running.route then RouteHint() end
    return
  end
  local saved = type(ER.db.guides) == "table" and ER.db.guides[ER.Char()] or nil
  if type(saved) == "table" and type(saved.key) == "string" and saved.key ~= "" then
    if saved.stopped then return end
    -- A casual-route key that is not running: its zone could not be found, so the zone for the level starts below.
    if string.sub(saved.key, 1, string.len(ER.ROUTE_GROUP) + 1) ~= ER.ROUTE_GROUP .. "\\" then
      RouteHint()
      return
    end
  end
  if ER.db.mode == nil then ER.db.mode = "casual" end
  local info = ER.RouteVisitFor(UnitLevel("player"))
  if not info then return end
  if not ER.StartGuide(ER.Steps.Key(info), nil, true) then return end
  local race = UnitRace("player")
  ER.Print("following the casual route for " .. tostring(race) .. " on " .. ER.MODES[ER.Mode()].label ..
    ". The gear on the step box changes the route or difficulty.")
end

-- At login: wait at least 4 seconds, then until the quest log has been read (a part-way start looks at the log, and an unread log looks
-- empty), then start the route once. Gives up after 20 seconds without a log.
local starter = CreateFrame("Frame", "EasyRouteRouteStarter")
starter:RegisterEvent("PLAYER_ENTERING_WORLD")
starter:SetScript("OnEvent", function()
  this:UnregisterEvent("PLAYER_ENTERING_WORLD")
  this.wait, this.gap = 0, 0.5
  this:SetScript("OnUpdate", function()
    this.wait = this.wait + arg1
    if this.wait < 4 then return end
    this.gap = this.gap + arg1
    if this.gap < 0.5 then return end
    this.gap = 0
    if ER.Recorder and ER.Recorder.Ready and ER.Recorder.Ready() then
      this:SetScript("OnUpdate", nil)
      ER.RouteAutoStart()
    elseif this.wait > 20 then
      this:SetScript("OnUpdate", nil)
    end
  end)
end)

ER.Loaded("RouteRun.lua")
