-- Easy Route: auto mode. At an NPC it does the clicking the guide asks for (it takes the quests the plan wants and hands in the ones it finishes), and says each talk's
-- actions in one chat line. Holding Shift when the window opens leaves that whole talk to you. Settings has one tick for the whole
-- thing (autoOff) and one for each part (auto<part>Off); a flag that is not set means on.

local ER = EasyRoute
local A = {}
ER.Auto = A

------------------------------------------------------------------------------------------------------
-- Numbers
------------------------------------------------------------------------------------------------------

A.N = {
  DEFER = 0.05,         -- seconds a queued action waits before it runs
  TALK_GAP = 1,         -- seconds with no NPC window open that end a talk
  FLUSH_AFTER = 1,      -- seconds of quiet before the chat line is said
  MAX_ACTIONS = 6,      -- automatic actions in one talk
  QUEST_LOG_MAX = 20,   -- quests the game lets you carry
  QUEUE_MAX_AGE = 30,   -- seconds after which a queued action that never got ready is dropped
}

------------------------------------------------------------------------------------------------------
-- Ticks, Shift and the talk
------------------------------------------------------------------------------------------------------

-- Is automation on? part is nil (the whole) or "quest", "menu", "flight", "inn", "sell".
local function On(part)
  local db = ER.db
  if not db or db.autoOff then return false end
  if part and db["auto" .. part .. "Off"] then return false end
  return true
end

-- One talk with an NPC can show several windows one after another (menu, quest, hand-in). What is remembered for it.
local talk = { off = false, tried = {}, told = {}, count = 0, lines = { handed = {}, accepted = {}, other = {} }, seen = 0, quiet = 0, full = false }

local function ResetTalk()
  talk.off = false
  talk.tried = {}
  talk.told = {}
  talk.count = 0
  talk.full = false
end

local function NpcWindowShown()
  local names = { "QuestFrame", "GossipFrame", "MerchantFrame", "TaxiFrame" }
  for _, name in ipairs(names) do
    local f = getglobal(name)
    if f and f:IsVisible() then return true end
  end
  return false
end

-- Shift down at any moment of a talk turns the rest of it over to the player.
local function ShiftNow()
  if IsShiftKeyDown() then
    talk.off = true
    return true
  end
  return false
end

-- Every handler starts here. false = leave this window alone.
local function Go(part)
  if not On(part) then return false end
  ShiftNow()
  talk.seen = GetTime()
  return not talk.off
end

function A._testTalk() return talk end

------------------------------------------------------------------------------------------------------
-- The action queue: an action runs a moment after the event, when its window is still there
------------------------------------------------------------------------------------------------------

local queue = {}

-- act runs later, once; ready (optional) must answer true before it runs. Each act checks its own window and title again.
function A.Later(act, ready)
  table.insert(queue, { act = act, ready = ready, at = GetTime() })
end

-- "run", "wait" or "drop" for one queued item.
local function Verdict(item, now)
  if now - item.at > A.N.QUEUE_MAX_AGE then return "drop" end
  if now - item.at < A.N.DEFER then return "wait" end
  if item.ready then
    local ok, yes = pcall(item.ready)
    if not ok then return "drop" end
    if not yes then return "wait" end
  end
  return "run"
end

------------------------------------------------------------------------------------------------------
-- The chat line: all actions of a talk in one, said after a moment of quiet
------------------------------------------------------------------------------------------------------

-- No colour codes, no level tag, no "|" that would be read as a code.
local function Clean(text)
  if type(text) ~= "string" then return "" end
  text = string.gsub(text, "|c%x%x%x%x%x%x%x%x", "")
  text = string.gsub(text, "|r", "")
  text = string.gsub(text, "|", "")
  text = string.gsub(text, "^%[[%d%?%+%-]*%]%s*", "")
  return text
end

-- "A", "A and B", "A, B and C".
local function Join(list)
  local n = table.getn(list)
  if n == 0 then return "" end
  if n == 1 then return list[1] end
  local s = list[1]
  for i = 2, n - 1 do s = s .. ", " .. list[i] end
  return s .. " and " .. list[n]
end

local function Has(list, text)
  for _, t in ipairs(list) do
    if t == text then return true end
  end
  return false
end

-- kind "handed" or "accepted" adds a quest title; any other kind adds the text itself.
function A.Say(kind, text)
  local list = talk.lines[kind] or talk.lines.other
  text = Clean(text)
  if text ~= "" and not Has(list, text) then table.insert(list, text) end
  talk.quiet = GetTime()
end

local function InLog(norm)
  local entries = GetNumQuestLogEntries() or 0
  for i = 1, entries do
    local title, _, _, isHeader = GetQuestLogTitle(i)
    if title and not isHeader and ER.Steps.NormTitle(title) == norm then return true end
  end
  return false
end

local function QuestCount()
  local entries, quests = GetNumQuestLogEntries()
  return quests or entries or 0
end

local function Flush()
  local lines = talk.lines
  local handed, accepted, parts = {}, {}, {}
  local missing = false
  for _, t in ipairs(lines.handed) do
    if not InLog(ER.Steps.NormTitle(t)) then table.insert(handed, t) end
  end
  for _, t in ipairs(lines.accepted) do
    if InLog(ER.Steps.NormTitle(t)) then table.insert(accepted, t) else missing = true end
  end
  if table.getn(handed) > 0 then table.insert(parts, "handed in " .. Join(handed)) end
  if table.getn(accepted) > 0 then table.insert(parts, "accepted " .. Join(accepted)) end
  for _, t in ipairs(lines.other) do table.insert(parts, t) end
  talk.lines.handed, talk.lines.accepted, talk.lines.other = {}, {}, {}
  if table.getn(parts) > 0 then ER.Print(table.concat(parts, ", ") .. ".") end
  if missing and QuestCount() >= A.N.QUEST_LOG_MAX and not talk.full then
    talk.full = true
    ER.Print("Your quest log is full.")
  end
end

local function Pending()
  local lines = talk.lines
  return table.getn(lines.handed) > 0 or table.getn(lines.accepted) > 0 or table.getn(lines.other) > 0
end

------------------------------------------------------------------------------------------------------
-- The ticker: runs one queued action, says the chat line, ends the talk
------------------------------------------------------------------------------------------------------

local tick = CreateFrame("Frame", "EasyRouteAutoTick")
tick:SetScript("OnUpdate", function()
  local now = GetTime()
  for i = 1, table.getn(queue) do
    local item = queue[i]
    local verdict = Verdict(item, now)
    if verdict ~= "wait" then
      table.remove(queue, i)
      if verdict == "run" then pcall(item.act) end
      break
    end
  end
  if NpcWindowShown() then talk.seen = now end
  if Pending() and now - talk.quiet >= A.N.FLUSH_AFTER then pcall(Flush) end
  if table.getn(queue) == 0 and not NpcWindowShown() and now - talk.seen > A.N.TALK_GAP then ResetTalk() end
end)

------------------------------------------------------------------------------------------------------
-- Quests: take the ones the plan wants now
------------------------------------------------------------------------------------------------------

function A.Detail()
  if not Go("quest") then return end
  if not (ER.Steps and ER.Steps.Running()) then return end
  if UnitIsPlayer("npc") then return end   -- a quest a friend shares: the plan does not know that friend
  local title = GetTitleText()
  local norm = ER.Steps.NormTitle(title)
  local id = ER.Steps.WantedAccepts()[norm]
  if not id or talk.tried["accept:" .. norm] or talk.count >= A.N.MAX_ACTIONS then return end
  talk.tried["accept:" .. norm] = true
  talk.count = talk.count + 1
  A.Later(function()
    if not (QuestFrameDetailPanel and QuestFrameDetailPanel:IsVisible()) then return end
    if ER.Steps.NormTitle(GetTitleText()) ~= norm or ShiftNow() then return end
    AcceptQuest()
    A.Say("accepted", title)
  end)
end

------------------------------------------------------------------------------------------------------
-- Quests: hand in the ones the guide hands in
------------------------------------------------------------------------------------------------------

-- A line said at once, once per talk for each key. It is a notice, not an action: it does not count against MAX_ACTIONS.
local function Notice(key, text)
  if talk.told[key] then return end
  talk.told[key] = true
  ER.Print(text)
end

-- The open quest window is for a quest the guide hands in and nothing says the player must do it: title and tidied title, else nil.
local function HandInWindow()
  if not Go("quest") then return nil end
  if not (ER.Steps and ER.Steps.Running()) then return nil end
  local title = GetTitleText()
  local norm = ER.Steps.NormTitle(title)
  if not ER.Steps.HandInTitles()[norm] then return nil end
  if (GetQuestMoneyToGet() or 0) > 0 then
    Notice("money:" .. norm, "This quest takes money: finish it yourself.")
    return nil
  end
  return title, norm
end

-- The progress window ("Complete Quest" is next): press it when the game says the quest is ready.
function A.Progress()
  local title, norm = HandInWindow()
  if not title then return end
  if not IsQuestCompletable() then return end
  if talk.tried["progress:" .. norm] or talk.count >= A.N.MAX_ACTIONS then return end
  talk.tried["progress:" .. norm] = true
  talk.count = talk.count + 1
  A.Later(function()
    if not (QuestFrameProgressPanel and QuestFrameProgressPanel:IsVisible()) then return end
    if ER.Steps.NormTitle(GetTitleText()) ~= norm or ShiftNow() then return end
    if not IsQuestCompletable() or (GetQuestMoneyToGet() or 0) > 0 then return end
    CompleteQuest()
  end)
end

-- The reward window. No reward to choose: take it. One: take it. Two or more: the choice is the player's, never ours.
function A.Complete()
  local title, norm = HandInWindow()
  if not title then return end
  local choices = GetNumQuestChoices() or 0
  if choices >= 2 then
    Notice("pick:" .. norm, "Pick your reward for " .. Clean(title) .. ", then press Complete Quest.")
    return
  end
  if talk.tried["reward:" .. norm] or talk.count >= A.N.MAX_ACTIONS then return end
  talk.tried["reward:" .. norm] = true
  talk.count = talk.count + 1
  A.Later(function()
    if not (QuestFrameRewardPanel and QuestFrameRewardPanel:IsVisible()) then return end
    if ER.Steps.NormTitle(GetTitleText()) ~= norm or ShiftNow() then return end
    if (GetNumQuestChoices() or 0) ~= choices or (GetQuestMoneyToGet() or 0) > 0 then return end
    if choices == 1 then GetQuestReward(1) else GetQuestReward(0) end
    A.Say("handed", title)
  end)
end

------------------------------------------------------------------------------------------------------
-- Events
------------------------------------------------------------------------------------------------------

local HANDLERS = {
  QUEST_DETAIL = A.Detail,
  QUEST_PROGRESS = A.Progress,
  QUEST_COMPLETE = A.Complete,
}

local ev = CreateFrame("Frame", "EasyRouteAuto")
for name in pairs(HANDLERS) do
  ev:RegisterEvent(name)
end
ev:SetScript("OnEvent", function()
  local handler = HANDLERS[event]
  if handler then pcall(handler, arg1) end
end)

ER.Loaded("Auto.lua")
