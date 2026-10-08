-- Easy Route: the settings window. Every option and every window of the addon in one place, so nothing needs a
-- slash command: tick boxes for what can be on or off, buttons for the rest. The gear on the guide (step box or
-- quest list) opens it, so does right-clicking the minimap button, or /er settings.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local W = 460
local S = { checks = {}, buttons = {} }

local function Db() return ER.db or {} end

-- Each: label, is it on now, turn it on or off. The toggles that already have their own function use it, so the
-- chat line and the windows follow as with the slash command.
local CHECKS = {
  { "Simple mode: quest list on the left instead of the step box",
    function() return Db().simple end,
    function(on) if ER.SetSimple then ER.SetSimple(on) end end },
  { "Show the arrow",
    function() return not Db().arrowOff end,
    function(on) if (not Db().arrowOff) ~= on and ER.ToggleArrow then ER.ToggleArrow() end end },
  { "Show tips (the \"Easy Route says\" box)",
    function() return not Db().tipsOff end,
    function(on) if (not Db().tipsOff) ~= on and ER.ToggleTips then ER.ToggleTips() end end },
  { "Skulls over enemies my quests need (V shows their health bars)",
    function() return not Db().skullsOff end,
    function(on) if (not Db().skullsOff) ~= on and ER.ToggleSkulls then ER.ToggleSkulls() end end },
  { "Easy / Medium / Hard on enemy tooltips",
    function() return not Db().rateOff end,
    function(on) if ER.db then ER.db.rateOff = not on end end },
  { "Leave out steps that only farm money (I have money on another character)",
    function() return ER.HasMoney and ER.HasMoney() end,
    function(on) if ER.SetHasMoney then ER.SetHasMoney(on) end end },
  { "Say in party chat when I hand a quest in",
    function() return Db().partyAnnounce end,
    function(on) if ER.db then ER.db.partyAnnounce = on end end },
  { "Popup when I pick up the first quest of a chain",
    function() return Db().chainPopup end,
    function(on) if ER.db then ER.db.chainPopup = on end end },
  { "Ask how a quest was after every hand-in",
    function() return Db().autoPrompt end,
    function(on) if ER.db then ER.db.autoPrompt = on end end },
  { "Minimap button",
    function() return not Db().minimapHidden end,
    function(on)
      if ER.db then ER.db.minimapHidden = not on end
      if ER.UpdateMinimapButton then ER.UpdateMinimapButton() end
    end },
}

local function Running() return ER.Steps and ER.Steps.Running() end

local BUTTONS = {
  { "Pick a guide", "Every guide for your faction, by level.", function()
    S.frame:Hide()
    if ER.ShowGuideMenu then ER.ShowGuideMenu() end
  end },
  { "Change difficulty", "Casual, Medium, Hard or Everything.", function()
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
  { "Quests around me", "The quests worth doing where you stand, chains and a grind spot.", function()
    S.frame:Hide()
    if ER.ToggleGuide then ER.ToggleGuide() end
  end },
  { "Notebook", "Your quest log with Easy / Medium / Hard / Skip buttons, and everything rated so far.", function()
    S.frame:Hide()
    if ER.ToggleWindow then ER.ToggleWindow() end
  end },
  { "Send feedback", "Your ratings and notes in a box, already selected: Ctrl+C and paste it to stealthzi.", function()
    S.frame:Hide()
    if ER.ShowExport then ER.ShowExport() end
  end },
  { "Unskip quests", "Bring back every quest you said \"not today\" to.", function()
    if ER.ClearSkipped then ER.ClearSkipped() end
    ER.Print("every quest you said 'not today' to is back on the list.")
  end },
  { "How to use", "The help page.", function()
    S.frame:Hide()
    if ER.ShowHelp then ER.ShowHelp() end
  end },
  { "What it records", "Exactly what the addon writes down, and that nothing leaves your computer.", function()
    S.frame:Hide()
    if ER.ShowNotice then ER.ShowNotice() end
  end },
}

local function Refresh()
  for i, c in ipairs(S.checks) do
    c:SetChecked(CHECKS[i][2]() and 1 or nil)
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
  for i, c in ipairs(CHECKS) do
    local b = CreateFrame("CheckButton", "EasyRouteSettingsCheck" .. i, f, "UICheckButtonTemplate")
    b:SetWidth(24)
    b:SetHeight(24)
    b:SetPoint("TOPLEFT", f, "TOPLEFT", 22, y)
    local label = getglobal("EasyRouteSettingsCheck" .. i .. "Text")
    if label then
      label:SetText(c[1])
      label:SetWidth(W - 80)
      label:SetJustifyH("LEFT")
    end
    b.index = i
    b:SetScript("OnClick", function()
      local on = this:GetChecked() and true or false
      CHECKS[this.index][3](on)
      Refresh()
    end)
    S.checks[i] = b
    y = y - 24
  end

  y = y - 10
  local bw = math.floor((W - 56) / 2)
  for i, def in ipairs(BUTTONS) do
    local b = CreateFrame("Button", "EasyRouteSettingsButton" .. i, f, "UIPanelButtonTemplate")
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
    S.buttons[i] = b
    if col == 1 then y = y - 26 end
  end
  if math.mod(table.getn(BUTTONS), 2) == 1 then y = y - 26 end

  local credit = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  credit:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -20, 16)
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
  f:SetHeight(-y + 40)
end

function ER.ShowSettings()
  if not S.frame then Build() end
  Refresh()
  S.frame:Show()
end

function ER.ToggleSettings()
  if S.frame and S.frame:IsShown() then S.frame:Hide() else ER.ShowSettings() end
end
