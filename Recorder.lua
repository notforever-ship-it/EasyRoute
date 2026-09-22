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
        info.obj, info.pfid = old.obj, old.pfid
      else
        info.obj = Objectives(i)
        info.pfid = QuestID(i)
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
  local out = { qlevel = info.qlevel, tag = info.tag, pfid = info.pfid or (a and a.pfid), obj = info.obj,
    deaths = (a and a.deaths) or 0 }
  if a and a.at and not a.unknownStart then out.mins = math.floor((time() - a.at) / 60 + 0.5) end
  return out
end

local function OnAccept(title, info)
  local act = R.Active()
  act[title] = { at = time(), qlevel = info.qlevel, tag = info.tag, deaths = 0, pfid = info.pfid }
  ER.Log("accept", { title = title, qlevel = info.qlevel, tag = info.tag, obj = info.obj, pfid = info.pfid })
end

local function OnRemove(title, info, turnedIn)
  local act = R.Active()
  local a = act[title]
  act[title] = nil
  local mins = nil
  local deaths = (a and a.deaths) or 0
  if a and a.at and not a.unknownStart then mins = math.floor((time() - a.at) / 60 + 0.5) end
  local pfid = info.pfid or (a and a.pfid)
  ER.Log(turnedIn and "turnin" or "abandon",
    { title = title, qlevel = info.qlevel, tag = info.tag, mins = mins, deaths = deaths, pfid = pfid, obj = info.obj })
  if not turnedIn then return end
  if ER.db.autoPrompt and ER.OpenRate then
    ER.OpenRate(title, { qlevel = info.qlevel, tag = info.tag, mins = mins, deaths = deaths, pfid = pfid, obj = info.obj })
    return
  end
  -- One line so you remember what the quest was: "Wanted: Hogger handed in (Hogger x1)".
  local line = ER.GOLD .. title .. ER.END .. " handed in"
  local what = ER.ObjectiveSummary(info.obj)
  if what then line = line .. ER.GREY .. " (" .. what .. ")" .. ER.END end
  local r = ER.GetRating(title)
  if r then
    line = line .. ". Rated " .. ER.Coloured(r.rating) .. "."
  else
    line = line .. ". Not rated yet, it waits in " .. ER.GOLD .. "/er" .. ER.END .. "."
  end
  ER.Print(line)
end

-- First read after logging in: remember what is in the log and line the character's list up with
-- it, without writing accept or turn-in lines for things that happened while the addon was off.
local function Seed(quests, count)
  local act = R.Active()
  for title, info in pairs(quests) do
    if not act[title] then
      act[title] = { at = time(), qlevel = info.qlevel, tag = info.tag, deaths = 0, pfid = info.pfid, unknownStart = true }
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

local function OnDeath()
  local names = {}
  for title, a in pairs(R.Active()) do
    local info = known[title]
    if info and not info.complete then
      a.deaths = (a.deaths or 0) + 1
      table.insert(names, title)
    end
  end
  table.sort(names)
  ER.Log("death", { quests = names })
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("QUEST_LOG_UPDATE")
events:RegisterEvent("PLAYER_LEVEL_UP")
events:RegisterEvent("PLAYER_DEAD")
events:RegisterEvent("ZONE_CHANGED_NEW_AREA")
events:SetScript("OnEvent", function()
  if not ER.db then return end
  if event == "PLAYER_ENTERING_WORLD" then
    enteredAt = GetTime()
    seeded = false
    lastZone = GetZoneText()
    ScheduleScan()
  elseif event == "QUEST_LOG_UPDATE" then
    ScheduleScan()
  elseif event == "PLAYER_LEVEL_UP" then
    ER.Log("level", { plevel = tonumber(arg1) })
  elseif event == "PLAYER_DEAD" then
    OnDeath()
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
