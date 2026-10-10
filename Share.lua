-- Easy Route: sharing what you rated with whoever builds the guide. A one-time notice on first login
-- says exactly what the addon writes down and where the file is, and "Send feedback" puts every
-- rating and place note in a box you can Ctrl+C into Discord. Nothing leaves your computer on its
-- own: a 1.12 addon has no way to send anything anywhere.

local ER = EasyRoute
local GOLD, GREY, WHITE, GREEN, END = ER.GOLD, ER.GREY, ER.WHITE, ER.GREEN, ER.END

local FILE_PATH = "WTF\\Account\\<YOUR ACCOUNT NAME>\\SavedVariables\\EasyRoute.lua"

local function B(s) return WHITE .. s .. END end

-- The notice comes up again, once, when its words change in a way you should know about: raise this number then. What you clicked is kept
-- as this number in ER.db.noticeShown (the first notices kept true, which counts as 1).
local NOTICE_VERSION = 3

local NOTICE_TEXT = table.concat({
  "Easy Route is a relaxed leveling guide by " .. B("stealthzi") .. ": one zone at a time, one step in a box on the right, " ..
    "and an arrow that shows the way. Type " .. B("/er") .. " to start.",
  " ",
  GOLD .. "What it writes down" .. END,
  "- Quests you take, hand in or abandon, what they asked for, and the first line of their text.",
  "- Your Easy / Medium / Hard / Skip answers, reasons and notes, if you give any.",
  "- Your character's name, class, level, zone and map position at those moments.",
  "- Deaths, close calls (health under 30% in a fight), level-ups and zone changes, with the time.",
  "- Which enemies you saw as yellow or red, and which ones attacked you first (only their names), " ..
    "so the guide can pick safer grind spots. This keeps going even when " .. B("Show grind spots") .. " is off.",
  " ",
  GOLD .. "What it does not do" .. END,
  "- It does not read what other players say in chat. " .. B("Auto mode") .. " looks at your bags and gold only to sell grey " ..
    "items, repair, pick a reward and find your hearthstone; none of that is written down. " ..
    "It says nothing in party chat unless you tick that in " .. B("Settings") .. ".",
  "- It cannot send anything anywhere. Addons on this client have no internet access. " ..
    "Everything stays in one file on your computer, and you decide if and when to share it.",
  " ",
  GOLD .. "How to share (for testers)" .. END,
  "- " .. B("Quick:") .. " " .. B("Send feedback") .. " in " .. B("Settings") .. " (the gear on the guide), press Ctrl+C, " ..
    "paste it to stealthzi or whoever gave you this addon.",
  "- " .. B("Complete:") .. " log out, then send the file " .. B(FILE_PATH) .. " from your game folder. " ..
    "It is plain text, open it and see for yourself.",
  " ",
  GREY .. "This notice shows once, and again if it changes. " .. B("/er about") .. GREY .. " brings it back." .. END,
}, "\n")

------------------------------------------------------------------------------------------------------
-- Export text
------------------------------------------------------------------------------------------------------

local function Clean(s)
  s = string.gsub(s or "", "|", "/")
  s = string.gsub(s, "[\r\n]+", " ")
  return s
end

-- Every rating and place note as lines of "field | field | field", easy to read and easy to paste.
function ER.ExportText()
  local out = {}
  local class = ER.ClassRace()
  table.insert(out, "# Easy Route " .. ER.VERSION .. " - " .. date("%Y-%m-%d %H:%M") .. " - " .. ER.Char() .. " (" .. (class or "?") .. " " .. (UnitLevel("player") or "?") .. ")")
  table.insert(out, "# rating | quest | quest level | level when done | class | reasons | deaths/close calls | note | what it asked for | chain | about | what you did (with map positions)")
  local list = {}
  for _, r in pairs(ER.db.ratings) do table.insert(list, r) end
  table.sort(list, function(a, b) return (a.time or 0) < (b.time or 0) end)
  for _, r in ipairs(list) do
    local tags = {}
    for _, t in ipairs(ER.TAGS) do
      if r.tags and r.tags[t.key] then table.insert(tags, t.key) end
    end
    table.insert(out, table.concat({
      r.rating or "?", Clean(r.title), r.qlevel or "?", r.donelevel or r.plevel or "?", r.class or "?",
      table.concat(tags, "+"), (r.deaths or 0) .. "/" .. (r.close or 0), Clean(r.note), Clean(ER.ObjectiveSummary(r.obj) or ""),
      r.chain or "", Clean(r.ask or r.desc), Clean(ER.Recorder.StoryText(r.story, true, true, r.pfid, r.obj) or r.did or ""),
    }, " | "))
  end
  local notes = {}
  for _, e in ipairs(ER.db.journal) do
    if e.t == "note" then table.insert(notes, e) end
  end
  if table.getn(notes) > 0 then
    table.insert(out, "# note | zone, area | x,y | your level | text")
    for _, e in ipairs(notes) do
      local place = e.zone or "?"
      if e.sub and e.sub ~= "" and e.sub ~= e.zone then place = place .. ", " .. e.sub end
      table.insert(out, table.concat({ "note", Clean(place), (e.x or 0) .. "," .. (e.y or 0), e.plevel or "?", Clean(e.note) }, " | "))
    end
  end
  return table.concat(out, "\n")
end

------------------------------------------------------------------------------------------------------
-- Windows
------------------------------------------------------------------------------------------------------

local function Opaque(f)
  local solid = f:CreateTexture(nil, "BACKGROUND")
  solid:SetTexture(0.05, 0.05, 0.07, 1)
  solid:SetPoint("TOPLEFT", f, "TOPLEFT", 11, -11)
  solid:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -11, 11)
end

local function Dialog(name, width, height, titleText, creditPoint)
  local f = CreateFrame("Frame", name, UIParent)
  f:SetWidth(width)
  f:SetHeight(height)
  f:SetPoint("CENTER", UIParent, "CENTER", 0, 40)
  f:SetFrameStrata("FULLSCREEN_DIALOG")
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  f:SetMovable(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function() this:StartMoving() end)
  f:SetScript("OnDragStop", function() this:StopMovingOrSizing() end)
  Opaque(f)
  f:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  f:Hide()
  table.insert(UISpecialFrames, name)
  local title = f:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOP", f, "TOP", 0, -20)
  title:SetText(titleText)
  local close = CreateFrame("Button", name .. "Close", f, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", f, "TOPRIGHT", -6, -6)
  close:SetScript("OnClick", function() f:Hide() end)
  local credit = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  if creditPoint == "BOTTOM" then credit:SetPoint("BOTTOM", f, "BOTTOM", 0, 26) else credit:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", 26, 26) end
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
  return f
end

local notice, export, exportBox

local function BuildNotice()
  notice = Dialog("EasyRouteNoticeFrame", 520, 440, "Easy Route - before you start")
  local text = notice:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  text:SetPoint("TOPLEFT", notice, "TOPLEFT", 26, -52)
  text:SetJustifyH("LEFT")
  text:SetJustifyV("TOP")
  local th = ER.FitHeight(text, NOTICE_TEXT, 468, 100)
  notice:SetHeight(th + 52 + 70)
  local ok = CreateFrame("Button", "EasyRouteNoticeOk", notice, "UIPanelButtonTemplate")
  ok:SetWidth(120)
  ok:SetHeight(24)
  ok:SetPoint("BOTTOMRIGHT", notice, "BOTTOMRIGHT", -24, 20)
  ok:SetText("Got it")
  ok:SetScript("OnClick", function()
    ER.db.noticeShown = NOTICE_VERSION
    notice:Hide()
  end)
  local copy = CreateFrame("Button", "EasyRouteNoticeCopy", notice, "UIPanelButtonTemplate")
  copy:SetWidth(120)
  copy:SetHeight(24)
  copy:SetPoint("RIGHT", ok, "LEFT", -8, 0)
  copy:SetText("Send feedback")
  copy:SetScript("OnClick", function()
    ER.db.noticeShown = NOTICE_VERSION
    notice:Hide()
    ER.ShowExport()
  end)
end

function ER.ShowNotice()
  if not notice then BuildNotice() end
  notice:Show()
end

local function BuildExport()
  export = Dialog("EasyRouteExportFrame", 560, 420, "Easy Route - send feedback", "BOTTOM")
  local hint = export:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  hint:SetPoint("TOP", export, "TOP", 0, -44)
  hint:SetWidth(500)
  hint:SetText(GREY .. "The text is already selected: press " .. END .. B("Ctrl+C") .. GREY ..
    ", then paste it to stealthzi or whoever gave you this addon. Only your ratings and place notes are in here." .. END)

  local scroll = CreateFrame("ScrollFrame", "EasyRouteExportScroll", export, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", export, "TOPLEFT", 26, -76)
  scroll:SetWidth(484)
  scroll:SetHeight(290)
  local bg = export:CreateTexture(nil, "ARTWORK")
  bg:SetTexture(0, 0, 0, 0.5)
  bg:SetPoint("TOPLEFT", scroll, "TOPLEFT", -4, 4)
  bg:SetPoint("BOTTOMRIGHT", scroll, "BOTTOMRIGHT", 4, -4)

  exportBox = CreateFrame("EditBox", "EasyRouteExportBox", scroll)
  exportBox:SetWidth(480)
  exportBox:SetHeight(290)
  exportBox:SetMultiLine(true)
  exportBox:SetAutoFocus(false)
  exportBox:SetMaxLetters(0)
  exportBox:SetFontObject(ChatFontNormal)
  exportBox:SetScript("OnEscapePressed", function() this:ClearFocus() end)
  -- Typing in here would only change the copy, never your saved ratings; still, keep it as shown.
  exportBox:SetScript("OnTextChanged", function()
    if this.filling then return end
    this.filling = true
    this:SetText(this.export or "")
    this.filling = false
  end)
  scroll:SetScrollChild(exportBox)

  local again = CreateFrame("Button", "EasyRouteExportSelect", export, "UIPanelButtonTemplate")
  again:SetWidth(120)
  again:SetHeight(24)
  again:SetPoint("BOTTOMLEFT", export, "BOTTOMLEFT", 24, 20)
  again:SetText("Select all")
  again:SetScript("OnClick", function()
    exportBox:SetFocus()
    exportBox:HighlightText()
  end)
  local done = CreateFrame("Button", "EasyRouteExportDone", export, "UIPanelButtonTemplate")
  done:SetWidth(120)
  done:SetHeight(24)
  done:SetPoint("BOTTOMRIGHT", export, "BOTTOMRIGHT", -24, 20)
  done:SetText("Done")
  done:SetScript("OnClick", function() export:Hide() end)
end

function ER.ShowExport()
  if not export then BuildExport() end
  local text = ER.ExportText()
  exportBox.filling = true
  exportBox.export = text
  exportBox:SetText(text)
  exportBox.filling = false
  export:Show()
  exportBox:SetFocus()
  exportBox:HighlightText()
end

-- Is the notice due? Not yet seen at all, or seen only in an older version of its words.
function ER.NoticeDue()
  if not ER.db then return false end
  local seen = ER.db.noticeShown
  if seen == true then seen = 1 end
  return (tonumber(seen) or 0) < NOTICE_VERSION
end

-- For the quick checks: the words of the notice.
function ER._testNoticeText()
  return NOTICE_TEXT
end

-- At login at most one window comes up. A character's first login gets the welcome window (Help.lua); it points to What it records,
-- so a notice that was due then counts as seen. Otherwise the notice comes up the first time the addon is loaded, and once more when its
-- words have changed. Returns which window was shown: "welcome", "notice" or nil.
function ER.LoginWindows()
  if ER.WelcomeDue and ER.ShowWelcome and ER.WelcomeDue() then
    if ER.NoticeDue() then ER.db.noticeShown = NOTICE_VERSION end
    ER.ShowWelcome()
    return "welcome"
  end
  if ER.NoticeDue() then
    ER.ShowNotice()
    return "notice"
  end
  return nil
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function() ER.LoginWindows() end)

ER.Loaded("Share.lua")
