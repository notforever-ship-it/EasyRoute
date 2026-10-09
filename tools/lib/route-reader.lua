-- Easy Route: reader for the generated route data (Data/Route.lua), written in Lua 5.0 so the game can use the same code.
-- A visit has the field areas: lines split by tabs, kept as one string.
--   A <TAB> x <TAB> y <TAB> who                      starts an area (map percent; who = the giver it is named after)
--   Q <TAB> id <TAB> flags <TAB> hand <TAB> obj      is a quest; hand and obj are "x y" when away from the giver or the area,
--                                                    "x y Zone" when in another zone, empty otherwise
-- flags: e elite, d partly in a dungeon, s escort, c chain of 4 or more, f far from its area,
-- x handed in at another zone on the way, k something to kill or collect.
-- ER.RouteReader.ReadVisit(visit) gives a list of areas { x, y, who, q = { { id, flags, hx, hy, hzone, ox, oy, ozone }, ... } }
--   and a second value: how many lines it could not use (a Q line before any A line, a number that is not a number). It gives an
--   empty list, not an error, when the visit is missing or damaged.
-- ER.RouteReader.ReadPlace("x y Zone") gives x, y and the zone name (nil when there is none), or nothing for an empty string.

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
      table.insert(cur.q, q)
    else
      bad = bad + 1
    end
  end
  return areas, bad
end
