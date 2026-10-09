-- Easy Route: the game's reader of the casual route plan (Data/Route.lua), written in Lua 5.0. tools/test-route.js reads this same file.
-- A visit has the field areas: lines split by tabs, kept as one string.
--   A <TAB> x <TAB> y <TAB> who                      starts an area (map percent; who = the giver it is named after)
--   Q <TAB> id <TAB> flags <TAB> hand <TAB> obj <TAB> grind      is a quest; hand and obj are "x y" when away from the giver or the area,
--                                                    "x y Zone" when in another zone, empty otherwise; grind is the level to grind
--                                                    to before picking the quest up, empty when there is no need (a line with five
--                                                    fields still reads, grind is then nil)
-- flags: e elite, d partly in a dungeon, s escort, c chain of 4 or more, f far from its area,
-- x handed in later, at the capital stop right after this visit or in the next zone (at most 3 per visit), k something to kill or collect.
-- ER.RouteReader.ReadVisit(visit) gives a list of areas { x, y, who, q = { { id, flags, hx, hy, hzone, ox, oy, ozone, grind }, ... } }
--   and a second value: how many lines it could not use (a Q line before any A line, a number that is not a number). It gives an
--   empty list, not an error, when the visit is missing or damaged.
-- ER.RouteReader.ReadPlace("x y Zone") gives x, y and the zone name (nil when there is none), or nothing for an empty string.
-- ER.RouteReader.ReadTravel(s) reads one value of the travel table (EasyRoute_Route.travel["<Faction>|<From>><To>"]): one leg per line, fields
--   split by tabs: kind (walk fly boat zeppelin tram portal), via ("x y Zone": where the arrow points, empty: none), text (the words),
--   tick (the zone or sub-zone that ends the leg), to (a fly leg: the flight master you land at, empty otherwise).
--   It gives a list of legs { kind, x, y, zone, text, tick, to } (x, y, zone from via, nil when empty; to nil when empty), in order, and an
--   empty list for anything that is not a string; a line with no words or no zone to tick is left out.

local ER = EasyRoute
ER.RouteReader = ER.RouteReader or {}
local R = ER.RouteReader

local function Split(line)
  local out, pos = {}, 1
  while true do
    local s, e = string.find(line, "\t", pos, true)
    if not s then
      table.insert(out, string.sub(line, pos))
      break
    end
    table.insert(out, string.sub(line, pos, s - 1))
    pos = e + 1
  end
  return out
end

function R.ReadPlace(s)
  if type(s) ~= "string" or s == "" then return nil end
  local _, _, x, y, zone = string.find(s, "^(%S+) (%S+) ?(.*)$")
  if not x then return nil end
  if zone == "" then zone = nil end
  return tonumber(x), tonumber(y), zone
end

function R.ReadVisit(v)
  local areas, cur, bad = {}, nil, 0
  if type(v) ~= "table" or type(v.areas) ~= "string" then return areas, bad end
  for line in string.gfind(v.areas, "[^\n]+") do
    local f = Split(line)
    if f[1] == "A" then
      cur = { x = tonumber(f[2]), y = tonumber(f[3]), who = f[4] or "", q = {} }
      if not cur.x or not cur.y then bad = bad + 1 end
      table.insert(areas, cur)
    elseif f[1] == "Q" and cur then
      local q = { id = tonumber(f[2]), flags = f[3] or "" }
      if not q.id then bad = bad + 1 end
      q.hx, q.hy, q.hzone = R.ReadPlace(f[4])
      q.ox, q.oy, q.ozone = R.ReadPlace(f[5])
      q.grind = tonumber(f[6])
      table.insert(cur.q, q)
    else
      bad = bad + 1
    end
  end
  return areas, bad
end

function R.ReadTravel(s)
  local legs = {}
  if type(s) ~= "string" then return legs end
  for line in string.gfind(s, "[^\n]+") do
    local f = Split(line)
    local leg = { kind = f[1] or "", text = f[3] or "", tick = f[4] or "" }
    leg.x, leg.y, leg.zone = R.ReadPlace(f[2])
    if f[5] and f[5] ~= "" then leg.to = f[5] end
    if leg.kind ~= "" and leg.text ~= "" and leg.tick ~= "" then table.insert(legs, leg) end
  end
  return legs
end

ER.Loaded("RouteReader.lua")
