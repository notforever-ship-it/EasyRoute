-- Easy Route: the wizard. /er (or the minimap button) asks how you want to play (Casual, Medium or Hard), then
-- suggests a guide for your faction and level, like RestedXP: the starting zone made for your race, or the guide
-- whose levels you are in now. "Go with this" starts it: the step window (Tracker.lua) opens on
-- the right and the arrow (Arrow.lua) points the way. "All guides" opens the guide menu with every guide by level.
--
-- The guides are RestedXP's (Data\Guides.lua); the engine that follows them is Steps.lua.

local ER = EasyRoute
local GOLD, GREY, END = ER.GOLD, ER.GREY, ER.END

local WIDTH, HEIGHT = 480, 400
local LEFT, INNER_W = 24, 432

local frame, subtitle, bodyText, footText
local buttons = {}
local screen = "mood"
local pick, choices = 1, {}
local Refresh

local function Opaque(f)
  local solid = f:CreateTexture(nil, "BACKGROUND")
  solid:SetTexture(0.05, 0.05, 0.07, 1)
  solid:SetPoint("TOPLEFT", f, "TOPLEFT", 11, -11)
  solid:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -11, 11)
end

local function Credit(parent, x, y)
  local credit = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  credit:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", x, y)
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
  return credit
end

local function Me()
  local faction = UnitFactionGroup and UnitFactionGroup("player") or "Alliance"
  return faction, UnitLevel("player") or 1, GetZoneText() or ""
end

local function HideAll()
  for i = 1, table.getn(buttons) do buttons[i]:Hide() end
end

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

------------------------------------------------------------------------------------------------------
-- Screens
------------------------------------------------------------------------------------------------------

local function ShowMood()
  local faction, level, zone = Me()
  subtitle:SetText(GREY .. "level " .. level .. " " .. faction .. (zone ~= "" and (" - " .. zone) or "") .. END)
  bodyText:SetText(GOLD .. "How do you want to play?" .. END .. "\n\nI'll pick a leveling guide for your level and " ..
    "take you through it one step at a time, with an arrow that points the way. Pick how hard you want it:")
  local tips = {
    casual = "Casual - no group quests, nothing with an elite to kill",
    medium = "Medium - the full guide, but no group quests",
    hard = "Hard - everything, group quests too",
  }
  for i, key in ipairs(ER.MODE_ORDER) do
    Btn(i, tips[key] or key, LEFT, -150 - (i - 1) * 38, INNER_W, function()
      ER.SetMode(key)
      if ER.db then
        if type(ER.db.wizardAsked) ~= "table" then ER.db.wizardAsked = {} end
        ER.db.wizardAsked[ER.Char()] = true   -- this character has picked a difficulty
      end
      choices, pick = ER.Steps.Suggest(), 1
      screen = "guide"
      -- A guide already running carries on with the new difficulty.
      if ER.Steps.Running() then
        frame:Hide()
        ER.Steps.Check()
        if ER.ShowTracker then ER.ShowTracker() end
        return
      end
      Refresh()
    end)
    buttons[i]:SetHeight(30)
  end
  footText:SetText(GREY .. "You can change this any time in Settings (the gear on the guide)." .. END)
end

-- Why a guide is suggested, in a few words.
local function Why(g)
  local _, level, zone = Me()
  local parts = {}
  if g.defaultFor and g.defaultFor ~= "" and ER.Steps.Applies(g.defaultFor) then
    table.insert(parts, "made for your race's starting area")
  end
  if zone ~= "" and string.find(string.lower(g.title or g.name), string.lower(zone), 1, true) then
    table.insert(parts, "you are in " .. zone)
  end
  if level >= g.lo and level <= g.hi then
    table.insert(parts, "levels " .. g.lo .. " to " .. g.hi .. " suit you")
  elseif level < g.lo then
    table.insert(parts, "it starts at level " .. g.lo .. ", the next one up")
  end
  if table.getn(parts) == 0 then return "" end
  return table.concat(parts, ", ") .. "."
end

local function ShowGuideChoice()
  local _, level = Me()
  local mode = ER.MODES[ER.Mode()]
  subtitle:SetText(GREY .. "level " .. level .. " - " .. mode.label .. END)
  if table.getn(choices) == 0 then choices, pick = ER.Steps.Suggest(), 1 end
  local g = choices[pick]
  if not g then
    bodyText:SetText(GOLD .. "I don't have a guide for you right now." .. END ..
      "\n\nThe guides go from level 1 to 60 for the Alliance and the Horde. Have a look through them all.")
    Btn(1, "All guides", LEFT, -200, 200, function()
      frame:Hide()
      ER.ShowGuideMenu()
    end)
    Btn(2, "Change difficulty", LEFT + 210, -200, 200, ChangeMood)
    return
  end
  local text = GOLD .. "I suggest: " .. (g.title or g.name) .. END .. "\n" .. GREY .. g.group .. END .. "\n\n" .. Why(g)
  local running = ER.Steps.Info()
  if running then
    text = text .. "\n\n" .. GREY .. "You are following " .. (running.title or running.name) .. " now; this switches to it." .. END
  end
  bodyText:SetText(text)
  Btn(1, "Go with this", LEFT, -190, 200, function()
    frame:Hide()
    ER.StartGuide(ER.Steps.Key(g))
  end)
  if table.getn(choices) > 1 then
    Btn(2, "Show me another", LEFT + 210, -190, 200, function()
      pick = math.mod(pick, table.getn(choices)) + 1
      Refresh()
    end)
  end
  Btn(3, "All guides", LEFT, -224, 200, function()
    frame:Hide()
    ER.ShowGuideMenu()
  end)
  Btn(4, "Change difficulty", LEFT + 210, -224, 200, ChangeMood)
  footText:SetText(GREY .. pick .. " of " .. table.getn(choices) .. " suggestions  -  routes by RestedXP" .. END)
end

Refresh = function()
  if not frame then return end
  HideAll()
  footText:SetText("")
  if screen == "mood" then ShowMood()
  else ShowGuideChoice() end
end

------------------------------------------------------------------------------------------------------
-- The window
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
    -- After the first time it goes straight to the guide suggestion, not the difficulty question.
    if screen == "mood" and ER.db and type(ER.db.wizardAsked) == "table" and ER.db.wizardAsked[ER.Char()] then
      choices, pick = ER.Steps.Suggest(), 1
      screen = "guide"
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
  bodyText:SetHeight(120)
  bodyText:SetJustifyH("LEFT")
  bodyText:SetJustifyV("TOP")

  for i = 1, 5 do
    local b = CreateFrame("Button", "EasyRouteWizardBtn" .. i, frame, "UIPanelButtonTemplate")
    b:SetWidth(100)
    b:SetHeight(22)
    b:SetScript("OnClick", function() if this.fn then this.fn() end end)
    b:Hide()
    buttons[i] = b
  end

  footText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  footText:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", LEFT, 22)
  Credit(frame, -24, 22)
end

function ER.ShowWizard()
  if not frame then Build() end
  frame:Show()
end

-- The guide menu's "Change difficulty": the wizard on its first question.
function ER.ShowWizardMood()
  if not frame then Build() end
  screen = "mood"
  if frame:IsShown() then Refresh() else frame:Show() end
end

-- /er and the minimap button: with a guide running they show or hide the step window; otherwise the wizard.
function ER.ToggleWizard()
  if ER.Steps and ER.Steps.Running() then
    if ER.ToggleTracker then ER.ToggleTracker() end
    return
  end
  if not frame then Build() end
  if frame:IsShown() then frame:Hide() else frame:Show() end
end

-- What the wizard is showing, for the self-test.
function ER.WizardInfo()
  if not frame then return nil end
  return { screen = screen, text = bodyText:GetText(), guide = choices[pick] }
end

-- The first time on each character the wizard opens by itself, a few seconds after the game has settled, so a
-- new character starts with the question. It only does this once per character; /er opens it any time.
local starter = CreateFrame("Frame", "EasyRouteWizardStarter")
starter:RegisterEvent("PLAYER_ENTERING_WORLD")
starter:SetScript("OnEvent", function()
  this:UnregisterEvent("PLAYER_ENTERING_WORLD")
  if not ER.db then return end
  -- 0.7.0 has a new wizard (guides, not stops), so every character gets asked once more.
  if type(ER.db.guideAsked) ~= "table" then ER.db.guideAsked = {} end
  local who = ER.Char()
  if ER.db.guideAsked[who] then return end
  ER.db.guideAsked[who] = true
  this.wait = 0
  this:SetScript("OnUpdate", function()
    this.wait = this.wait + arg1
    if this.wait < 4 then return end
    this:SetScript("OnUpdate", nil)
    if (not frame or not frame:IsShown()) and not (ER.Steps and ER.Steps.Running()) then
      screen = "mood"   -- always start with the difficulty question
      ER.ShowWizard()
    end
  end)
end)
