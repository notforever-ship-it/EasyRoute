-- Easy Route: grind spots. A grind step of the casual route (RouteRun.lua marks it grind=<level> or grind=end, with at=<x>,<y>) gets a
-- real place to grind: the game picks one spot from the visit's pool in Data\Route.lua by your level now, names the mobs, says why
-- in plain words, and points the arrow at it. The pool is made offline by tools/build-route.js; the numbers here are the same ones.
-- Without a spot (the Settings tick is off, or nothing fits) the route's own "Grind to level N" words stay as they are.

local ER = EasyRoute

------------------------------------------------------------------------------------------------------
-- Numbers (tools/build-route.js has the same names; tools/test-route.js reads both)
------------------------------------------------------------------------------------------------------

ER.GRIND = {
  -- A spot needs at least this many spawns, and a strong mob (rank 1 to 3) within the build's radius counts when its top level is at
  -- least your level minus GRIND_ELITE_BELOW.
  GRIND_MIN_SPAWNS = 8,
  GRIND_ELITE_BELOW = 3,
  -- Other red or unknown spawns close by: at most this many for a yellow spot and for a red spot.
  GRIND_RED_MAX_YELLOW = 30,
  GRIND_RED_MAX_RED = 20,
  -- How far from where the step is anchored (yards): near, far; past far is the last stage.
  GRIND_NEAR = 600,
  GRIND_FAR = 1200,
  -- Yellow mobs may be this many levels above you (a little above you is ranked lower; two above only when nothing else fits), and
  -- this many levels below you. Red and unknown mobs only at your level or this many below it.
  GRIND_YELLOW_ABOVE = 1,
  GRIND_YELLOW_LAST = 2,
  GRIND_BELOW = 1,
  -- A group this big is preferred to a smaller one of the same stage.
  GRIND_BIG = 20,
  -- "Few other mobs around" is said up to this many other red spawns. The place word "near <who>" needs the area within this many yards.
  GRIND_FEW_OTHERS = 12,
  GRIND_NAME_YARDS = 500,
}
local G = ER.GRIND

------------------------------------------------------------------------------------------------------
-- Plural of a mob name ("Mottled Boar" -> "Mottled Boars")
------------------------------------------------------------------------------------------------------

-- Words that do not change, and words that already are a plural.
local SAME = { vermin = true, deer = true, sheep = true, fish = true, moose = true, elk = true, swine = true }
local EN_PLURAL = { children = true, oxen = true, brethren = true }
local MAN_SINGULAR = { human = true, shaman = true, talisman = true, german = true, roman = true }

local function PluralWord(word)
  local lower = string.lower(word)
  local len = string.len(word)
  if len == 0 or SAME[lower] then return word end
  local last, last2 = string.sub(lower, len, len), string.sub(lower, len - 1, len)
  if last2 == "en" and (EN_PLURAL[lower] or string.sub(lower, len - 2, len) == "men") then return word end
  if last2 == "an" and string.sub(lower, len - 2, len) == "man" and not MAN_SINGULAR[lower] then
    return string.sub(word, 1, len - 2) .. "en"
  end
  if lower == "thief" then return string.sub(word, 1, len - 1) .. "ves" end
  if last2 == "fe" then
    if lower == "giraffe" then return word .. "s" end
    return string.sub(word, 1, len - 2) .. "ves"
  end
  if last == "f" then
    if string.sub(lower, len - 1, len) == "ff" or last2 == "ef" then return word .. "s" end
    return string.sub(word, 1, len - 1) .. "ves"
  end
  if last2 == "ch" or last2 == "sh" or last2 == "ss" or last == "x" or string.sub(lower, len - 1, len) == "us" then return word .. "es" end
  if last == "s" then return word end
  if last == "y" then
    local before = string.sub(lower, len - 1, len - 1)
    if before ~= "a" and before ~= "e" and before ~= "i" and before ~= "o" and before ~= "u" then
      return string.sub(word, 1, len - 1) .. "ies"
    end
  end
  return word .. "s"
end

-- "X of Y" pluralizes the first part ("Spirit of the Wolf" -> "Spirits of the Wolf"); otherwise the last word.
function ER.GrindPlural(name)
  name = tostring(name or "")
  local _, _, head, tail = string.find(name, "^(.-)( of .*)$")
  if head and head ~= "" then name = head else tail = "" end
  local _, _, front, word = string.find(name, "^(.*[ %-])([^ %-]*)$")
  if not front then front, word = "", name end
  return front .. PluralWord(word) .. tail
end
local Plural = ER.GrindPlural

------------------------------------------------------------------------------------------------------
-- The pool of a visit and the choice by level
------------------------------------------------------------------------------------------------------

-- The spots and the areas of a visit, read once and kept on the guide's info (like the quest flags in RouteRun.lua).
local function SpotsOf(info)
  local made = rawget(info, "spotsOf")
  if made then return made end
  made = ER.RouteReader.ReadSpots(info.visit)
  rawset(info, "spotsOf", made)
  return made
end

local function AreasOf(info)
  local made = rawget(info, "areasOf")
  if made then return made end
  made = ER.RouteReader.ReadVisit(info.visit)
  rawset(info, "areasOf", made)
  return made
end

local function Yellow(code)
  return code == "y" or code == "p"
end

-- The spots of the visit that fit a player of this level, best first: { spot, code, yards, tier }. Yards are from the anchor ax, ay
-- (map percent in the visit's zone; none: 0). A yellow mob may be from GRIND_BELOW levels below you to GRIND_YELLOW_LAST above (one above
-- ranks lower than the rest); a red or unknown one only at your level or GRIND_BELOW below; never grey, never next to a strong mob.
local function Choose(info, level, ax, ay)
  local S = ER.Steps
  local out = {}
  if not info or not info.visit or not S then return out end
  local grey = S.GreyLevel(level)
  for _, spot in ipairs(SpotsOf(info)) do
    local code = spot.code
    local yellow = Yellow(code)
    local fits
    if yellow then
      fits = spot.lo <= level + G.GRIND_YELLOW_LAST and spot.hi >= level - G.GRIND_BELOW
    else
      fits = spot.hi <= level and spot.hi >= level - G.GRIND_BELOW
    end
    local redMax = G.GRIND_RED_MAX_RED
    if yellow then redMax = G.GRIND_RED_MAX_YELLOW end
    if fits and spot.n >= G.GRIND_MIN_SPAWNS and spot.hi > grey
      and (spot.elite == 0 or spot.elite < level - G.GRIND_ELITE_BELOW) and spot.red <= redMax then
      local d = 0
      if ax and ay then d = (S.Yards(info.visit.zone, ax, ay, spot.x, spot.y)) end
      local tier = 3
      if yellow then tier = 0 end
      if d > G.GRIND_FAR then tier = tier + 2 elseif d > G.GRIND_NEAR then tier = tier + 1 end
      if yellow and spot.lo > level + G.GRIND_YELLOW_ABOVE then tier = tier + 0.5 end
      table.insert(out, { spot = spot, code = code, yards = d, tier = tier })
    end
  end
  table.sort(out, function(a, b)
    if a.tier ~= b.tier then return a.tier < b.tier end
    local abig, bbig = 1, 1
    if a.spot.n >= G.GRIND_BIG then abig = 0 end
    if b.spot.n >= G.GRIND_BIG then bbig = 0 end
    if abig ~= bbig then return abig < bbig end
    if a.yards ~= b.yards then return a.yards < b.yards end
    if a.spot.name ~= b.spot.name then return a.spot.name < b.spot.name end
    if a.spot.x ~= b.spot.x then return a.spot.x < b.spot.x end
    return a.spot.y < b.spot.y
  end)
  return out
end

-- For the quick checks: the same choice, from an info, a level and an anchor.
function ER._testGrindChoose(info, level, ax, ay)
  return Choose(info, level, ax, ay)
end

------------------------------------------------------------------------------------------------------
-- The pick for one step
------------------------------------------------------------------------------------------------------

local picks, picksInfo = {}, nil

local function SameText(a, b)
  return a and b and string.lower(a) == string.lower(b)
end

-- Where a grind step is anchored: its at=<x>,<y> flag. A zone-end grind (grind=end) uses where you stand when you are in the visit's
-- zone; a step with no place falls back to the first area of the visit.
local function Anchor(step, info)
  local S = ER.Steps
  local ax, ay
  local _, _, fx, fy = string.find(step.flags.at or "", "^([%d%.]+),([%d%.]+)$")
  if fx then ax, ay = tonumber(fx), tonumber(fy) end
  if step.flags.grind == "end" then
    local zone, px, py = S.Here()
    if zone and SameText(zone, info.visit.zone) and px and py and not (px == 0 and py == 0) then return px, py end
  end
  if not ax then
    local first = AreasOf(info)[1]
    if first then ax, ay = first.x, first.y end
  end
  return ax, ay
end

-- The spot chosen for a grind step: { spot, code, yards, tier }, or nil (no grind flag, the Settings tick is off, not a casual-route visit,
-- nothing fits). Kept per step; chosen again only when your level or the difficulty changes, so the arrow does not jump while you walk.
function ER.GrindPick(step)
  if type(step) ~= "table" or type(step.flags) ~= "table" or not step.flags.grind then return nil end
  if ER.db and ER.db.grindOff then return nil end
  local S = ER.Steps
  local info = S and S.Info()
  if not info or not info.route or not info.visit then return nil end
  local level = UnitLevel("player") or 1
  local mode = ER.Mode and ER.Mode() or "casual"
  if picksInfo ~= info then picks, picksInfo = {}, info end
  local kept = picks[step]
  if kept and kept.level == level and kept.mode == mode then return kept.result end
  local ax, ay = Anchor(step, info)
  local list = Choose(info, level, ax, ay)
  local result = list[1]
  picks[step] = { level = level, mode = mode, result = result or false }
  return result
end

------------------------------------------------------------------------------------------------------
-- Words (no colour codes, no coordinates)
------------------------------------------------------------------------------------------------------

-- The level the step grinds to: its X element.
local function GrindLevel(step)
  for _, e in ipairs(step.elements or {}) do
    if e.kind == "X" and tonumber(e.level) then return tonumber(e.level) end
  end
  return nil
end

-- "near <who>" for the area of the visit nearest to the spot when it is close, else "here".
local function PlaceWord(info, spot)
  local S = ER.Steps
  local best, bestYards
  for _, area in ipairs(AreasOf(info)) do
    if area.x and area.y and area.who and area.who ~= "" then
      local d = (S.Yards(info.visit.zone, area.x, area.y, spot.x, spot.y))
      if not bestYards or d < bestYards then best, bestYards = area, d end
    end
  end
  if best and bestYards <= G.GRIND_NAME_YARDS then return "near " .. best.who end
  return "here"
end

local function LevelWord(spot)
  if spot.lo == spot.hi then return "level " .. spot.lo end
  return "level " .. spot.lo .. "-" .. spot.hi
end

-- Why this spot, in plain words. code is the spot's code now, level your level, yards the walk from where the step is anchored.
local function Reason(spot, code, level, yards)
  local mobs = Plural(spot.name)
  local text
  if code == "y" then
    if spot.lo > level + G.GRIND_YELLOW_ABOVE then
      text = mobs .. " here are a little above you (" .. LevelWord(spot) .. "), but yellow: they won't attack you first."
    elseif spot.red <= G.GRIND_FEW_OTHERS then
      text = mobs .. " here are yellow: they won't attack you, and there are few other mobs around."
    else
      text = mobs .. " here are yellow: they won't attack you first. Other mobs are close by, so keep an eye out."
    end
  elseif code == "p" then
    text = mobs .. " here do not attack unless you attack them first, and no strong mobs are near."
  elseif code == "r" then
    if spot.red <= G.GRIND_FEW_OTHERS then
      text = mobs .. " here attack you, but they are your level or lower, and no strong mobs are near."
    else
      text = mobs .. " here attack you, but they are your level or lower. Other mobs are close by, so keep an eye out."
    end
  else
    text = mobs .. " here are your level (" .. LevelWord(spot) .. "), and no strong mobs are near."
  end
  if yards and yards > G.GRIND_NEAR then
    text = text .. " It is a bit of a walk, but it is the closest spot that fits."
  end
  return text
end

function ER._testGrindReason(spot, code, level, yards)
  return Reason(spot, code, level, yards)
end

-- "Grind Mottled Boars near Gornek until level 2." (the step's line), or nil when the step has no spot.
function ER.GrindText(step)
  local pick = ER.GrindPick(step)
  local info = ER.Steps.Info()
  local to = GrindLevel(step)
  if not pick or not info or not to then return nil end
  return "Grind " .. Plural(pick.spot.name) .. " " .. PlaceWord(info, pick.spot) .. " until level " .. to .. "."
end

-- "Grind Mottled Boars until level 2" (the short name of the step), or nil.
function ER.GrindTitle(step)
  local pick = ER.GrindPick(step)
  local to = GrindLevel(step)
  if not pick or not to then return nil end
  return "Grind " .. Plural(pick.spot.name) .. " until level " .. to
end

-- Where the arrow points: { zone, x, y, text }, or nil.
function ER.GrindTarget(step)
  local pick = ER.GrindPick(step)
  local info = ER.Steps.Info()
  if not pick or not info then return nil end
  return { zone = info.visit.zone, x = pick.spot.x, y = pick.spot.y, text = "Grind " .. Plural(pick.spot.name) }
end

-- The grey reason line under the step in the step box, or nil.
function ER.GrindReasonLine(step)
  local pick = ER.GrindPick(step)
  if not pick then return nil end
  return Reason(pick.spot, pick.code, UnitLevel("player") or 1, pick.yards)
end

ER.Loaded("Grind.lua")
