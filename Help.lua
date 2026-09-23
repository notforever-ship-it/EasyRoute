-- Easy Route: "How to use" window. Opens with the button in the /er window, /er help, or
-- Shift-clicking the minimap icon.

local ER = EasyRoute

local GOLD, GREEN, GREY, WHITE, END = "|cffffd100", "|cff40ff40", "|cff9d9d9d", "|cffffffff", "|r"

local function B(s) return WHITE .. s .. END end

local HELP_TEXT = table.concat({
  GOLD .. "What this is" .. END,
  "The notebook for a relaxed leveling guide. While you play, it writes down which quests you took and handed in, " ..
    "where you were, what level you were, when you died and when you leveled. You add the part it cannot see: " ..
    B("was that quest easy or hard?") .. " Those answers become the guide.",
  " ",
  GOLD .. "Rating a quest" .. END,
  "- Open your " .. B("quest log (L)") .. " and pick a quest. The Easy Route panel on the right says how hard it looks " ..
    B("for your level right now") .. " and why. Click " .. GREEN .. "Easy" .. END .. ", Medium, " ..
    "|cffff8000Hard" .. END .. " or |cffff4040Skip" .. END .. ". One click, done.",
  "- The guess uses the quest's level next to yours (green, yellow, orange, red, like the game), its Group or Elite tag, " ..
    "and whether you died or nearly died while it was in your log. A quest well below you is only 'easy' until the mobs " ..
    "come in packs, so if a green quest still had you running, say Hard. You always have the last word.",
  "- " .. B("No combat") .. " marks a quest with nothing to kill: talk, deliver, explore. One click, and an unrated quest becomes Easy with it. " ..
    B("Better solo") .. " is for pick-up quests where a group only competes for spawns, " .. B("Better coop") ..
    " for kill quests with shared credit or drops.",
  "- " .. B("...") .. " opens the popup for a " .. B("reason") .. " (no combat, better solo, better coop, needs a group, crowded, cave, " ..
    "long walk) and a " .. B("note") .. " like 'do this at 14'.",
  "- With " .. B("pfQuest") .. " installed, the panel says " .. B("chain quest, step 2 of 5") .. " and what comes next, and chat " ..
    "says so when you pick one up.",
  "- When you are in a party, handing a quest in posts " .. B("I've done ... (Gnoll Bands x6)") .. " in party chat. Untick it in /er or type " ..
    B("/er party") .. ".",
  "- The popup also has " .. B("'I was level __ when I did it'") .. ". It is filled in from what the addon saw, and the level " ..
    "a quest was handed in at is kept. Rating something days later? Type the level you really were, the guess follows.",
  "- When you hand a quest in, chat reminds you what it was: " .. GREY .. "Wanted: Hogger handed in (Hogger x1)" .. END .. ", " ..
    "with the first line of the quest's text under it. Hovering a quest in the " .. B("/er") .. " window shows the same, " ..
    "so you can rate it days later and still know which one it was.",
  "- Handed one in without rating it? It waits under 'Handed in, not rated yet' in the " .. B("/er") .. " window, " ..
    "which also lists your whole log and everything rated so far, each with the four buttons.",
  "- From chat: " .. B("/er hard") .. " rates the quest picked in your quest log, " .. B("/er hard Hogger") .. " rates by name.",
  "- Prefer being asked? " .. B("/er prompt") .. " opens the popup by itself when you hand in a quest you have not rated yet. " ..
    "Rate one from the quest log first and it will not ask again.",
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
  "- " .. B("Copy for dev") .. " in the /er window (or " .. B("/er export") .. ") puts every rating and place note in a box. " ..
    "Ctrl+C, paste it to whoever is building the guide.",
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
  B("/er") .. " - the window     " .. B("/er easy|medium|hard|skip [quest]") .. " - rate from chat     " .. B("/er note <text>") .. " - note this spot",
  B("/er export") .. " - copy for dev     " .. B("/er rate") .. " - popup for the picked quest     " ..
    B("/er prompt") .. " - popup after turn-ins on/off",
  B("/er party") .. " - party chat on turn-in on/off     " .. B("/er about") .. " - what it records     " ..
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
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END)
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
