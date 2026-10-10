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
  MAX_ACTIONS = 12,     -- quests taken or handed in (and a flight, an inn) in one talk; menu picks and progress windows do not count
  QUEST_LOG_MAX = 20,   -- quests the game lets you carry
  QUEUE_MAX_AGE = 30,   -- seconds after which a queued action that never got ready is dropped
  VOICE_CAP = 25,       -- seconds an accept or hand-in may wait for the voice-over to stop
  BIND_YARDS = 100,     -- how close to the inn of a set-hearthstone step you must be for the innkeeper to be used
  BIND_TRUST = 5,       -- seconds after Easy Route picked the innkeeper's option in which the popup that follows is answered
  SELL_EVERY = 0.1,     -- seconds between two sales at a vendor
  SETTLE = 0.5,         -- seconds with no sale before the repair is looked at
  REPAIR_KEEP = 10,     -- repair only when at least 1/REPAIR_KEEP of the money is left afterwards
  HEARTHSTONE = 6948,   -- the item id of the hearthstone
  TIP_EVERY = 1,        -- seconds between two looks for a hearth step (Simple mode's tip)
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
-- The vendor: sell grey items one at a time, then repair when the money allows
------------------------------------------------------------------------------------------------------

-- "1 gold 5 silver 3 copper" with the zero parts left out; "0 copper" for nothing.
function A.Money(copper)
  copper = math.floor(tonumber(copper) or 0)
  if copper <= 0 then return "0 copper" end
  local g = math.floor(copper / 10000)
  local s = math.floor(math.mod(copper, 10000) / 100)
  local c = math.floor(math.mod(copper, 100))
  local parts = {}
  if g > 0 then table.insert(parts, g .. " gold") end
  if s > 0 then table.insert(parts, s .. " silver") end
  if c > 0 then table.insert(parts, c .. " copper") end
  return table.concat(parts, " ")
end

-- Grey means the colour of the item link. The quality number can be -1 for an item the game has not seen yet, so it is never used.
function A.IsGrey(bag, slot)
  local link = GetContainerItemLink(bag, slot)
  if not link then return false end
  local hex
  if GetItemQualityColor then
    local _, _, _, h = GetItemQualityColor(0)
    hex = h
  end
  if type(hex) == "string" and hex ~= "" and string.find(link, hex, 1, true) then return true end
  return string.find(link, "ff9d9d9d", 1, true) ~= nil
end

-- What a sale must leave alone: items a quest in the log asks for (by the name before ": " in each objective) and the items of open K lines.
local function Protected()
  local keep = { names = {}, ids = {} }
  local entries = GetNumQuestLogEntries() or 0
  for i = 1, entries do
    local title, _, _, isHeader = GetQuestLogTitle(i)
    if title and not isHeader and GetNumQuestLeaderBoards then
      for j = 1, GetNumQuestLeaderBoards(i) or 0 do
        local text = GetQuestLogLeaderBoard(j, i)
        if type(text) == "string" then
          local at = string.find(text, ": ", 1, true)
          if at then keep.names[string.lower(string.sub(text, 1, at - 1))] = true end
        end
      end
    end
  end
  if ER.Steps and ER.Steps.Running() then
    for _, o in ipairs(ER.Steps.OpenElements("K")) do
      if o.e.item then keep.ids[tostring(o.e.item)] = true end
    end
  end
  return keep
end

-- The next slot to sell: grey, not locked, not kept, not tried before in this visit.
local function NextGrey(sale)
  for bag = 0, 4 do
    for slot = 1, GetContainerNumSlots(bag) or 0 do
      if not sale.done[bag .. "x" .. slot] and A.IsGrey(bag, slot) then
        local _, _, locked = GetContainerItemInfo(bag, slot)
        local link = GetContainerItemLink(bag, slot)
        local _, _, name = string.find(link, "%[(.-)%]")
        local _, _, id = string.find(link, "item:(%d+)")
        local kept = (name and sale.keep.names[string.lower(name)]) or (id and sale.keep.ids[id])
        if not locked and not kept then return bag, slot end
      end
    end
  end
  return nil
end

local sale = nil   -- the visit at a vendor: { state = "sell" / "settle", done, sent, count, money, at, keep }

local function SoldText(count, gain)
  local text = "sold " .. count .. (count == 1 and " grey item" or " grey items")
  if gain and gain > 0 then text = text .. " for " .. A.Money(gain) end
  return text
end

-- How many of the slots we used are empty now: what the vendor really took.
local function Gone(s)
  local n = 0
  for _, spot in ipairs(s.sent) do
    if not GetContainerItemLink(spot[1], spot[2]) then n = n + 1 end
  end
  return n
end

-- The visit stops here (the vendor closed, Shift, a tick turned off): say what the vendor really took so far.
local function EndSale()
  local s = sale
  sale = nil
  if not s then return end
  local count = Gone(s)
  if count > 0 then A.Say("other", SoldText(count, (GetMoney() or 0) - s.money)) end
end

function A.Merchant()
  if not Go("sell") then return end
  sale = { state = "sell", done = {}, sent = {}, count = 0, money = GetMoney() or 0, at = GetTime(), keep = Protected() }
end

function A.MerchantClosed()
  EndSale()
end

-- Repair only with a tenth of the money left afterwards.
local function Repair()
  if not (CanMerchantRepair and CanMerchantRepair()) then return nil end
  local cost, canRepair = GetRepairAllCost()
  if not canRepair or (cost or 0) <= 0 then return nil end
  local money = GetMoney() or 0
  if money - cost >= math.floor(money / A.N.REPAIR_KEEP) then
    RepairAllItems()
    return "repaired for " .. A.Money(cost)
  end
  return "not repaired: it costs " .. A.Money(cost) .. ", more than you can spare"
end

-- Called by the ticker. One sale each SELL_EVERY seconds while the vendor window is open; then a wait for the money to settle; then the repair.
local function SaleTick(now)
  local s = sale
  if not s then return end
  if not (MerchantFrame and MerchantFrame:IsVisible()) then return end
  if not On("sell") or ShiftNow() then
    EndSale()
    return
  end
  if s.state == "sell" then
    if now - s.at < A.N.SELL_EVERY - 0.001 then return end
    local bag, slot = NextGrey(s)
    if not bag then
      s.state = "settle"
      return
    end
    if ClearCursor then ClearCursor() end
    s.done[bag .. "x" .. slot] = true
    UseContainerItem(bag, slot)
    table.insert(s.sent, { bag, slot })
    s.count = s.count + 1
    s.at = now
  elseif now - s.at >= A.N.SETTLE - 0.001 then
    local gain = (GetMoney() or 0) - s.money
    local count = Gone(s)
    sale = nil
    if count > 0 then A.Say("other", SoldText(count, gain)) end
    local note = Repair()
    if note then A.Say("other", note) end
  end
end

------------------------------------------------------------------------------------------------------
-- The hearthstone: used only by a click on Easy Route's own line or tip button, never by itself
------------------------------------------------------------------------------------------------------

-- Where the hearthstone is in the bags: bag, slot; nil when there is none.
function A.FindHearth()
  local wanted = "item:" .. A.N.HEARTHSTONE .. ":"
  for bag = 0, 4 do
    for slot = 1, GetContainerNumSlots(bag) or 0 do
      local link = GetContainerItemLink(bag, slot)
      if link and string.find(link, wanted, 1, true) then return bag, slot end
    end
  end
  return nil
end

-- Called only from the step line's click (Tracker.lua) and the tip button below. Not from an event, the queue or the ticker, and it does
-- not look at the Auto mode ticks: the button works with auto mode off. true when the hearthstone was used.
function A.UseHearth()
  local bag, slot = A.FindHearth()
  if not bag then
    ER.Print("You have no hearthstone in your bags.")
    return false
  end
  -- With one of these windows open, using an item from the bags puts it in the bank, sells it, or adds it to a trade, a letter or an auction.
  for _, name in ipairs({ "BankFrame", "MerchantFrame", "TradeFrame", "MailFrame", "AuctionFrame" }) do
    local f = getglobal(name)
    if f and f.IsVisible and f:IsVisible() then
      ER.Print("Close the open window first, then use your hearthstone.")
      return false
    end
  end
  if GetContainerItemCooldown then
    local start, duration = GetContainerItemCooldown(bag, slot)
    start, duration = tonumber(start) or 0, tonumber(duration) or 0
    if start > 0 and duration > 0 then
      local left = start + duration - GetTime()
      if left > 0 then
        ER.Print("Your hearthstone is not ready yet: about " .. math.ceil(left / 60) .. " minutes left.")
        return false
      end
    end
  end
  UseContainerItem(bag, slot)
  return true
end

-- Simple mode: on a hearth step a tip with the same button. Raised once for each step (a tip the player closed does not come back for that step).
-- A press that could not use the hearthstone (none in the bags, still cooling down) brings the tip back on the next look.
local hearthTip = nil   -- the number of the step the tip was raised for
local hearthAt = 0

local function HearthTip(now)
  hearthAt = now
  local open = {}
  if ER.db and ER.db.simple and ER.Steps and ER.Steps.Running() then open = ER.Steps.OpenElements("H") end
  if table.getn(open) > 0 then
    local n = open[1].step.n
    if hearthTip ~= n and ER.AddTip then
      hearthTip = n
      ER.AddTip("hearth", "Time to use your hearthstone.", { { label = "Use your hearthstone", fn = function()
        if not A.UseHearth() then hearthTip = nil end
      end } })
    end
  elseif hearthTip then
    hearthTip = nil
    if ER.RemoveTip then ER.RemoveTip("hearth") end
  end
end

------------------------------------------------------------------------------------------------------
-- The ticker: runs one queued action, says the chat line, ends the talk
------------------------------------------------------------------------------------------------------

-- Runs fn(a) so that an error never reaches the player, and keeps each different error once in EasyRouteDB.errors (as Selftest.lua does
-- for the errors the game shows) so it can be read after a /reload.
local noted = {}
local function Try(what, fn, a)
  local ok, err = pcall(fn, a)
  if ok then return end
  err = "EasyRoute Auto " .. what .. ": " .. tostring(err)
  if noted[err] or not ER.db then return end
  noted[err] = true
  if type(ER.db.errors) ~= "table" then ER.db.errors = {} end
  table.insert(ER.db.errors, (date and date("%Y-%m-%d %H:%M") or "") .. "  " .. err)
  while table.getn(ER.db.errors) > 20 do table.remove(ER.db.errors, 1) end
end

local tick = CreateFrame("Frame", "EasyRouteAutoTick")
tick:SetScript("OnUpdate", function()
  local now = GetTime()
  if now - hearthAt >= A.N.TIP_EVERY then Try("hearth tip", HearthTip, now) end
  -- One item at a time, in order: a waiting item holds back the ones after it. Dropped items go at once.
  while queue[1] do
    local verdict = Verdict(queue[1], now)
    if verdict == "wait" then break end
    local item = table.remove(queue, 1)
    if verdict == "run" then
      Try("action", item.act)
      break
    end
  end
  if sale then Try("vendor", SaleTick, now) end
  if NpcWindowShown() then talk.seen = now end
  if Pending() and now - talk.quiet >= A.N.FLUSH_AFTER then Try("chat line", Flush) end
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
    ER.Print(who .. " is on, so Easy Route lets it take the quests.")
  else
    ER.Print(who .. " is on, so Easy Route lets it hand in the quests.")
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

-- A line said at once, once per talk for each key. It is a notice, not an action: it does not count against MAX_ACTIONS.
local function Notice(key, text)
  if talk.told[key] then return end
  talk.told[key] = true
  ER.Print(text)
end

-- Is there room for one more action in this talk? At the cap the player is told once and the rest of the talk is theirs.
local function Room()
  if talk.count < A.N.MAX_ACTIONS then return true end
  Notice("cap", "Easy Route stopped clicking for this talk: do the rest yourself.")
  return false
end

function A.Detail()
  if not Go("quest") then return end
  if not (ER.Steps and ER.Steps.Running()) then return end
  if UnitIsPlayer("npc") then return end   -- a quest a friend shares: the plan does not know that friend
  local title = GetTitleText()
  local norm = ER.Steps.NormTitle(title)
  local id = ER.Steps.WantedAccepts()[norm]
  if not id then
    -- An escort quest the plan wants: never accepted for the player, who is told once.
    local escort = ER.Steps.WantedAccepts(true)[norm]
    if escort and ER.Steps.Escort(escort) then
      Notice("escort:" .. norm, "Escort quest: accept it yourself when you are ready.")
    end
    return
  end
  if talk.tried["accept:" .. norm] then return end
  local other = A.Other()
  if other.accepts then
    HoldBack("accept", other.who)
    return
  end
  if not Room() then return end
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

-- The open quest window is for a quest the guide hands in and nothing says the player must do it: title and tidied title, else nil.
local function HandInWindow()
  if not Go("quest") then return nil end
  if not (ER.Steps and ER.Steps.Running()) then return nil end
  local title = GetTitleText()
  local norm = ER.Steps.NormTitle(title)
  if not ER.Steps.HandInTitles()[norm] then return nil end
  if (GetQuestMoneyToGet() or 0) > 0 then
    Notice("money:" .. norm, "This quest asks for money, so hand it in yourself.")
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
  -- The progress window is a step of the hand-in, not an action of its own: it needs room but does not take it (the reward window does).
  if talk.tried["progress:" .. norm] or not Room() then return end
  talk.tried["progress:" .. norm] = true
  A.Later(function()
    if not (QuestFrameProgressPanel and QuestFrameProgressPanel:IsVisible()) then return end
    if ER.Steps.NormTitle(GetTitleText()) ~= norm or ShiftNow() then return end
    if not IsQuestCompletable() or (GetQuestMoneyToGet() or 0) > 0 then return end
    CompleteQuest()
  end, A.VoiceQuiet, PanelShown("QuestFrameProgressPanel"))
end

-- Rewards to choose from. Each one is read with a hidden tooltip: a red line means this character cannot use it (a class line, an armour
-- or weapon type it cannot use), except "Requires Level N" and an armour or weapon type the class learns later, which only mean later. The game's own isUsable answer is the second signal:
-- when it says usable, the item counts as usable. An item whose tooltip has no lines (not read yet) counts as usable, so nothing is taken.
local scan

local function ScanTip()
  if not scan and CreateFrame then
    local ok, f = pcall(CreateFrame, "GameTooltip", "EasyRouteRewardScan", nil, "GameTooltipTemplate")
    if ok and f then scan = f end
  end
  return scan
end

local function LevelPattern()
  local f = type(ITEM_MIN_LEVEL) == "string" and ITEM_MIN_LEVEL or "Requires Level %d"
  f = string.gsub(f, "([%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
  f = string.gsub(f, "%%d", "%%d+")
  return "^" .. f
end

local function Red(line)
  if not (line and line.GetText and line.GetTextColor) then return false end
  local text = line:GetText()
  if type(text) ~= "string" or text == "" then return false end
  local r, g, b = line:GetTextColor()
  return (r or 0) > 0.9 and (g or 1) < 0.2 and (b or 1) < 0.2, text
end

-- The armour and weapon types each class can learn later (mail and plate at level 40, weapon skills from a trainer). A red line naming one
-- of them means "later", not "never". A class not in this list (or a tooltip in another language) counts every red line as before.
local LATER = {
  WARRIOR = { "Mail", "Plate", "Shield", "Axe", "Mace", "Sword", "Dagger", "Staff", "Polearm", "Fist Weapon", "Bow", "Gun", "Crossbow", "Thrown" },
  PALADIN = { "Mail", "Plate", "Shield", "Axe", "Mace", "Sword", "Polearm" },
  HUNTER = { "Mail", "Axe", "Sword", "Dagger", "Staff", "Polearm", "Fist Weapon", "Bow", "Gun", "Crossbow", "Thrown" },
  SHAMAN = { "Mail", "Shield", "Axe", "Mace", "Staff", "Dagger", "Fist Weapon" },
  ROGUE = { "Dagger", "Sword", "Mace", "Fist Weapon", "Bow", "Gun", "Crossbow", "Thrown" },
  DRUID = { "Mace", "Dagger", "Staff", "Fist Weapon" },
  PRIEST = { "Mace", "Dagger", "Staff", "Wand" },
  MAGE = { "Sword", "Dagger", "Staff", "Wand" },
  WARLOCK = { "Sword", "Dagger", "Staff", "Wand" },
}

local function LearnLater(text)
  local _, class = UnitClass("player")
  for _, t in ipairs(LATER[class or ""] or {}) do
    if text == t then return true end
  end
  return false
end

-- true when the tooltip of choice i has a red line other than the level line and the types this class learns later; nil when the
-- tooltip could not be read.
local function RedLine(i)
  local tip = ScanTip()
  if not (tip and tip.SetQuestItem) then return nil end
  if tip.SetOwner then tip:SetOwner(WorldFrame or UIParent, "ANCHOR_NONE") end
  if tip.ClearLines then tip:ClearLines() end
  local ok = pcall(tip.SetQuestItem, tip, "choice", i)
  if not ok then return nil end
  local n = tonumber(tip.NumLines and tip:NumLines()) or 0
  if n < 1 then return nil end
  local level = LevelPattern()
  local found = false
  for l = 1, n do
    for _, side in ipairs({ "Left", "Right" }) do
      local red, text = Red(getglobal("EasyRouteRewardScanText" .. side .. l))
      if red and not string.find(text, level) and not string.find(text, "^Requires Level %d+") and not LearnLater(text) then found = true end
    end
  end
  if tip.Hide then tip:Hide() end
  return found
end

-- The facts of choice i: { usable, price (copper or nil), quality (or -1), link (or name) }.
local function Choice(i)
  local name, _, _, quality, isUsable
  if GetQuestItemInfo then name, _, _, quality, isUsable = GetQuestItemInfo("choice", i) end
  local link = GetQuestItemLink and GetQuestItemLink("choice", i)
  local price
  if type(link) == "string" and type(EasyRoute_Prices) == "table" then
    local _, _, id = string.find(link, "item:(%d+)")
    if id then price = EasyRoute_Prices[tonumber(id)] end
  end
  local usable = true
  if not isUsable and RedLine(i) then usable = false end
  return { usable = usable, price = price, quality = tonumber(quality) or -1, link = link or name or "a reward" }
end

-- When none of the choices fits this character: the index to take and the reason words. Else nil (the player picks).
-- With a price known for every choice, the highest sell price wins; else (a Turtle WoW item has no price) the highest quality, when only one
-- has it.
function A.PickUnfit(choices)
  local list = {}
  local allPriced = true
  for i = 1, choices do
    local c = Choice(i)
    if c.usable then return nil end
    if not c.price then allPriced = false end
    list[i] = c
  end
  local best
  if allPriced then
    for i = 1, choices do
      if not best or list[i].price > list[best].price then best = i end
    end
    if best then return best, list[best].link, "sells for the most" end
  end
  local top, count = -1, 0
  for i = 1, choices do
    local q = list[i].quality
    if q > top then top, best, count = q, i, 1 elseif q == top then count = count + 1 end
  end
  if top >= 0 and count == 1 then return best, list[best].link, "the best of them" end
  return nil
end

-- The reward window. No reward to choose: take it. One: take it. Two or more: the choice is the player's, unless none of them fits this
-- character: then the one that sells for the most is taken.
function A.Complete()
  local title, norm = HandInWindow()
  if not title then return end
  local other = A.Other()
  if other.handsIn then
    HoldBack("handin", other.who)
    return
  end
  local choices = GetNumQuestChoices() or 0
  local pick, link, why
  if choices >= 2 then
    if talk.tried["reward:" .. norm] then return end
    pick, link, why = A.PickUnfit(choices)
    if not pick then
      Notice("pick:" .. norm, "Pick your reward for " .. Clean(title) .. ", then press Complete Quest.")
      return
    end
  end
  if talk.tried["reward:" .. norm] or not Room() then return end
  talk.tried["reward:" .. norm] = true
  talk.count = talk.count + 1
  A.Later(function()
    if not (QuestFrameRewardPanel and QuestFrameRewardPanel:IsVisible()) then return end
    if ER.Steps.NormTitle(GetTitleText()) ~= norm or ShiftNow() then return end
    if (GetNumQuestChoices() or 0) ~= choices or (GetQuestMoneyToGet() or 0) > 0 then return end
    if pick then
      GetQuestReward(pick)
      -- Kept as it is (A.Say would strip the item link), so the hand-in and the reward come out as one line.
      table.insert(talk.lines.other, "took " .. link .. " (none of the rewards fit you; " .. why .. ")")
    elseif choices == 1 then
      GetQuestReward(1)
    else
      GetQuestReward(0)
    end
    A.Say("handed", title)
  end, A.VoiceQuiet, PanelShown("QuestFrameRewardPanel"))
end

------------------------------------------------------------------------------------------------------
-- Flights and the inn
------------------------------------------------------------------------------------------------------

local function Trim(s)
  s = string.gsub(s, "^%s+", "")
  s = string.gsub(s, "%s+$", "")
  return s
end

-- Lower case, no dots or apostrophes, no leading "the " and no trailing " city": "Stormwind City" and "stormwind" are the same place.
local function Tidy(s)
  s = Trim(string.lower(Clean(s)))
  s = string.gsub(s, "[%.']", "")
  s = string.gsub(s, "^the ", "")
  s = string.gsub(s, " city$", "")
  return s
end

-- The town part of a flight map name: "Stormwind, Elwynn Forest" gives "Stormwind"; a name without a comma is all town.
local function TownOf(name)
  name = Clean(name)
  local _, _, town = string.find(name, "^(.-),")
  return Trim(town or name)
end

-- How well a flight map node ("Town, Zone") fits a wanted place: 3 the town is the key, 2 one starts with the other (key longer than 3
-- letters), 1 the zone is the key or starts with it, 0 not at all.
local function NodeScore(name, key)
  local _, _, town, zone = string.find(Clean(name), "^(.-),%s*(.*)$")
  town, zone = Tidy(town or name), Tidy(zone or "")
  local k = Tidy(key)
  if k == "" or town == "" then return 0 end
  if town == k then return 3 end
  if string.len(k) > 3 and (string.find(town, k, 1, true) == 1 or string.find(k, town, 1, true) == 1) then return 2 end
  if zone ~= "" and (zone == k or string.find(zone, k, 1, true) == 1) then return 1 end
  return 0
end

-- The place a line of words flies to: after "Fly from X to ", "Fly to " or "Take the flight path to ", up to the first full stop.
local function FlyKey(text)
  text = Clean(text)
  local at
  local _, e = string.find(text, "Fly from ", 1, true)
  if e then
    local _, e2 = string.find(text, " to ", e + 1, true)
    if e2 then at = e2 + 1 end
  end
  if not at then
    _, e = string.find(text, "Fly to ", 1, true)
    if e then at = e + 1 end
  end
  if not at then
    _, e = string.find(text, "Take the flight path to ", 1, true)
    if e then at = e + 1 end
  end
  if not at then return nil end
  local key = string.sub(text, at)
  local stop = string.find(key, ". ", 1, true)
  if stop then key = string.sub(key, 1, stop - 1) end
  key = Trim(string.gsub(key, "%.+%s*$", ""))
  if key == "" then return nil end
  return key
end

-- The places a fly step may mean, best first: what its words say, then each F line's place.
function A.FlightKeys(step)
  local keys = {}
  local function Add(k)
    if k and k ~= "" and not Has(keys, k) then table.insert(keys, k) end
  end
  for _, e in ipairs(step.elements) do
    if (e.kind == "I" or e.kind == "F") and type(e.text) == "string" then Add(FlyKey(e.text)) end
  end
  for _, e in ipairs(step.elements) do
    if e.kind == "F" and type(e.dest) == "string" then Add(Clean(e.dest)) end
  end
  return keys
end

-- The flight map node for the first key that fits a place you can fly to now: index, node name, town. Two equally good nodes give
-- nil, "tie", key; no fitting node for any key gives nil, "none". Only a REACHABLE node can be taken.
function A.PickNode(keys)
  local count = tonumber(NumTaxiNodes()) or 0
  for _, key in ipairs(keys) do
    local best, at, tie = 0, nil, false
    for i = 1, count do
      if TaxiNodeGetType(i) == "REACHABLE" then
        local score = NodeScore(TaxiNodeName(i) or "", key)
        if score > best then
          best, at, tie = score, i, false
        elseif score == best and score > 0 then
          tie = true
        end
      end
    end
    if best > 0 then
      if tie then return nil, "tie", key end
      local name = TaxiNodeName(at)
      return at, name, TownOf(name)
    end
  end
  return nil, "none"
end

-- The open fly line of the CURRENT step, or nil. A fly step that is only a side step never counts (the player may open the map just to learn
-- a flight path), and neither does a current "Get the flight path" step (it has a P line) or any other step without an open fly line.
local function CurrentFly()
  local cur = ER.Steps.Current()
  if not cur then return nil end
  for _, e in ipairs(cur.elements) do
    if e.kind == "P" then return nil end
  end
  for _, o in ipairs(ER.Steps.OpenElements("F")) do
    if o.step == cur then return o end
  end
  return nil
end

-- The flight map opened. On an open fly step: fly to the one place that fits, when it can be paid. Otherwise one plain line, and no flight.
function A.Taxi()
  if not Go("flight") then return end
  if not (ER.Steps and ER.Steps.Running()) then return end
  local open = CurrentFly()
  if not open then return end
  local keys = A.FlightKeys(open.step)
  local index, name, town = A.PickNode(keys)
  if not index then
    if name == "tie" then
      Notice("fly", "Pick the flight yourself: more than one place matches " .. Clean(town) .. ".")
    else
      Notice("fly", "You do not have that flight path yet.")
    end
    return
  end
  if (TaxiNodeCost(index) or 0) > (GetMoney() or 0) then
    Notice("fly", "You do not have enough money for that flight.")
    return
  end
  if talk.tried["fly"] or not Room() then return end
  talk.tried["fly"] = true
  talk.count = talk.count + 1
  A.Later(function()
    if TaxiNodeName(index) ~= name or ShiftNow() then return end
    TakeTaxiNode(index)
    A.Say("other", "taking the flight to " .. town)
  end, nil, PanelShown("TaxiFrame"))
end

-- The town a set-hearthstone line names: the part after " to ", up to " if " when there is one.
local function BindPlace(text)
  if type(text) ~= "string" then return "" end
  text = Clean(text)
  local _, e = string.find(text, " to ", 1, true)
  if not e then return "" end
  local place = string.sub(text, e + 1)
  local stop = string.find(place, " if ", 1, true)
  if stop then place = string.sub(place, 1, stop - 1) end
  return Trim(string.gsub(place, "%.+%s*$", ""))
end

-- Do you stand at the inn of this step? Near its last place, or, when the step has none, in the town the line names.
local function AtInn(step, place)
  local g
  for _, e in ipairs(step.elements) do
    if e.kind == "G" then g = e end
  end
  if g then
    local yards = ER.Steps.DistanceTo(g.zone, g.x, g.y)
    return yards ~= nil and yards <= A.N.BIND_YARDS
  end
  local p = Tidy(place)
  if p == "" then return false end
  return p == Tidy(GetZoneText()) or p == Tidy((GetSubZoneText and GetSubZoneText()) or "")
end

local function SamePlace(a, b)
  a, b = Tidy(a), Tidy(b)
  if a == "" or b == "" then return false end
  if a == b then return true end
  if string.len(a) > 3 and string.len(b) > 3 then
    return string.find(a, b, 1, true) ~= nil or string.find(b, a, 1, true) ~= nil
  end
  return false
end

-- The town of an open set-hearthstone line whose inn is right here, or nil.
local function BinderHere()
  for _, o in ipairs(ER.Steps.OpenElements("B")) do
    local town = BindPlace(o.e.text)
    if AtInn(o.step, town) then return town end
  end
  return nil
end

local binderAt = nil   -- when Easy Route itself picked the innkeeper's "make this inn your home" option

-- Is the "make this inn your home" popup still on the screen? (A game without the check counts as yes.)
local function BinderShown()
  if not StaticPopup_Visible then return true end
  return StaticPopup_Visible("CONFIRM_BINDER") and true or false
end

-- The game asks to make this inn your home. Say yes only on an open set-hearthstone line: when the popup names its town, or when the
-- popup follows Easy Route's own pick of the innkeeper's option at that line's inn (the popup's place name can differ from the guide's
-- town, for example a part of a city). A popup the player opened on any other step is never answered.
function A.Binder(place)
  if not Go("inn") then return end
  if not (ER.Steps and ER.Steps.Running()) then return end
  local picked = binderAt ~= nil and GetTime() - binderAt <= A.N.BIND_TRUST
  binderAt = nil
  local town
  for _, o in ipairs(ER.Steps.OpenElements("B")) do
    if SamePlace(BindPlace(o.e.text), place) then town = BindPlace(o.e.text) end
  end
  if not town and picked then town = BinderHere() end
  if not town or talk.tried["bind"] or not Room() then return end
  talk.tried["bind"] = true
  talk.count = talk.count + 1
  local said = Clean(place)
  if said == "" then said = town end
  if said == "" then said = "this inn" end
  A.Later(function()
    if ShiftNow() then return end
    if ConfirmBinder then ConfirmBinder() end
    if StaticPopup_Hide then StaticPopup_Hide("CONFIRM_BINDER") end
    A.Say("other", "hearthstone set to " .. said)
  end, nil, BinderShown)
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

-- The index of the first gossip option of this type ("binder", "taxi", "vendor" ...), or nil.
local function OptionOf(kind)
  for _, o in ipairs(Pairs({ GetGossipOptions() })) do
    if o.level == kind then return o.index end
  end
  return nil
end

-- With no quest line to pick: the innkeeper's "make this your home" at the inn of a set-hearthstone line, or the flight master's flight
-- option when the current step flies. These two types are the only ones ever selected.
local function PickOption()
  local kind, index
  if On("inn") and not talk.tried["binder"] and BinderHere() then
    index = OptionOf("binder")
    if index then kind = "binder" end
  end
  -- The flight option only when the flight map would fly: the same test as A.Taxi (the current step's open fly line, no "get the flight path").
  if not kind and On("flight") and not talk.tried["taxi"] and CurrentFly() then
    index = OptionOf("taxi")
    if index then kind = "taxi" end
  end
  if not kind or not Room() then return end
  talk.tried[kind] = true
  A.Later(function()
    if not (GossipFrame and GossipFrame:IsVisible()) or ShiftNow() then return end
    if OptionOf(kind) ~= index then return end
    SelectGossipOption(index)
    if kind == "binder" then binderAt = GetTime() end
  end)
end

-- One pick per window event: first a hand-in the log shows finished, then a pick-up the plan wants now. Nothing else is chosen.
-- read gives the active and the available list; panel is the window that must still be open; select... are called by global name.
local function Menu(read, panel, selectActive, selectAvailable, options)
  if not Go(nil) then return end
  if not (ER.Steps and ER.Steps.Running()) then return end
  local active, avail = read()
  -- A quest window opened from the menu is only worth it when the quest part will take or hand in that quest.
  if not On("menu") or not On("quest") then active, avail = {}, {} end
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
  -- The binder and flight options of a gossip menu come after the quest picks and never before them.
  if not pick then
    if options then PickOption() end
    return
  end
  -- A menu pick only opens the quest's window; the accept or hand-in in that window is what counts against the cap.
  if not Room() then return end
  talk.tried[key] = true
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
    function(i) SelectGossipActiveQuest(i) end, function(i) SelectGossipAvailableQuest(i) end, true)
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
  TAXIMAP_OPENED = A.Taxi,
  CONFIRM_BINDER = A.Binder,
  MERCHANT_SHOW = A.Merchant,
  MERCHANT_CLOSED = A.MerchantClosed,
}

local ev = CreateFrame("Frame", "EasyRouteAuto")
for name in pairs(HANDLERS) do
  ev:RegisterEvent(name)
end
ev:SetScript("OnEvent", function()
  local handler = HANDLERS[event]
  if handler then Try(event, handler, arg1) end
end)

ER.Loaded("Auto.lua")
