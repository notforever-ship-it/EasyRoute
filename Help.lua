-- Easy Route: "How to use" window. Opens with /er help, the How to use button in Settings, or Shift-clicking the
-- minimap icon.

local ER = EasyRoute

local GOLD, GREEN, GREY, WHITE, END = "|cffffd100", "|cff40ff40", "|cff9d9d9d", "|cffffffff", "|r"

local function B(s) return WHITE .. s .. END end

local HELP_TEXT = table.concat({
  GOLD .. "The guide" .. END,
  "- The " .. B("casual route") .. " starts by itself on a new character, a few seconds after you log in. It takes you through the " ..
    "game one zone at a time, and the steps show on the right with an arrow at the top of the screen. " .. B("/er") ..
    " shows or hides the steps; with no guide running it opens the start screen.",
  "- The grey line under the step says " .. B("where you are in the plan") .. ", for example \"Durotar (1-10): 3 of 20 quests done. " ..
    "Next: Orgrimmar at 10.\"",
  "- When a zone is done, the guide tells you how to get to the next one and the arrow points the way, flight paths too " ..
    "(\"Get the flight path\" steps). Then the next zone starts by itself.",
  "- Want to go faster? Click the guide's name: the casual route comes first, then the " .. B("Fast route") .. " guides for your " ..
    "faction by level. A guide you already follow stays as it is.",
  "- " .. B("Stuck? Skip this step") .. " shows up when a step has not moved for 10 minutes. It skips only when you click it.",
  "- The box at the top is the step you are on. It ticks itself off as you take quests, kill, loot and hand in. " ..
    B("<") .. " and " .. B(">") .. " step by hand, " .. B("Skip") .. " leaves a step out, click a step in the list to jump to it.",
  "- " .. B("Skip") .. " on a step with a quest in it marks that quest Hard for you, so Casual and Medium leave it out from then on. " ..
    B("<") .. " and " .. B(">") .. " never do that. " .. B("/er unskip") .. " brings them back.",
  "- The " .. B("arrow") .. " points at the next place and says how many yards away. Drag it to move it, right-click hides it (" ..
    B("/er arrow") .. " brings it back). With pfQuest the place is marked on your map too.",
  "- " .. B("Your level") .. ": quests too easy for you (grey) are left out, a quest above you gets a red warning, and when you " ..
    "outlevel a guide it offers the next one.",
  "- " .. B("Grind spots") .. ": when there are no good quests, the guide says which mobs to grind, where, and why (yellow mobs " ..
    "won't attack you first). The arrow points there and the step ends by itself at the level. When you are behind the plan " ..
    "and the next quests are too high for you, it asks you to grind first.",
  "- " .. B("Auto mode") .. ": at an NPC, Easy Route does the clicking for you. It takes the quests your route wants (no others), hands in " ..
    "finished ones (a busy quest giver in one talk), takes the flight on a fly step, sets your hearthstone on its step, and sells grey " ..
    "items and repairs at a vendor. With two or more rewards the pick is yours; only when none of them fits you does it take the one " ..
    "that sells for the most, and says so. Hold " .. B("Shift") .. " when you start talking to do it yourself that time. On a hearth step, " ..
    "click " .. B("Use your hearthstone") .. "; it never hearths by itself. It never accepts an escort quest for you.",
  "- " .. B("Warnings") .. ": the step box (or the tips box) shows warnings for dangerous mobs on the step you are on, and a heads-up " ..
    "before caves, mines and crypts.",
  "- " .. B("How is it going?") .. ": every 3 levels the guide asks Too easy, About right or Too hard, and moves how far above you " ..
    "quests may be.",
  "- " .. B("Quest chains") .. ": a chain of 3 or more quests stays in your route only when its xp or the reward at the end is " ..
    "worth the walk. The step where it starts says what the end gives, for example " ..
    B("Chain of 4: lots of xp and a really good ring at the end."),
  "- " .. B("Simple mode") .. ": a quest list on the left instead of the step box. Click a quest and the arrow points there; " ..
    "click it again and the arrow follows the guide.",
  "- " .. B("Easy Route says") .. ": a small box with tips, such as the guide's own warnings and trainer reminders.",
  "- Enemies say " .. GREEN .. "Easy" .. END .. ", Medium or |cffff4040Hard" .. END .. " at the bottom of their tooltip, " ..
    "and a gold skull over the health bar (V key) marks the ones your quests need.",
  " ",
  GOLD .. "How hard" .. END,
  "- " .. B("Casual") .. " leaves out group, elite, dungeon and escort quests, risky quests, quests friends found hard, and quests " ..
    "you died on twice or skipped.",
  "- " .. B("Medium") .. " leaves out group, elite and dungeon quests and the hard ones; escorts and risky quests stay, with a warning.",
  "- " .. B("Hard") .. " does everything except dungeon quests. Change it with " .. B("Change difficulty") .. " in Settings.",
  "- " .. B("/er unskip") .. " brings back the quests the guide learned to leave out.",
  " ",
  GOLD .. "Settings" .. END,
  "- The " .. B("gear") .. " on the guide (or right-clicking the minimap button) opens Settings: every option in one place, " ..
    "no commands needed.",
  "- " .. B("The guide") .. ": the guide, how hard, simple mode, the arrow, tips, grind spots, skulls, enemy tooltips, money steps, " ..
    "going on to the next guide, asking every 3 levels, auto mode and its five parts, the minimap button.",
  "- " .. B("Feedback (for testers)") .. ": tick " .. B("Ask me how hard each quest was") .. " and a small box asks after each " ..
    "hand-in. " .. B("Send feedback") .. " puts your answers in a box to copy for stealthzi. Nothing leaves your computer by itself.",
  " ",
  GOLD .. "Commands" .. END,
  B("/er") .. " - show or hide the guide     " .. B("/er settings") .. " - every option     " .. B("/er arrow") .. " - arrow on or off",
  B("/er next") .. " - next step     " .. B("/er stop") .. " - stop the guide     " .. B("/er help") .. " - this page",
  " ",
  GREY .. "Quest data: pfQuest, pfExtend and CMaNGOS classic-db (which mobs are yellow or red)." .. END,
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
