-- Easy Route: the "How to use" window and the welcome window. How to use opens with /er help, the How to use button in
-- Settings, or Shift-clicking the minimap icon. The welcome window comes up once per character on its first login (Share.lua decides,
-- so it never shows together with the notice), and from the Welcome button in Settings and in How to use.

local ER = EasyRoute

local GOLD, GREEN, GREY, WHITE, END = "|cffffd100", "|cff40ff40", "|cff9d9d9d", "|cffffffff", "|r"

local function B(s) return WHITE .. s .. END end

local HELP_TEXT = table.concat({
  GOLD .. "Start" .. END,
  "- Type " .. B("/er") .. ", pick how hard, click " .. B("Go with this") .. ".",
  "- The " .. B("casual route") .. " goes one zone at a time. It starts by itself on a new character.",
  "- Follow the step box on the right and the arrow on screen.",
  "- Steps tick off by themselves. The grey line shows " .. B("where you are in the plan") .. ".",
  " ",
  GOLD .. "Buttons" .. END,
  "- " .. B("<") .. " and " .. B(">") .. ": go back or forward a step.",
  "- " .. B("Skip") .. ": leave a quest out. It counts as Hard for you from then on.",
  "- " .. B("Stuck? Skip this step") .. ": shows after 10 minutes on one step.",
  "- Gear button: " .. B("Settings") .. ". Pages: Guide, Auto mode, Helpers, Feedback.",
  "- Click the guide's name to pick another guide, or the " .. B("Fast route") .. ".",
  " ",
  GOLD .. "Auto mode" .. END .. " (on by default)",
  "- " .. B("Auto mode") .. " takes your route's quests and hands in finished ones.",
  "- Takes the flight, sets your hearthstone, sells grey items and repairs.",
  "- Rewards: you pick. If none fit you, it takes the one that sells for the most.",
  "- Hold " .. B("Shift") .. " when you talk to an NPC to do it yourself.",
  "- Each part has its own tick in " .. B("Settings") .. ", Auto mode page.",
  "- Hearth steps: click " .. B("Use your hearthstone") .. ". It never hearths by itself.",
  " ",
  GOLD .. "Helpers" .. END,
  "- " .. B("Grind spots") .. ": safe mobs to kill when there are no good quests.",
  "- " .. B("Warnings") .. ": dangerous mobs, caves and mines.",
  "- " .. B("Quest chains") .. ": kept only when worth it. The first step says what you get.",
  "- " .. B("How is it going?") .. ": every 3 levels, answer Too easy, About right or Too hard.",
  "- Enemy tooltips say " .. GREEN .. "Easy" .. END .. ", Medium or |cffff4040Hard" .. END .. ".",
  " ",
  GOLD .. "How hard" .. END,
  "- " .. B("Casual") .. ": no group, elite, dungeon, escort or risky quests.",
  "- " .. B("Medium") .. ": escorts and risky quests stay, with a warning.",
  "- " .. B("Hard") .. ": everything except dungeon quests.",
  "- " .. B("/er unskip") .. ": bring back quests you skipped.",
  " ",
  GOLD .. "Commands" .. END,
  B("/er") .. " show or hide     " .. B("/er settings") .. "     " .. B("/er arrow") .. "     " .. B("/er next") ..
    "     " .. B("/er stop") .. "     " .. B("/er help"),
  " ",
  GREY .. "Quest data: pfQuest, pfExtend and CMaNGOS classic-db." .. END,
  GREY .. "Thanks to Nonnally for helping test." .. END,
}, "\n")

local frame

local function Opaque(f)
  local solid = f:CreateTexture(nil, "BACKGROUND")
  solid:SetTexture(0.05, 0.05, 0.07, 1)
  solid:SetPoint("TOPLEFT", f, "TOPLEFT", 11, -11)
  solid:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -11, 11)
end

local function CreateHelp()
  frame = CreateFrame("Frame", "EasyRouteHelpFrame", UIParent)
  frame:SetWidth(560)
  frame:SetPoint("CENTER", UIParent, "CENTER", 0, 20)
  frame:SetFrameStrata("FULLSCREEN_DIALOG")
  frame:SetClampedToScreen(true)
  frame:EnableMouse(true)
  frame:SetMovable(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", function() this:StartMoving() end)
  frame:SetScript("OnDragStop", function() this:StopMovingOrSizing() end)
  Opaque(frame)
  frame:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  frame:Hide()
  table.insert(UISpecialFrames, "EasyRouteHelpFrame")

  local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOP", frame, "TOP", 0, -20)
  title:SetText("Easy Route - How to use")

  local close = CreateFrame("Button", "EasyRouteHelpCloseButton", frame, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -6, -6)
  close:SetScript("OnClick", function() frame:Hide() end)

  local text = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  text:SetPoint("TOPLEFT", frame, "TOPLEFT", 26, -50)
  text:SetJustifyH("LEFT")
  text:SetJustifyV("TOP")
  local th = ER.FitHeight(text, HELP_TEXT, 508, 100)
  local height = th + 50 + 70   -- room for the title above and the Got it button and the credit below
  frame:SetHeight(height)
  if ER.SettingsScale then frame:SetScale(ER.SettingsScale(height, UIParent:GetHeight())) end   -- big text: shrink to fit the screen

  local ok = CreateFrame("Button", "EasyRouteHelpOkButton", frame, "UIPanelButtonTemplate")
  ok:SetWidth(120)
  ok:SetHeight(24)
  ok:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -24, 20)
  ok:SetText("Got it")
  ok:SetScript("OnClick", function() frame:Hide() end)
  local welcome = CreateFrame("Button", "EasyRouteHelpWelcomeButton", frame, "UIPanelButtonTemplate")
  welcome:SetWidth(120)
  welcome:SetHeight(24)
  welcome:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", 24, 20)
  welcome:SetText("Welcome")
  welcome:SetScript("OnClick", function()
    frame:Hide()
    ER.ShowWelcome()
  end)

  local credit = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  credit:SetPoint("BOTTOM", frame, "BOTTOM", 0, 26)
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
end

function ER.ShowHelp()
  if not frame then CreateHelp() end
  frame:Show()
end

function ER.ToggleHelp()
  if frame and frame:IsShown() then
    frame:Hide()
  else
    ER.ShowHelp()
  end
end

------------------------------------------------------------------------------------------------------
-- The welcome window
------------------------------------------------------------------------------------------------------

-- The welcome window comes up once per character. What a character has seen is kept as this number in ER.db.welcomeSeen[character];
-- raise it when the words change in a way every character should see again.
local WELCOME_VERSION = 1

local WELCOME_TEXT = table.concat({
  GOLD .. "Best features" .. END,
  "- One zone at a time, level 1 to 60. No running back and forth.",
  "- Starts by itself: a step box and an arrow show what to do.",
  "- " .. B("Auto mode") .. ": takes and hands in quests, flies, sets your hearthstone, sells junk, repairs.",
  "- Smart rewards: if none fit you, it takes the one that sells for the most.",
  "- " .. B("Casual") .. " leaves out elites, group quests, dungeons and escorts.",
  "- Safe grind spots when there are no good quests.",
  "- Warnings before dangerous mobs, caves and mines.",
  "- Quest chains only when worth it, and it says what you get.",
  "- Learns from you: asks every 3 levels; quests you die on twice or skip count as hard.",
  "- Casual, Medium or Hard. Made for Turtle WoW.",
  " ",
  GOLD .. "Why Easy Route?" .. END,
  "- Made for fun, not speed. Speed guides rush you from zone to zone.",
  "- Leaves out the quests that are no fun on your own.",
  "- Changes with how you play, not a fixed list.",
  "- Does the clicking for you.",
  "- Tells you where to grind and why it is safe.",
  " ",
  GOLD .. "How to start" .. END,
  "1. Pick how hard (Casual, Medium or Hard).",
  "2. Follow the step box and the arrow.",
  "3. Hold " .. B("Shift") .. " at an NPC to do it yourself.",
  " ",
  GREY .. "Nothing leaves your computer. More in Settings, Feedback page." .. END,
}, "\n")

local THANKS_TEXT = "Thanks to Nonnally for helping test."

local welcome

local function CreateWelcome()
  welcome = CreateFrame("Frame", "EasyRouteWelcomeFrame", UIParent)
  welcome:SetWidth(540)
  welcome:SetPoint("CENTER", UIParent, "CENTER", 0, 20)
  welcome:SetFrameStrata("FULLSCREEN_DIALOG")
  welcome:SetClampedToScreen(true)
  welcome:EnableMouse(true)
  welcome:SetMovable(true)
  welcome:RegisterForDrag("LeftButton")
  welcome:SetScript("OnDragStart", function() this:StartMoving() end)
  welcome:SetScript("OnDragStop", function() this:StopMovingOrSizing() end)
  Opaque(welcome)
  welcome:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  welcome:Hide()
  table.insert(UISpecialFrames, "EasyRouteWelcomeFrame")

  local title = welcome:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOP", welcome, "TOP", 0, -20)
  title:SetText("Welcome to Easy Route")

  local close = CreateFrame("Button", "EasyRouteWelcomeClose", welcome, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", welcome, "TOPRIGHT", -6, -6)
  close:SetScript("OnClick", function() welcome:Hide() end)

  local text = welcome:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  text:SetPoint("TOPLEFT", welcome, "TOPLEFT", 26, -50)
  text:SetJustifyH("LEFT")
  text:SetJustifyV("TOP")
  local th = ER.FitHeight(text, WELCOME_TEXT, 488, 100)

  -- Under the words: the thanks line, then the buttons and the credit line.
  local thanks = welcome:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  thanks:SetPoint("BOTTOMLEFT", welcome, "BOTTOMLEFT", 26, 52)
  thanks:SetJustifyH("LEFT")
  local nh = ER.FitHeight(thanks, GREY .. THANKS_TEXT .. END, 488, 14)

  local height = th + 50 + 12 + nh + 52
  welcome:SetHeight(height)
  if ER.SettingsScale then welcome:SetScale(ER.SettingsScale(height, UIParent:GetHeight())) end   -- big text: shrink to fit the screen

  local go = CreateFrame("Button", "EasyRouteWelcomeGo", welcome, "UIPanelButtonTemplate")
  go:SetWidth(120)
  go:SetHeight(24)
  go:SetPoint("BOTTOMRIGHT", welcome, "BOTTOMRIGHT", -24, 20)
  go:SetText("Let's go")
  go:SetScript("OnClick", function()
    welcome:Hide()
    if not (ER.Steps and ER.Steps.Running()) and ER.ShowWizard then ER.ShowWizard() end
  end)
  local settings = CreateFrame("Button", "EasyRouteWelcomeSettings", welcome, "UIPanelButtonTemplate")
  settings:SetWidth(120)
  settings:SetHeight(24)
  settings:SetPoint("RIGHT", go, "LEFT", -8, 0)
  settings:SetText("Settings")
  settings:SetScript("OnClick", function()
    welcome:Hide()
    if ER.ShowSettings then ER.ShowSettings() end
  end)

  local credit = welcome:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  credit:SetPoint("BOTTOMLEFT", welcome, "BOTTOMLEFT", 26, 26)
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
end

-- Has this character not seen the welcome window yet (in its words of now)?
function ER.WelcomeDue()
  if not ER.db then return false end
  local seen = type(ER.db.welcomeSeen) == "table" and ER.db.welcomeSeen[ER.Char()]
  return (tonumber(seen) or 0) < WELCOME_VERSION
end

-- Shows the welcome window; from then on it counts as seen for this character, however it is closed.
function ER.ShowWelcome()
  if not welcome then CreateWelcome() end
  if ER.db then
    if type(ER.db.welcomeSeen) ~= "table" then ER.db.welcomeSeen = {} end
    ER.db.welcomeSeen[ER.Char()] = WELCOME_VERSION
  end
  welcome:Show()
end

-- For the quick checks: the words of the welcome window and its thanks line.
function ER._testWelcomeText()
  return WELCOME_TEXT .. "\n" .. THANKS_TEXT
end

ER.Loaded("Help.lua")
