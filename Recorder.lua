-- Easy Route: watches your quest log and writes the journal. Accepts, turn-ins, abandons, deaths,
-- level-ups and zone changes each get a line with where you were. A turn-in also opens the
-- "how was this quest?" popup.
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
  return out
end

local function OnAccept(title, info)
  local act = R.Active()
  act[title] = { at = time(), qlevel = info.qlevel, tag = info.tag, deaths = 0, close = 0, pfid = info.pfid }
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
  ER.Log(turnedIn and "turnin" or "abandon",
    { title = title, qlevel = info.qlevel, tag = info.tag, mins = mins, deaths = deaths, close = close, pfid = pfid,
      obj = info.obj, desc = info.desc, chain = chain })
  if not turnedIn then return end
  local plevel = UnitLevel("player")
  local what = ER.ObjectiveSummary(info.obj)
  -- Rated while it was still in the log? The level it was actually finished at is the one that counts.
  local rated = ER.GetRating(title)
  if rated and not rated.donelevelManual then rated.donelevel = plevel end
  -- Let the party know, when there is one.
  if ER.db.partyAnnounce and (GetNumPartyMembers() or 0) > 0 then
    local msg = "I've done " .. title
    if what then msg = msg .. " (" .. what .. ")" end
    pcall(SendChatMessage, msg .. ".", "PARTY")
  end
  if ER.db.autoPrompt and ER.OpenRate then
    ER.OpenRate(title, { qlevel = info.qlevel, tag = info.tag, mins = mins, deaths = deaths, close = close, pfid = pfid,
      obj = info.obj, desc = info.desc, chain = chain, donelevel = plevel })
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
  if info.desc then ER.Print(ER.GREY .. "  \"" .. info.desc .. "\"" .. ER.END) end
end

-- First read after logging in: remember what is in the log and line the character's list up with
-- it, without writing accept or turn-in lines for things that happened while the addon was off.
local function Seed(quests, count)
  local act = R.Active()
  for title, info in pairs(quests) do
    if not act[title] then
      act[title] = { at = time(), qlevel = info.qlevel, tag = info.tag, deaths = 0, close = 0, pfid = info.pfid, unknownStart = true }
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
  pendingAccept, pendingTurnIn, turnInTitle = nil, nil, nil
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
  return origAccept()
end
GetQuestReward = function(choice)
  pendingTurnIn = GetTime()
  turnInTitle = GetTitleText()
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
events:SetScript("OnEvent", function()
  if not ER.db then return end
  if event == "UNIT_HEALTH" then
    if arg1 == "player" then OnHealth() end
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
