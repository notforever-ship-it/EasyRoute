-- Easy Route: the wizard (/er, or the minimap button). It asks how you want to play (Casual, Medium or Hard),
-- looks at your faction and level, suggests an area, and then takes you through it one stop at a time:
-- go to the quest giver, pick up the quests, do them, hand them in. Each step can put a marker on the map
-- (with pfQuest) and says the same thing in chat.
--
-- The quests, chains and grind spots come from the director (Director.lua). Who a quest is handed in to and
-- where its targets are come from pfQuest's database when it is installed; without it the steps still say where
-- to pick the quests up and to look in the quest log for the rest.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local WIDTH, HEIGHT = 480, 540
local LEFT, INNER_W = 24, 432
local ROWS, ROW_H = 5, 50
local COLOURS = { red = "|cffff4040", orange = "|cffff8040", yellow = "|cffffff00", green = "|cff40c040" }

local frame, subtitle, bodyText, moreText, footText
local rows, buttons = {}, {}
local screen = "mood"
local state = { choices = {}, pick = 1, zone = nil, stop = nil, phase = 1, skipped = {}, stops = 0 }
local Refresh

------------------------------------------------------------------------------------------------------
-- Small helpers
------------------------------------------------------------------------------------------------------

local function Say(msg)
  if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99Easy Route:|r " .. msg) end
end

local function Where(x, y)
  return "(" .. math.floor(x + 0.5) .. ", " .. math.floor(y + 0.5) .. ")"
end

local function Opaque(f)
  local solid = f:CreateTexture(nil, "BACKGROUND")
  solid:SetTexture(0.05, 0.05, 0.07, 1)
  solid:SetPoint("TOPLEFT", f, "TOPLEFT", 11, -11)
  solid:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -11, 11)
end

local function Cut(text, max)
  if string.len(text) <= max then return text end
  return string.sub(text, 1, max - 3) .. "..."
end

local function Capital(s)
  return string.upper(string.sub(s, 1, 1)) .. string.sub(s, 2)
end

-- Faction, level, zone and map position of the player.
local function Me()
  local faction = UnitFactionGroup and UnitFactionGroup("player") or "Alliance"
  local zone, _, x, y = ER.Where()
  return faction, UnitLevel("player") or 1, zone, x, y
end

local function SameZone(a, b)
  return a and b and string.lower(a) == string.lower(b)
end

local function HubKey(h)
  return (h.giver or "?") .. "|" .. math.floor(h.x) .. "," .. math.floor(h.y)
end

-- Puts a marker on the map and says where (Guide.lua does both), or says it does not know.
local function PointAt(w, label)
  if w and w.map and w.x and w.y then
    ER.PointTo(w.map, w.x, w.y, label)
  else
    Say("I don't know where that is. " .. WHITE .. "Look in your quest log" .. END .. " for what to do.")
  end
end

-- Everything the wizard says about one quest: its sentence, who takes it back, and where its targets are.
local function Info(q)
  local info = { q = q, targets = {} }
  info.objective = ER.QuestObjective and ER.QuestObjective(q.id) or nil
  local facts = ER.QuestFacts and ER.QuestFacts(q.id) or nil
  if facts then
    if facts.taker then info.taker = { name = facts.taker.name, w = facts.taker.where } end
    for name, o in pairs(facts.objectives or {}) do
      table.insert(info.targets, { name = Capital(name), kind = o.kind, w = o.where })
    end
    table.sort(info.targets, function(a, b) return a.name < b.name end)
  end
  return info
end

local function PlaceText(w)
  if not w then return nil end
  if w.area then return w.area .. " " .. Where(w.x, w.y) end
  return w.map .. " " .. Where(w.x, w.y)
end

local function Status(q)
  if ER.IsDone(q) then return GREY .. "  (handed in)" .. END end
  if ER.InLog and ER.InLog(q) then return GOLD .. "  (in your log)" .. END end
  return ""
end

------------------------------------------------------------------------------------------------------
-- What each screen needs
------------------------------------------------------------------------------------------------------

-- Areas to suggest: this one if plenty of quests suit you here, then the best other places.
local function BuildChoices()
  local _, level = Me()
  local mode = ER.Mode()
  local plan = ER.Plan()
  local list = {}
  if plan.zid and plan.count > ER.MODES[mode].leaveAt then
    local h = plan.hubs[1]
    table.insert(list, { name = plan.zone, count = plan.count, here = true,
      giver = h and h.giver, x = h and h.x, y = h and h.y })
  end
  local nxt = ER.WhereNext(level, mode, plan.zid)
  for i = 1, math.min(4, table.getn(nxt)) do
    local n = nxt[i]
    table.insert(list, { name = n.name, count = n.count, giver = n.giver, x = n.x, y = n.y })
  end
  state.choices, state.pick = list, 1
end

-- Picks the next stop in the chosen zone: the best group of quests, near you if you are there.
local function BeginStop()
  local _, level, zone, px, py = Me()
  local mode = ER.Mode()
  local plan
  if SameZone(zone, state.zone) then
    plan = ER.Plan(state.zone, level, mode, px, py)
  else
    plan = ER.Plan(state.zone, level, mode)
  end
  local hub
  for _, h in ipairs(plan.hubs) do
    if not state.skipped[HubKey(h)] then hub = h break end
  end
  if not hub then
    state.stop = nil
    screen = "done"
    return
  end
  local ids = {}
  for i = 1, math.min(ROWS, table.getn(hub.items)) do table.insert(ids, hub.items[i].q.id) end
  state.stops = state.stops + 1
  state.stop = { zone = state.zone, giver = hub.giver, x = hub.x, y = hub.y, ids = ids,
    more = table.getn(hub.items) - table.getn(ids), key = HubKey(hub), number = state.stops }
  state.phase = 1
  screen = "step"
end

local function GrindHere()
  local _, level, zone, px, py = Me()
  local zid = ER.ZoneId(state.zone)
  local spots = zid and ER.GrindSpots(zid, level, SameZone(zone, state.zone) and px or nil,
    SameZone(zone, state.zone) and py or nil, 1) or {}
  local s = spots[1]
  if s then
    local mobs = table.concat(s.mobs, ", ")
    Say("a spot to grind: " .. WHITE .. mobs .. END .. ", levels " .. s.lo .. " to " .. s.hi .. ".")
    ER.PointTo(state.zone, s.x, s.y, "mobs to grind: " .. mobs)
  else
    Say("I have no good grinding spot on file for your level here.")
  end
end

------------------------------------------------------------------------------------------------------
-- Drawing
------------------------------------------------------------------------------------------------------

local function HideAll()
  for i = 1, table.getn(buttons) do buttons[i]:Hide() end
  for i = 1, ROWS do rows[i].info = nil rows[i]:Hide() end
  moreText:SetText("")
end

-- Shows button i with a label, a place and what it does.
local function Btn(i, label, x, y, w, fn)
  local b = buttons[i]
  b:ClearAllPoints()
  b:SetPoint("TOPLEFT", frame, "TOPLEFT", x, y)
  b:SetWidth(w)
  b:SetHeight(22)
  b:SetText(label)
  b.fn = fn
  b:Show()
end

local function ChangeMood()
  screen = "mood"
  Refresh()
end

local function ShowMood()
  local faction, level, zone = Me()
  subtitle:SetText(GREY .. "level " .. level .. " " .. faction .. (zone and (" - " .. zone) or "") .. END)
  bodyText:SetText(GOLD .. "How do you want to play?" .. END .. "\n\nI'll look at your level and find quests that suit you, " ..
    "then take you through them one stop at a time. Pick how hard you want it:")
  local keys = ER.MODE_ORDER
  local tips = {
    casual = "Casual - easy quests, nearly everything in an area",
    medium = "Medium - some challenge, a good few quests per area",
    normal = "Hard - harder quests, fewer per area, move on sooner",
  }
  for i = 1, table.getn(keys) do
    local key = keys[i]
    Btn(i, tips[key] or key, LEFT, -170 - (i - 1) * 40, INNER_W, function()
      ER.SetMode(key)
      if ER.db then
        if type(ER.db.wizardAsked) ~= "table" then ER.db.wizardAsked = {} end
        ER.db.wizardAsked[ER.Char()] = true   -- this character has picked a difficulty
      end
      BuildChoices()
      screen = "area"
      Refresh()
    end)
    buttons[i]:SetHeight(30)
  end
  footText:SetText(GREY .. "You can change this any time." .. END)
end

local function ShowArea()
  local _, level = Me()
  local mode = ER.MODES[ER.Mode()]
  subtitle:SetText(GREY .. "level " .. level .. " - " .. mode.label .. END)
  local c = state.choices[state.pick]
  if not c then
    bodyText:SetText(GOLD .. "I can't find a good area for you right now." .. END ..
      "\n\nTry a different difficulty, or walk into a zone with quests and open me again.")
    Btn(1, "Change difficulty", LEFT, -200, 200, ChangeMood)
    return
  end
  local text = GOLD .. "I suggest: " .. c.name .. END .. "\n\n"
  if c.here then
    text = text .. "You are already here. " .. WHITE .. c.count .. END .. " quests suit you in this area."
  else
    text = text .. "It is a trip from where you are. " .. WHITE .. c.count .. END .. " quests suit you there."
  end
  if c.giver and c.x then
    text = text .. "\n\nBest place to start: " .. WHITE .. c.giver .. END .. " " .. Where(c.x, c.y) .. "."
  end
  bodyText:SetText(text)
  Btn(1, "Go with this", LEFT, -230, 200, function()
    state.zone, state.skipped, state.stops = c.name, {}, 0
    if c.here then
      BeginStop()
    else
      screen = "travel"
    end
    Refresh()
  end)
  if table.getn(state.choices) > 1 then
    Btn(2, "Show me another", LEFT + 210, -230, 200, function()
      state.pick = math.mod(state.pick, table.getn(state.choices)) + 1
      Refresh()
    end)
  end
  Btn(3, "Change difficulty", LEFT, -264, 200, ChangeMood)
  footText:SetText(GREY .. state.pick .. " of " .. table.getn(state.choices) .. " suggestions" .. END)
end

local function ShowTravel()
  local c = state.choices[state.pick]
  subtitle:SetText(GREY .. "on the way to " .. state.zone .. END)
  local text = GOLD .. "First, get to " .. state.zone .. END .. "\n\n"
  if c and c.giver and c.x then
    text = text .. "Head for " .. WHITE .. c.giver .. END .. " " .. Where(c.x, c.y) .. ", where the first quests are."
  else
    text = text .. "Travel there, then come back to me."
  end
  bodyText:SetText(text)
  if c and c.x then
    Btn(1, "Show me where", LEFT, -200, 200, function()
      ER.PointTo(state.zone, c.x, c.y, "the first quests near " .. (c.giver or "the quest giver"))
    end)
  end
  Btn(2, "I'm there", LEFT + 210, -200, 200, function()
    BeginStop()
    Refresh()
  end)
  Btn(3, "Back", LEFT, -234, 200, function()
    screen = "area"
    Refresh()
  end)
end

local function ShowDone()
  subtitle:SetText(GREY .. state.zone .. END)
  bodyText:SetText(GOLD .. "That's the area done." .. END .. "\n\nThere are no more quests in " .. state.zone ..
    " that suit you right now. Shall I find somewhere else?")
  Btn(1, "Where next?", LEFT, -200, 200, function()
    BuildChoices()
    screen = "area"
    Refresh()
  end)
  Btn(2, "Change difficulty", LEFT + 210, -200, 200, ChangeMood)
end

-- The line under each quest, by phase: what it asks, where to look, or who to hand it in to.
local function SecondLine(info, phase)
  if phase == 1 then
    if info.objective then return "What to do: " .. Cut(info.objective, 130) end
    return "You will see what to do in your quest log."
  elseif phase == 2 then
    local parts = {}
    if info.objective then table.insert(parts, Cut(info.objective, 100)) end
    local t = info.targets[1]
    if t and t.w then table.insert(parts, "Look " .. (PlaceText(t.w) and ("around " .. PlaceText(t.w)) or "in your quest log") .. " for " .. t.name .. ".") end
    if table.getn(parts) == 0 then return "Do what the quest log says." end
    return table.concat(parts, " ")
  else
    if info.taker and info.taker.name then
      local place = PlaceText(info.taker.w)
      return "Hand in to " .. info.taker.name .. (place and (" - " .. place) or ".")
    end
    return "Hand it in where your quest log says."
  end
end

local function RowTooltip(row)
  local info = row.info
  if not info then return end
  GameTooltip:SetOwner(row, "ANCHOR_RIGHT")
  GameTooltip:SetText(info.q.n)
  GameTooltip:AddLine("Level " .. info.q.l .. ", " .. ER.WhyQuest({ q = info.q, diff = info.q.l - (UnitLevel("player") or 1), chain = ER.ChainOf(info.q.id) }), 0.8, 0.8, 0.8, 1)
  if info.objective then GameTooltip:AddLine(info.objective, 1, 1, 1, 1) end
  if info.taker and info.taker.name then
    GameTooltip:AddLine("Hand in to " .. info.taker.name .. (PlaceText(info.taker.w) and (", " .. PlaceText(info.taker.w)) or ""), 1, 0.82, 0, 1)
  end
  GameTooltip:AddLine(" ")
  GameTooltip:AddLine("Click: put a marker where this step happens.", 0.6, 0.6, 0.6, 1)
  GameTooltip:Show()
end

local function RowClick(row)
  local info, stop = row.info, state.stop
  if not info or not stop then return end
  if state.phase == 1 then
    ER.PointTo(stop.zone, stop.x, stop.y, stop.giver)
  elseif state.phase == 2 then
    local t = info.targets[1]
    PointAt(t and t.w, (t and t.name or "the quest") .. " for " .. info.q.n)
  else
    PointAt(info.taker and info.taker.w, (info.taker and info.taker.name or "the hand-in") .. " for " .. info.q.n)
  end
end

local function ShowStep()
  local stop = state.stop
  local _, level = Me()
  local mode = ER.MODES[ER.Mode()]
  subtitle:SetText(GREY .. stop.zone .. " - level " .. level .. " - " .. mode.label .. " - stop " .. stop.number .. END)
  local phase = state.phase
  if phase == 1 then
    bodyText:SetText(GOLD .. "Step 1 of 3: pick up the quests" .. END .. "\nGo to " .. WHITE .. stop.giver .. END .. " " ..
      Where(stop.x, stop.y) .. " and accept these:")
  elseif phase == 2 then
    bodyText:SetText(GOLD .. "Step 2 of 3: do the quests" .. END .. "\nWork through them. Click a quest to mark where to look.")
  else
    bodyText:SetText(GOLD .. "Step 3 of 3: hand them in" .. END .. "\nWhen they are finished, take them back. Click a quest to mark where.")
  end

  for i, id in ipairs(stop.ids) do
    local q = ER.QuestRow(id)
    local row = rows[i]
    if q then
      local info = Info(q)
      local chain = ER.ChainOf(q.id)
      local diff = q.l - level
      local colour = COLOURS[ER.QuestColour(diff)] or ""
      local mark = chain and (GOLD .. "  chain " .. chain.pos .. "/" .. chain.len .. END) or ""
      row.info = info
      row.text:SetText(colour .. "[" .. q.l .. "]" .. END .. " " .. q.n .. mark .. Status(q) .. "\n" .. GREY .. SecondLine(info, phase) .. END)
      row:ClearAllPoints()
      row:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT, -118 - (i - 1) * ROW_H)
      row:Show()
    end
  end
  if stop.more > 0 then
    moreText:SetText(GREY .. "... and " .. stop.more .. " more quests here. They will come up in a later stop." .. END)
  end

  local y1, y2 = -118 - ROWS * ROW_H - 26, -118 - ROWS * ROW_H - 58
  if phase == 1 then
    Btn(1, "Show me where", LEFT, y1, 140, function() ER.PointTo(stop.zone, stop.x, stop.y, stop.giver) end)
    Btn(2, "I've picked them up >", LEFT + 148, y1, 180, function() state.phase = 2 Refresh() end)
    Btn(3, "Skip this stop", LEFT + 336, y1, 96, function()
      state.skipped[stop.key] = true
      BeginStop()
      Refresh()
    end)
  elseif phase == 2 then
    Btn(1, "< Back", LEFT, y1, 140, function() state.phase = 1 Refresh() end)
    Btn(2, "Ready to hand in >", LEFT + 148, y1, 180, function() state.phase = 3 Refresh() end)
  else
    Btn(1, "< Back", LEFT, y1, 140, function() state.phase = 2 Refresh() end)
    Btn(2, "Next stop >", LEFT + 148, y1, 180, function()
      BeginStop()
      Refresh()
    end)
  end
  Btn(4, "Grind spot", LEFT, y2, 100, GrindHere)
  Btn(5, "Difficulty", LEFT + 108, y2, 100, ChangeMood)
  Btn(6, "Other area", LEFT + 216, y2, 100, function()
    BuildChoices()
    screen = "area"
    Refresh()
  end)
  Btn(7, "Notebook", LEFT + 324, y2, 108, function() if ER.ToggleWindow then ER.ToggleWindow() end end)
  footText:SetText(GREY .. "All stops at once: /er go" .. END)
end

Refresh = function()
  if not frame then return end
  HideAll()
  footText:SetText("")
  if screen == "step" and not state.stop then screen = "area" end
  if screen == "area" and table.getn(state.choices) == 0 and not state.built then
    BuildChoices()
    state.built = true
  end
  if screen == "mood" then ShowMood()
  elseif screen == "area" then ShowArea()
  elseif screen == "travel" then ShowTravel()
  elseif screen == "done" then ShowDone()
  else ShowStep() end
end

------------------------------------------------------------------------------------------------------
-- Building the window
------------------------------------------------------------------------------------------------------

local function Build()
  frame = CreateFrame("Frame", "EasyRouteWizardFrame", UIParent)
  frame:SetWidth(WIDTH)
  frame:SetHeight(HEIGHT)
  frame:SetPoint("CENTER", UIParent, "CENTER", 0, 20)
  frame:SetFrameStrata("HIGH")
  frame:SetClampedToScreen(true)
  frame:EnableMouse(true)
  frame:SetMovable(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", function() this:StartMoving() end)
  frame:SetScript("OnDragStop", function() this:StopMovingOrSizing() end)
  frame:SetScript("OnShow", function()
    -- Opening it again after the first time goes straight to the area suggestion, not the difficulty question.
    if screen == "mood" and ER.db and type(ER.db.wizardAsked) == "table" and ER.db.wizardAsked[ER.Char()] then
      BuildChoices()
      state.built = true
      screen = "area"
    end
    Refresh()
  end)
  Opaque(frame)
  frame:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  frame:Hide()
  table.insert(UISpecialFrames, "EasyRouteWizardFrame")

  local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOP", frame, "TOP", 0, -18)
  title:SetText("Easy Route")
  subtitle = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  subtitle:SetPoint("TOP", title, "BOTTOM", 0, -3)

  local close = CreateFrame("Button", "EasyRouteWizardClose", frame, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -6, -6)
  close:SetScript("OnClick", function() frame:Hide() end)

  bodyText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  bodyText:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT, -58)
  bodyText:SetWidth(INNER_W)
  bodyText:SetHeight(54)
  bodyText:SetJustifyH("LEFT")
  bodyText:SetJustifyV("TOP")

  for i = 1, ROWS do
    local row = CreateFrame("Button", "EasyRouteWizardRow" .. i, frame)
    row:SetWidth(INNER_W)
    row:SetHeight(ROW_H)
    local glow = row:CreateTexture(nil, "HIGHLIGHT")
    glow:SetTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight")
    glow:SetBlendMode("ADD")
    glow:SetAllPoints(row)
    row.text = row:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    row.text:SetPoint("TOPLEFT", row, "TOPLEFT", 4, -3)
    row.text:SetWidth(INNER_W - 8)
    row.text:SetHeight(ROW_H - 4)
    row.text:SetJustifyH("LEFT")
    row.text:SetJustifyV("TOP")
    row:SetScript("OnEnter", function() RowTooltip(this) end)
    row:SetScript("OnLeave", function() GameTooltip:Hide() end)
    row:SetScript("OnClick", function() RowClick(this) end)
    row:Hide()
    rows[i] = row
  end

  moreText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  moreText:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT, -118 - ROWS * ROW_H)
  moreText:SetWidth(INNER_W)
  moreText:SetJustifyH("LEFT")

  for i = 1, 8 do
    local b = CreateFrame("Button", "EasyRouteWizardBtn" .. i, frame, "UIPanelButtonTemplate")
    b:SetWidth(100)
    b:SetHeight(22)
    b:SetScript("OnClick", function() if this.fn then this.fn() end end)
    b:Hide()
    buttons[i] = b
  end

  footText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  footText:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", LEFT, 22)

  local credit = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  credit:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -24, 22)
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
end

function ER.ToggleWizard()
  if not frame then Build() end
  if frame:IsShown() then frame:Hide() else frame:Show() end
end

function ER.ShowWizard()
  if not frame then Build() end
  frame:Show()
end

-- The first time on each character the wizard opens by itself, a few seconds after the game has settled, so a
-- new character starts with the question. It only does this once per character; /er opens it any time.
local starter = CreateFrame("Frame", "EasyRouteWizardStarter")
starter:RegisterEvent("PLAYER_ENTERING_WORLD")
starter:SetScript("OnEvent", function()
  this:UnregisterEvent("PLAYER_ENTERING_WORLD")
  if not ER.db then return end
  if type(ER.db.wizardChars) ~= "table" then ER.db.wizardChars = {} end
  local who = ER.Char()
  if ER.db.wizardChars[who] then return end
  ER.db.wizardChars[who] = true
  this.wait = 0
  this:SetScript("OnUpdate", function()
    this.wait = this.wait + arg1
    if this.wait < 4 then return end
    this:SetScript("OnUpdate", nil)
    if not frame or not frame:IsShown() then
      screen, state.stop = "mood", nil   -- always start with the difficulty question
      ER.ShowWizard()
    end
  end)
end)

-- What the wizard is showing, for the self-test.
function ER.WizardInfo()
  if not frame then return nil end
  return { screen = screen, text = bodyText:GetText(), stop = state.stop, phase = state.phase }
end
