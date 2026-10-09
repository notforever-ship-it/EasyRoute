-- Easy Route: minimap button. Click opens the guide, right-click Settings, Shift-click the help, drag moves it around the minimap.

local ER = EasyRoute

local button

local function UpdatePosition()
  local angle = math.rad(ER.db.minimapAngle or 200)
  button:SetPoint("CENTER", Minimap, "CENTER", math.cos(angle) * 80, math.sin(angle) * 80)
end

local function DragUpdate()
  local mx, my = Minimap:GetCenter()
  local px, py = GetCursorPosition()
  local scale = Minimap:GetEffectiveScale()
  px, py = px / scale, py / scale
  ER.db.minimapAngle = math.deg(math.atan2(py - my, px - mx))
  UpdatePosition()
end

function ER.UpdateMinimapButton()
  if not button then return end
  if ER.db.minimapHidden then
    button:Hide()
  else
    UpdatePosition()
    button:Show()
  end
end

function ER.InitMinimapButton()
  button = CreateFrame("Button", "EasyRouteMinimapButton", Minimap)
  button:SetWidth(31)
  button:SetHeight(31)
  button:SetFrameStrata("MEDIUM")
  button:SetFrameLevel(8)
  button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  button:RegisterForDrag("LeftButton")
  button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

  local icon = button:CreateTexture(nil, "BACKGROUND")
  icon:SetTexture("Interface\\Icons\\INV_Misc_Map_01")
  icon:SetWidth(20)
  icon:SetHeight(20)
  icon:SetTexCoord(0.07, 0.93, 0.07, 0.93)
  icon:SetPoint("TOPLEFT", button, "TOPLEFT", 6, -5)

  local border = button:CreateTexture(nil, "OVERLAY")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
  border:SetWidth(53)
  border:SetHeight(53)
  border:SetPoint("TOPLEFT", button, "TOPLEFT", 0, 0)

  button:SetScript("OnClick", function()
    if arg1 == "RightButton" and ER.ToggleSettings then
      ER.ToggleSettings()
    elseif IsShiftKeyDown() then
      ER.ToggleHelp()
    elseif IsControlKeyDown and IsControlKeyDown() then
      ER.ToggleWindow()
    elseif ER.ToggleWizard then
      ER.ToggleWizard()
    else
      ER.RestartNeeded()
    end
  end)
  button:SetScript("OnDragStart", function() this:SetScript("OnUpdate", DragUpdate) end)
  button:SetScript("OnDragStop", function() this:SetScript("OnUpdate", nil) end)
  button:SetScript("OnEnter", function()
    GameTooltip:SetOwner(this, "ANCHOR_LEFT")
    GameTooltip:SetText("Easy Route")
    GameTooltip:AddLine("version " .. ER.VERSION, 0.6, 0.6, 0.6)
    GameTooltip:AddLine("Click: the guide (what to do next)", 0.8, 0.8, 0.8)
    GameTooltip:AddLine("Right-click: settings (every option)", 0.8, 0.8, 0.8)
    GameTooltip:AddLine("Shift-click: how to use", 0.8, 0.8, 0.8)
    GameTooltip:AddLine("Drag: move this button", 0.8, 0.8, 0.8)
    GameTooltip:AddLine("/er minimap hides it", 0.8, 0.8, 0.8)
    GameTooltip:Show()
  end)
  button:SetScript("OnLeave", function() GameTooltip:Hide() end)

  ER.UpdateMinimapButton()
end

ER.Loaded("Minimap.lua")
