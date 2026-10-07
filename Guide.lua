-- Easy Route: the director window (/er go). It shows where you are, which quests are worth doing here in
-- stops (quests handed out close together, so you collect them in one visit), chains worth following, a
-- spot to grind when you want a break, and when the area is used up it asks where you would like to go.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local WIDTH, HEIGHT = 450, 570
local ROWS, ROW_H = 9, 20
local LEFT, INNER_W = 22, 406
local COLOURS = { red = "|cffff4040", orange = "|cffff8040", yellow = "|cffffff00", green = "|cff40c040" }

local frame, subtitle, modeButtons, askText, askButtons, stopText, rows, chainLines, grindLines
local plan, stop = nil, 1
local lastZone

modeButtons, askButtons, rows, chainLines, grindLines = {}, {}, {}, {}, {}

local function Opaque(f)
  local solid = f:CreateTexture(nil, "BACKGROUND")
  solid:SetTexture(0.05, 0.05, 0.07, 1)
  solid:SetPoint("TOPLEFT", f, "TOPLEFT", 11, -11)
  solid:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -11, 11)
end

local function Explain(widget, title, text)
  widget:SetScript("OnEnter", function()
    GameTooltip:SetOwner(this, "ANCHOR_RIGHT")
    GameTooltip:SetText(title)
    if text then GameTooltip:AddLine(text, 1, 1, 1, 1) end
    GameTooltip:Show()
  end)
  widget:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

local function Button(name, parent, width, text)
  local b = CreateFrame("Button", name, parent, "UIPanelButtonTemplate")
  b:SetWidth(width)
  b:SetHeight(22)
  b:SetText(text)
  return b
end

local function Say(msg)
  if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99Easy Route:|r " .. msg) end
end

local function Where(x, y)
  return "(" .. math.floor(x + 0.5) .. ", " .. math.floor(y + 0.5) .. ")"
end

------------------------------------------------------------------------------------------------------
-- Pointing at a place
------------------------------------------------------------------------------------------------------

-- Says where to go, and when pfQuest is there puts a marker on the map and minimap and aims its arrow at it.
-- The pfQuest part is a best effort: if anything in it fails, the chat line still tells you where to go.
function ER.PointTo(zone, x, y, label)
  Say("go to " .. GOLD .. label .. END .. " in " .. zone .. " " .. Where(x, y) .. ".")
  if pfMap and pfMap.AddNode and pfMap.GetMapIDByName and pfQuest and pfQuest.route and pfQuest.route.SetTarget then
    pcall(function()
      local mapId = pfMap:GetMapIDByName(zone)
      if not mapId then return end
      pfMap:DeleteNode("EASYROUTE")
      pfMap:AddNode({ addon = "EASYROUTE", zone = mapId, x = x, y = y, title = label, spawn = label,
        spawntype = "Easy Route", level = "", respawn = "N/A" })
      local nodes = pfMap:GetNodes("EASYROUTE", label)
      if nodes and nodes[1] then pfQuest.route.SetTarget(nodes[1]) end
      if pfMap.UpdateNodes then pfMap:UpdateNodes() end
    end)
  end
end

------------------------------------------------------------------------------------------------------
-- Filling the window
------------------------------------------------------------------------------------------------------

local function StayedRecently(zone)
  local t = ER.db and ER.db.stay and ER.db.stay[zone]
  return t and (time() - t) < 900
end

local function Refresh()
  if not frame or not frame:IsShown() then return end
  plan = ER.Plan()
  if plan.zone ~= lastZone then stop = 1 lastZone = plan.zone end
  local mode = ER.MODES[plan.mode]
  subtitle:SetText(GREY .. plan.zone .. "  -  level " .. plan.level .. "  -  " .. plan.count .. " quests fit you here" .. END)

  for _, b in ipairs(modeButtons) do
    if b.key == plan.mode then
      b:LockHighlight()
      b:SetText(GOLD .. b.label .. END)
    else
      b:UnlockHighlight()
      b:SetText(b.label)
    end
  end

  -- The question: used up here, where would you like to go?
  for _, b in ipairs(askButtons) do b:Hide() end
  if not plan.zid then
    askText:SetText("I have no quests on file for " .. plan.zone .. ". Walk into a zone with quests, or use the notebook " .. GOLD .. "/er" .. END .. ".")
  elseif plan.leave and not StayedRecently(plan.zone) then
    askText:SetText(GOLD .. "Almost done here." .. END .. " Only " .. plan.count .. " quest" .. (plan.count == 1 and "" or "s") ..
      " left that suit you. Where next?")
    for i = 1, 3 do
      local n = plan.next[i]
      local b = askButtons[i]
      if n then
        b.target = n
        b:SetText(n.name)
        b:Show()
      end
    end
    askButtons[4].zoneName = plan.zone
    askButtons[4]:Show()
  elseif plan.count == 0 then
    askText:SetText("Nothing here fits you right now. Try a grind spot below, or ask where next.")
    askButtons[5]:Show()
  else
    askText:SetText(GREY .. mode.label .. ": " .. mode.tip .. END)
    askButtons[5]:Show()
  end

  -- The stop.
  local hubs = plan.hubs
  local total = table.getn(hubs)
  if stop > total then stop = total end
  if stop < 1 then stop = 1 end
  local hub = hubs[stop]
  if hub then
    stopText:SetText(GOLD .. "Stop " .. stop .. " of " .. total .. ":" .. END .. " around " .. hub.giver .. " " .. Where(hub.x, hub.y) ..
      GREY .. ", " .. table.getn(hub.items) .. " quests" .. END)
  else
    stopText:SetText(GREY .. "No stops to show." .. END)
  end
  for i = 1, ROWS do
    local row = rows[i]
    local c = hub and hub.items[i]
    if c then
      local mark = c.chain and (GOLD .. "  chain " .. c.chain.pos .. "/" .. c.chain.len .. END) or ""
      row.text:SetText((COLOURS[c.colour] or "") .. "[" .. c.q.l .. "]" .. END .. " " .. c.q.n .. mark)
      row.cand = c
      row:Show()
    else
      row.cand = nil
      row:Hide()
    end
  end
  if hub and table.getn(hub.items) > ROWS then
    rows[ROWS].text:SetText(GREY .. "... and " .. (table.getn(hub.items) - ROWS + 1) .. " more here" .. END)
    rows[ROWS].cand = nil
  end

  -- Chains worth doing.
  for i = 1, 2 do
    local line = chainLines[i]
    local ch = plan.chains[i]
    if ch then
      local text = WHITE .. ch.name .. END .. GREY .. " - " .. ch.len .. " quests, levels " .. ch.lo .. "-" .. ch.hi
      if ch.xp > 0 then text = text .. ", about " .. ch.xp .. " xp" end
      if ch.rewards then text = text .. ", rewards" end
      line.text:SetText(text .. END)
      line.chain = ch
      line:Show()
    else
      line.chain = nil
      line:Hide()
    end
  end

  -- Grinding.
  for i = 1, 2 do
    local line = grindLines[i]
    local g = plan.grind[i]
    if g then
      line.text:SetText(WHITE .. table.concat(g.mobs, ", ") .. END .. GREY .. " around " .. Where(g.x, g.y) .. ", levels " .. g.lo .. "-" .. g.hi .. END)
      line.spot = g
      line:Show()
    else
      line.spot = nil
      if i == 1 then
        line.text:SetText(GREY .. "No good grinding spot on file for your level in this zone." .. END)
        line:Show()
      else
        line:Hide()
      end
    end
  end
end
ER.RefreshDirector = Refresh

------------------------------------------------------------------------------------------------------
-- Building the window
------------------------------------------------------------------------------------------------------

local function SectionTitle(text, y)
  local fs = frame:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  fs:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT, y)
  fs:SetText(text)
  return fs
end

local function MakeRow(i, y, parent)
  local row = CreateFrame("Button", "EasyRouteGuideRow" .. i, parent or frame)
  row:SetWidth(INNER_W)
  row:SetHeight(ROW_H)
  row:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT, y)
  local glow = row:CreateTexture(nil, "HIGHLIGHT")
  glow:SetTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight")
  glow:SetBlendMode("ADD")
  glow:SetAllPoints(row)
  row.text = row:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  row.text:SetPoint("LEFT", row, "LEFT", 4, 0)
  row.text:SetWidth(INNER_W - 70)
  row.text:SetHeight(ROW_H)
  row.text:SetJustifyH("LEFT")
  return row
end

local function QuestTooltip(row)
  local c = row.cand
  if not c then return end
  GameTooltip:SetOwner(row, "ANCHOR_RIGHT")
  GameTooltip:SetText(c.q.n)
  GameTooltip:AddLine("Level " .. c.q.l .. ", " .. ER.WhyQuest(c), 0.8, 0.8, 0.8, 1)
  if c.q.g then GameTooltip:AddLine("From " .. c.q.g .. " " .. Where(c.q.x, c.q.y), 1, 1, 1, 1) end
  if c.chain then
    local sum = ER.ChainSummary(c.chain)
    GameTooltip:AddLine(" ")
    GameTooltip:AddLine("Chain of " .. c.chain.len .. " quests, levels " .. sum.lo .. "-" .. sum.hi .. (sum.rewards and ", with rewards" or ""), 1, 0.82, 0, 1)
  end
  GameTooltip:AddLine(" ")
  GameTooltip:AddLine("Click: show me where. Right-click: not today.", 0.6, 0.6, 0.6, 1)
  GameTooltip:Show()
end

local function Build()
  frame = CreateFrame("Frame", "EasyRouteGuideFrame", UIParent)
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
  frame:SetScript("OnShow", function() Refresh() end)
  Opaque(frame)
  frame:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  frame:Hide()
  table.insert(UISpecialFrames, "EasyRouteGuideFrame")

  local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOP", frame, "TOP", 0, -18)
  title:SetText("Easy Route")
  subtitle = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  subtitle:SetPoint("TOP", title, "BOTTOM", 0, -3)

  local close = CreateFrame("Button", "EasyRouteGuideClose", frame, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -6, -6)
  close:SetScript("OnClick", function() frame:Hide() end)

  -- Mood buttons.
  for i, key in ipairs(ER.MODE_ORDER) do
    local m = ER.MODES[key]
    local b = Button("EasyRouteGuideMode" .. i, frame, 90, m.label)
    b:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT + (i - 1) * 96, -58)
    b.key, b.label = key, m.label
    b:SetScript("OnClick", function() ER.SetMode(this.key) end)
    Explain(b, m.label, m.tip)
    modeButtons[i] = b
  end

  -- The question line and its answers.
  askText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  askText:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT, -92)
  askText:SetWidth(INNER_W)
  askText:SetHeight(32)
  askText:SetJustifyH("LEFT")
  askText:SetJustifyV("TOP")
  for i = 1, 3 do
    local b = Button("EasyRouteGuideAsk" .. i, frame, 130, "")
    b:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT + (i - 1) * 136, -128)
    b:SetScript("OnClick", function()
      local n = this.target
      if n then ER.PointTo(n.name, n.x, n.y, "the first quests near " .. n.giver) end
    end)
    b:SetScript("OnEnter", function()
      local n = this.target
      if not n then return end
      GameTooltip:SetOwner(this, "ANCHOR_RIGHT")
      GameTooltip:SetText(n.name)
      GameTooltip:AddLine(n.count .. " quests fit you there. Start near " .. n.giver .. " " .. Where(n.x, n.y) .. ".", 1, 1, 1, 1)
      GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    askButtons[i] = b
  end
  local stay = Button("EasyRouteGuideStay", frame, 130, "Stay a while")
  stay:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT, -154)
  stay:SetScript("OnClick", function()
    if not ER.db.stay then ER.db.stay = {} end
    ER.db.stay[this.zoneName or lastZone or "?"] = time()
    Refresh()
  end)
  Explain(stay, "Stay a while", "Stop asking about this area for 15 minutes.")
  askButtons[4] = stay
  local whereNext = Button("EasyRouteGuideWhere", frame, 130, "Where next?")
  whereNext:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT, -128)
  whereNext:SetScript("OnClick", function()
    if ER.db.stay and plan then ER.db.stay[plan.zone] = nil end
    plan.leave = true
    plan.next = ER.WhereNext(plan.level, plan.mode, plan.zid)
    -- show the answers without waiting for the next refresh
    askText:SetText(GOLD .. "Good places for your level:" .. END)
    for i = 1, 3 do
      local n = plan.next[i]
      askButtons[i].target = n
      if n then askButtons[i]:SetText(n.name) askButtons[i]:Show() else askButtons[i]:Hide() end
    end
    this:Hide()
  end)
  askButtons[5] = whereNext

  -- Stop header, rows and stop buttons.
  stopText = SectionTitle("", -190)
  for i = 1, ROWS do
    local row = MakeRow(i, -212 - (i - 1) * ROW_H)
    row:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    row:SetScript("OnEnter", function() QuestTooltip(this) end)
    row:SetScript("OnLeave", function() GameTooltip:Hide() end)
    row:SetScript("OnClick", function()
      local c = this.cand
      if not c then return end
      if arg1 == "RightButton" then
        ER.SkipQuest(c.q.id)
        Say("not today: " .. c.q.n .. ". " .. GOLD .. "/er unskip" .. END .. " brings them all back.")
        Refresh()
      else
        ER.PointTo(plan.zone, c.q.x, c.q.y, (c.q.g or "the quest giver") .. " for " .. c.q.n)
      end
    end)
    rows[i] = row
  end
  local yb = -212 - ROWS * ROW_H - 4
  local prev = Button("EasyRouteGuidePrev", frame, 90, "< Stop")
  prev:SetPoint("TOPLEFT", frame, "TOPLEFT", LEFT, yb)
  prev:SetScript("OnClick", function() stop = stop - 1 Refresh() end)
  local nextb = Button("EasyRouteGuideNext", frame, 90, "Stop >")
  nextb:SetPoint("LEFT", prev, "RIGHT", 6, 0)
  nextb:SetScript("OnClick", function() stop = stop + 1 Refresh() end)
  local go = Button("EasyRouteGuideGo", frame, 130, "Show me this stop")
  go:SetPoint("LEFT", nextb, "RIGHT", 6, 0)
  go:SetScript("OnClick", function()
    local hub = plan and plan.hubs[stop]
    if hub then ER.PointTo(plan.zone, hub.x, hub.y, hub.giver) end
  end)
  Explain(go, "Show me this stop", "Tells you where it is, and puts a marker and the arrow there when pfQuest is installed.")

  -- Chains.
  local y = yb - 36
  SectionTitle("Chains worth doing here", y)
  for i = 1, 2 do
    local line = MakeRow(100 + i, y - 18 - (i - 1) * ROW_H)
    line.text:SetWidth(INNER_W)
    line:SetScript("OnEnter", function()
      local ch = this.chain
      if not ch then return end
      GameTooltip:SetOwner(this, "ANCHOR_RIGHT")
      GameTooltip:SetText(ch.name)
      GameTooltip:AddLine("Carry on with: " .. ch.start.q.n .. (ch.start.q.g and (" (from " .. ch.start.q.g .. ")") or ""), 1, 1, 1, 1)
      GameTooltip:AddLine("Click: show me where.", 0.6, 0.6, 0.6, 1)
      GameTooltip:Show()
    end)
    line:SetScript("OnLeave", function() GameTooltip:Hide() end)
    line:SetScript("OnClick", function()
      local ch = this.chain
      if ch then ER.PointTo(plan.zone, ch.start.q.x, ch.start.q.y, (ch.start.q.g or "the quest giver") .. " for " .. ch.start.q.n) end
    end)
    chainLines[i] = line
  end

  -- Grinding.
  y = y - 18 - 2 * ROW_H - 12
  SectionTitle("Want a break? Grind here", y)
  for i = 1, 2 do
    local line = MakeRow(200 + i, y - 18 - (i - 1) * ROW_H)
    line.text:SetWidth(INNER_W)
    line:SetScript("OnEnter", function()
      local s = this.spot
      if not s then return end
      GameTooltip:SetOwner(this, "ANCHOR_RIGHT")
      GameTooltip:SetText("Good mobs for level " .. plan.level)
      GameTooltip:AddLine(s.count .. " of them stand around here, " .. s.lo .. " to " .. s.hi .. ": never more than " ..
        ER.GRIND_BEHIND .. " below you, up to " .. ER.GRIND_AHEAD .. " above.", 1, 1, 1, 1)
      GameTooltip:AddLine("Click: show me where.", 0.6, 0.6, 0.6, 1)
      GameTooltip:Show()
    end)
    line:SetScript("OnLeave", function() GameTooltip:Hide() end)
    line:SetScript("OnClick", function()
      local s = this.spot
      if s then ER.PointTo(plan.zone, s.x, s.y, "mobs to grind: " .. table.concat(s.mobs, ", ")) end
    end)
    grindLines[i] = line
  end

  local notebook = Button("EasyRouteGuideNotebook", frame, 110, "Notebook")
  notebook:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", LEFT, 20)
  notebook:SetScript("OnClick", function() if ER.ToggleWindow then ER.ToggleWindow() end end)
  Explain(notebook, "Notebook", "Rate quests and read the journal (/er).")
  local refresh = Button("EasyRouteGuideRefresh", frame, 90, "Refresh")
  refresh:SetPoint("LEFT", notebook, "RIGHT", 6, 0)
  refresh:SetScript("OnClick", function() Refresh() end)
  local foot = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  foot:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -24, 24)
  foot:SetText(GREY .. "click a quest to find it, right-click for not today" .. END)
end

function ER.ToggleGuide()
  if not frame then Build() end
  if frame:IsShown() then frame:Hide() else frame:Show() end
end

function ER.ShowGuide()
  if not frame then Build() end
  frame:Show()
end

------------------------------------------------------------------------------------------------------
-- Staying in touch: refresh while open, and a short nudge on a new zone or a new level
------------------------------------------------------------------------------------------------------

local watcher = CreateFrame("Frame")
watcher:RegisterEvent("PLAYER_LEVEL_UP")
watcher:RegisterEvent("ZONE_CHANGED_NEW_AREA")
watcher:RegisterEvent("QUEST_LOG_UPDATE")
local nextRefresh = 0
local greeted = nil
watcher:SetScript("OnEvent", function()
  if not ER.db then return end
  if event == "QUEST_LOG_UPDATE" then
    if frame and frame:IsShown() and GetTime() > nextRefresh then
      nextRefresh = GetTime() + 2
      Refresh()
    end
    return
  end
  if frame and frame:IsShown() then Refresh() return end
  -- Closed: one calm line, not a popup.
  local zone = GetZoneText()
  local level = event == "PLAYER_LEVEL_UP" and tonumber(arg1) or UnitLevel("player")
  local key = (zone or "?") .. ":" .. (level or 0)
  if key == greeted or not zone or zone == "" then return end
  greeted = key
  local p = ER.Plan(zone, level, ER.Mode())
  if not p.zid then return end
  Say(zone .. ", level " .. level .. ": " .. p.count .. " quests fit you here (" .. ER.MODES[p.mode].label .. "). " .. GOLD .. "/er go" .. END .. " to see them.")
end)
