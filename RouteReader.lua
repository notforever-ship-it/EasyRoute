-- Easy Route: the game's reader of the casual route plan (Data/Route.lua), written in Lua 5.0. tools/test-route.js reads this same file.
-- A visit has the field areas: lines split by tabs, kept as one string.
--   A <TAB> x <TAB> y <TAB> who                      starts an area (map percent; who = the giver it is named after)
--   Q <TAB> id <TAB> flags <TAB> hand <TAB> obj <TAB> grind      is a quest; hand and obj are "x y" when away from the giver or the area,
--                                                    "x y Zone" when in another zone, empty otherwise; grind is the level to grind
--                                                    to before picking the quest up, empty when there is no need (a line with five
--                                                    fields still reads, grind is then nil). A seventh field, pl, is the level the plan's
--                                                    player has when this quest's wave of pick-ups starts (a leveling visit only; nil
--                                                    when it is not there)
-- flags: e elite, d an objective only inside a dungeon, s escort, c chain of 4 or more, f far from its area,
-- x handed in later, at the capital stop right after this visit or in the next zone (at most 3 per visit), k something to kill or collect,
-- g group quest, v the safe route skips it, h friends found it hard, u goes into a cave, mine or crypt.
-- ER.RouteReader.ReadVisit(visit) gives a list of areas { x, y, who, q = { { id, flags, hx, hy, hzone, ox, oy, ozone, grind, pl }, ... } }
--   and a second value: how many lines it could not use (a Q line before any A line, a number that is not a number). It gives an
--   empty list, not an error, when the visit is missing or damaged.
-- A leveling visit (not a capital stop) can have the field spots: the grind spots, lines split by tabs:
--   name <TAB> x <TAB> y <TAB> lo <TAB> hi <TAB> n <TAB> code <TAB> red <TAB> elite
--   x, y = map percent of the biggest group, lo and hi = mob levels, n = spawns, code = y yellow by data, p red name but does not attack
--   first, r red, u no data; red = spawns of other red or unknown mobs close by; elite = the highest level of a strong mob close by (0: none).
-- ER.RouteReader.ReadSpots(visit) gives a list of spots { name, x, y, lo, hi, n, code, red, elite } in the order of the field. It gives an
--   empty list when the visit is missing or has no spots; a line without a name, x, y, lo or hi is left out.
-- ER.RouteReader.ReadPlace("x y Zone") gives x, y and the zone name (nil when there is none), or nothing for an empty string.
-- ER.RouteReader.ReadTravel(s) reads one value of the travel table (EasyRoute_Route.travel["<Faction>|<From>><To>"]): one leg per line, fields
--   split by tabs: kind (walk fly boat zeppelin tram portal), via ("x y Zone": where the arrow points, empty: none), text (the words),
--   tick (the zone or sub-zone that ends the leg), to (a fly leg: the flight master you land at, empty otherwise), learn (optional: the flight
--   master in the tick zone to talk to after this leg, to get its flight path).
--   It gives a list of legs { kind, x, y, zone, text, tick, to, learn } (x, y, zone from via, nil when empty; to and learn nil when empty), in order, and an
--   empty list for anything that is not a string; a line with no words or no zone to tick is left out.
-- ER.RouteReader.ReadChain(c) reads one entry of EasyRoute_Chains.chains (Data\Chains.lua): { l, h, z, steps = { { id, xp, real, v, w }, ... },
--   items = { { kind, id, q, slot, letters, name }, ... } } in the order of the fields; real is true for a step whose xp is real, q is nil when the
--   quality is not known. It gives nil for anything that is not a table.

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
      q.pl = tonumber(f[7])
      table.insert(cur.q, q)
    else
      bad = bad + 1
    end
  end
  return areas, bad
end

function R.ReadSpots(v)
  local out = {}
  if type(v) ~= "table" or type(v.spots) ~= "string" then return out end
  for line in string.gfind(v.spots, "[^\n]+") do
    local f = Split(line)
    local s = { name = f[1] or "", x = tonumber(f[2]), y = tonumber(f[3]), lo = tonumber(f[4]), hi = tonumber(f[5]),
      n = tonumber(f[6]) or 0, code = f[7] or "u", red = tonumber(f[8]) or 0, elite = tonumber(f[9]) or 0 }
    if s.name ~= "" and s.x and s.y and s.lo and s.hi then table.insert(out, s) end
  end
  return out
end

function R.ReadTravel(s)
  local legs = {}
  if type(s) ~= "string" then return legs end
  for line in string.gfind(s, "[^\n]+") do
    local f = Split(line)
    local leg = { kind = f[1] or "", text = f[3] or "", tick = f[4] or "" }
    leg.x, leg.y, leg.zone = R.ReadPlace(f[2])
    if f[5] and f[5] ~= "" then leg.to = f[5] end
    if f[6] and f[6] ~= "" then leg.learn = f[6] end
    if leg.kind ~= "" and leg.text ~= "" and leg.tick ~= "" then table.insert(legs, leg) end
  end
  return legs
end

function R.ReadChain(c)
  if type(c) ~= "table" then return nil end
  local out = { l = tonumber(c.l) or 0, h = tonumber(c.h) or 0, z = "", steps = {}, items = {} }
  if type(c.z) == "string" then out.z = c.z end
  if type(c.s) == "string" then
    for line in string.gfind(c.s, "[^\n]+") do
      local f = Split(line)
      local id = tonumber(f[1])
      if id then
        table.insert(out.steps, { id = id, xp = tonumber(f[2]) or 0, real = f[3] == "r", v = tonumber(f[4]) or 0, w = tonumber(f[5]) or 0 })
      end
    end
  end
  if type(c.e) == "string" then
    for line in string.gfind(c.e, "[^\n]+") do
      local f = Split(line)
      local id = tonumber(f[2])
      if id then
        table.insert(out.items, { kind = f[1] or "", id = id, q = tonumber(f[3]), slot = f[4] or "", letters = f[5] or "", name = f[6] or "" })
      end
    end
  end
  return out
end

ER.Loaded("RouteReader.lua")
