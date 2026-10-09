-- Easy Route: "How to use" window. Opens with the button in the /er window, /er help, or
-- Shift-clicking the minimap icon.

local ER = EasyRoute

local GOLD, GREEN, GREY, WHITE, END = "|cffffd100", "|cff40ff40", "|cff9d9d9d", "|cffffffff", "|r"

local function B(s) return WHITE .. s .. END end

local HELP_TEXT = table.concat({
  GOLD .. "The guide" .. END,
  "- " .. B("/er") .. " (or the minimap button) asks how hard you want it, then suggests a guide for your level and faction. " ..
    B("Go with this") .. " opens the steps on the right and an arrow at the top of the screen.",
  "- The box at the top is the step you are on. It ticks itself off as you take quests, kill, loot and hand in. " ..
    B("<") .. " and " .. B(">") .. " step by hand, " .. B("Skip") .. " leaves a step out, click a step in the list to jump to it.",
  "- The " .. B("arrow") .. " points at the next place and says how many yards away. Drag it to move it, right-click hides it (" ..
    B("/er arrow") .. " brings it back). With pfQuest the place is marked on your map too.",
  "- The " .. B("gear") .. " (or right-clicking the minimap button) opens " .. B("Settings") .. ": every option in one place, " ..
    "tick boxes and buttons, no slash commands needed. Clicking the guide's name lists every guide for your faction by level.",
  "- " .. B("Casual") .. " leaves out group quests and quests with an elite to kill, " .. B("Medium") .. " leaves out group quests, " ..
    B("Hard") .. " does them all. " .. B("Everything") .. " turns the guide off: play your own way and rate quests.",
  "- " .. B("Your level") .. ": quests too easy for you (grey) are left out, a guide picked late starts at the first quest worth " ..
    "doing, a quest above you gets a red warning, and when you outlevel a guide it offers the next one.",
  "- " .. B("Simple mode") .. " (gear menu, or " .. B("/er simple") .. "): a quest list on the left like pfQuest's, coloured by level. " ..
    "Click a quest and the arrow points there; click it again and the arrow follows the guide.",
  "- " .. B("Easy Route says") .. ": a small box with tips: the guide's own warnings, trainer reminders, and a question or two. " ..
    B("/er tips") .. " hides it. Say you have money on another character and the money-farming steps are left out (" .. B("/er money") .. ").",
  "- Enemies say " .. GREEN .. "Easy" .. END .. ", Medium or |cffff4040Hard" .. END .. " at the bottom of their tooltip, " ..
    "and a gold skull over the health bar (V key) marks the ones your quests need (" .. B("/er skulls") .. ").",
  "- " .. B("/er go") .. " lists the quests worth doing where you stand, chains and a grind spot. Click one to find it, right-click for not today.",
  "- The routes are RestedXP's free classic guides (" .. GREY .. "github.com/RestedXP/RXPGuides, CC BY-NC-SA 4.0" .. END .. ").",
  " ",
  GOLD .. "The notebook" .. END,
  "While you play it also writes down which quests you took and handed in, where and at what level. You add what it " ..
    "cannot see: " .. B("was that quest easy or hard?"),
  " ",
  GOLD .. "Rating a quest" .. END,
  "- Open your " .. B("quest log (L)") .. " and pick a quest. The Easy Route panel on the right says how hard it looks " ..
    B("for your level right now") .. " and why. Click " .. GREEN .. "Easy" .. END .. ", Medium, " ..
    "|cffff8000Hard" .. END .. " or |cffff4040Skip" .. END .. ". One click, done.",
  "- The guess is said as advice: " .. GREY .. "Hard for you at level 12: it is 3 levels above you. Sure you want it now? Fine at " ..
    "level 13, easy at 18." .. END .. " A hard quest in a chain adds its step, since that can be a reason to do it anyway.",
  "- " .. B("No combat") .. " marks a quest with nothing to kill: talk, deliver, explore. One click, and an unrated quest becomes Easy with it. " ..
    B("Better solo") .. " is for pick-up quests where a group only competes for spawns, " .. B("Better coop") ..
    " for kill quests with shared credit or drops.",
  "- " .. B("...") .. " opens the popup for a " .. B("reason") .. " (no combat, better solo, better coop, needs a group, crowded, cave, " ..
    "long walk) and a " .. B("note") .. " like 'do this at 14'.",
  "- With " .. B("pfQuest") .. " installed, the panel says " .. B("chain quest, step 2 of 5") .. " and what comes next, chat " ..
    "says so when you pick one up, and the first quest of a chain gets a small popup (" .. B("/er chain") .. " turns it off).",
  "- When you are in a party, handing a quest in posts " .. B("I've done ... (Gnoll Bands x6)") .. " in party chat. Untick it in /er or type " ..
    B("/er party") .. ".",
  "- " .. B("Which quest was that?") .. " Three short lines wherever you rate: what it asked for (" .. WHITE .. "Collect 8 Torn Murloc Fins" .. END ..
    "), the quest's own words for it (" .. GREY .. "\"Bring 8 Torn Murloc Fins to Guard Thomas at the Eastvale Logging Camp.\"" .. END ..
    "), and where you did it (" .. WHITE .. "Done at Crystal Lake (Elwynn Forest), 16 min." .. END .. "). In the quest log panel " ..
    "while the quest is in your log, in chat and the popup when you hand it in, and when you hover a quest in " .. B("/er") .. ".",
  "- The places are noted as the counters tick up. For a quest the addon did not watch you do, " .. B("pfQuest") ..
    "'s database says where the things are instead.",
  "- Handed one in without rating it? It waits under 'Handed in, not rated yet' in the " .. B("/er") .. " window, " ..
    "which also lists your whole log and everything rated so far, each with the four buttons.",
  " ",
  GOLD .. "Notes about places" .. END,
  "- " .. B("/er note nice quiet boar spot") .. " or the box at the bottom of the window saves a note with where you stand.",
  "- Use it for grind spots, dangerous corners, a good place to hearth to, anything the guide should say.",
  " ",
  GOLD .. "What Easy, Medium, Hard and Skip mean" .. END,
  "- " .. GREEN .. "Easy" .. END .. ": relaxed, did it alone without stress. The guide sends casual players here.",
  "- " .. B("Medium") .. ": fine, takes some care, nothing that spoils the evening.",
  "- |cffff8000Hard" .. END .. ": stressful, dangerous or annoying alone. The guide will warn, delay it to a higher level, or suggest a partner.",
  "- |cffff4040Skip" .. END .. ": not worth doing. The guide leaves it out.",
  " ",
  GOLD .. "Sending your notes back" .. END,
  "- " .. B("Send feedback") .. " in the guide's gear menu (also " .. B("Copy for dev") .. " in the notebook, or " .. B("/er export") ..
    ") puts every rating and place note in a box, already selected. Ctrl+C, paste it to whoever is building the guide.",
  "- The complete file, journal included, is written when you " .. B("log out or reload") .. ": " ..
    "WTF\\Account\\<account>\\SavedVariables\\EasyRoute.lua in your game folder.",
  "- Nothing leaves your computer by itself. Addons on this client have no internet access. " .. B("/er about") ..
    " shows exactly what gets written down.",
  " ",
  GOLD .. "Good to know" .. END,
  "- Ratings are shared across your characters and remember who rated it and at what level.",
  "- Quests you already had when you installed this show up too; they just have no start time.",
  " ",
  GOLD .. "Commands" .. END,
  B("/er") .. " - the guide (shows or hides the steps)     " .. B("/er guides") .. " - every guide     " .. B("/er arrow") .. " - arrow on/off     " ..
    B("/er next") .. " - skip a step     " .. B("/er stop") .. " - stop the guide",
  B("/er simple") .. " - quest list or step box     " .. B("/er tips") .. " - tips on/off     " .. B("/er skulls") .. " - skulls on/off     " ..
    B("/er money") .. " - money steps     " .. B("/er rate enemies") .. " - enemy tooltip on/off",
  B("/er go") .. " - the quests around you     " .. B("/er mode casual|medium|hard") .. " - how hard     " .. B("/er unskip") .. " - bring back skipped quests",
  B("/er notebook") .. " - the notebook     " .. B("/er easy|medium|hard|skip [quest]") .. " - rate from chat     " .. B("/er note <text>") .. " - note this spot",
  B("/er export") .. " - copy for dev     " .. B("/er rate") .. " - popup for the picked quest     " ..
    B("/er prompt") .. " - popup after turn-ins on/off",
  B("/er party") .. " - party chat on turn-in on/off     " .. B("/er chain") .. " - chain start popup on/off     " .. B("/er about") .. " - what it records     " ..
    B("/er minimap") .. " - minimap button     " .. B("/er help") .. " - this",
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
  frame:SetHeight(740)
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
  text:SetWidth(508)
  text:SetHeight(620)
  text:SetJustifyH("LEFT")
  text:SetJustifyV("TOP")
  text:SetText(HELP_TEXT)

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
