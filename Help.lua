-- Easy Route: "How to use" window. Opens with /er help, the How to use button in Settings, or Shift-clicking the
-- minimap icon.

local ER = EasyRoute

local GOLD, GREEN, GREY, WHITE, END = "|cffffd100", "|cff40ff40", "|cff9d9d9d", "|cffffffff", "|r"

local function B(s) return WHITE .. s .. END end

local HELP_TEXT = table.concat({
  GOLD .. "The guide" .. END,
  "- " .. B("/er") .. " (or the minimap button) asks how hard you want it, then suggests a guide for your level. " ..
    B("Go with this") .. " opens the steps on the right and an arrow at the top of the screen.",
  "- The box at the top is the step you are on. It ticks itself off as you take quests, kill, loot and hand in. " ..
    B("<") .. " and " .. B(">") .. " step by hand, " .. B("Skip") .. " leaves a step out, click a step in the list to jump to it.",
  "- The " .. B("arrow") .. " points at the next place and says how many yards away. Drag it to move it, right-click hides it (" ..
    B("/er arrow") .. " brings it back). With pfQuest the place is marked on your map too.",
  "- When a guide ends, the next one starts by itself. Clicking the guide's name lists every guide for your faction by level.",
  "- " .. B("Your level") .. ": quests too easy for you (grey) are left out, a quest above you gets a red warning, and when you " ..
    "outlevel a guide it offers the next one.",
  "- " .. B("Simple mode") .. ": a quest list on the left instead of the step box. Click a quest and the arrow points there; " ..
    "click it again and the arrow follows the guide.",
  "- " .. B("Easy Route says") .. ": a small box with tips, such as the guide's own warnings and trainer reminders.",
  "- Enemies say " .. GREEN .. "Easy" .. END .. ", Medium or |cffff4040Hard" .. END .. " at the bottom of their tooltip, " ..
    "and a gold skull over the health bar (V key) marks the ones your quests need.",
  " ",
  GOLD .. "How hard" .. END,
  "- " .. B("Casual") .. " leaves out group quests and quests with an elite to kill.",
  "- " .. B("Medium") .. " leaves out group quests.",
  "- " .. B("Hard") .. " does them all. Change it with " .. B("Change difficulty") .. " in Settings.",
  " ",
  GOLD .. "Settings" .. END,
  "- The " .. B("gear") .. " on the guide (or right-clicking the minimap button) opens Settings: every option in one place, " ..
    "no commands needed.",
  "- " .. B("The guide") .. ": the guide, how hard, simple mode, the arrow, tips, skulls, enemy tooltips, money steps, " ..
    "going on to the next guide, the minimap button.",
  "- " .. B("Feedback (for testers)") .. ": tick " .. B("Ask me how hard each quest was") .. " and a small box asks after each " ..
    "hand-in. " .. B("Send feedback") .. " puts your answers in a box to copy for stealthzi. Nothing leaves your computer by itself.",
  " ",
  GOLD .. "Commands" .. END,
  B("/er") .. " - the guide     " .. B("/er settings") .. " - every option     " .. B("/er arrow") .. " - arrow on or off",
  B("/er next") .. " - skip a step     " .. B("/er stop") .. " - stop the guide     " .. B("/er help") .. " - this page",
  " ",
  GREY .. "The routes are RestedXP's free classic guides (github.com/RestedXP/RXPGuides, CC BY-NC-SA 4.0)." .. END,
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
  local version = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  version:SetPoint("TOP", title, "BOTTOM", 0, -2)
  version:SetText(GREY .. "version " .. ER.VERSION .. END)

  local close = CreateFrame("Button", "EasyRouteHelpCloseButton", frame, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -6, -6)
  close:SetScript("OnClick", function() frame:Hide() end)

  local text = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  text:SetPoint("TOPLEFT", frame, "TOPLEFT", 26, -64)
  text:SetJustifyH("LEFT")
  text:SetJustifyV("TOP")
  local th = ER.FitHeight(text, HELP_TEXT, 508, 100)
  frame:SetHeight(th + 64 + 70)   -- room for the title above and the Got it button and the credit below

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
