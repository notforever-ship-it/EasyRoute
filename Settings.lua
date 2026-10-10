-- Easy Route: the settings window. Every option and every window of the addon in one place, so nothing needs a
-- slash command: tick boxes for what can be on or off, buttons for the rest. The gear on the guide (step box or
-- quest list) opens it, so does right-clicking the minimap button, or /er settings.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local W = 520
local S = { checks = {}, buttons = {} }

local function Db() return ER.db or {} end

local function Running() return ER.Steps and ER.Steps.Running() end

-- Two groups, each with ticks and buttons. A tick: label, is it on now, turn it on or off. The toggles that already
-- have their own function use it, so the chat line and the windows follow as with the slash command. A button:
-- label, what the tooltip says, what it does.
local GROUPS = {
  { title = "The guide",
    checks = {
      { "Simple mode: quest list on the left instead of the step box",
        function() return Db().simple end,
        function(on) if ER.SetSimple then ER.SetSimple(on) end end },
      { "Show the arrow",
        function() return not Db().arrowOff end,
        function(on) if (not Db().arrowOff) ~= on and ER.ToggleArrow then ER.ToggleArrow() end end },
      { "Show tips (the \"Easy Route says\" box)",
        function() return not Db().tipsOff end,
        function(on) if (not Db().tipsOff) ~= on and ER.ToggleTips then ER.ToggleTips() end end },
      { "Show grind spots (where to grind, and why)",
        function() return not Db().grindOff end,
        function(on) if ER.db then ER.db.grindOff = not on end end },
      { "Skulls over enemies my quests need (V shows their health bars)",
        function() return not Db().skullsOff end,
        function(on) if (not Db().skullsOff) ~= on and ER.ToggleSkulls then ER.ToggleSkulls() end end },
      { "Easy / Medium / Hard on enemy tooltips",
        function() return not Db().rateOff end,
        function(on) if ER.db then ER.db.rateOff = not on end end },
      { "Leave out steps that only farm money (I have money on another character)",
        function() return ER.HasMoney and ER.HasMoney() end,
        function(on) if ER.SetHasMoney then ER.SetHasMoney(on) end end },
      { "Go straight on to the next guide when one ends",
        function() return not Db().autoNextOff end,
        function(on) if ER.db then ER.db.autoNextOff = not on end end },
      { "Minimap button",
        function() return not Db().minimapHidden end,
        function(on)
          if ER.db then ER.db.minimapHidden = not on end
          if ER.UpdateMinimapButton then ER.UpdateMinimapButton() end
        end },
      { "Ask every 3 levels how it is going",
        function() return not Db().checkinOff end,
        function(on) if ER.db then ER.db.checkinOff = not on end end },
      { "Auto mode: Easy Route does the clicking at NPCs for you (hold Shift when you talk to do it yourself)",
        function() return not Db().autoOff end,
        function(on) if ER.db then ER.db.autoOff = not on end end },
      { "Take and hand in quests",
        function() return not Db().autoquestOff end,
        function(on) if ER.db then ER.db.autoquestOff = not on end end, part = true },
      { "Pick the right quest when an NPC has several",
        function() return not Db().automenuOff end,
        function(on) if ER.db then ER.db.automenuOff = not on end end, part = true },
      { "Take the flight on a fly step",
        function() return not Db().autoflightOff end,
        function(on) if ER.db then ER.db.autoflightOff = not on end end, part = true },
      { "Set the hearthstone on its step",
        function() return not Db().autoinnOff end,
        function(on) if ER.db then ER.db.autoinnOff = not on end end, part = true },
      { "Sell grey items and repair",
        function() return not Db().autosellOff end,
        function(on) if ER.db then ER.db.autosellOff = not on end end, part = true },
    },
    buttons = {
      { "Pick a guide", "Every guide for your faction, by level.", function()
        S.frame:Hide()
        if ER.ShowGuideMenu then ER.ShowGuideMenu() end
      end },
      { "Change difficulty", "Casual, Medium or Hard.", function()
        S.frame:Hide()
        if ER.ShowWizardMood then ER.ShowWizardMood() end
      end },
      { "Start guide again", "Back to step 1 of the guide you are on.", function()
        local info = Running() and ER.Steps.Info()
        if info then ER.Steps.Load(ER.Steps.Key(info), true) end
        S.frame:Hide()
      end },
      { "Stop the guide", "Close the guide. Pick a guide starts one again.", function()
        if Running() then
          ER.Steps.Stop()
          ER.Print("guide stopped.")
        end
        S.frame:Hide()
      end },
      { "How to use", "The help page.", function()
        S.frame:Hide()
        if ER.ShowHelp then ER.ShowHelp() end
      end },
    },
  },
  { title = "Feedback (for testers)",
    checks = {
      { "Ask me how hard each quest was",
        function() return Db().autoPrompt end,
        function(on) if ER.db then ER.db.autoPrompt = on end end },
      { "Tell my party when I hand a quest in",
        function() return Db().partyAnnounce end,
        function(on) if ER.db then ER.db.partyAnnounce = on end end },
      { "Popup when I pick up the first quest of a chain",
        function() return Db().chainPopup end,
        function(on) if ER.db then ER.db.chainPopup = on end end },
    },
    buttons = {
      { "Notebook", "Your quest log with Easy / Medium / Hard / Skip buttons, and everything you rated so far.", function()
        S.frame:Hide()
        if ER.ToggleWindow then ER.ToggleWindow() end
      end },
      { "Send feedback", "Your ratings and notes in a box, already selected: Ctrl+C and paste it to stealthzi.", function()
        S.frame:Hide()
        if ER.ShowExport then ER.ShowExport() end
      end },
      { "What it records", "Exactly what the addon writes down, and that nothing leaves your computer.", function()
        S.frame:Hide()
        if ER.ShowNotice then ER.ShowNotice() end
      end },
    },
  },
}

-- Every tick of both groups in one list, in the order they show.
local CHECKS = {}
for _, g in ipairs(GROUPS) do
  for _, c in ipairs(g.checks) do table.insert(CHECKS, c) end
end

-- What the window holds, for the tests: each group's title and how many ticks (parts: how many of them are the indented part ticks)
-- and buttons it has.
function ER.SettingsInfo()
  local out = { groups = {} }
  for _, g in ipairs(GROUPS) do
    local parts = 0
    for _, c in ipairs(g.checks) do
      if c.part then parts = parts + 1 end
    end
    table.insert(out.groups, { title = g.title, checks = table.getn(g.checks), parts = parts, buttons = table.getn(g.buttons) })
  end
  return out
end

-- A window taller than the screen is made smaller to fit: 1 when it fits (or the screen height is not known), else the share that fits
-- with 20 units to spare.
function ER.SettingsScale(height, screen)
  if type(height) == "number" and height > 0 and type(screen) == "number" and screen >= 300 and height > screen - 20 then
    return (screen - 20) / height
  end
  return 1
end

local function Refresh()
  local off = Db().autoOff
  for i, c in ipairs(S.checks) do
    c:SetChecked(CHECKS[i][2]() and 1 or nil)
    -- The part ticks of auto mode are greyed while auto mode is off (they still work; the Auto mode tick decides).
    if CHECKS[i].part then c:SetAlpha(off and 0.5 or 1) end
  end
  local info = Running() and ER.Steps.Info()
  local mode = ER.MODES and ER.Mode and ER.MODES[ER.Mode()]
  S.sub:SetText(GREY .. "Difficulty: " .. END .. WHITE .. (mode and mode.label or "?") .. END .. GREY .. "     Guide: " .. END ..
    WHITE .. (info and (info.title or info.name) or "none") .. END)
end

local function Build()
  local f = CreateFrame("Frame", "EasyRouteSettings", UIParent)
  S.frame = f
  f:SetWidth(W)
  f:SetFrameStrata("DIALOG")
  f:SetPoint("CENTER", UIParent, "CENTER", 0, 40)
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  f:SetMovable(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function() this:StartMoving() end)
  f:SetScript("OnDragStop", function() this:StopMovingOrSizing() end)
  f:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  f:Hide()
  table.insert(UISpecialFrames, "EasyRouteSettings")

  local title = f:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOP", f, "TOP", 0, -18)
  title:SetText("Easy Route settings")
  S.sub = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  S.sub:SetPoint("TOP", title, "BOTTOM", 0, -6)
  local close = CreateFrame("Button", "EasyRouteSettingsClose", f, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", f, "TOPRIGHT", -6, -6)

  local y = -62
  local nc, nb = 0, 0   -- ticks and buttons so far, over both groups (they give the frames their names)
  local bw = math.floor((W - 56) / 2)
  local colW = math.floor((W - 68) / 2)   -- one column of the part ticks
  for _, g in ipairs(GROUPS) do
    local head = f:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    head:SetPoint("TOPLEFT", f, "TOPLEFT", 22, y)
    head:SetText(g.title)
    y = y - 18
    local rule = f:CreateTexture(nil, "ARTWORK")
    rule:SetTexture(1, 1, 1, 0.15)
    rule:SetHeight(1)
    rule:SetWidth(W - 44)
    rule:SetPoint("TOPLEFT", f, "TOPLEFT", 22, y)
    y = y - 6

    -- The part ticks of auto mode sit indented in two columns. The first of a pair waits (pendingH) for the second, so the pair is as tall
    -- as the taller of the two labels.
    local partNo, pendingH = 0, nil
    for _, c in ipairs(g.checks) do
      nc = nc + 1
      local b = CreateFrame("CheckButton", "EasyRouteSettingsCheck" .. nc, f, "UICheckButtonTemplate")
      b:SetWidth(24)
      b:SetHeight(24)
      local x, labelW, col = 22, W - 80, 0
      if c.part then
        partNo = partNo + 1
        col = math.mod(partNo - 1, 2)
        x = 46 + col * colW
        labelW = colW - 30
      elseif pendingH then
        y = y - pendingH
        pendingH, partNo = nil, 0
      end
      b:SetPoint("TOPLEFT", f, "TOPLEFT", x, y)
      local rowH = 24
      local label = getglobal("EasyRouteSettingsCheck" .. nc .. "Text")
      if label then
        label:ClearAllPoints()
        label:SetPoint("TOPLEFT", b, "TOPRIGHT", 0, -4)
        label:SetJustifyH("LEFT")
        rowH = math.max(24, ER.FitHeight(label, c[1], labelW, 16) + 8)
      end
      b.index = nc
      b:SetScript("OnClick", function()
        local on = this:GetChecked() and true or false
        CHECKS[this.index][3](on)
        Refresh()
      end)
      S.checks[nc] = b
      if not c.part then
        y = y - rowH
      elseif col == 0 then
        pendingH = rowH
      else
        y = y - math.max(pendingH or 24, rowH)
        pendingH = nil
      end
    end
    if pendingH then y = y - pendingH end

    y = y - 6
    for i, def in ipairs(g.buttons) do
      nb = nb + 1
      local b = CreateFrame("Button", "EasyRouteSettingsButton" .. nb, f, "UIPanelButtonTemplate")
      b:SetWidth(bw)
      b:SetHeight(22)
      local col = math.mod(i - 1, 2)
      b:SetPoint("TOPLEFT", f, "TOPLEFT", 24 + col * (bw + 8), y)
      b:SetText(def[1])
      b.def = def
      b:SetScript("OnClick", function() this.def[3]() end)
      b:SetScript("OnEnter", function()
        GameTooltip:SetOwner(this, "ANCHOR_RIGHT")
        GameTooltip:SetText(this.def[1])
        GameTooltip:AddLine(this.def[2], 1, 1, 1, 1)
        GameTooltip:Show()
      end)
      b:SetScript("OnLeave", function() GameTooltip:Hide() end)
      S.buttons[nb] = b
      if col == 1 then y = y - 26 end
    end
    if math.mod(table.getn(g.buttons), 2) == 1 then y = y - 26 end
    y = y - 12
  end

  local credit = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  credit:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -20, 16)
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
  local height = -y + 40
  f:SetHeight(height)
  f:SetScale(ER.SettingsScale(height, UIParent:GetHeight()))
end

function ER.ShowSettings()
  if not S.frame then Build() end
  Refresh()
  S.frame:Show()
end

function ER.ToggleSettings()
  if S.frame and S.frame:IsShown() then S.frame:Hide() else ER.ShowSettings() end
end

ER.Loaded("Settings.lua")
