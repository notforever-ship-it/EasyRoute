-- Easy Route: "How to use" window. Opens with /er help, the How to use button in Settings, or Shift-clicking the
-- minimap icon.

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
  "- Gear button: " .. B("Settings") .. ". Everything can be turned on or off there.",
  "- Click the guide's name to pick another guide, or the " .. B("Fast route") .. ".",
  " ",
  GOLD .. "Auto mode" .. END .. " (on by default)",
  "- " .. B("Auto mode") .. " takes your route's quests and hands in finished ones.",
  "- Takes the flight, sets your hearthstone, sells grey items and repairs.",
  "- Rewards: you pick. If none fit you, it takes the one that sells for the most.",
  "- Hold " .. B("Shift") .. " when you talk to an NPC to do it yourself.",
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

ER.Loaded("Help.lua")
