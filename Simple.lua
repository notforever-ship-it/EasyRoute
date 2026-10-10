-- Easy Route: simple mode and the tips box.
--
-- Simple mode shows the guide as a quest list on the left, the way pfQuest's tracker does: what to do now, then
-- every quest the guide is busy with, coloured by level, with what is left of it. Click a quest and the arrow
-- points to it; click it again and the arrow follows the guide. The gear menu switches between this and the step
-- box (Tracker.lua).
--
-- The tips box ("Easy Route says") sits under whichever guide window is up and shows what Adapt.lua has to say:
-- questions with buttons first, then the newest tips.

local ER = EasyRoute
local GOLD, GREY, WHITE, GREEN, END = ER.GOLD, ER.GREY, ER.WHITE, ER.GREEN, ER.END

local W = 270
local ROWS, SUBS = 10, 3
local L = { rows = {} }              -- the quest list
local TP = { list = {}, rows = {} }  -- the tips box
local TIPS_SHOWN = 3
local TIP_BUTTONS = 4   -- buttons one tip can have (they wrap onto a second row when they do not fit)
local TipsFill

local function Say(msg)
  if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99Easy Route:|r " .. msg) end
end

local function Plain(text)
  text = string.gsub(text or "", "|c%x%x%x%x%x%x%x%x", "")
  return (string.gsub(text, "|r", ""))
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

local function Credit(parent)
  local credit = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  credit:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", -10, 7)
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
  return credit
end

local function Tip(widget, fn)
  widget:SetScript("OnEnter", function()
    local title, body, hint = fn(this)
    if not title then return end
    GameTooltip:SetOwner(this, "ANCHOR_RIGHT")
    GameTooltip:SetText(title)
    if body then GameTooltip:AddLine(body, 1, 1, 1, 1) end
    if hint then GameTooltip:AddLine(hint, 0.6, 0.6, 0.6, 1) end
    GameTooltip:Show()
  end)
  widget:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

-- A quest level's colour against yours, the way the quest log colours it: red, orange, yellow, green, grey.
function ER.LevelColour(level)
  local me = UnitLevel("player") or 1
  if not level or level <= 0 then return WHITE end
  local d = level - me
  if d >= 5 then return "|cffff1a1a" end
  if d >= 3 then return "|cffff8040" end
  if d >= -2 then return "|cffffff00" end
  if level > ER.Steps.GreyLevel(me) then return "|cff40c040" end
  return "|cff808080"
end

------------------------------------------------------------------------------------------------------
-- The quest list
------------------------------------------------------------------------------------------------------

local function Fill()
  local Steps = ER.Steps
  local info = Steps.Info()
  if info then
    -- A casual-route zone shows how far you are in it ("Durotar: 12/20 done") in place of the guide's name. A zone name that is too
    -- long is cut; the numbers never are.
    local short, head, tail
    if ER.RouteShort then short, head, tail = ER.RouteShort() end
    if head then
      ER.FitLine(L.name, GREY .. Plain(head), W - 130, tail .. END)
    else
      ER.FitLine(L.name, GREY .. Plain(info.title or info.name) .. END, W - 130)
    end
  else
    L.name:SetText("")
  end
  local cur = Steps.Current()
  local nh
  if cur then
    nh = ER.FitHeight(L.now.text, GOLD .. "Now: " .. END .. WHITE .. Plain(Steps.Title(cur)) .. END, W - 74, 14)
    L.now.step = cur
    L.skip:SetText(Steps.ByHand(cur) and "Done" or "Skip")
    L.skip:Show()
  else
    nh = ER.FitHeight(L.now.text, GOLD .. "This guide is finished." .. END, W - 74, 14)
    L.now.step = nil
    L.skip:Hide()
  end
  L.now:SetHeight(nh + 2)
  local list = Steps.QuestList(ROWS)
  local pin = ER.ArrowPin and ER.ArrowPin()
  local y = -28 - (nh + 2) - 4
  for i = 1, ROWS do
    local r, q = L.rows[i], list[i]
    if q then
      local lines = {}
      if q.what == "pickup" then
        table.insert(lines, GREY .. "- pick up" .. (q.who and (" from " .. q.who) or "") .. END)
      elseif q.what == "turnin" then
        table.insert(lines, GREEN .. "- ready, hand in" .. (q.who and (" to " .. q.who) or "") .. END)
      else
        for _, o in ipairs(Steps.Objectives(q.title)) do
          if not o.done and table.getn(lines) < SUBS then table.insert(lines, WHITE .. "- " .. o.text .. END) end
        end
      end
      local lvl = (q.level and q.level > 0) and ("[" .. q.level .. "] ") or ""
      local mark = (pin and pin.quest == q.title) and "|cff79a2ff> |r" or ""
      r.title:ClearAllPoints()
      r.title:SetPoint("TOPLEFT", r, "TOPLEFT", 2, -1)
      local th = ER.FitHeight(r.title, mark .. ER.LevelColour(q.level) .. lvl .. q.title .. END, W - 20, 14)
      local below = 0
      for j = 1, SUBS do
        if lines[j] then
          r.subs[j]:ClearAllPoints()
          r.subs[j]:SetPoint("TOPLEFT", r, "TOPLEFT", 12, -(1 + th + below))
          below = below + ER.FitHeight(r.subs[j], lines[j], W - 30, 12)
          r.subs[j]:Show()
        else
          r.subs[j]:Hide()
        end
      end
      local h = 1 + th + below + 3
      r:ClearAllPoints()
      r:SetPoint("TOPLEFT", L.frame, "TOPLEFT", 8, y)
      r:SetHeight(h)
      r.quest = q
      r:Show()
      y = y - h
    else
      r.quest = nil
      r:Hide()
    end
  end
  if table.getn(list) == 0 then
    L.empty:ClearAllPoints()
    L.empty:SetPoint("TOPLEFT", L.frame, "TOPLEFT", 12, y - 2)
    L.empty:Show()
    y = y - 18
  else
    L.empty:Hide()
  end
  L.frame:SetHeight(-y + 26)
end

local function Build()
  local f = CreateFrame("Frame", "EasyRouteSimple", UIParent)
  L.frame = f
  f:SetWidth(W)
  f:SetHeight(120)
  local pos = ER.db and ER.db.simplePos
  if type(pos) == "table" and pos.point then
    f:SetPoint(pos.point, UIParent, pos.relPoint or pos.point, pos.x or 0, pos.y or 0)
  else
    f:SetPoint("TOPLEFT", UIParent, "LEFT", 20, 180)
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
    if ER.db then ER.db.simplePos = { point = point, relPoint = relPoint, x = x, y = y } end
  end)
  Backdrop(f, 0.85)
  f:Hide()

  local title = f:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  title:SetPoint("TOPLEFT", f, "TOPLEFT", 10, -9)
  title:SetText("Easy Route")
  L.name = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  L.name:SetPoint("LEFT", title, "RIGHT", 6, 0)
  L.name:SetWidth(W - 130)
  L.name:SetHeight(12)
  L.name:SetJustifyH("LEFT")

  local gear = CreateFrame("Button", "EasyRouteSimpleGear", f)
  gear:SetWidth(16)
  gear:SetHeight(16)
  gear:SetPoint("TOPRIGHT", f, "TOPRIGHT", -28, -7)
  gear:SetNormalTexture("Interface\\Icons\\INV_Misc_Gear_01")
  gear:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square")
  gear:SetScript("OnClick", function()
    if ER.ShowSettings then ER.ShowSettings() else ER.ShowGuideMenu() end
  end)
  Tip(gear, function() return "Settings", "Every option in one place: the guide, how hard, auto mode, the arrow, tips and more.", nil end)
  local close = CreateFrame("Button", "EasyRouteSimpleClose", f, "UIPanelCloseButton")
  close:SetWidth(24)
  close:SetHeight(24)
  close:SetPoint("TOPRIGHT", f, "TOPRIGHT", -2, -2)
  close:SetScript("OnClick", function()
    f:Hide()
    if ER.PlaceTips then ER.PlaceTips() end
    Say("quest list hidden; the guide keeps going. " .. GOLD .. "/er" .. END .. " shows it again.")
  end)

  -- What to do now, with Skip (or Done for a step only you can tick).
  local now = CreateFrame("Button", "EasyRouteSimpleNow", f)
  L.now = now
  now:SetWidth(W - 70)
  now:SetHeight(16)
  now:SetPoint("TOPLEFT", f, "TOPLEFT", 8, -28)
  local glow = now:CreateTexture(nil, "HIGHLIGHT")
  glow:SetTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight")
  glow:SetBlendMode("ADD")
  glow:SetAllPoints(now)
  now.text = now:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  now.text:SetPoint("LEFT", now, "LEFT", 2, 0)
  now.text:SetWidth(W - 74)
  now.text:SetJustifyH("LEFT")
  now:SetScript("OnClick", function()
    local step = this.step
    if step and ER.Steps.ByHand(step) then ER.Steps.Tick(step.n) end
  end)
  Tip(now, function(b)
    local step = b.step
    if not step then return nil end
    local lines = {}
    for _, e in ipairs(step.elements) do
      local line = ER.Steps.Line(step, e)
      if line then table.insert(lines, Plain(line.text)) end
    end
    return "Step " .. step.n, table.concat(lines, "\n"),
      ER.Steps.ByHand(step) and "Click when you have done this." or "The arrow shows where this happens."
  end)
  L.skip = CreateFrame("Button", "EasyRouteSimpleSkip", f, "UIPanelButtonTemplate")
  L.skip:SetWidth(50)
  L.skip:SetHeight(18)
  L.skip:SetPoint("TOPRIGHT", f, "TOPRIGHT", -10, -27)
  L.skip:SetText("Skip")
  L.skip:SetScript("OnClick", function()
    local step = ER.Steps.Current()
    if step and ER.Steps.ByHand(step) then ER.Steps.Tick(step.n) else ER.Steps.Next(true) end
  end)
  Tip(L.skip, function() return "Skip / Done", "Skip: leave it out and go on; its quests then count as Hard for you. Done: you have done it.", nil end)

  for i = 1, ROWS do
    local r = CreateFrame("Button", "EasyRouteSimpleRow" .. i, f)
    r:SetWidth(W - 16)
    r:SetHeight(16)
    local hl = r:CreateTexture(nil, "HIGHLIGHT")
    hl:SetTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight")
    hl:SetBlendMode("ADD")
    hl:SetAllPoints(r)
    r.title = r:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    r.title:SetPoint("TOPLEFT", r, "TOPLEFT", 2, -1)
    r.title:SetWidth(W - 20)
    r.title:SetJustifyH("LEFT")
    r.subs = {}
    for j = 1, SUBS do
      local s = r:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
      s:SetWidth(W - 30)
      s:SetJustifyH("LEFT")
      r.subs[j] = s
    end
    r:SetScript("OnClick", function()
      local q = this.quest
      if not q then return end
      local pin = ER.ArrowPin and ER.ArrowPin()
      if pin and pin.quest == q.title then
        ER.PinArrow(nil)
        Say("the arrow follows the guide again.")
        return
      end
      local place = ER.Steps.PlaceFor(q)
      if not place then
        Say("I do not know where " .. GOLD .. q.title .. END .. " happens. The guide will get to it.")
        return
      end
      place.quest = q.title
      ER.PinArrow(place)
    end)
    Tip(r, function(b)
      local q = b.quest
      if not q then return nil end
      local lines = {}
      if q.level then table.insert(lines, "Level " .. q.level) end
      if q.what == "pickup" then table.insert(lines, "Pick it up" .. (q.who and (" from " .. q.who) or "") .. ".")
      elseif q.what == "turnin" then table.insert(lines, "Ready to hand in" .. (q.who and (" to " .. q.who) or "") .. ".")
      else
        for _, o in ipairs(ER.Steps.Objectives(q.title)) do table.insert(lines, (o.done and "[x] " or "[  ] ") .. o.text) end
      end
      local pin = ER.ArrowPin and ER.ArrowPin()
      local hint = (pin and pin.quest == q.title) and "Click: the arrow follows the guide again."
        or "Click: the arrow points to this quest."
      return q.title, table.concat(lines, "\n"), hint
    end)
    r:Hide()
    L.rows[i] = r
  end
  L.empty = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  L.empty:SetText(GREY .. "No quests right now. Follow the arrow." .. END)
  Credit(f)
end

function ER.ShowSimple()
  if not L.frame then Build() end
  L.frame:Show()
  Fill()
  if ER.PlaceTips then ER.PlaceTips() end
end

function ER.HideSimple()
  if L.frame then L.frame:Hide() end
end

function ER.SimpleShown()
  return L.frame and L.frame:IsShown() or false
end

function ER.SimpleFrame() return L.frame end

function ER.RefreshSimple()
  if not L.frame or not L.frame:IsShown() then return end
  if not ER.Steps.Running() then
    L.frame:Hide()
    if ER.PlaceTips then ER.PlaceTips() end
    return
  end
  Fill()
  if ER.PlaceTips then ER.PlaceTips() end
end

ER.PinChanged = function() ER.RefreshSimple() end

-- Simple mode on or off (the gear menu, /er simple).
function ER.SetSimple(on)
  if not ER.db then return end
  ER.db.simple = on and true or nil
  if ER.Steps.Running() then ER.ShowTracker() end
  Say(on and ("simple mode: the quests are listed on the left. Untick Simple mode in Settings (the gear) to get the step box back.")
    or "the step box is back.")
end

------------------------------------------------------------------------------------------------------
-- The tips box
------------------------------------------------------------------------------------------------------

local function TipsBuild()
  local f = CreateFrame("Frame", "EasyRouteTips", UIParent)
  TP.frame = f
  TP.width = 300
  f:SetWidth(TP.width)
  f:SetHeight(60)
  f:SetFrameStrata("MEDIUM")
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  Backdrop(f, 0.95)
  f:SetBackdropBorderColor(0.85, 0.65, 0.3, 1)
  f:Hide()
  local head = f:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  head:SetPoint("TOPLEFT", f, "TOPLEFT", 10, -8)
  head:SetText("Easy Route says:")
  local close = CreateFrame("Button", "EasyRouteTipsClose", f, "UIPanelCloseButton")
  close:SetWidth(20)
  close:SetHeight(20)
  close:SetPoint("TOPRIGHT", f, "TOPRIGHT", 0, 0)
  close:SetScript("OnClick", function()
    TP.list = {}
    TipsFill()
  end)
  for i = 1, TIPS_SHOWN do
    local r = { buttons = {} }
    r.text = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    r.text:SetJustifyH("LEFT")
    r.text:SetJustifyV("TOP")
    for j = 1, TIP_BUTTONS do
      local b = CreateFrame("Button", "EasyRouteTip" .. i .. "Button" .. j, f, "UIPanelButtonTemplate")
      b:SetHeight(18)
      b:SetScript("OnClick", function()
        local tip, fn = this.tip, this.fn
        if tip then ER.RemoveTip(tip.key) end
        if fn then fn() end
      end)
      b:Hide()
      r.buttons[j] = b
    end
    TP.rows[i] = r
  end
  Credit(f)

  -- Tips with a time limit go when it runs out.
  local ticker = CreateFrame("Frame", "EasyRouteTipsTicker")
  ticker.wait = 0
  ticker:SetScript("OnUpdate", function()
    this.wait = this.wait + arg1
    if this.wait < 1 then return end
    this.wait = 0
    local now, changed = GetTime(), false
    for i = table.getn(TP.list), 1, -1 do
      local tip = TP.list[i]
      if tip.life and now - tip.at > tip.life then
        table.remove(TP.list, i)
        changed = true
      end
    end
    if changed then TipsFill() end
  end)
end

-- Questions first (they wait for an answer), then the newest tips.
local function Ordered()
  local out = {}
  for _, tip in ipairs(TP.list) do
    if tip.buttons then table.insert(out, tip) end
  end
  for _, tip in ipairs(TP.list) do
    if not tip.buttons then table.insert(out, tip) end
  end
  return out
end

TipsFill = function()
  local f = TP.frame
  if not f then return end
  if (ER.db and ER.db.tipsOff) or table.getn(TP.list) == 0 then
    f:Hide()
    return
  end
  local w = TP.width
  local y = -24
  local list = Ordered()
  for i = 1, TIPS_SHOWN do
    local r, tip = TP.rows[i], list[i]
    if tip then
      r.text:ClearAllPoints()
      r.text:SetPoint("TOPLEFT", f, "TOPLEFT", 10, y)
      local h = ER.FitHeight(r.text, tip.text, w - 20, 14) + 2
      r.text:Show()
      y = y - h - 2
      local x, any = 10, false
      for j = 1, TIP_BUTTONS do
        local b, bt = r.buttons[j], tip.buttons and tip.buttons[j]
        if bt then
          b:SetText(bt.label)
          local tw = b.GetTextWidth and b:GetTextWidth() or 0
          local bw = (tw > 0 and tw or string.len(bt.label) * 6) + 22
          if x + bw > w - 10 and x > 10 then
            y = y - 22
            x = 10
          end
          b:SetWidth(bw)
          b:ClearAllPoints()
          b:SetPoint("TOPLEFT", f, "TOPLEFT", x, y)
          b.tip, b.fn = tip, bt.fn
          b:Show()
          x = x + bw + 4
          any = true
        else
          b.tip, b.fn = nil, nil
          b:Hide()
        end
      end
      if any then y = y - 22 end
      y = y - 4
    else
      r.text:Hide()
      for j = 1, TIP_BUTTONS do r.buttons[j]:Hide() end
    end
  end
  f:SetHeight(-y + 18)
  f:Show()
end

-- Puts the tips box under the quest list in simple mode, under the step window otherwise, or on its own at the
-- right of the screen when neither is up.
function ER.PlaceTips()
  local f = TP.frame
  if not f then return end
  f:ClearAllPoints()
  local under = ER.TrackerBottom and ER.TrackerBottom()
  if L.frame and L.frame:IsShown() then
    TP.width = W
    f:SetPoint("TOPLEFT", L.frame, "BOTTOMLEFT", 0, 2)
  elseif under then
    TP.width = 300
    f:SetPoint("TOPLEFT", under, "BOTTOMLEFT", 0, 2)
  else
    TP.width = 300
    f:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -40, -560)
  end
  f:SetWidth(TP.width)
  TipsFill()
end

-- A tip: key (a newer tip with the same key replaces it), text, buttons ({ { label, fn }, ... }, up to four; a tip
-- with buttons waits for an answer), life (seconds before it goes by itself; nil = until answered or closed).
function ER.AddTip(key, text, buttons, life)
  if not key or not text then return end
  for i = table.getn(TP.list), 1, -1 do
    if TP.list[i].key == key then table.remove(TP.list, i) end
  end
  table.insert(TP.list, 1, { key = key, text = text, buttons = buttons, life = life, at = GetTime() })
  while table.getn(TP.list) > 8 do table.remove(TP.list) end
  if not TP.frame then TipsBuild() end
  ER.PlaceTips()
end

function ER.RemoveTip(key)
  local changed = false
  for i = table.getn(TP.list), 1, -1 do
    if TP.list[i].key == key then
      table.remove(TP.list, i)
      changed = true
    end
  end
  if changed then TipsFill() end
end

-- Removes every tip whose key starts with this (the guide's warnings for a step that is behind you).
function ER.RemoveTips(prefix)
  local changed = false
  for i = table.getn(TP.list), 1, -1 do
    if string.sub(TP.list[i].key, 1, string.len(prefix)) == prefix then
      table.remove(TP.list, i)
      changed = true
    end
  end
  if changed then TipsFill() end
end

function ER.HasTip(key)
  for _, tip in ipairs(TP.list) do
    if tip.key == key then return true end
  end
  return false
end

function ER.TipsList() return TP.list end

function ER.ToggleTips()
  if not ER.db then return end
  ER.db.tipsOff = not ER.db.tipsOff
  Say("tips " .. (ER.db.tipsOff and "hidden. " .. GOLD .. "/er tips" .. END .. " shows them again." or "shown."))
  if TP.frame then TipsFill() end
end

ER.Loaded("Simple.lua")
