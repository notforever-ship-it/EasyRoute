-- Easy Route: watches your quest log and writes the journal. Accepts, turn-ins, abandons, deaths,
-- level-ups and zone changes each get a line with where you were. A turn-in also opens the
-- "how was this quest?" popup.
--
-- It also keeps the story of each quest, so "what did I do in this one?" has an answer: who gave it
-- and where, each objective with the place it was done and the mobs that counted for it, how long it
-- took, deaths, and who took it back. The places come from where you stood each time an objective
-- ticked up; the mobs from the kill that happened just before the tick.
--
-- The 1.12 client has no "quest accepted" or "quest turned in" event and no quest IDs, so the log
-- is compared with the last look at it whenever it changes. The quest window's Accept and Complete
-- buttons are hooked to tell a turn-in apart from an abandon.

local ER = EasyRoute
local R = {}
ER.Recorder = R

local known, knownCount = {}, nil     -- quests in the log at the last full read: [title] = info
local seeded = false
local enteredAt = nil                 -- GetTime() at PLAYER_ENTERING_WORLD
local pendingAccept, pendingTurnIn, turnInTitle = nil, nil, nil
local pendingNPC, pendingPlace, turnInNPC = nil, nil, nil
local lastKill = nil                  -- { name, at }: the last thing that died near you
local scanAt = nil
local lastZone = nil

local GRACE = 5      -- seconds after entering the world during which the log is only read, not compared
local WINDOW = 5     -- seconds after Accept / Complete during which the hook stamp is trusted
local DELAY = 0.3    -- quest log updates come in bursts; wait this long and read once

function R.Known() return known end

-- Quest ID from pfQuest's database when it is installed, nil otherwise.
local function QuestID(index)
  if not (pfDatabase and type(pfDatabase.GetQuestIDs) == "function") then return nil end
  local ok, ids = pcall(pfDatabase.GetQuestIDs, pfDatabase, index)
  if not ok or type(ids) ~= "table" then return nil end
  if type(ids[1]) == "number" then return ids[1] end
  for k in pairs(ids) do
    if type(k) == "number" then return k end
  end
  return nil
end

local function Objectives(index)
  local list = {}
  local n = GetNumQuestLeaderBoards(index) or 0
  for j = 1, n do
    local text = GetQuestLogLeaderBoard(j, index)
    if text then table.insert(list, text) end
  end
  return list
end

-- What tells one quest from another with the same title: the objectives' names and the quest level.
local function Signature(lines, level)
  local names = {}
  for _, line in ipairs(lines) do
    local _, _, name = string.find(line, "^(.-):%s*%d+%s*/%s*%d+%s*$")
    table.insert(names, name or line)
  end
  return (level or 0) .. "|" .. table.concat(names, "|")
end

-- What the quest asks for in its own words, the short text at the top of a quest in the log: "Bring 8
-- Torn Murloc Fins to Guard Thomas at the Eastvale Logging Camp." Reading it means picking the quest in
-- the log for a moment; the pick is put back right after.
local function AskText(index)
  local ok, text = pcall(function()
    local selected = GetQuestLogSelection()
    SelectQuestLogEntry(index)
    local _, objectives = GetQuestLogQuestText()
    if selected and selected > 0 then SelectQuestLogEntry(selected) end
    return objectives
  end)
  if not ok or type(text) ~= "string" then return nil end
  text = ER.Trim(string.gsub(text, "%s+", " "))
  if text == "" then return nil end
  if string.len(text) > 240 then text = string.sub(text, 1, 237) .. "..." end
  return text
end

------------------------------------------------------------------------------------------------------
-- The story of a quest: where it came from, where each objective was done, how it ended
------------------------------------------------------------------------------------------------------

local function Place(zone, sub)
  if sub and sub ~= "" and sub ~= zone then return sub .. " (" .. zone .. ")" end
  return zone
end

local function PlaceNow()
  local zone, sub = ER.Where()
  return Place(zone, sub)
end

-- The names with the biggest counts, as "name" or "name x3".
local function TopKeys(counts, max, withCounts)
  local list = {}
  for k, n in pairs(counts or {}) do table.insert(list, { k = k, n = n }) end
  table.sort(list, function(a, b)
    if a.n ~= b.n then return a.n > b.n end
    return a.k < b.k
  end)
  local out = {}
  for i = 1, math.min(max, table.getn(list)) do
    if withCounts then table.insert(out, list[i].k .. " x" .. list[i].n) else table.insert(out, list[i].k) end
  end
  return out
end

-- An objective ticked up: remember where you stood, and what you had just killed.
local function Progressed(o, steps)
  local zone, sub, x, y = ER.Where()
  local place = Place(zone, sub)
  o.places[place] = (o.places[place] or 0) + steps
  if not o.x then o.x, o.y, o.zone = x, y, zone end
  if lastKill and GetTime() - lastKill.at < 8 then
    o.mobs[lastKill.name] = (o.mobs[lastKill.name] or 0) + steps
  end
end

-- Reads the objectives of a quest in the log and notes any that moved since the last look.
local function TrackProgress(title, index)
  local a = R.Active()[title]
  if not a then return end
  if type(a.objs) ~= "table" then a.objs = {} end
  local n = GetNumQuestLeaderBoards(index) or 0
  for j = 1, n do
    local text, kind, finished = GetQuestLogLeaderBoard(j, index)
    if text then
      local _, _, name, have, need = string.find(text, "^(.-):%s*(%d+)%s*/%s*(%d+)%s*$")
      have, need = tonumber(have), tonumber(need)
      if not name or name == "" then name = text end
      local o = a.objs[j]
      if not o then
        a.objs[j] = { name = name, kind = kind, have = have or 0, need = need, done = finished and true or false, places = {}, mobs = {} }
      else
        o.name, o.kind = name, kind
        if need then o.need = need end
        local steps = 0
        if have and have > (o.have or 0) then steps = have - (o.have or 0)
        elseif finished and not o.done then steps = 1 end
        if steps > 0 then Progressed(o, steps) end
        if have then o.have = have end
        o.done = finished and true or false
      end
    end
  end
end

local function StoryOf(a)
  if not a then return nil end
  return { from = a.from, fromPlace = a.fromPlace, startLevel = a.startLevel, at = a.at, unknownStart = a.unknownStart,
    objs = a.objs, deaths = a.deaths, close = a.close }
end

------------------------------------------------------------------------------------------------------
-- pfQuest's database, when it is installed: who gives a quest and takes it back, and where the things
-- it asks for are found. That way a quest the addon never watched you do still gets a reminder.
-- Spawn points carry a map id; the zones table holds named areas inside each map as rectangles
-- (map, width, height, centre x, centre y), which is how "around Crystal Lake" is found for a spot.
------------------------------------------------------------------------------------------------------

local dbFacts = {}       -- [quest id] = facts, or false when the database has nothing

local function Loc(db)
  local t = pfDB and pfDB[db]
  return t and (t.loc or t.enUS)
end

local function Data(db)
  local t = pfDB and pfDB[db]
  return t and t.data
end

-- The smallest named area around a spot on a map, or nil.
local function AreaAt(map, x, y)
  local zones, names = Data("zones"), Loc("zones")
  if not zones or not names then return nil end
  local best, bestSize = nil, nil
  for id, z in pairs(zones) do
    if type(z) == "table" and z[1] == map and names[id] and z[2] and z[3] and z[4] and z[5] then
      if math.abs(x - z[4]) <= z[2] / 2 and math.abs(y - z[5]) <= z[3] / 2 then
        local size = z[2] * z[3]
        if not bestSize or size < bestSize then best, bestSize = names[id], size end
      end
    end
  end
  return best
end

-- Where a creature or object is found: the map with most of its spawns, the spawn nearest the middle
-- of them, and the named area around it. { map, area, x, y } or nil.
local function Whereabouts(db, id)
  local data = Data(db)
  local e = data and data[id]
  if not e or type(e.coords) ~= "table" or not e.coords[1] then return nil end
  local count, sumX, sumY, best = {}, {}, {}, nil
  for _, c in ipairs(e.coords) do
    local map = c[3]
    if map then
      count[map] = (count[map] or 0) + 1
      sumX[map] = (sumX[map] or 0) + c[1]
      sumY[map] = (sumY[map] or 0) + c[2]
      if not best or count[map] > count[best] then best = map end
    end
  end
  if not best then return nil end
  local mx, my = sumX[best] / count[best], sumY[best] / count[best]
  local x, y, dist = mx, my, nil
  for _, c in ipairs(e.coords) do
    if c[3] == best then
      local d = (c[1] - mx) * (c[1] - mx) + (c[2] - my) * (c[2] - my)
      if not dist or d < dist then x, y, dist = c[1], c[2], d end
    end
  end
  x, y = math.floor(x + 0.5), math.floor(y + 0.5)
  local names = Loc("zones")
  return { map = (names and names[best]) or ("map " .. best), area = AreaAt(best, x, y), x = x, y = y }
end

-- What drops an item, best chances first.
local function ItemSources(itemId, max)
  local items = Data("items")
  local e = items and items[itemId]
  if not e then return {} end
  local list = {}
  local units, objects = Loc("units"), Loc("objects")
  for id, chance in pairs(e.U or {}) do
    if units and units[id] then table.insert(list, { db = "units", id = id, name = units[id], chance = chance or 0 }) end
  end
  for id, chance in pairs(e.O or {}) do
    if objects and objects[id] then table.insert(list, { db = "objects", id = id, name = objects[id], chance = chance or 0 }) end
  end
  table.sort(list, function(a, b)
    if a.chance ~= b.chance then return a.chance > b.chance end
    return a.name < b.name
  end)
  local out = {}
  for i = 1, math.min(max, table.getn(list)) do table.insert(out, list[i]) end
  return out
end

-- Everything the database says about one quest, worked out once.
local function QuestFacts(pfid)
  if not pfid then return nil end
  if dbFacts[pfid] ~= nil then return dbFacts[pfid] or nil end
  local quests = Data("quests")
  local q = quests and quests[pfid]
  if not q then
    dbFacts[pfid] = false
    return nil
  end
  local units, objects, items = Loc("units"), Loc("objects"), Loc("items")
  local facts = { objectives = {} }
  local function Person(list)
    local id = type(list) == "table" and type(list.U) == "table" and list.U[1]
    if id and units and units[id] then return { name = units[id], where = Whereabouts("units", id) } end
    return nil
  end
  facts.giver = Person(q.start)
  facts.taker = Person(q["end"])
  if type(q.obj) == "table" then
    for _, id in ipairs(q.obj.U or {}) do
      if units and units[id] then facts.objectives[string.lower(units[id])] = { kind = "monster", where = Whereabouts("units", id) } end
    end
    for _, id in ipairs(q.obj.O or {}) do
      if objects and objects[id] then facts.objectives[string.lower(objects[id])] = { kind = "object", where = Whereabouts("objects", id) } end
    end
    for _, id in ipairs(q.obj.I or {}) do
      if items and items[id] then
        local sources = ItemSources(id, 3)
        facts.objectives[string.lower(items[id])] = { kind = "item", sources = sources,
          where = sources[1] and Whereabouts(sources[1].db, sources[1].id) }
      end
    end
  end
  dbFacts[pfid] = facts
  return facts
end

-- "around Crystal Lake in Elwynn Forest", or the map and a spot when no area is named.
local function Around(w, coords)
  if not w then return nil end
  local text
  if w.area then text = "around " .. w.area .. " in " .. w.map else text = "in " .. w.map .. " around (" .. w.x .. ", " .. w.y .. ")" end
  if coords and w.area then text = text .. " (" .. w.x .. ", " .. w.y .. ")" end
  return text
end

------------------------------------------------------------------------------------------------------
-- The story in sentences, the way a friend would remind you
------------------------------------------------------------------------------------------------------

-- "a", "a and b", "a, b and c"
local function Join(list)
  local n = table.getn(list)
  if n == 0 then return "" end
  if n == 1 then return list[1] end
  return table.concat(list, ", ", 1, n - 1) .. " and " .. list[n]
end

-- "Collect 8 fins" -> "collect 8 fins"; a name at the start ("Marshal Dughan") is left alone.
local function Lower(s)
  local second = string.sub(s, 2, 2)
  if second ~= "" and second ~= string.lower(second) then return s end
  return string.lower(string.sub(s, 1, 1)) .. string.sub(s, 2)
end

-- Objectives from the plain texts saved at accept ("Torn Murloc Fin: 0/8"), for a quest whose story
-- has none of its own.
local function ObjsFromTexts(texts)
  local objs = {}
  for _, line in ipairs(texts or {}) do
    local _, _, name, have, need = string.find(line, "^(.-):%s*(%d+)%s*/%s*(%d+)%s*$")
    if name and name ~= "" then
      table.insert(objs, { name = name, have = tonumber(have), need = tonumber(need), places = {}, mobs = {} })
    elseif line ~= "" then
      table.insert(objs, { name = line, places = {}, mobs = {} })
    end
  end
  return objs
end

-- done: the quest is handed in. coords: map positions after the places, for the export. pfid and
-- objTexts let the database and the objectives saved at accept fill in what the story lacks.
function R.StoryParts(s, done, coords, pfid, objTexts)
  s = s or {}
  local parts = {}
  local facts = QuestFacts(pfid)

  if s.from or s.fromPlace then
    local line = s.from or "Someone"
    if s.fromPlace then line = line .. " in " .. s.fromPlace end
    line = line .. " gave you this"
    if s.startLevel then line = line .. " at level " .. s.startLevel end
    table.insert(parts, line .. ".")
  elseif facts and facts.giver then
    local line = "It comes from " .. facts.giver.name
    local where = Around(facts.giver.where, coords)
    if where then line = line .. " " .. where end
    table.insert(parts, line .. ".")
  elseif s.unknownStart then
    table.insert(parts, "It was already in your log when Easy Route started.")
  end

  local objs = s.objs
  if not (objs and objs[1]) then objs = ObjsFromTexts(objTexts) end
  local j = 1
  while objs[j] do
    local o = objs[j]
    local _, _, mob = string.find(o.name, "^(.-)%s+slain$")
    local kills = (o.kind == "monster") or (mob ~= nil)
    local base = mob or o.name
    local finished = done or o.done
    local line
    if o.need then
      line = (finished and "You had to " or "You have to ") .. Lower(ER.Phrase(o.name, o.need, o.kind, nil))
      if not finished then line = line .. ", " .. (o.have or 0) .. " so far" end
    else
      line = (finished and "You had to " or "You have to ") .. Lower(o.name)
    end
    line = line .. "."
    local it = (o.need and o.need > 1) and "them" or "it"
    local places = TopKeys(o.places, 2)
    local mobs = {}
    if not kills then mobs = TopKeys(o.mobs, 3, true) end
    if table.getn(places) > 0 then
      line = line .. " " .. (kills and "You did that" or ("You got " .. it)) .. " at " .. Join(places)
      if coords and o.x then line = line .. " [" .. o.x .. ", " .. o.y .. "]" end
      if table.getn(mobs) > 0 then line = line .. ", from " .. Join(mobs) end
      line = line .. "."
    elseif table.getn(mobs) > 0 then
      line = line .. " You got " .. it .. " from " .. Join(mobs) .. "."
    end
    -- Not watched by the addon: what the database says about where and from what.
    local f = facts and facts.objectives[string.lower(base)]
    if f and table.getn(places) == 0 then
      local where = Around(f.where, coords)
      if f.kind == "item" and f.sources and f.sources[1] then
        local names = {}
        for _, src in ipairs(f.sources) do table.insert(names, ER.Plural(src.name, 2)) end
        line = line .. " " .. ((it == "them") and "They drop" or "It drops") .. " from " .. Join(names)
        if where then line = line .. ", " .. where end
        line = line .. "."
      elseif where then
        if f.kind == "monster" then
          line = line .. " " .. ((it == "them") and "They live " or "It lives ") .. where .. "."
        else
          line = line .. " You find " .. it .. " " .. where .. "."
        end
      end
    end
    table.insert(parts, line)
    j = j + 1
  end

  local mins = s.mins
  if not mins and s.at and not s.unknownStart then mins = math.floor((time() - s.at) / 60 + 0.5) end
  local span = ER.Span(mins)
  local bits = {}
  if (s.deaths or 0) > 0 then table.insert(bits, "you died " .. (s.deaths == 1 and "once" or (s.deaths .. " times"))) end
  if (s.close or 0) > 0 then table.insert(bits, "you got low on health " .. (s.close == 1 and "once" or (s.close .. " times"))) end
  if span then
    local line = done and ("It took " .. span) or ("It has been in your log for " .. span)
    if table.getn(bits) > 0 then line = line .. " and " .. Join(bits) end
    table.insert(parts, line .. ".")
  elseif table.getn(bits) > 0 then
    local text = Join(bits)
    table.insert(parts, string.upper(string.sub(text, 1, 1)) .. string.sub(text, 2) .. ".")
  end

  if done and (s.to or s.toPlace) then
    local line = "You handed it in"
    if s.to then line = line .. " to " .. s.to end
    if s.toPlace then line = line .. " in " .. s.toPlace end
    if s.donelevel then line = line .. " at level " .. s.donelevel end
    table.insert(parts, line .. ".")
  elseif facts and facts.taker then
    local line = "It goes back to " .. facts.taker.name
    local where = Around(facts.taker.where, coords)
    if where then line = line .. " " .. where end
    table.insert(parts, line .. ".")
  end
  return parts
end

function R.StoryText(s, done, coords, pfid, objTexts)
  local parts = R.StoryParts(s, done, coords, pfid, objTexts)
  if table.getn(parts) == 0 then return nil end
  return table.concat(parts, " ")
end

-- What the quest asked for in its own words: saved when it was accepted, else pfQuest's copy.
function R.Ask(info, pfid)
  if info and type(info.ask) == "string" and info.ask ~= "" then return info.ask end
  local loc = Loc("quests")
  local q = loc and pfid and loc[pfid]
  if q and type(q.O) == "string" and q.O ~= "" then return q.O end
  return nil
end

-- The objectives in one line: "Kill 8 Prowlers (3 so far), Kill 5 Young Forest Bears".
function R.ObjectivesLine(s, done, objTexts)
  local objs = s and s.objs
  if not (objs and objs[1]) then objs = ObjsFromTexts(objTexts) end
  local lines = {}
  local j = 1
  while objs[j] do
    local o = objs[j]
    local finished = done or o.done
    if o.need then
      local have = nil
      if not finished then have = o.have or 0 end
      table.insert(lines, ER.Phrase(o.name, o.need, o.kind, have))
    else
      table.insert(lines, o.name .. (finished and "" or " (not yet)"))
    end
    j = j + 1
  end
  if table.getn(lines) == 0 then return nil end
  return table.concat(lines, ", ")
end

-- One short line of what you did: where, how long, deaths. "Done at Crystal Lake (Elwynn Forest), 16 min."
-- When the addon watched none of it, where the database puts the first objective.
function R.ShortStory(s, done, pfid)
  local bits = {}
  local places, seen = {}, {}
  local j = 1
  while s and s.objs and s.objs[j] do
    for _, p in ipairs(TopKeys(s.objs[j].places, 1)) do
      if not seen[p] and table.getn(places) < 2 then
        seen[p] = true
        table.insert(places, p)
      end
    end
    j = j + 1
  end
  if table.getn(places) > 0 then
    table.insert(bits, (done and "Done at " or "So far at ") .. Join(places))
  else
    local facts = QuestFacts(pfid)
    if facts then
      for _, f in pairs(facts.objectives) do
        local where = Around(f.where)
        if where then
          table.insert(bits, string.upper(string.sub(where, 1, 1)) .. string.sub(where, 2))
          break
        end
      end
    end
  end
  local mins = s and s.mins
  if not mins and s and s.at and not s.unknownStart then mins = math.floor((time() - s.at) / 60 + 0.5) end
  local span = ER.Span(mins)
  if span then table.insert(bits, done and span or ("in your log for " .. span)) end
  if s and (s.deaths or 0) > 0 then table.insert(bits, "died " .. (s.deaths == 1 and "once" or (s.deaths .. " times"))) end
  if table.getn(bits) == 0 then return nil end
  local text = table.concat(bits, ", ")
  return string.upper(string.sub(text, 1, 1)) .. string.sub(text, 2) .. "."
end

------------------------------------------------------------------------------------------------------
-- Quest chains, from pfQuest's database when it is installed. Each quest there lists the quests that
-- must be done before it ("pre"); the follow-ups are indexed once from that, the other way round.
------------------------------------------------------------------------------------------------------

local followUps = nil    -- [quest id] = the first quest that has it as a prerequisite

local function QuestData()
  return pfDB and pfDB.quests and pfDB.quests.data
end

local function QuestTitle(id)
  local loc = pfDB and pfDB.quests and (pfDB.quests.loc or pfDB.quests.enUS)
  local e = loc and loc[id]
  return e and e.T
end

local function IndexFollowUps()
  followUps = {}
  local data = QuestData()
  if not data then return end
  for id, q in pairs(data) do
    if type(q.pre) == "table" then
      for _, p in ipairs(q.pre) do
        if type(id) == "number" and (not followUps[p] or id < followUps[p]) then followUps[p] = id end
      end
    end
  end
end

-- Where a quest sits in its chain: step, total, the next quest's title, the previous one's. nil when
-- it is on its own or pfQuest is not there.
function R.Chain(pfid)
  local data = QuestData()
  if not pfid or not data or not data[pfid] then return nil end
  if not followUps then IndexFollowUps() end
  local seen = { [pfid] = true }
  local before, prevId, id = 0, nil, pfid
  while data[id] and type(data[id].pre) == "table" and data[id].pre[1] and not seen[data[id].pre[1]] and before < 30 do
    id = data[id].pre[1]
    if before == 0 then prevId = id end
    seen[id] = true
    before = before + 1
  end
  local after, nextId = 0, nil
  id = pfid
  while followUps[id] and not seen[followUps[id]] and after < 30 do
    id = followUps[id]
    if after == 0 then nextId = id end
    seen[id] = true
    after = after + 1
  end
  local total = before + 1 + after
  if total <= 1 then return nil end
  return before + 1, total, nextId and QuestTitle(nextId), prevId and QuestTitle(prevId)
end

function R.ChainText(pfid)
  local step, total = R.Chain(pfid)
  if step then return step .. "/" .. total end
  return nil
end

-- Every quest in the log, including those under collapsed headers. Collapsed headers are opened
-- for the read and closed again, from the bottom up so the indexes stay valid.
local function FullScan()
  local numEntries, numQuests = GetNumQuestLogEntries()
  numEntries, numQuests = numEntries or 0, numQuests or 0
  local collapsed, hidden, visible = {}, false, 0
  for i = 1, numEntries do
    local title, _, _, isHeader, isCollapsed = GetQuestLogTitle(i)
    if isHeader then
      if isCollapsed and title then
        collapsed[title] = true
        hidden = true
      end
    elseif title then
      visible = visible + 1
    end
  end
  hidden = hidden and visible < numQuests
  if hidden then ExpandQuestHeader(0) end
  local quests = {}
  numEntries = GetNumQuestLogEntries() or 0
  for i = 1, numEntries do
    local title, level, tag, isHeader, _, isComplete = GetQuestLogTitle(i)
    if title and not isHeader then
      local info = { qlevel = level, tag = tag, complete = (isComplete and isComplete ~= -1) and true or false }
      local lines = Objectives(i)
      info.sig = Signature(lines, level)
      local old = known[title]
      local same = old and old.sig == info.sig
      if same then
        info.obj, info.pfid, info.ask = old.obj, old.pfid, old.ask
      else
        info.obj = lines
        info.pfid = QuestID(i)
        info.ask = AskText(i)
      end
      quests[title] = info
      -- A quest just replaced by another of the same title gets its own record first (see Diff).
      if not old or same then TrackProgress(title, i) end
    end
  end
  if hidden then
    for i = GetNumQuestLogEntries() or 0, 1, -1 do
      local title, _, _, isHeader = GetQuestLogTitle(i)
      if isHeader and title and collapsed[title] then CollapseQuestHeader(i) end
    end
  end
  return quests, numQuests
end

-- Refreshes the complete flags of what is visible. Cheap, so it runs on every quest log update.
local function VisibleRefresh()
  local numEntries = GetNumQuestLogEntries() or 0
  for i = 1, numEntries do
    local title, level, tag, isHeader, _, isComplete = GetQuestLogTitle(i)
    if title and not isHeader and known[title] then
      known[title].complete = (isComplete and isComplete ~= -1) and true or false
      known[title].qlevel = level
      known[title].tag = tag
      TrackProgress(title, i)
    end
  end
end

-- What this character is carrying right now, saved between sessions: when each quest was taken
-- and how many deaths happened while it was in the log.
function R.Active()
  local c = ER.Char()
  if type(ER.db.active[c]) ~= "table" then ER.db.active[c] = {} end
  return ER.db.active[c]
end

-- Rating info for a quest: its level and tag plus what the journal knows about your time on it.
function R.InfoFor(title, info)
  info = info or {}
  local a = R.Active()[title]
  local pfid = info.pfid or (a and a.pfid)
  local out = { qlevel = info.qlevel, tag = info.tag, pfid = pfid, obj = info.obj, desc = info.desc,
    chain = R.ChainText(pfid), deaths = (a and a.deaths) or 0, close = (a and a.close) or 0, donelevel = UnitLevel("player") }
  if a and a.at and not a.unknownStart then out.mins = math.floor((time() - a.at) / 60 + 0.5) end
  local story = StoryOf(a)
  out.story = story
  out.ask = R.Ask(info, pfid)
  out.what = R.ObjectivesLine(story, false, info.obj)
  out.did = R.ShortStory(story, false, pfid)
  return out
end

local function OnAccept(title, info)
  local act = R.Active()
  local fresh = pendingAccept and GetTime() - pendingAccept < WINDOW
  act[title] = { at = time(), qlevel = info.qlevel, tag = info.tag, deaths = 0, close = 0, pfid = info.pfid,
    from = fresh and pendingNPC or nil, fromPlace = (fresh and pendingPlace) or PlaceNow(), startLevel = UnitLevel("player"), objs = {} }
  local step, total, nextTitle = R.Chain(info.pfid)
  ER.Log("accept", { title = title, qlevel = info.qlevel, tag = info.tag, obj = info.obj, ask = info.ask, pfid = info.pfid,
    chain = step and (step .. "/" .. total) or nil })
  if step then
    local line = ER.GOLD .. title .. ER.END .. " is a chain quest: step " .. step .. " of " .. total
    if nextTitle then line = line .. ER.GREY .. " (next: " .. nextTitle .. ")" .. ER.END end
    ER.Print(line .. ".")
    -- The first quest of a chain gets a popup too, so you know what you are starting.
    if step == 1 and ER.db.chainPopup and ER.ShowChainNotice then ER.ShowChainNotice(title, total, nextTitle) end
  end
end

local function OnRemove(title, info, turnedIn)
  local act = R.Active()
  local a = act[title]
  act[title] = nil
  local mins = nil
  local deaths = (a and a.deaths) or 0
  local close = (a and a.close) or 0
  if a and a.at and not a.unknownStart then mins = math.floor((time() - a.at) / 60 + 0.5) end
  local pfid = info.pfid or (a and a.pfid)
  local chain = R.ChainText(pfid)
  local plevel = UnitLevel("player")
  local story = StoryOf(a)
  if story then
    story.mins = mins
    if turnedIn then
      story.to = turnInNPC
      story.toPlace = PlaceNow()
      story.donelevel = plevel
    end
  end
  local ask = R.Ask(info, pfid)
  local what = R.ObjectivesLine(story, turnedIn, info.obj)
  local did = R.ShortStory(story, turnedIn, pfid)
  ER.Log(turnedIn and "turnin" or "abandon",
    { title = title, qlevel = info.qlevel, tag = info.tag, mins = mins, deaths = deaths, close = close, pfid = pfid,
      obj = info.obj, ask = ask, chain = chain, story = story, did = did, long = R.StoryText(story, turnedIn, nil, pfid, info.obj) })
  if not turnedIn then return end
  -- Rated while it was still in the log? The level it was actually finished at is the one that counts,
  -- and the finished story replaces the one so far.
  local rated = ER.GetRating(title, pfid)
  if rated then
    if not rated.donelevelManual then rated.donelevel = plevel end
    rated.story, rated.did, rated.ask = story, did, ask
  end
  -- Let the party know, when there is one.
  if ER.db.partyAnnounce and (GetNumPartyMembers() or 0) > 0 then
    local msg = "I've done " .. title
    if what then msg = msg .. " (" .. what .. ")" end
    pcall(SendChatMessage, msg .. ".", "PARTY")
  end
  -- The popup, when it is on, only asks about quests you have not rated yet. One you filled in from
  -- the quest log beforehand is settled, so it just gets the line below.
  if ER.db.autoPrompt and ER.OpenRate and not rated then
    ER.OpenRate(title, { qlevel = info.qlevel, tag = info.tag, mins = mins, deaths = deaths, close = close, pfid = pfid,
      obj = info.obj, ask = ask, what = what, chain = chain, donelevel = plevel, story = story, did = did })
    return
  end
  -- One line so you remember what the quest was, with the quest's own words under it.
  local line = ER.GOLD .. title .. ER.END .. " handed in at level " .. plevel
  if what then line = line .. ER.GREY .. " (" .. what .. ")" .. ER.END end
  if rated then
    line = line .. ". Rated " .. ER.Coloured(rated.rating) .. "."
  else
    line = line .. ". Not rated yet, it waits in " .. ER.GOLD .. "/er" .. ER.END .. "."
  end
  ER.Print(line)
  if ask then ER.Print(ER.GREY .. "  \"" .. ask .. "\"" .. ER.END) end
  if did then ER.Print(ER.GREY .. "  " .. did .. ER.END) end
end

-- First read after logging in: remember what is in the log and line the character's list up with
-- it, without writing accept or turn-in lines for things that happened while the addon was off.
local function Seed(quests, count)
  local act = R.Active()
  for title, info in pairs(quests) do
    if not act[title] then
      act[title] = { at = time(), qlevel = info.qlevel, tag = info.tag, deaths = 0, close = 0, pfid = info.pfid, unknownStart = true, objs = {} }
    end
  end
  for title in pairs(act) do
    if not quests[title] then act[title] = nil end
  end
  known, knownCount, seeded = quests, count, true
end

local function Diff()
  local quests, count = FullScan()
  if not seeded or (enteredAt and GetTime() - enteredAt < GRACE) then
    Seed(quests, count)
    if ER.RefreshWindow then ER.RefreshWindow() end
    return
  end
  local now = GetTime()
  local function TurnedIn(title)
    if pendingTurnIn and now - pendingTurnIn < WINDOW then return (not turnInTitle) or (turnInTitle == title) end
    return false
  end
  for title, info in pairs(quests) do
    local old = known[title]
    if not old then
      OnAccept(title, info)
    elseif old.sig and info.sig and old.sig ~= info.sig then
      -- The same title, but another quest: a chain step handed in and the next one taken in one go
      -- (the paladin's Tome of Divinity), which looks like no change at all when only titles are compared.
      OnRemove(title, old, TurnedIn(title))
      OnAccept(title, info)
    end
  end
  for title, info in pairs(known) do
    if not quests[title] then OnRemove(title, info, TurnedIn(title)) end
  end
  known, knownCount = quests, count
  pendingAccept, pendingTurnIn, turnInTitle, pendingNPC, pendingPlace, turnInNPC = nil, nil, nil, nil, nil, nil
  if ER.RefreshWindow then ER.RefreshWindow() end
end

local function Scan()
  if not ER.db then return end
  local _, count = GetNumQuestLogEntries()
  count = count or 0
  local now = GetTime()
  local hooked = (pendingAccept and now - pendingAccept < WINDOW) or (pendingTurnIn and now - pendingTurnIn < WINDOW)
  if not seeded or count ~= knownCount or hooked or (enteredAt and now - enteredAt < GRACE) then
    Diff()
  else
    VisibleRefresh()
  end
end

local function ScheduleScan()
  scanAt = GetTime() + DELAY
end

function R.Refresh()
  if seeded then VisibleRefresh() end
end

-- The quest picked in the quest log window, for /er rate and the quick /er hard commands.
function R.SelectedQuest()
  local index = GetQuestLogSelection()
  if not index or index == 0 then return nil end
  local title, level, tag, isHeader = GetQuestLogTitle(index)
  if not title or isHeader then return nil end
  return title, R.InfoFor(title, known[title] or { qlevel = level, tag = tag })
end

-- A quest in the log whose title contains the text (an exact title wins).
function R.FindQuest(text)
  local lower = string.lower(text)
  local best = nil
  for title, info in pairs(known) do
    if string.lower(title) == lower then return title, R.InfoFor(title, info) end
    if not best and string.find(string.lower(title), lower, 1, true) then best = title end
  end
  if best then return best, R.InfoFor(best, known[best]) end
  return nil
end

------------------------------------------------------------------------------------------------------
-- Hooks: the quest window's Accept and Complete buttons go through these two functions, and so do
-- addons that accept or turn in quests for you.
------------------------------------------------------------------------------------------------------

local origAccept, origReward = AcceptQuest, GetQuestReward
AcceptQuest = function()
  pendingAccept = GetTime()
  pendingNPC = UnitName("npc")
  pendingPlace = PlaceNow()
  return origAccept()
end
GetQuestReward = function(choice)
  pendingTurnIn = GetTime()
  turnInTitle = GetTitleText()
  turnInNPC = UnitName("npc")
  return origReward(choice)
end

------------------------------------------------------------------------------------------------------
-- Events
------------------------------------------------------------------------------------------------------

-- Deaths and close calls are charged to every unfinished quest in the log, since the addon cannot
-- tell which one you were working on. A close call is health under 30% in a fight, once per fight.
-- Together they catch what quest levels miss: a low quest can still mean packs of mobs.
local CLOSE_CALL = 0.3
local scared = false

local function Charge(field, kind)
  local names = {}
  for title, a in pairs(R.Active()) do
    local info = known[title]
    if info and not info.complete then
      a[field] = (a[field] or 0) + 1
      table.insert(names, title)
    end
  end
  table.sort(names)
  ER.Log(kind, { quests = names })
end

local function OnHealth()
  if scared or not UnitAffectingCombat("player") then return end
  local hp, max = UnitHealth("player"), UnitHealthMax("player")
  if not hp or not max or max == 0 or hp <= 0 then return end
  if hp / max < CLOSE_CALL then
    scared = true
    Charge("close", "close")
  end
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("QUEST_LOG_UPDATE")
events:RegisterEvent("PLAYER_LEVEL_UP")
events:RegisterEvent("PLAYER_DEAD")
events:RegisterEvent("PLAYER_REGEN_ENABLED")
events:RegisterEvent("UNIT_HEALTH")
events:RegisterEvent("ZONE_CHANGED_NEW_AREA")
events:RegisterEvent("CHAT_MSG_COMBAT_HOSTILE_DEATH")
events:SetScript("OnEvent", function()
  if not ER.db then return end
  if event == "UNIT_HEALTH" then
    if arg1 == "player" then OnHealth() end
  elseif event == "CHAT_MSG_COMBAT_HOSTILE_DEATH" then
    -- "You have slain Riverpaw Runt!", or "Riverpaw Runt dies." when your pet or a friend got the blow.
    local _, _, name = string.find(arg1 or "", "^You have slain (.-)!$")
    if not name then _, _, name = string.find(arg1 or "", "^(.-) dies%.$") end
    if name then lastKill = { name = name, at = GetTime() } end
  elseif event == "PLAYER_ENTERING_WORLD" then
    enteredAt = GetTime()
    seeded = false
    scared = false
    lastZone = GetZoneText()
    ScheduleScan()
  elseif event == "QUEST_LOG_UPDATE" then
    ScheduleScan()
  elseif event == "PLAYER_LEVEL_UP" then
    ER.Log("level", { plevel = tonumber(arg1) })
  elseif event == "PLAYER_DEAD" then
    scared = false
    Charge("deaths", "death")
  elseif event == "PLAYER_REGEN_ENABLED" then
    scared = false
  elseif event == "ZONE_CHANGED_NEW_AREA" then
    local zone = GetZoneText()
    if zone and zone ~= "" and zone ~= lastZone then
      local from = lastZone
      lastZone = zone
      ER.Log("zone", { from = from })
    end
  end
end)
events:SetScript("OnUpdate", function()
  if scanAt and GetTime() >= scanAt then
    scanAt = nil
    Scan()
  end
end)
