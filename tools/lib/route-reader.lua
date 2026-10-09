-- Easy Route: reader for the generated route data (Data/Route.lua), written in Lua 5.0 so the game can use the same code.
-- A visit has the field areas: lines split by tabs, kept as one string.
--   A <TAB> x <TAB> y <TAB> who                      starts an area (map percent; who = the giver it is named after)
--   Q <TAB> id <TAB> flags <TAB> hand <TAB> obj      is a quest; hand and obj are "x y" when away from the giver or the area,
--                                                    "x y Zone" when in another zone, empty otherwise
-- flags: e elite, d partly in a dungeon, s escort, c chain of 4 or more, f far from its area,
-- x handed in at another zone on the way, k something to kill or collect.
-- ReadVisit(visit) gives a list of areas { x, y, who, q = { { id, flags, hx, hy, hzone, ox, oy, ozone }, ... } }.
-- ReadPlace("x y Zone") gives x, y and the zone name (nil when there is none), or nothing for an empty string.

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

function ReadPlace(s)
  if not s or s == "" then return nil end
  local _, _, x, y, zone = string.find(s, "^(%S+) (%S+) ?(.*)$")
  if not x then return nil end
  if zone == "" then zone = nil end
  return tonumber(x), tonumber(y), zone
end

function ReadVisit(v)
  local areas, cur = {}, nil
  for line in string.gfind(v.areas, "[^\n]+") do
    local f = Split(line)
    if f[1] == "A" then
      cur = { x = tonumber(f[2]), y = tonumber(f[3]), who = f[4], q = {} }
      table.insert(areas, cur)
    elseif f[1] == "Q" and cur then
      local q = { id = tonumber(f[2]), flags = f[3] or "" }
      q.hx, q.hy, q.hzone = ReadPlace(f[4])
      q.ox, q.oy, q.ozone = ReadPlace(f[5])
      table.insert(cur.q, q)
    end
  end
  return areas
end
