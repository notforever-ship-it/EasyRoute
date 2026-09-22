-- Easy Route: the notebook window (/er). Top: the quests in your log, each with Easy / OK / Hard /
-- Skip buttons. Below them: everything rated so far. Bottom: a quick note box and the settings.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local WIDTH, HEIGHT = 500, 486
local ROWS, ROW_H = 16, 20
local LIST_X, LIST_Y, LIST_W = 20, -54, 440
local TITLE_W = 212
local BTN_X, BTN_W, BTN_GAP = 220, 44, 2

local frame, scroll, countText, promptCheck, noteBox
local rows = {}
local data = {}

local function Opaque(f)
  local solid = f:CreateTexture(nil, "BACKGROUND")
  solid:SetTexture(0.05, 0.05, 0.07, 1)
  solid:SetPoint("TOPLEFT", f, "TOPLEFT", 11, -11)
  solid:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -11, 11)
end

local function Explain(widget, title, text)
  widget:SetScript("OnEnter", function()
    GameTooltip:SetOwner(this, "ANCHOR_RIGHT")
    GameTooltip:SetText(title)
    GameTooltip:AddLine(text, 1, 1, 1, 1)
    GameTooltip:Show()
  end)
  widget:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

local function Button(name, parent, width, text)
  local b = CreateFrame("Button", name, parent, "UIPanelButtonTemplate")
  b:SetWidth(width)
  b:SetHeight(22)
  b:SetText(text)
  return b
end

------------------------------------------------------------------------------------------------------
-- The list
------------------------------------------------------------------------------------------------------

local function RateRow(row, key)
  if not row.title then return end
  local old = ER.GetRating(row.title)
  ER.SetRating(row.title, key, old and old.tags, old and old.note, row.info)
end

local function RowTooltip(row)
  if not row.title then return end
  GameTooltip:SetOwner(row, "ANCHOR_RIGHT")
  GameTooltip:SetText(row.title)
  local info = row.info or {}
  local line = {}
  if info.qlevel then table.insert(line, "level " .. info.qlevel) end
  if info.tag and info.tag ~= "" then table.insert(line, info.tag) end
  if info.mins and info.mins > 0 then table.insert(line, info.mins .. " min in your log") end
  if info.deaths and info.deaths > 0 then table.insert(line, info.deaths .. (info.deaths == 1 and " death" or " deaths")) end
  if info.close and info.close > 0 then table.insert(line, info.close .. (info.close == 1 and " close call" or " close calls")) end
  if table.getn(line) > 0 then GameTooltip:AddLine(table.concat(line, ", "), 0.6, 0.6, 0.6) end
  local r = ER.GetRating(row.title)
  for _, o in ipairs(ER.ObjectiveLines(info.obj or (r and r.obj))) do
    GameTooltip:AddLine(o, 0.8, 0.8, 0.8)
  end
  if r then
    local tags = {}
    for _, t in ipairs(ER.TAGS) do
      if r.tags and r.tags[t.key] then table.insert(tags, t.label) end
    end
    local text = "Rated " .. ER.Coloured(r.rating)
    if table.getn(tags) > 0 then text = text .. GREY .. " (" .. table.concat(tags, ", ") .. ")" .. END end
    GameTooltip:AddLine(" ")
    GameTooltip:AddLine(text, 1, 1, 1)
    if r.note and r.note ~= "" then GameTooltip:AddLine("Note: " .. r.note, 1, 0.82, 0, 1) end
    GameTooltip:AddLine((r.char or "?") .. " did it at level " .. (r.donelevel or r.plevel or "?") .. ", rated " .. (r.when or "?"), 0.6, 0.6, 0.6)
  else
    local rating, _, why = ER.Suggest(info)
    GameTooltip:AddLine(" ")
    GameTooltip:AddLine("Not rated yet. My guess: " .. ER.Coloured(rating) .. GREY .. ", " .. why .. END, 1, 1, 1)
  end
  GameTooltip:Show()
end

local function MakeRow(i)
  local row = CreateFrame("Frame", "EasyRouteRow" .. i, frame)
  row:SetWidth(LIST_W)
  row:SetHeight(ROW_H)
  row:SetPoint("TOPLEFT", frame, "TOPLEFT", LIST_X, LIST_Y - (i - 1) * ROW_H)
  row:SetFrameLevel(scroll:GetFrameLevel() + 2)
  row:EnableMouse(true)
  row:EnableMouseWheel(true)
  row:SetScript("OnMouseWheel", function()
    local bar = getglobal(scroll:GetName() .. "ScrollBar")
    if bar then bar:SetValue(bar:GetValue() - arg1 * ROW_H * 3) end
  end)
  row:SetScript("OnEnter", function() RowTooltip(this) end)
  row:SetScript("OnLeave", function() GameTooltip:Hide() end)

  local glow = row:CreateTexture(nil, "HIGHLIGHT")
  glow:SetTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight")
  glow:SetBlendMode("ADD")
  glow:SetAllPoints(row)

  row.text = row:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  row.text:SetPoint("LEFT", row, "LEFT", 4, 0)
  row.text:SetWidth(TITLE_W)
  row.text:SetHeight(ROW_H)
  row.text:SetJustifyH("LEFT")

  row.buttons = {}
  for j, r in ipairs(ER.RATINGS) do
    local b = CreateFrame("Button", "EasyRouteRow" .. i .. "Rate" .. j, row, "UIPanelButtonTemplate")
    b:SetWidth(BTN_W)
    b:SetHeight(ROW_H - 2)
    b:SetPoint("LEFT", row, "LEFT", BTN_X + (j - 1) * (BTN_W + BTN_GAP), 0)
    b:SetText(r.label)
    b.key, b.label, b.colour = r.key, r.label, r.colour
    b:SetScript("OnClick", function() RateRow(this:GetParent(), this.key) end)
    Explain(b, r.label, r.tip)
    row.buttons[j] = b
  end

  row.more = CreateFrame("Button", "EasyRouteRow" .. i .. "More", row, "UIPanelButtonTemplate")
  row.more:SetWidth(26)
  row.more:SetHeight(ROW_H - 2)
  row.more:SetPoint("LEFT", row, "LEFT", BTN_X + 4 * (BTN_W + BTN_GAP) + 2, 0)
  row.more:SetText("...")
  row.more:SetScript("OnClick", function()
    local p = this:GetParent()
    if p.title then ER.OpenRate(p.title, p.info) end
  end)
  Explain(row.more, "More", "Add a reason (needs a group, cramped, cave, long walk) and a note.")
  return row
end

local function SetRow(row, item)
  if item.header then
    row.text:SetText(GOLD .. item.header .. END)
    row.title, row.info = nil, nil
    for _, b in ipairs(row.buttons) do b:Hide() end
    row.more:Hide()
    return
  end
  if item.note then
    row.text:SetText(GREY .. item.note .. END)
    row.title, row.info = nil, nil
    for _, b in ipairs(row.buttons) do b:Hide() end
    row.more:Hide()
    return
  end
  local r = item.rating
  local level = (item.info and item.info.qlevel) or (r and r.qlevel)
  local label = item.title
  if level then label = GREY .. "[" .. level .. "] " .. END .. label end
  if r and r.note and r.note ~= "" then label = label .. GOLD .. " *" .. END end
  row.text:SetText(label)
  row.title, row.info = item.title, item.info
  for _, b in ipairs(row.buttons) do
    b:Show()
    if r and r.rating == b.key then
      b:LockHighlight()
      b:SetText(b.colour .. b.label .. END)
    else
      b:UnlockHighlight()
      b:SetText(b.label)
    end
  end
  row.more:Show()
end

local function BuildData()
  data = {}
  ER.Recorder.Refresh()
  local inLog = ER.Recorder.Known()
  local log = {}
  for title, info in pairs(inLog) do
    table.insert(log, { title = title, info = ER.Recorder.InfoFor(title, info), rating = ER.GetRating(title) })
  end
  table.sort(log, function(a, b)
    local la, lb = a.info.qlevel or 0, b.info.qlevel or 0
    if la ~= lb then return la < lb end
    return a.title < b.title
  end)
  table.insert(data, { header = "In your quest log (" .. table.getn(log) .. ")" })
  if table.getn(log) == 0 then
    table.insert(data, { note = "   nothing yet. Quests show up here as you take them." })
  end
  for _, item in ipairs(log) do table.insert(data, item) end

  -- Quests handed in without a rating, newest first, so nothing slips through.
  local recent, seen = {}, {}
  local journal = ER.db.journal
  for i = table.getn(journal), 1, -1 do
    local e = journal[i]
    if e.t == "turnin" and e.title and not seen[e.title] and not inLog[e.title] and not ER.db.ratings[e.title] then
      seen[e.title] = true
      table.insert(recent, { title = e.title,
        info = { qlevel = e.qlevel, tag = e.tag, deaths = e.deaths, close = e.close, mins = e.mins, pfid = e.pfid,
          donelevel = e.plevel, obj = e.obj } })
      if table.getn(recent) >= 30 then break end
    end
  end
  if table.getn(recent) > 0 then
    table.insert(data, { header = "Handed in, not rated yet (" .. table.getn(recent) .. ")" })
    for _, item in ipairs(recent) do table.insert(data, item) end
  end

  local rated = {}
  for title, r in pairs(ER.db.ratings) do
    if not inLog[title] then
      table.insert(rated, { title = title, rating = r,
        info = { qlevel = r.qlevel, tag = r.tag, deaths = r.deaths, close = r.close, mins = r.mins, pfid = r.pfid, obj = r.obj,
          donelevel = r.donelevel, donelevelManual = r.donelevelManual } })
    end
  end
  table.sort(rated, function(a, b) return (a.rating.time or 0) > (b.rating.time or 0) end)
  table.insert(data, { header = "Rated before (" .. table.getn(rated) .. ")" })
  if table.getn(rated) == 0 then
    table.insert(data, { note = "   nothing yet. Turn a quest in and the popup asks you." })
  end
  for _, item in ipairs(rated) do table.insert(data, item) end
end

local function Refresh()
  if not frame or not frame:IsShown() then return end
  BuildData()
  local offset = FauxScrollFrame_GetOffset(scroll)
  FauxScrollFrame_Update(scroll, table.getn(data), ROWS, ROW_H)
  for i = 1, ROWS do
    local item = data[i + offset]
    if item then
      SetRow(rows[i], item)
      rows[i]:Show()
    else
      rows[i]:Hide()
    end
  end
  local ratedCount, lines = ER.Counts()
  countText:SetText(GREY .. ratedCount .. " quests rated, " .. lines .. " journal lines" .. END)
  promptCheck:SetChecked(ER.db.autoPrompt and 1 or nil)
end
ER.RefreshWindow = Refresh

------------------------------------------------------------------------------------------------------
-- The window
------------------------------------------------------------------------------------------------------

local function AddNoteFromBox()
  local text = noteBox:GetText()
  noteBox:ClearFocus()
  if ER.Trim(text) == "" then return end
  ER.AddNote(text)
  noteBox:SetText("")
end

local function Build()
  frame = CreateFrame("Frame", "EasyRouteFrame", UIParent)
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
  frame:SetScript("OnShow", function() Refresh() end)
  Opaque(frame)
  frame:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  frame:Hide()
  table.insert(UISpecialFrames, "EasyRouteFrame")

  local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOP", frame, "TOP", 0, -18)
  title:SetText("Easy Route - notebook")
  local version = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  version:SetPoint("TOP", title, "BOTTOM", 0, -2)
  version:SetText(GREY .. "version " .. ER.VERSION .. "  -  click a button on a quest to rate it, hover a quest for details, ... for reasons and notes" .. END)

  local close = CreateFrame("Button", "EasyRouteCloseButton", frame, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -6, -6)
  close:SetScript("OnClick", function() frame:Hide() end)

  scroll = CreateFrame("ScrollFrame", "EasyRouteScroll", frame, "FauxScrollFrameTemplate")
  scroll:SetWidth(LIST_W)
  scroll:SetHeight(ROWS * ROW_H)
  scroll:SetPoint("TOPLEFT", frame, "TOPLEFT", LIST_X, LIST_Y)
  scroll:SetScript("OnVerticalScroll", function() FauxScrollFrame_OnVerticalScroll(ROW_H, Refresh) end)

  for i = 1, ROWS do rows[i] = MakeRow(i) end

  local y = LIST_Y - ROWS * ROW_H - 12
  local noteLabel = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  noteLabel:SetPoint("TOPLEFT", frame, "TOPLEFT", LIST_X + 4, y - 4)
  noteLabel:SetText("Note about this spot")
  noteBox = CreateFrame("EditBox", "EasyRouteNoteBox", frame, "InputBoxTemplate")
  noteBox:SetWidth(238)
  noteBox:SetHeight(20)
  noteBox:SetPoint("TOPLEFT", frame, "TOPLEFT", LIST_X + 130, y)
  noteBox:SetAutoFocus(false)
  noteBox:SetMaxLetters(200)
  noteBox:SetScript("OnEscapePressed", function() this:ClearFocus() end)
  noteBox:SetScript("OnEnterPressed", function() AddNoteFromBox() end)
  Explain(noteBox, "Note about this spot", "Saved with where you are standing. 'Nice quiet boar spot', 'too many murlocs here', that kind of thing.")
  local addNote = Button("EasyRouteAddNote", frame, 70, "Add")
  addNote:SetPoint("LEFT", noteBox, "RIGHT", 8, 0)
  addNote:SetScript("OnClick", AddNoteFromBox)

  y = y - 30
  promptCheck = CreateFrame("CheckButton", "EasyRoutePromptCheck", frame, "UICheckButtonTemplate")
  promptCheck:SetWidth(24)
  promptCheck:SetHeight(24)
  promptCheck:SetPoint("TOPLEFT", frame, "TOPLEFT", LIST_X, y)
  getglobal("EasyRoutePromptCheckText"):SetText("Ask me after every turn-in")
  promptCheck:SetScript("OnClick", function()
    ER.db.autoPrompt = this:GetChecked() and true or false
  end)
  Explain(promptCheck, "Ask me after every turn-in", "Also opens the 'how was this quest?' popup when you hand a quest in. Off by default: the buttons in your quest log are the normal way.")

  local help = Button("EasyRouteHelpButton", frame, 90, "How to use")
  help:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -24, y - 1)
  help:SetScript("OnClick", function() ER.ShowHelp() end)
  local copy = Button("EasyRouteCopyButton", frame, 100, "Copy for dev")
  copy:SetPoint("RIGHT", help, "LEFT", -6, 0)
  copy:SetScript("OnClick", function() ER.ShowExport() end)
  Explain(copy, "Copy for dev", "Puts all your ratings and place notes in a box. Ctrl+C, then paste it to whoever is building the guide. Nothing is sent by itself.")

  countText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  countText:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", LIST_X + 4, 34)
  local fileText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  fileText:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", LIST_X + 4, 20)
  fileText:SetText(GREY .. "Saved when you log out, in WTF\\Account\\<your account>\\SavedVariables\\EasyRoute.lua" .. END)
end

function ER.ShowWindow()
  if not frame then Build() end
  frame:Show()
  Refresh()
end

function ER.ToggleWindow()
  if frame and frame:IsShown() then
    frame:Hide()
  else
    ER.ShowWindow()
  end
end
