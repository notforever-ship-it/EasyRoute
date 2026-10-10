-- Easy Route: grind spots. A grind step of the casual route (RouteRun.lua marks it grind=<level> or grind=end, with at=<x>,<y>) gets a
-- real place to grind: the game picks one spot from the visit's pool in Data\Route.lua by your level now, names the mobs, says why
-- in plain words, and points the arrow at it. The pool is made offline by tools/build-route.js; the numbers here are the same ones.
-- Without a spot (the Settings tick is off, or nothing fits) the route's own "Grind to level N" words stay as they are.
-- Bridges (grind=bridge steps, also made by RouteRun.lua) are steps that show only for a player who is behind the plan: see ER.GrindBridgeShows.
-- The data is vanilla and the servers are not, so the game also learns: a mob you target or point at out of a fight is written down as
-- yellow or red (ER.db.reactions, by name, per faction), and what you saw beats the data in the pick.

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
  -- How far from where the step is anchored (yards): the words call a walk of more than NEAR "a bit of a walk" and one of more than FAR
  -- "far away". The pool of a visit holds spots up to GRIND_LAST yards from its areas (the builder's number).
  GRIND_NEAR = 600,
  GRIND_FAR = 1200,
  -- The best spot is the nearest one that fits, as if a spot of red or unknown mobs were GRIND_YELLOW_EXTRA yards farther and a yellow spot
  -- of mobs a little above you GRIND_ABOVE_EXTRA yards farther. So a yellow spot wins over a red one unless it is more than
  -- GRIND_YELLOW_EXTRA yards farther away.
  GRIND_YELLOW_EXTRA = 600,
  GRIND_ABOVE_EXTRA = 300,
  -- Yellow mobs may be this many levels above you (a little above you is ranked lower; two above only when nothing else fits), and
  -- this many levels below you. Red and unknown mobs only at your level or this many below it.
  GRIND_YELLOW_ABOVE = 1,
  GRIND_YELLOW_LAST = 2,
  GRIND_BELOW = 1,
  -- "Few other mobs around" is said up to this many other red spawns. The place word "near <who>" needs the area within this many yards.
  GRIND_FEW_OTHERS = 12,
  GRIND_NAME_YARDS = 500,
  -- A grind bridge needs the quests still wanted to be at least this many levels above you; no bridge for less. Raise it to 2 for fewer bridges.
  BRIDGE_MIN_GAIN = 1,
  -- Names kept per faction in ER.db.reactions (the mobs you saw as yellow or red); when the list is full the oldest go first.
  REACT_CAP = 800,
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
-- What you saw: yellow or red mobs, remembered by name per faction
------------------------------------------------------------------------------------------------------

-- The saved list: ER.db.reactions[<faction>][<name in lower case>] = { k = "y" or "r", t = time, a = 1 or 2 when the mob attacked first }.
-- a = 1 is a soft mark (it happened once): a later yellow look out of a fight clears it. a = 2 (it happened twice, with no yellow look
-- between) sticks as red. Only those three things are written. Whatever is read from it is checked for its type first: a damaged list
-- counts as empty and is made again by the next write. Mobs are kept by name only, so two creatures of one name share one entry.
local changes = 0 -- raised on every change of the list, so a grind pick made before the change is made again

-- The name as it is stored: no colour codes, tabs or line breaks, trimmed, at most 60 letters, lower case. nil when nothing is left.
local function ReactKey(name)
  if type(name) ~= "string" then return nil end
  name = string.gsub(name, "|c%x%x%x%x%x%x%x%x", "")
  name = string.gsub(name, "|r", "")
  name = string.gsub(name, "[|\t\r\n]", " ")
  name = string.gsub(name, "^%s+", "")
  name = string.sub(name, 1, 60)
  name = string.gsub(name, "%s+$", "")
  if name == "" then return nil end
  return string.lower(name)
end

local function Faction()
  local f = UnitFactionGroup("player")
  if f == "Alliance" or f == "Horde" then return f end
  return nil
end

-- The saved list of this faction, or nil when there is none (or it is damaged).
local function KnownList()
  local f = Faction()
  if not f or not ER.db or type(ER.db.reactions) ~= "table" then return nil end
  local list = ER.db.reactions[f]
  if type(list) ~= "table" then return nil end
  return list
end

-- What the list says about a mob name: "y" or "r", and whether it attacked first; nil when it says nothing.
local function Learned(list, name)
  if not list then return nil end
  local key = ReactKey(name)
  local e = key and list[key]
  if type(e) ~= "table" then return nil end
  if e.k == "y" then return "y", false end
  if e.k == "r" then return "r", (tonumber(e.a) or 0) >= 1 end
  return nil
end

local function TimeOf(e)
  return type(e) == "table" and tonumber(e.t) or -1
end

-- Writes down that a mob (by name) was seen yellow ("y") or red ("r"), or attacked first (kind "r", attacked true). A mob that attacked
-- first once is a soft mark: a later yellow look undoes it. One that attacked first twice stays red, whatever it looks like later. A new
-- name when the faction already holds REACT_CAP names pushes the oldest out.
local function Remember(name, kind, attacked)
  local key, f = ReactKey(name), Faction()
  if not key or not f or not ER.db then return end
  if kind ~= "y" and kind ~= "r" then return end
  if type(ER.db.reactions) ~= "table" then ER.db.reactions = {} end
  local all = ER.db.reactions
  if type(all[f]) ~= "table" then all[f] = {} end
  local list = all[f]
  local e = list[key]
  if type(e) == "table" and (e.k == "y" or e.k == "r") then
    local was = tonumber(e.a) or 0
    local a
    if kind == "y" then
      if was >= 2 then return end
    else
      a = was
      if attacked then a = math.min(2, was + 1) end
      if a < 1 then a = nil end
    end
    if e.k ~= kind or e.a ~= a then changes = changes + 1 end
    e.k, e.t, e.a = kind, time(), a
    return
  end
  local count = 0
  for _ in pairs(list) do count = count + 1 end
  if count >= G.REACT_CAP then
    local keys = {}
    for k in pairs(list) do table.insert(keys, k) end
    table.sort(keys, function(x, y)
      local tx, ty = TimeOf(list[x]), TimeOf(list[y])
      if tx ~= ty then return tx < ty end
      return tostring(x) < tostring(y)
    end)
    for i = 1, count - G.REACT_CAP + 1 do list[keys[i]] = nil end
  end
  local a
  if attacked then a = 1 end
  list[key] = { k = kind, t = time(), a = a }
  changes = changes + 1
end

-- Looks at a unit ("target" or "mouseover") and remembers its colour. Only a mob that is not in a fight: in a fight a yellow mob turns
-- red on the screen, and it would be written down wrongly. Not players, pets, critters, dead things or things you cannot attack.
local function Sample(unit)
  if not UnitExists(unit) or UnitIsPlayer(unit) or UnitPlayerControlled(unit) or UnitIsDead(unit) then return end
  if not UnitCanAttack("player", unit) or UnitAffectingCombat(unit) then return end
  if UnitCreatureType(unit) == "Critter" then return end
  local r = UnitReaction(unit, "player")
  if type(r) ~= "number" then return end
  local kind
  if r >= 1 and r <= 3 then kind = "r" elseif r == 4 then kind = "y" end
  if kind then Remember(UnitName(unit), kind) end
end

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

-- The spots of the visit that fit a player of this level, best first: { spot, code, yards, rank }. Yards are from the anchor ax, ay
-- (map percent in the visit's zone; none: 0). A yellow mob may be from GRIND_BELOW levels below you to GRIND_YELLOW_LAST above; a red or
-- unknown one only at your level or GRIND_BELOW below; never grey, never next to a strong mob; a spot has at least GRIND_MIN_SPAWNS spawns.
-- The order is the nearest first, where a red or unknown spot counts GRIND_YELLOW_EXTRA yards farther than it is and a yellow spot of
-- mobs a little above you (more than GRIND_YELLOW_ABOVE levels) counts GRIND_ABOVE_EXTRA farther: rank.
-- What you saw beats the data: a mob you saw yellow takes the yellow rules, one you saw red (or that attacked first) the red rules. With
-- plain set the saved list is left out (the data alone). Each entry carries learned ("y" or "r" when what you saw decided) and first.
local function Choose(info, level, ax, ay, plain)
  local S = ER.Steps
  local out = {}
  if not info or not info.visit or not S then return out end
  local grey = S.GreyLevel(level)
  local known
  if not plain then known = KnownList() end
  for _, spot in ipairs(SpotsOf(info)) do
    local code = spot.code
    local learned, first = Learned(known, spot.name)
    if learned then code = learned end
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
      local rank = d
      if not yellow then
        rank = rank + G.GRIND_YELLOW_EXTRA
      elseif spot.lo > level + G.GRIND_YELLOW_ABOVE then
        rank = rank + G.GRIND_ABOVE_EXTRA
      end
      table.insert(out, { spot = spot, code = code, yards = d, rank = rank, learned = learned, first = first })
    end
  end
  table.sort(out, function(a, b)
    if a.rank ~= b.rank then return a.rank < b.rank end
    local ayellow, byellow = Yellow(a.code), Yellow(b.code)
    if ayellow ~= byellow then return ayellow end
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

-- The spot chosen for a grind step: { spot, code, yards, rank }, or nil (no grind flag, the Settings tick is off, not a casual-route visit,
-- nothing fits). Kept per step; chosen again only when your level or the difficulty changes, or what you saw changes, so the arrow does
-- not jump while you walk. What you saw never takes the last spot away: when it leaves nothing, the best spot of the data is kept and
-- marked warn (the words say to be careful).
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
  if kept and kept.level == level and kept.mode == mode and kept.changes == changes then return kept.result or nil end
  local ax, ay = Anchor(step, info)
  local result = Choose(info, level, ax, ay)[1]
  if not result then
    result = Choose(info, level, ax, ay, true)[1]
    if result then
      local learned, first = Learned(KnownList(), result.spot.name)
      if learned == "r" then result.warn, result.learned, result.first = true, "r", first end
    end
  end
  picks[step] = { level = level, mode = mode, changes = changes, result = result or false }
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

-- Why this spot, in plain words. code is the spot's code now, level your level, yards the walk from where the step is anchored. how is
-- what you saw, when it matters: "y" (seen yellow), "first" (attacked you first), "warn" and "warnfirst" (seen red or attacked first,
-- but the only spot that fits); nil for the data alone, and for a mob seen red that did not attack first (the red words are true).
local function Reason(spot, code, level, yards, how)
  local mobs = Plural(spot.name)
  local text
  if how == "warn" then
    text = "Careful: you saw that " .. mobs .. " attack you. It is the only spot that fits, so fight one at a time."
  elseif how == "warnfirst" then
    text = "Careful: " .. mobs .. " attacked you first last time. It is the only spot that fits, so fight one at a time."
  elseif how == "first" then
    text = "Careful: " .. mobs .. " attacked you first last time. They are your level or lower, and no strong mobs are near."
  elseif how == "y" then
    text = "You saw that " .. mobs .. " are yellow: they won't attack you first."
    if spot.lo > level + G.GRIND_YELLOW_ABOVE then
      text = text .. " They are a little above you (" .. LevelWord(spot) .. ")."
    end
    if spot.red <= G.GRIND_FEW_OTHERS then
      text = text .. " There are few other mobs around."
    else
      text = text .. " Other mobs are close by, so keep an eye out."
    end
  elseif code == "y" then
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
  if yards and yards > G.GRIND_FAR then
    text = text .. " It is far away: a long walk."
  elseif yards and yards > G.GRIND_NEAR then
    text = text .. " It is a bit of a walk."
  end
  return text
end

function ER._testGrindReason(spot, code, level, yards, how)
  return Reason(spot, code, level, yards, how)
end

-- The "how" of a pick (see Reason).
local function HowOf(pick)
  if pick.warn then
    if pick.first then return "warnfirst" end
    return "warn"
  end
  if pick.learned == "r" and pick.first then return "first" end
  if pick.learned == "y" then return "y" end
  return nil
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

-- The first words of a bridge's reason line.
local BRIDGE_WHY = "The next quests are too high for you right now."

-- The grey reason line under the step in the step box, or nil. A bridge says first why it is there.
function ER.GrindReasonLine(step)
  local pick = ER.GrindPick(step)
  if not pick then return nil end
  local text = Reason(pick.spot, pick.code, UnitLevel("player") or 1, pick.yards, HowOf(pick))
  if step.flags.grind == "bridge" then text = BRIDGE_WHY .. " " .. text end
  return text
end

------------------------------------------------------------------------------------------------------
-- Bridges: a grind step before a pick-up for a player who is behind the plan
------------------------------------------------------------------------------------------------------

-- The area number of a bridge step (its rt flag "bridge:<area>").
local function BridgeArea(step)
  local _, _, area = string.find(step.flags.rt or "", "^bridge:(%d+)$")
  return tonumber(area)
end

-- The record of the guide being followed (the saved position), or nil.
local function SavedRecord()
  if not ER.db or type(ER.db.guides) ~= "table" then return nil end
  local saved = ER.db.guides[ER.Char()]
  if type(saved) ~= "table" then return nil end
  return saved
end

-- Asked by ER.RouteStepOut for a bridge step: is it for you now? The quests the step is for (its bq flag) that you still want are worked
-- out: each needs your level to be at least its minimum level and at least its level minus the comfort of the difficulty. The highest of
-- those, never above the top level of the zone, is the level the bridge grinds to. It shows only for a player who is behind the plan: your
-- level is below the level the plan itself has there (the step's pl flag, made by the builder), and the level the bridge grinds to is at
-- least BRIDGE_MIN_GAIN levels above you. And only when the Settings tick is on, when no other bridge of the same area has been current,
-- and when there is a spot. Once it has been current (BridgeLook notes it) it stays, whatever the tick, the plan level or the spots say,
-- until you reach its level or skip it: it then reads as the plain grind step when no spot is left.
-- Side effect, on purpose: it sets the level of the step's X element to that level before it answers. Fits runs before the step is
-- checked for done and before its words are made, so the level shown and the end of the step follow it.
function ER.GrindBridgeShows(step)
  if type(step) ~= "table" or type(step.flags) ~= "table" then return false end
  local S = ER.Steps
  local info = S and S.Info()
  if not info or not info.route or not info.visit then return false end
  local area = BridgeArea(step)
  if not area then return false end
  -- A bridge that has been current (noted in the saved position) stays until its level is reached or you skip it: it does not wait for the
  -- plan level, the Settings tick or a spot any more. Without a spot or with the tick off it shows as the plain grind step.
  local mine = false
  local saved = SavedRecord()
  if saved and type(saved.bridges) == "table" then
    local first = saved.bridges[area]
    if first ~= nil and first ~= step.n then return false end
    mine = first ~= nil
  end
  if not mine and ER.db and ER.db.grindOff then return false end
  local comfort = S.Comfort()
  local need = 0
  for id in string.gfind(step.flags.bq or "", "%d+") do
    id = tonumber(id)
    if not (S.InLog(id) or S.TurnedIn(id) or S.LeftOut(id)) then
      local row = ER.QuestRow and ER.QuestRow(id)
      if row then
        local want = math.max(row.m or 0, (row.l or 0) - comfort)
        if want > need then need = want end
      end
    end
  end
  local top = info.hi or info.visit.hi
  if top and need > top then need = top end
  local level = UnitLevel("player") or 1
  if need - level < G.BRIDGE_MIN_GAIN then return false end
  if not mine then
    local planLevel = tonumber(step.flags.pl)
    if not planLevel or level >= planLevel then return false end
  end
  for _, e in ipairs(step.elements or {}) do
    if e.kind == "X" then e.level = need end
  end
  if not mine and not ER.GrindPick(step) then return false end
  return true
end

-- Once a second: when the step you are on is a bridge, note it in the saved position (the first bridge of an area; a later one of the
-- same area stays hidden) and say once, in one line, why it is there.
local GRIND_EVERY = 1

local function BridgeLook()
  local S = ER.Steps
  if not (S and S.Running()) then return end
  local info = S.Info()
  local cur = S.Current()
  if not info or not info.route or not cur or type(cur.flags) ~= "table" or cur.flags.grind ~= "bridge" then return end
  local area = BridgeArea(cur)
  local saved = SavedRecord()
  if not area or not saved then return end
  if type(saved.bridges) ~= "table" then saved.bridges = {} end
  if saved.bridges[area] ~= nil then return end
  if S.Fits and not S.Fits(cur) then return end
  saved.bridges[area] = cur.n
  ER.Print("The next quests are too high for you right now, so grind first.")
end

-- When what you saw has changed, a grind step on the screen is drawn again (its mob, its words and the arrow follow the new pick).
local seenChanges = 0

local function LearnedLook()
  if changes == seenChanges then return end
  seenChanges = changes
  local S = ER.Steps
  local cur = S and S.Running() and S.Current()
  if type(cur) ~= "table" or type(cur.flags) ~= "table" or not cur.flags.grind then return end
  if ER.StepsChanged then ER.StepsChanged() end
end

local watch = CreateFrame("Frame", "EasyRouteGrindWatch")
watch.wait = 0
watch:SetScript("OnUpdate", function()
  this.wait = this.wait + arg1
  if this.wait < GRIND_EVERY then return end
  this.wait = 0
  BridgeLook()
  LearnedLook()
end)

------------------------------------------------------------------------------------------------------
-- Learning: the mobs you look at
------------------------------------------------------------------------------------------------------

-- The colour of a mob is written down when you target it or point at it, out of a fight, whatever the Settings tick says: the tick only
-- decides whether the guide uses it (D-04a).
-- A backup to the look: a mob that swings at you before you, your pet or anyone in your group has done anything is red, and it attacked
-- first. It reads the fight messages (English game text only; on another language it never fires and the look still works). A swing
-- counts whether it lands or not (hit, crit, miss, or a dodge, parry or block). One fight record at a time: it starts with
-- PLAYER_REGEN_DISABLED or with the first swing at you, and ends with PLAYER_REGEN_ENABLED. When two different names swing first in one
-- fight (a pack pulled by accident: the one you pulled and its neighbour) nothing is written down, since we cannot tell which one it was.
-- Nothing is written down while you are in a group, or when your pet is already fighting: somebody else may have pulled it.
local ACT_WINDOW = 5 -- seconds: something you did just before the fight began still counts as you acting first
local fight, lastAct = nil, nil

local function ActedRecently()
  return lastAct ~= nil and GetTime() - lastAct <= ACT_WINDOW
end

local function Acted()
  lastAct = GetTime()
  if fight then fight.acted = true end
end

local function Grouped()
  return (GetNumPartyMembers and GetNumPartyMembers() or 0) > 0 or (GetNumRaidMembers and GetNumRaidMembers() or 0) > 0
end

local function PetFighting()
  return UnitExists("pet") and UnitAffectingCombat("pet") and true or false
end

local function StartFight()
  if not fight then fight = { acted = ActedRecently(), skip = Grouped(), first = nil, two = false, t = GetTime() } end
  return fight
end

-- The name of the mob in a message like "Scorpid Worker hits you for 3." / "... crits you for 6." / "... misses you." / "... attacks.
-- You dodge." (also parry, block).
local function HitterOf(text)
  if type(text) ~= "string" then return nil end
  local _, _, name = string.find(text, "^(.-) hits you")
  if not name then _, _, name = string.find(text, "^(.-) crits you") end
  if not name then _, _, name = string.find(text, "^(.-) misses you") end
  if not name then _, _, name = string.find(text, "^(.-) attacks%. You ") end
  return ReactKey(name)
end

local function MobHit(text)
  local who = HitterOf(text)
  if not who then return end
  local f = StartFight()
  if f.acted or f.skip then return end
  if not f.first then
    if PetFighting() then
      f.skip = true
      return
    end
    f.first = who
  elseif f.first ~= who then
    f.two = true
  end
end

local function FightEnds()
  if fight and fight.first and not fight.two then Remember(fight.first, "r", true) end
  fight, lastAct = nil, nil
end

local learn = CreateFrame("Frame", "EasyRouteGrindLearn")
learn:RegisterEvent("PLAYER_TARGET_CHANGED")
learn:RegisterEvent("UPDATE_MOUSEOVER_UNIT")
learn:RegisterEvent("PLAYER_REGEN_DISABLED")
learn:RegisterEvent("PLAYER_REGEN_ENABLED")
learn:RegisterEvent("PLAYER_ENTER_COMBAT")
learn:RegisterEvent("SPELLCAST_START")
learn:RegisterEvent("CHAT_MSG_COMBAT_SELF_HITS")
learn:RegisterEvent("CHAT_MSG_COMBAT_SELF_MISSES")
learn:RegisterEvent("CHAT_MSG_SPELL_SELF_DAMAGE")
learn:RegisterEvent("CHAT_MSG_SPELL_SELF_BUFF")
learn:RegisterEvent("START_AUTOREPEAT_SPELL")
learn:RegisterEvent("CHAT_MSG_COMBAT_PET_HITS")
learn:RegisterEvent("CHAT_MSG_COMBAT_PET_MISSES")
learn:RegisterEvent("CHAT_MSG_SPELL_PET_DAMAGE")
learn:RegisterEvent("CHAT_MSG_COMBAT_CREATURE_VS_SELF_HITS")
learn:RegisterEvent("CHAT_MSG_COMBAT_CREATURE_VS_SELF_MISSES")
learn:SetScript("OnEvent", function()
  if not ER.db then return end
  if event == "PLAYER_TARGET_CHANGED" then
    Sample("target")
  elseif event == "UPDATE_MOUSEOVER_UNIT" then
    Sample("mouseover")
  elseif event == "PLAYER_REGEN_DISABLED" then
    -- a record that is already there is the first hit a moment ago; an older one is left over from a hit line after the last fight
    if fight and GetTime() - fight.t > ACT_WINDOW then fight = nil end
    StartFight()
  elseif event == "PLAYER_REGEN_ENABLED" then
    FightEnds()
  elseif event == "PLAYER_ENTER_COMBAT" or event == "SPELLCAST_START" or event == "CHAT_MSG_COMBAT_SELF_HITS"
    or event == "CHAT_MSG_COMBAT_SELF_MISSES" or event == "CHAT_MSG_SPELL_SELF_DAMAGE" or event == "CHAT_MSG_SPELL_SELF_BUFF"
    or event == "START_AUTOREPEAT_SPELL" or event == "CHAT_MSG_COMBAT_PET_HITS" or event == "CHAT_MSG_COMBAT_PET_MISSES"
    or event == "CHAT_MSG_SPELL_PET_DAMAGE" then
    Acted()
  elseif event == "CHAT_MSG_COMBAT_CREATURE_VS_SELF_HITS" or event == "CHAT_MSG_COMBAT_CREATURE_VS_SELF_MISSES" then
    MobHit(arg1)
  end
end)

ER.Loaded("Grind.lua")
