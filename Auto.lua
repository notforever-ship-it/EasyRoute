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
  VOICE_CAP = 25,       -- seconds an accept or hand-in may wait for the voice-over to stop
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

-- act runs later, once. ready (optional) must answer true before it runs, or the item must be older than VOICE_CAP. alive (optional) answers
-- false when the window is gone: the item is then dropped at once. Each act checks its own window and title again.
function A.Later(act, ready, alive)
  table.insert(queue, { act = act, ready = ready, alive = alive, at = GetTime() })
end

-- "run", "wait" or "drop" for one queued item.
local function Verdict(item, now)
  if item.alive then
    local ok, yes = pcall(item.alive)
    if not ok or not yes then return "drop" end
  end
  if now - item.at > A.N.QUEUE_MAX_AGE then return "drop" end
  if now - item.at < A.N.DEFER then return "wait" end
  if item.ready and now - item.at < A.N.VOICE_CAP then
    local ok, yes = pcall(item.ready)
    if not ok then return "drop" end
    if not yes then return "wait" end
  end
  return "run"
end

-- AI_VoiceOver ends the voice when a quest window closes, if its option StopAudioOnDisengage is on (it is off by default). Then an automatic
-- accept or hand-in waits for the voice to finish. Anything unexpected in its tables counts as quiet.
function A.VoiceQuiet()
  if type(VoiceOver) ~= "table" then return true end
  local ok, quiet = pcall(function()
    if VoiceOver.Addon.db.profile.Audio.StopAudioOnDisengage ~= true then return true end
    return not VoiceOver.SoundQueue:IsPlaying()
  end)
  if not ok then return true end
  return quiet and true or false
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
  -- One item at a time, in order: a waiting item holds back the ones after it. Dropped items go at once.
  while queue[1] do
    local verdict = Verdict(queue[1], now)
    if verdict == "wait" then break end
    local item = table.remove(queue, 1)
    if verdict == "run" then
      pcall(item.act)
      break
    end
  end
  if NpcWindowShown() then talk.seen = now end
  if Pending() and now - talk.quiet >= A.N.FLUSH_AFTER then pcall(Flush) end
  if table.getn(queue) == 0 and not NpcWindowShown() and now - talk.seen > A.N.TALK_GAP then ResetTalk() end
end)

------------------------------------------------------------------------------------------------------
-- Other addons: leave to them exactly what they will do at this window
------------------------------------------------------------------------------------------------------

-- What other addons will do at an NPC window, read now (never at load; their tables can be of any shape or version):
-- { accepts =, handsIn =, who = }. Unknown or unreadable means they do nothing, except AutoQuest with settings we cannot read.
-- AutoQuest always hands in; it accepts only when followTourGuide is off or a TourGuide is hooked (its default is on, so it accepts nothing).
-- Automaton (Gossip module on) and FastQuest (AutoComplete on) hand in. LazyPig acts only with Shift or Alt held and needs no rule here.
function A.Other()
  local out = { accepts = false, handsIn = false, who = nil }
  local okQ = pcall(function()
    if type(AutoQuest) ~= "table" then return end
    out.who, out.handsIn = "AutoQuest", true
    local s = AutoQuest.Settings
    if type(s) ~= "table" or s.followTourGuide ~= true or AutoQuest.TG ~= nil then out.accepts = true end
  end)
  if not okQ and type(AutoQuest) == "table" then out.who, out.handsIn, out.accepts = "AutoQuest", true, true end
  pcall(function()
    if Automaton_Gossip == nil or type(Automaton) ~= "table" or type(Automaton.IsModuleActive) ~= "function" then return end
    local ok, active = pcall(Automaton.IsModuleActive, Automaton, "Gossip")
    if ok and active then
      out.handsIn = true
      out.who = out.who or "Automaton"
    end
  end)
  pcall(function()
    if type(FQD) == "table" and FQD.AutoComplete == true then
      out.handsIn = true
      out.who = out.who or "FastQuest"
    end
  end)
  return out
end

-- Said once per session for each addon and kind (A.told is not cleared when a talk ends).
A.told = {}
local function HoldBack(kind, who)
  who = who or "Another addon"
  local key = who .. ":" .. kind
  if A.told[key] then return end
  A.told[key] = true
  if kind == "accept" then
    ER.Print(who .. " is on, so Easy Route leaves quest accepting to it.")
  else
    ER.Print(who .. " is on, so Easy Route leaves handing in quests to it.")
  end
end

------------------------------------------------------------------------------------------------------
-- Quests: take the ones the plan wants now
------------------------------------------------------------------------------------------------------

-- The alive check of a queued act: is this window still open? (Accepts and hand-ins wait for the voice-over; a closed window ends the wait.)
local function PanelShown(name)
  return function()
    local f = getglobal(name)
    return f and f:IsVisible()
  end
end

function A.Detail()
  if not Go("quest") then return end
  if not (ER.Steps and ER.Steps.Running()) then return end
  if UnitIsPlayer("npc") then return end   -- a quest a friend shares: the plan does not know that friend
  local title = GetTitleText()
  local norm = ER.Steps.NormTitle(title)
  local id = ER.Steps.WantedAccepts()[norm]
  if not id or talk.tried["accept:" .. norm] or talk.count >= A.N.MAX_ACTIONS then return end
  local other = A.Other()
  if other.accepts then
    HoldBack("accept", other.who)
    return
  end
  talk.tried["accept:" .. norm] = true
  talk.count = talk.count + 1
  A.Later(function()
    if not (QuestFrameDetailPanel and QuestFrameDetailPanel:IsVisible()) then return end
    if ER.Steps.NormTitle(GetTitleText()) ~= norm or ShiftNow() then return end
    AcceptQuest()
    A.Say("accepted", title)
  end, A.VoiceQuiet, PanelShown("QuestFrameDetailPanel"))
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
  local other = A.Other()
  if other.handsIn then
    HoldBack("handin", other.who)
    return
  end
  if talk.tried["progress:" .. norm] or talk.count >= A.N.MAX_ACTIONS then return end
  talk.tried["progress:" .. norm] = true
  talk.count = talk.count + 1
  A.Later(function()
    if not (QuestFrameProgressPanel and QuestFrameProgressPanel:IsVisible()) then return end
    if ER.Steps.NormTitle(GetTitleText()) ~= norm or ShiftNow() then return end
    if not IsQuestCompletable() or (GetQuestMoneyToGet() or 0) > 0 then return end
    CompleteQuest()
  end, A.VoiceQuiet, PanelShown("QuestFrameProgressPanel"))
end

-- The reward window. No reward to choose: take it. One: take it. Two or more: the choice is the player's, never ours.
function A.Complete()
  local title, norm = HandInWindow()
  if not title then return end
  local other = A.Other()
  if other.handsIn then
    HoldBack("handin", other.who)
    return
  end
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
  end, A.VoiceQuiet, PanelShown("QuestFrameRewardPanel"))
end

------------------------------------------------------------------------------------------------------
-- Menus: pick the plan's quest lines in gossip and greeting windows
------------------------------------------------------------------------------------------------------

-- The game gives a menu list flat: title, level, title, level ... Turned into { { title =, level =, index = }, ... }.
-- The index counts inside its own list (1, 2, 3 ...), which is the number the Select calls want.
local function Pairs(list)
  local out = {}
  for i = 1, table.getn(list), 2 do
    table.insert(out, { title = list[i], level = list[i + 1], index = math.floor((i + 1) / 2) })
  end
  return out
end

-- The quests in the quest log that can be handed in: { [tidied title] = true }. The log says finished (6th value 1), or the
-- quest has no objectives at all (a quest that only asks you to talk to someone).
local function LogDone()
  local done = {}
  local entries = GetNumQuestLogEntries() or 0
  for i = 1, entries do
    local title, _, _, isHeader, _, complete = GetQuestLogTitle(i)
    if title and not isHeader then
      if complete == 1 or (GetNumQuestLeaderBoards and GetNumQuestLeaderBoards(i) == 0) then
        done[ER.Steps.NormTitle(title)] = true
      end
    end
  end
  return done
end

local function ReadGossip()
  return Pairs({ GetGossipActiveQuests() }), Pairs({ GetGossipAvailableQuests() })
end

local function ReadGreeting()
  local active, avail = {}, {}
  for i = 1, GetNumActiveQuests() or 0 do table.insert(active, { title = GetActiveTitle(i), index = i }) end
  for i = 1, GetNumAvailableQuests() or 0 do table.insert(avail, { title = GetAvailableTitle(i), index = i }) end
  return active, avail
end

-- Is the entry with this tidied title still at this index of the list?
local function Still(list, q, norm)
  for _, e in ipairs(list) do
    if e.index == q.index then return ER.Steps.NormTitle(e.title) == norm end
  end
  return false
end

-- One pick per window event: first a hand-in the log shows finished, then a pick-up the plan wants now. Nothing else is chosen.
-- read gives the active and the available list; panel is the window that must still be open; select... are called by global name.
local function Menu(read, panel, selectActive, selectAvailable)
  if not Go(nil) then return end
  if not (ER.Steps and ER.Steps.Running()) then return end
  if not On("menu") then return end
  if talk.count >= A.N.MAX_ACTIONS then return end
  local active, avail = read()
  local hand, want = ER.Steps.HandInTitles(), ER.Steps.WantedAccepts()
  local pick, key, list, choose
  local done
  local other = A.Other()
  for _, q in ipairs(active) do
    local norm = ER.Steps.NormTitle(q.title)
    if not pick and hand[norm] and not talk.tried["pickT:" .. norm] then
      done = done or LogDone()
      if done[norm] then
        if other.handsIn then
          HoldBack("handin", other.who)
        else
          pick, key, list, choose = q, "pickT:" .. norm, "active", selectActive
        end
      end
    end
  end
  if not pick then
    for _, q in ipairs(avail) do
      local norm = ER.Steps.NormTitle(q.title)
      if not pick and want[norm] and not talk.tried["pickA:" .. norm] then
        if other.accepts then
          HoldBack("accept", other.who)
        else
          pick, key, list, choose = q, "pickA:" .. norm, "avail", selectAvailable
        end
      end
    end
  end
  -- The binder and flight options of a gossip menu are picked here, after the quest picks and never before them.
  if not pick then return end
  talk.tried[key] = true
  talk.count = talk.count + 1
  local norm = ER.Steps.NormTitle(pick.title)
  A.Later(function()
    if not (panel() and panel():IsVisible()) or ShiftNow() then return end
    local a, b = read()
    local now = a
    if list == "avail" then now = b end
    if Still(now, pick, norm) then choose(pick.index) end
  end)
end

function A.Gossip()
  Menu(ReadGossip, function() return GossipFrame end,
    function(i) SelectGossipActiveQuest(i) end, function(i) SelectGossipAvailableQuest(i) end)
end

function A.Greeting()
  Menu(ReadGreeting, function() return QuestFrameGreetingPanel end,
    function(i) SelectActiveQuest(i) end, function(i) SelectAvailableQuest(i) end)
end

------------------------------------------------------------------------------------------------------
-- Events
------------------------------------------------------------------------------------------------------

local HANDLERS = {
  QUEST_DETAIL = A.Detail,
  QUEST_PROGRESS = A.Progress,
  QUEST_COMPLETE = A.Complete,
  GOSSIP_SHOW = A.Gossip,
  QUEST_GREETING = A.Greeting,
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
