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

-- The first sentence of the quest's own text, so "what was this quest about?" has an answer later.
-- Reading it means picking the quest in the log for a moment; the pick is put back right after.
local function Description(index)
  local ok, text = pcall(function()
    local selected = GetQuestLogSelection()
    SelectQuestLogEntry(index)
    local d = GetQuestLogQuestText()
    if selected and selected > 0 then SelectQuestLogEntry(selected) end
    return d
  end)
  if not ok or type(text) ~= "string" then return nil end
  text = string.gsub(text, "%s+", " ")
  local _, _, first = string.find(text, "^(.-[%.!%?])%s")
  first = first or text
  if string.len(first) > 160 then first = string.sub(first, 1, 157) .. "..." end
  return first
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
    local text, _, finished = GetQuestLogLeaderBoard(j, index)
    if text then
      local _, _, name, have, need = string.find(text, "^(.-):%s*(%d+)%s*/%s*(%d+)%s*$")
      have, need = tonumber(have), tonumber(need)
      if not name or name == "" then name = text end
      local o = a.objs[j]
      if not o then
        a.objs[j] = { name = name, have = have or 0, need = need, done = finished and true or false, places = {}, mobs = {} }
      else
        o.name = name
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

-- The story in sentences. done: the quest is handed in. coords: map positions after the places,
-- for the export.
function R.StoryParts(s, done, coords)
  local parts = {}
  if not s then return parts end
  if s.from or s.fromPlace then
    local line = "Picked up"
    if s.from then line = line .. " from " .. s.from end
    if s.fromPlace then line = line .. " in " .. s.fromPlace end
    if s.startLevel then line = line .. " at level " .. s.startLevel end
    table.insert(parts, line .. ".")
  elseif s.unknownStart then
    table.insert(parts, "Already in your log when Easy Route started.")
  end
  local j = 1
  while s.objs and s.objs[j] do
    local o = s.objs[j]
    local line = o.name
    if o.need then
      if done or o.done then line = line .. " x" .. o.need else line = line .. " " .. (o.have or 0) .. "/" .. o.need .. " so far" end
    elseif o.done or done then
      line = line .. ": done"
    else
      line = line .. ": not yet"
    end
    local places = TopKeys(o.places, 2)
    if table.getn(places) > 0 then
      line = line .. ", at " .. table.concat(places, " and ")
      if coords and o.x then line = line .. " [" .. o.x .. ", " .. o.y .. "]" end
    end
    -- "Riverpaw Gnoll slain" already says what died; item and event objectives get the mobs that counted.
    if not string.find(string.lower(o.name), "slain", 1, true) then
      local mobs = TopKeys(o.mobs, 3, true)
      if table.getn(mobs) > 0 then line = line .. ", from " .. table.concat(mobs, ", ") end
    end
    table.insert(parts, line .. ".")
    j = j + 1
  end
  local bits = {}
  local mins = s.mins
  if not mins and s.at and not s.unknownStart then mins = math.floor((time() - s.at) / 60 + 0.5) end
  local span = ER.Span(mins)
  if span then table.insert(bits, (done and "took " or "in your log for ") .. span) end
  if (s.deaths or 0) > 0 then table.insert(bits, "died " .. (s.deaths == 1 and "once" or (s.deaths .. " times"))) end
  if (s.close or 0) > 0 then table.insert(bits, "got low on health " .. (s.close == 1 and "once" or (s.close .. " times"))) end
  if table.getn(bits) > 0 then
    local text = table.concat(bits, ", ")
    table.insert(parts, string.upper(string.sub(text, 1, 1)) .. string.sub(text, 2) .. ".")
  end
  if done and (s.to or s.toPlace) then
    local line = "Handed in"
    if s.to then line = line .. " to " .. s.to end
    if s.toPlace then line = line .. " in " .. s.toPlace end
    if s.donelevel then line = line .. " at level " .. s.donelevel end
    table.insert(parts, line .. ".")
  end
  return parts
end

function R.StoryText(s, done, coords)
  local parts = R.StoryParts(s, done, coords)
  if table.getn(parts) == 0 then return nil end
  return table.concat(parts, " ")
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
      local old = known[title]
      if old then
        info.obj, info.pfid, info.desc = old.obj, old.pfid, old.desc
      else
        info.obj = Objectives(i)
        info.pfid = QuestID(i)
        info.desc = Description(i)
      end
      quests[title] = info
      TrackProgress(title, i)
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
  if story then
    out.story = story
    out.did = R.StoryText(story, false)
  end
  return out
end

local function OnAccept(title, info)
  local act = R.Active()
  local fresh = pendingAccept and GetTime() - pendingAccept < WINDOW
  act[title] = { at = time(), qlevel = info.qlevel, tag = info.tag, deaths = 0, close = 0, pfid = info.pfid,
    from = fresh and pendingNPC or nil, fromPlace = (fresh and pendingPlace) or PlaceNow(), startLevel = UnitLevel("player"), objs = {} }
  local step, total, nextTitle = R.Chain(info.pfid)
  ER.Log("accept", { title = title, qlevel = info.qlevel, tag = info.tag, obj = info.obj, desc = info.desc, pfid = info.pfid,
    chain = step and (step .. "/" .. total) or nil })
  if step then
    local line = ER.GOLD .. title .. ER.END .. " is a chain quest: step " .. step .. " of " .. total
    if nextTitle then line = line .. ER.GREY .. " (next: " .. nextTitle .. ")" .. ER.END end
    ER.Print(line .. ".")
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
  local story, did = StoryOf(a), nil
  if story then
    story.mins = mins
    if turnedIn then
      story.to = turnInNPC
      story.toPlace = PlaceNow()
      story.donelevel = plevel
    end
    did = R.StoryText(story, turnedIn)
  end
  ER.Log(turnedIn and "turnin" or "abandon",
    { title = title, qlevel = info.qlevel, tag = info.tag, mins = mins, deaths = deaths, close = close, pfid = pfid,
      obj = info.obj, desc = info.desc, chain = chain, story = story, did = did })
  if not turnedIn then return end
  local what = ER.ObjectiveSummary(info.obj)
  -- Rated while it was still in the log? The level it was actually finished at is the one that counts,
  -- and the finished story replaces the one so far.
  local rated = ER.GetRating(title)
  if rated then
    if not rated.donelevelManual then rated.donelevel = plevel end
    rated.story, rated.did = story, did
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
      obj = info.obj, desc = info.desc, chain = chain, donelevel = plevel, story = story, did = did })
    return
  end
  -- One line so you remember what the quest was: "Wanted: Hogger handed in at level 11 (Hogger x1)".
  local line = ER.GOLD .. title .. ER.END .. " handed in at level " .. plevel
  if what then line = line .. ER.GREY .. " (" .. what .. ")" .. ER.END end
  if rated then
    line = line .. ". Rated " .. ER.Coloured(rated.rating) .. "."
  else
    line = line .. ". Not rated yet, it waits in " .. ER.GOLD .. "/er" .. ER.END .. "."
  end
  ER.Print(line)
  if did then ER.Print(ER.WHITE .. "  " .. did .. ER.END) end
  if info.desc then ER.Print(ER.GREY .. "  \"" .. info.desc .. "\"" .. ER.END) end
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
  for title, info in pairs(quests) do
    if not known[title] then OnAccept(title, info) end
  end
  local now = GetTime()
  for title, info in pairs(known) do
    if not quests[title] then
      local turnedIn = false
      if pendingTurnIn and now - pendingTurnIn < WINDOW then
        turnedIn = (not turnInTitle) or (turnInTitle == title)
      end
      OnRemove(title, info, turnedIn)
    end
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
