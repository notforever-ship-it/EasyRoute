-- Easy Route: the step window, laid out like RestedXP's. At the top, the step you are on in a box ("Step 12"), with
-- a tick for each thing in it as you do it and the count for kill and collect objectives; under it the guide's name
-- with a gear for the guide menu; then the next few steps (click one to jump to it); and < > to step by hand.
-- The guide menu lists the guides for your faction by level, the ones that suit you now marked, like RestedXP's.
--
-- The steps and when they are done come from Steps.lua; the arrow is Arrow.lua.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END
local GREEN = ER.GREEN

local W = 300
local LINES, ROWS = 10, 6
local MARK = { A = "|cffffff00!|r ", T = "|cffffff00?|r ", C = "|cffff8040*|r ", K = "|cff00bcd4*|r ", X = "|cffb070ff*|r ",
  H = "|cff79a2ff*|r ", F = "|cff79a2ff*|r ", P = "|cff79a2ff*|r ", B = "|cff79a2ff*|r " }

local T = { lines = {}, rows = {} }
local M = { groupRows = {}, guideRows = {}, extraRows = {} }
local Refresh

local function Say(msg)
  if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99Easy Route:|r " .. msg) end
end

local function Plain(text)
  text = string.gsub(text or "", "|c%x%x%x%x%x%x%x%x", "")
  return (string.gsub(text, "|r", ""))
end

-- How tall a text is at this width, measured by the game (never guessed from letter counts). Leaves the font string
-- at that width and height with the text in it. The minimum height is only a floor for the result; if the game gives
-- no height, each line counts as the font size plus a small gap.
function ER.FitHeight(fs, text, width, minHeight)
  local least = minHeight or 14
  fs:SetWidth(width)
  fs:SetHeight(0)   -- 0 = size to the text
  fs:SetText(text or "")
  local h = fs:GetHeight()
  if not h or h < 1 then
    -- The client gave no height: work it out from the width of the text on one line.
    fs:SetWidth(0)
    local full = fs:GetStringWidth() or 0
    fs:SetWidth(width)
    local lines = math.ceil(full / (width * 0.9))   -- the 0.9 leaves room for words that do not fill a row
    if lines < 1 then lines = 1 end
    local _, size = fs:GetFont()
    if type(size) ~= "number" or size < 1 then size = 12 end
    h = lines * (size + 2)
  end
  if h < least then h = least end
  fs:SetHeight(h)
  return h
end

-- One line that fits the width: when it is too wide, whole words come off the end and "..." goes on.
function ER.FitLine(fs, text, width)
  fs:SetWidth(0)   -- 0 = size to the text, so the width read next is the whole text on one line
  fs:SetText(text or "")
  local full = fs:GetStringWidth() or 0
  if full <= width then
    fs:SetWidth(width)
    return
  end
  local words = {}
  for w in string.gfind(text or "", "[^ ]+") do table.insert(words, w) end
  while table.getn(words) > 1 do
    table.remove(words)
    fs:SetText(table.concat(words, " ") .. "...")
    if (fs:GetStringWidth() or 0) <= width then break end
  end
  if table.getn(words) == 1 then fs:SetText(words[1] .. "...") end
  fs:SetWidth(width)
end

local function Backdrop(f, alpha)
  f:SetBackdrop({
    bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    tile = true, tileSize = 16, edgeSize = 14,
    insets = { left = 4, right = 4, top = 4, bottom = 4 },
  })
  f:SetBackdropColor(0.03, 0.03, 0.05, alpha or 0.9)
  f:SetBackdropBorderColor(0.55, 0.55, 0.6, 1)
end

local function Tip(widget, fn)
  widget:SetScript("OnEnter", function()
    local title, body, hint = fn(this)
    if not title then return end
    GameTooltip:SetOwner(this, "ANCHOR_LEFT")
    GameTooltip:SetText(title)
    if body then GameTooltip:AddLine(body, 1, 1, 1, 1) end
    if hint then GameTooltip:AddLine(hint, 0.6, 0.6, 0.6, 1) end
    GameTooltip:Show()
  end)
  widget:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

local function Credit(parent, x, y)
  local credit = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  credit:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", x, y)
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
  return credit
end

------------------------------------------------------------------------------------------------------
-- The step box
------------------------------------------------------------------------------------------------------

-- The lines of one step: { text, done, kind, step }.
local function StepLines(step, max)
  local out = {}
  local Steps = ER.Steps
  for _, e in ipairs(step.elements) do
    local line = Steps.Line(step, e)
    if line then
      line.step = step
      table.insert(out, line)
      if max and table.getn(out) >= max then break end
    end
  end
  if table.getn(out) == 0 then table.insert(out, { text = Steps.Title(step), step = step }) end
  return out
end

local function LineText(line)
  local text = line.text
  if line.done == true then
    return GREEN .. "[x] " .. END .. GREY .. Plain(text) .. END
  elseif line.done == false then
    return GREY .. "[  ] " .. END .. (MARK[line.kind] or "") .. text
  end
  return text
end

local function FillBox()
  local Steps = ER.Steps
  local step = Steps.Current()
  local lines = {}
  if step then
    for _, l in ipairs(StepLines(step)) do table.insert(lines, l) end
    local hard = ER.HardLine and ER.HardLine(step)
    if hard then table.insert(lines, { text = hard, step = step }) end
    local needLevel = ER.NeedLevelLine and ER.NeedLevelLine(step)
    if needLevel then table.insert(lines, { text = needLevel, step = step }) end
    local rate = ER.QuestRateLine and ER.QuestRateLine(step)
    if rate then
      rate.step = step
      table.insert(lines, rate)
    end
    if Steps.ByHand(step) then
      table.insert(lines, { text = GREY .. "Click here or press > when this is done." .. END, step = step, tick = true })
    end
    local where = ER.RouteLine and ER.RouteLine()
    if where then table.insert(lines, { text = GREY .. where .. END }) end
  else
    table.insert(lines, { text = GOLD .. "This guide is finished." .. END })
    local nxt = Steps.NextGuide()
    if nxt then
      table.insert(lines, { text = "Next: " .. WHITE .. (nxt.title or nxt.name) .. END .. GREY .. "  (click to start it)" .. END, nextGuide = nxt })
    else
      table.insert(lines, { text = GREY .. "Open Settings (the gear) and press Pick a guide." .. END })
    end
    local where = ER.RouteLine and ER.RouteLine()
    if where then table.insert(lines, { text = GREY .. where .. END }) end
  end
  local side = Steps.Side()
  if table.getn(side) > 0 then
    table.insert(lines, { text = GREY .. "On the way:" .. END })
    for _, s in ipairs(side) do
      for _, l in ipairs(StepLines(s, 2)) do
        l.side = true
        table.insert(lines, l)
      end
    end
  end
  local y = -12
  for i = 1, LINES do
    local b, line = T.lines[i], lines[i]
    if line then
      local text = LineText(line)
      b:ClearAllPoints()
      b:SetPoint("TOPLEFT", T.box, "TOPLEFT", 10, y)
      local h = ER.FitHeight(b.text, text, W - 20, 14) + 2
      b:SetHeight(h)
      b.line = line
      b:Show()
      y = y - h - 2
    else
      b.line = nil
      b:Hide()
    end
  end
  T.box:SetHeight(-y + 8)
  T.tab:SetText(step and (GOLD .. "Step " .. Steps.Position() .. END .. GREY .. " of " .. Steps.Count() .. END) or (GOLD .. "Done" .. END))
  T.tick:SetText(step and Steps.ByHand(step) and "Done" or "Skip")
end

------------------------------------------------------------------------------------------------------
-- The guide name and the list of what comes next
------------------------------------------------------------------------------------------------------

-- RestedXP's groups ("RestedXP Alliance 1-20") are shown as "Fast route (RestedXP) 1-20"; every other name stays as it is. Display only:
-- the group of a guide, and so its saved key, keeps its name.
function ER.GroupLabel(name)
  if type(name) ~= "string" then return name end
  local _, _, levels = string.find(name, "^RestedXP %a+ (%d+%-%d+)$")
  if levels then return "Fast route (RestedXP) " .. levels end
  return name
end

local function FillList()
  local Steps = ER.Steps
  local info = Steps.Info()
  T.name:SetText(info and (GOLD .. (info.title or info.name) .. END) or "")
  T.group:SetText(info and (GREY .. ER.GroupLabel(info.group) .. "  -  " .. ER.MODES[ER.Mode()].label .. END) or "")
  local list = Steps.Upcoming(ROWS)
  local lh = ER.FitHeight(T.rows[1].text, "Hg", W - 24, 14)   -- one line as the game lays it out
  T.rowH = lh + 2
  T.list:SetHeight(ROWS * T.rowH + 40)
  for i = 1, ROWS do
    local r, s = T.rows[i], list[i]
    r:ClearAllPoints()
    r:SetPoint("TOPLEFT", T.list, "TOPLEFT", 8, -8 - (i - 1) * T.rowH)
    r:SetHeight(T.rowH)
    if s then
      ER.FitLine(r.text, GREY .. s.n .. END .. "  " .. Plain(Steps.Title(s)), W - 24)
      r.text:SetHeight(lh)
      r.step = s
      r:Show()
    else
      r.step = nil
      r:Hide()
    end
  end
end

Refresh = function()
  if not T.frame or not T.frame:IsShown() then return end
  if not ER.Steps.Running() then
    T.frame:Hide()
    return
  end
  FillBox()
  FillList()
  T.frame:SetHeight(T.box:GetHeight() + 44 + T.list:GetHeight())
end
ER.StepsChanged = function()
  Refresh()
  if ER.RefreshSimple then ER.RefreshSimple() end
  if M.frame and M.frame:IsShown() and M.Refresh then M.Refresh() end
end

-- The step window's bottom edge, for the tips box to sit under (nil when it is not up).
function ER.TrackerBottom()
  if T.frame and T.frame:IsShown() then return T.list end
  return nil
end

------------------------------------------------------------------------------------------------------
-- The guide menu
------------------------------------------------------------------------------------------------------

local function MenuRow(parent, name, w)
  local r = CreateFrame("Button", name, parent)
  r:SetWidth(w)
  r:SetHeight(16)
  local glow = r:CreateTexture(nil, "HIGHLIGHT")
  glow:SetTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight")
  glow:SetBlendMode("ADD")
  glow:SetAllPoints(r)
  r.text = r:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  r.text:SetPoint("LEFT", r, "LEFT", 4, 0)
  r.text:SetWidth(w - 8)
  r.text:SetHeight(14)   -- one line: anything longer ends in "..." instead of running into the next row
  r.text:SetJustifyH("LEFT")
  return r
end

local function ShowGroup(grp)
  M.group = grp
  local suggested = {}
  local best = ER.Steps.Suggest()[1]
  if best then suggested[best] = 1 end
  local running = ER.Steps.Info()
  local n = 0
  for i, r in ipairs(M.guideRows) do
    local g = grp and grp.guides[i]
    if g then
      local text = g.title or g.name
      if running == g then
        text = GREEN .. text .. "  (now)" .. END
      elseif suggested[g] then
        text = GOLD .. text .. END .. GREY .. "  - suits you" .. END
      else
        text = WHITE .. text .. END
      end
      r.text:SetText(text)
      r.guide = g
      r:Show()
      n = i
    else
      r.guide = nil
      r:Hide()
    end
  end
  M.panel:SetHeight(n * 16 + 36)
  M.panelTitle:SetText(grp and (GOLD .. ER.GroupLabel(grp.name) .. END) or "")
  if grp then M.panel:Show() else M.panel:Hide() end
end

M.Refresh = function()
  local groups = ER.Steps.Groups()
  local suggested = ER.Steps.Suggest()[1]
  local n = 0
  for i, r in ipairs(M.groupRows) do
    local grp = groups[i]
    if grp then
      local has = false
      for _, g in ipairs(grp.guides) do if g == suggested then has = true end end
      r.text:SetText((has and GOLD or WHITE) .. ER.GroupLabel(grp.name) .. END .. GREY .. "  >" .. END)
      r.grp = grp
      r:Show()
      n = i
    else
      r.grp = nil
      r:Hide()
    end
  end
  local y = -30 - n * 16 - 10
  M.otherTitle:ClearAllPoints()
  M.otherTitle:SetPoint("TOPLEFT", M.frame, "TOPLEFT", 12, y)
  y = y - 16
  -- Everything else lives in the settings window (Settings.lua).
  local extras = {
    { "Settings (every option)", function()
      M.frame:Hide()
      if ER.ShowSettings then ER.ShowSettings() end
    end },
    { "Close", function() M.frame:Hide() end },
  }
  for i, r in ipairs(M.extraRows) do
    local x = extras[i]
    if x then
      r:ClearAllPoints()
      r:SetPoint("TOPLEFT", M.frame, "TOPLEFT", 8, y - (i - 1) * 16)
      r.text:SetText(WHITE .. x[1] .. END)
      r.fn = x[2]
      r:Show()
    else
      r.fn = nil
      r:Hide()
    end
  end
  M.frame:SetHeight(-y + table.getn(extras) * 16 + 34)
  -- Open on the group that holds the guide that suits you best.
  local open = M.group
  if not open then
    for _, grp in ipairs(groups) do
      for _, g in ipairs(grp.guides) do if g == suggested then open = grp end end
    end
  end
  ShowGroup(open or groups[1])
end

local function BuildMenu()
  local f = CreateFrame("Frame", "EasyRouteGuideMenu", UIParent)
  M.frame = f
  f:SetWidth(250)
  f:SetHeight(200)
  f:SetFrameStrata("DIALOG")
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  Backdrop(f, 0.97)
  f:Hide()
  table.insert(UISpecialFrames, "EasyRouteGuideMenu")
  local title = f:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  title:SetPoint("TOPLEFT", f, "TOPLEFT", 12, -10)
  title:SetText("Available guides")
  for i = 1, 6 do
    local r = MenuRow(f, "EasyRouteGuideMenuGroup" .. i, 234)
    r:SetPoint("TOPLEFT", f, "TOPLEFT", 8, -28 - (i - 1) * 16)
    r:SetScript("OnEnter", function() if this.grp then ShowGroup(this.grp) end end)
    r:SetScript("OnClick", function() if this.grp then ShowGroup(this.grp) end end)
    r:Hide()
    M.groupRows[i] = r
  end
  M.otherTitle = f:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  M.otherTitle:SetText("Options")
  for i = 1, 2 do
    local r = MenuRow(f, "EasyRouteGuideMenuExtra" .. i, 234)
    r:SetScript("OnClick", function() if this.fn then this.fn() end end)
    r:Hide()
    M.extraRows[i] = r
  end
  Credit(f, -10, 8)

  local p = CreateFrame("Frame", "EasyRouteGuideMenuPanel", f)
  M.panel = p
  p:SetWidth(270)
  p:SetHeight(200)
  p:SetPoint("TOPLEFT", f, "TOPRIGHT", -2, 0)
  p:EnableMouse(true)
  Backdrop(p, 0.95)
  M.panelTitle = p:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  M.panelTitle:SetPoint("TOPLEFT", p, "TOPLEFT", 12, -10)
  for i = 1, 22 do
    local r = MenuRow(p, "EasyRouteGuideMenuGuide" .. i, 254)
    r:SetPoint("TOPLEFT", p, "TOPLEFT", 8, -28 - (i - 1) * 16)
    r:SetScript("OnClick", function()
      local g = this.guide
      if not g then return end
      M.frame:Hide()
      ER.StartGuide(ER.Steps.Key(g))
    end)
    Tip(r, function(b)
      local g = b.guide
      if not g then return nil end
      return g.title or g.name, "Levels " .. g.lo .. " to " .. g.hi .. ".", "Click to follow this guide."
    end)
    r:Hide()
    M.guideRows[i] = r
  end
end

-- Opens the guide menu, next to the step window when it is up, in the middle of the screen when not.
function ER.ShowGuideMenu(anchor)
  if not M.frame then BuildMenu() end
  M.group = nil
  M.frame:ClearAllPoints()
  if anchor then
    M.frame:SetPoint("TOPRIGHT", anchor, "BOTTOMLEFT", 0, 0)
  elseif ER.SimpleShown and ER.SimpleShown() then
    M.frame:SetPoint("TOPLEFT", ER.SimpleFrame(), "TOPRIGHT", 4, 0)
  elseif T.frame and T.frame:IsShown() then
    M.frame:SetPoint("TOPRIGHT", T.frame, "TOPLEFT", -276, 0)
  else
    M.frame:SetPoint("CENTER", UIParent, "CENTER", -140, 40)
  end
  M.frame:Show()
  M.Refresh()
end

------------------------------------------------------------------------------------------------------
-- Building the window
------------------------------------------------------------------------------------------------------

local function Button(name, parent, w, label, fn)
  local b = CreateFrame("Button", name, parent, "UIPanelButtonTemplate")
  b:SetWidth(w)
  b:SetHeight(20)
  b:SetText(label)
  b:SetScript("OnClick", fn)
  return b
end

local function Build()
  local f = CreateFrame("Frame", "EasyRouteTracker", UIParent)
  T.frame = f
  f:SetWidth(W)
  f:SetHeight(300)
  local pos = ER.db and ER.db.trackerPos
  if type(pos) == "table" and pos.point then
    f:SetPoint(pos.point, UIParent, pos.relPoint or pos.point, pos.x or 0, pos.y or 0)
  else
    f:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -40, -220)
  end
  f:SetFrameStrata("MEDIUM")
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  f:SetMovable(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function() this:StartMoving() end)
  f:SetScript("OnDragStop", function()
    this:StopMovingOrSizing()
    local point, _, relPoint, x, y = this:GetPoint()
    if ER.db then ER.db.trackerPos = { point = point, relPoint = relPoint, x = x, y = y } end
  end)
  f:SetScript("OnShow", function() Refresh() end)
  f:Hide()

  -- The step box, with its "Step 12" tab on top.
  local box = CreateFrame("Frame", "EasyRouteTrackerBox", f)
  T.box = box
  box:SetWidth(W)
  box:SetHeight(80)
  box:SetPoint("TOPLEFT", f, "TOPLEFT", 0, -16)
  Backdrop(box, 0.97)
  box:SetBackdropBorderColor(0.85, 0.65, 0.3, 1)
  local tab = CreateFrame("Frame", "EasyRouteTrackerTab", f)
  tab:SetWidth(130)
  tab:SetHeight(22)
  tab:SetPoint("BOTTOMLEFT", box, "TOPLEFT", 6, -6)
  Backdrop(tab, 0.95)
  tab:SetBackdropBorderColor(0.85, 0.65, 0.3, 1)
  T.tab = tab:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  T.tab:SetPoint("CENTER", tab, "CENTER", 0, 0)
  local close = CreateFrame("Button", "EasyRouteTrackerClose", f, "UIPanelCloseButton")
  close:SetWidth(24)
  close:SetHeight(24)
  close:SetPoint("BOTTOMRIGHT", box, "TOPRIGHT", 2, -6)
  close:SetScript("OnClick", function()
    f:Hide()
    if ER.PlaceTips then ER.PlaceTips() end
    Say("step window hidden; the guide keeps going. " .. GOLD .. "/er" .. END .. " shows it again.")
  end)
  for i = 1, LINES do
    local b = CreateFrame("Button", "EasyRouteTrackerLine" .. i, box)
    b:SetWidth(W - 20)
    b:SetHeight(14)
    local glow = b:CreateTexture(nil, "HIGHLIGHT")
    glow:SetTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight")
    glow:SetBlendMode("ADD")
    glow:SetAllPoints(b)
    b.text = b:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    b.text:SetPoint("TOPLEFT", b, "TOPLEFT", 0, 0)
    b.text:SetWidth(W - 20)
    b.text:SetJustifyH("LEFT")
    b.text:SetJustifyV("TOP")
    b:SetScript("OnClick", function()
      local line = this.line
      if line and line.nextGuide then
        ER.StartGuide(ER.Steps.Key(line.nextGuide))
        return
      end
      if line and line.rate then
        ER.NextQuestRating(line.rate)
        if Refresh then Refresh() end
        return
      end
      if not line or not line.step then return end
      if line.tick or line.kind == "M" or ER.Steps.ByHand(line.step) then
        ER.Steps.Tick(line.step.n)
      end
    end)
    Tip(b, function(btn)
      local line = btn.line
      if line and line.rate then
        local r = line.rate
        local body = r.mine and "You said this one is " .. Plain(ER.Coloured(r.rating)) .. "."
          or "My guess: " .. Plain(ER.Coloured(r.rating)) .. (r.why and (", because " .. r.why) or "") .. "."
        return "How hard is " .. r.title .. "?", body,
          "Click to change it: Easy, Medium, Hard. Your answer is saved and goes in Send feedback."
      end
      if not line or not line.step then return nil end
      local hint = "The arrow shows where this happens."
      if line.tick or line.kind == "M" or ER.Steps.ByHand(line.step) then hint = "Click when you have done this." end
      return Plain(ER.Steps.Title(line.step)), Plain(line.text), hint
    end)
    b:Hide()
    T.lines[i] = b
  end

  -- The guide's name, with the gear for the guide menu.
  local head = CreateFrame("Button", "EasyRouteTrackerHead", f)
  T.head = head
  head:SetWidth(W)
  head:SetHeight(38)
  head:SetPoint("TOPLEFT", box, "BOTTOMLEFT", 0, 2)
  Backdrop(head, 0.97)
  local icon = head:CreateTexture(nil, "ARTWORK")
  icon:SetTexture("Interface\\Icons\\INV_Misc_Book_09")
  icon:SetWidth(26)
  icon:SetHeight(26)
  icon:SetPoint("LEFT", head, "LEFT", 7, 0)
  T.name = head:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  T.name:SetPoint("TOPLEFT", icon, "TOPRIGHT", 6, 0)
  T.name:SetWidth(W - 80)
  T.name:SetJustifyH("LEFT")
  T.group = head:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  T.group:SetPoint("BOTTOMLEFT", icon, "BOTTOMRIGHT", 6, 0)
  T.group:SetWidth(W - 80)
  T.group:SetJustifyH("LEFT")
  head:SetScript("OnClick", function() ER.ShowGuideMenu() end)
  local gear = CreateFrame("Button", "EasyRouteTrackerGear", head)
  gear:SetWidth(22)
  gear:SetHeight(22)
  gear:SetPoint("RIGHT", head, "RIGHT", -8, 0)
  gear:SetNormalTexture("Interface\\Icons\\INV_Misc_Gear_01")
  gear:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square")
  gear:SetScript("OnClick", function()
    if ER.ShowSettings then ER.ShowSettings() else ER.ShowGuideMenu() end
  end)
  Tip(gear, function() return "Settings", "Every option in one place: the guide, the difficulty, simple mode, tips, skulls, the arrow, feedback.", nil end)
  Tip(head, function() return "Guide menu", "Click to pick another guide.", nil end)

  -- What comes next.
  local list = CreateFrame("Frame", "EasyRouteTrackerList", f)
  T.list = list
  list:SetWidth(W)
  T.rowH = 16
  list:SetHeight(ROWS * T.rowH + 40)
  list:SetPoint("TOPLEFT", head, "BOTTOMLEFT", 0, 2)
  Backdrop(list, 0.97)
  for i = 1, ROWS do
    local r = MenuRow(list, "EasyRouteTrackerRow" .. i, W - 16)
    r:SetPoint("TOPLEFT", list, "TOPLEFT", 8, -8 - (i - 1) * T.rowH)
    r:SetScript("OnClick", function() if this.step then ER.Steps.Jump(this.step.n) end end)
    Tip(r, function(b)
      if not b.step then return nil end
      local lines = {}
      for _, l in ipairs(StepLines(b.step)) do table.insert(lines, Plain(l.text)) end
      return "Step " .. b.step.n, table.concat(lines, "\n"), "Click to jump to this step."
    end)
    r:Hide()
    T.rows[i] = r
  end
  Button("EasyRouteTrackerPrev", list, 26, "<", function() ER.Steps.Prev() end):SetPoint("BOTTOMLEFT", list, "BOTTOMLEFT", 8, 8)
  Button("EasyRouteTrackerNext", list, 26, ">", function() ER.Steps.Next() end):SetPoint("BOTTOMLEFT", list, "BOTTOMLEFT", 36, 8)
  T.tick = Button("EasyRouteTrackerTick", list, 50, "Skip", function()
    local step = ER.Steps.Current()
    if step and ER.Steps.ByHand(step) then ER.Steps.Tick(step.n) else ER.Steps.Next() end
  end)
  T.tick:SetPoint("BOTTOMLEFT", list, "BOTTOMLEFT", 64, 8)
  Tip(T.tick, function()
    return "Done / Skip", "Done: you have done this step. Skip: leave this step out and go on.", nil
  end)
  Credit(list, -10, 12)
end

-- Shows the guide: the step box, or in simple mode the quest list on the left (Simple.lua).
function ER.ShowTracker()
  if not T.frame then Build() end
  if ER.db and ER.db.simple and ER.ShowSimple then
    T.frame:Hide()
    ER.ShowSimple()
  else
    if ER.HideSimple then ER.HideSimple() end
    T.frame:Show()
    Refresh()
  end
  if ER.PlaceTips then ER.PlaceTips() end
end

function ER.TrackerShown()
  if ER.SimpleShown and ER.SimpleShown() then return true end
  return T.frame and T.frame:IsShown() or false
end

function ER.ToggleTracker()
  if not T.frame then Build() end
  if ER.TrackerShown() then
    T.frame:Hide()
    if ER.HideSimple then ER.HideSimple() end
    if ER.PlaceTips then ER.PlaceTips() end
  else
    ER.ShowTracker()
  end
end

-- Starts a guide and shows the step window and the arrow. quiet: the caller prints its own line.
function ER.StartGuide(key, fresh, quiet)
  if not ER.Steps.Load(key, fresh) then
    Say("that guide could not be loaded.")
    return false
  end
  local info = ER.Steps.Info()
  if not quiet then
    Say("following " .. GOLD .. (info.title or info.name) .. END .. ". The arrow points the way; " .. GOLD .. "/er" .. END ..
      " shows or hides the steps.")
  end
  if ER.db then ER.db.arrowOff = nil end   -- a new guide always starts with the arrow on
  ER.ShowTracker()
  if ER.ArrowUpdate then ER.ArrowUpdate() end
  return true
end

-- When a guide is finished the next one starts by itself, no click needed. true when one was started.
function ER.AutoNextGuide()
  if ER.db and ER.db.autoNextOff then return false end
  local prev = ER.Steps.Info()
  local nxt = ER.Steps.NextGuide()
  if not nxt then return false end
  if not ER.StartGuide(ER.Steps.Key(nxt), nil, true) then return false end
  -- The casual route has its own single line; every other guide keeps the old one.
  local line = ER.RouteNextLine and ER.RouteNextLine(prev, nxt)
  if line then
    Say(line)
  else
    Say(GOLD .. "guide finished." .. END .. " Now following " .. GOLD .. (nxt.title or nxt.name) .. END .. ".")
  end
  return true
end

-- Picks the step window back up after a login when a guide was running.
local starter = CreateFrame("Frame", "EasyRouteTrackerStarter")
starter:RegisterEvent("PLAYER_ENTERING_WORLD")
starter:SetScript("OnEvent", function()
  this:UnregisterEvent("PLAYER_ENTERING_WORLD")
  this.wait = 0
  this:SetScript("OnUpdate", function()
    this.wait = this.wait + arg1
    if this.wait < 2 then return end
    this:SetScript("OnUpdate", nil)
    if ER.Steps.Running() or ER.Steps.Resume() then ER.ShowTracker() end
  end)
end)

ER.Loaded("Tracker.lua")
