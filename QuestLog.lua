-- Easy Route: the panel on the side of the quest log. Pick a quest in the list, see how hard it looks
-- for your level right now and why, and click Easy, Medium, Hard or Skip. "..." adds a reason or note.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local WIDTH, HEIGHT = 220, 326
local panel, guessText, whyText, chainText, saidText, storyText, moreButton
local buttons = {}         -- the four ratings
local tagButtons = {}      -- the reasons that earn their own button: no combat, better solo, better coop
local title, info          -- the quest the panel is showing

local function Explain(widget, head, text)
  widget:SetScript("OnEnter", function()
    GameTooltip:SetOwner(this, "ANCHOR_RIGHT")
    GameTooltip:SetText(head)
    GameTooltip:AddLine(text, 1, 1, 1, 1)
    GameTooltip:Show()
  end)
  widget:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

local function Rate(key)
  if not title then return end
  local old = ER.GetRating(title)
  ER.SetRating(title, key, old and old.tags, old and old.note, info)
end

local function Update()
  if not panel or not (QuestLogFrame and QuestLogFrame:IsVisible()) then return end
  title, info = ER.Recorder.SelectedQuest()
  if not title then
    guessText:SetText(GREY .. "Pick a quest in the list." .. END)
    whyText:SetText("")
    saidText:SetText("")
    for _, b in ipairs(buttons) do
      b:UnlockHighlight()
      b:SetText(b.label)
      b:Disable()
    end
    for _, b in ipairs(tagButtons) do
      b:UnlockHighlight()
      b:SetText(b.label)
      b:Disable()
    end
    chainText:SetText("")
    storyText:SetText("")
    moreButton:Disable()
    return
  end
  -- What it asks for, in short and in its own words, and where you have got so far, for when you
  -- come back to a quest and cannot remember what it was.
  local lines = {}
  if info and info.what then table.insert(lines, WHITE .. info.what .. END) end
  if info and info.ask then table.insert(lines, GREY .. "\"" .. info.ask .. "\"" .. END) end
  if info and info.did then table.insert(lines, WHITE .. info.did .. END) end
  storyText:SetText(table.concat(lines, "\n"))
  moreButton:Enable()
  local step, total, nextTitle = ER.Recorder.Chain(info and info.pfid)
  if step then
    local s = WHITE .. "Chain quest, step " .. step .. " of " .. total .. END
    if nextTitle then s = s .. GREY .. ". Next: " .. nextTitle .. END end
    chainText:SetText(s)
  elseif pfDB then
    chainText:SetText(GREY .. "Not part of a chain." .. END)
  else
    chainText:SetText(GREY .. "Chain info needs pfQuest." .. END)
  end
  local rating, advice = ER.Advice(info, step, total)
  guessText:SetText(WHITE .. "Looks " .. END .. ER.Coloured(rating) .. WHITE .. " at level " .. (UnitLevel("player") or "?") .. END)
  whyText:SetText(GREY .. advice .. END)
  local r = ER.GetRating(title)
  if r then
    local tags = {}
    for _, t in ipairs(ER.TAGS) do
      if r.tags and r.tags[t.key] then table.insert(tags, t.label) end
    end
    local s = WHITE .. "You said " .. END .. ER.Coloured(r.rating) .. GREY .. " at level " .. (r.donelevel or r.plevel or "?") .. END
    if table.getn(tags) > 0 then s = s .. GREY .. " (" .. table.concat(tags, ", ") .. ")" .. END end
    if r.note and r.note ~= "" then s = s .. GREY .. " - " .. r.note .. END end
    saidText:SetText(s)
  else
    saidText:SetText(GREY .. "Not rated yet. Click a button." .. END)
  end
  for _, b in ipairs(tagButtons) do
    b:Enable()
    if r and r.tags and r.tags[b.key] then
      b:LockHighlight()
      b:SetText(ER.GREEN .. b.label .. END)
    else
      b:UnlockHighlight()
      b:SetText(b.label)
    end
  end
  for _, b in ipairs(buttons) do
    b:Enable()
    if r and r.rating == b.key then
      b:LockHighlight()
      b:SetText(b.colour .. b.label .. END)
    else
      b:UnlockHighlight()
      b:SetText(b.label)
    end
  end
end
ER.RefreshQuestLogPanel = Update

local function Build()
  panel = CreateFrame("Frame", "EasyRouteQuestLogPanel", QuestLogFrame)
  panel:SetWidth(WIDTH)
  panel:SetHeight(HEIGHT)
  panel:SetPoint("TOPLEFT", QuestLogFrame, "TOPRIGHT", -32, -14)
  panel:SetFrameLevel(QuestLogFrame:GetFrameLevel() + 5)
  panel:EnableMouse(true)
  panel:SetBackdrop({
    bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
    edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
    tile = true, tileSize = 16, edgeSize = 16,
    insets = { left = 4, right = 4, top = 4, bottom = 4 },
  })
  panel:SetBackdropColor(0.05, 0.05, 0.07, 0.95)

  local head = panel:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  head:SetPoint("TOPLEFT", panel, "TOPLEFT", 10, -9)
  head:SetText(GOLD .. "Easy Route" .. END .. GREY .. "  -  how is this quest?" .. END)

  guessText = panel:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  guessText:SetPoint("TOPLEFT", panel, "TOPLEFT", 10, -26)
  guessText:SetWidth(WIDTH - 20)
  guessText:SetJustifyH("LEFT")

  whyText = panel:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  whyText:SetPoint("TOPLEFT", panel, "TOPLEFT", 10, -40)
  whyText:SetWidth(WIDTH - 20)
  whyText:SetHeight(50)
  whyText:SetJustifyH("LEFT")
  whyText:SetJustifyV("TOP")

  local bw, gap = 48, 2
  for i, r in ipairs(ER.RATINGS) do
    local b = CreateFrame("Button", "EasyRouteQuestLogRate" .. i, panel, "UIPanelButtonTemplate")
    b:SetWidth(bw)
    b:SetHeight(20)
    b:SetPoint("TOPLEFT", panel, "TOPLEFT", 10 + (i - 1) * (bw + gap), -94)
    b:SetText(r.label)
    b.key, b.label, b.colour = r.key, r.label, r.colour
    b:SetScript("OnClick", function() Rate(this.key) end)
    Explain(b, r.label, r.tip)
    buttons[i] = b
  end

  -- Second and third rows: the reasons worth their own button, and "..." for the rest.
  local function TagButton(name, key, label, x, y, width, tip)
    local b = CreateFrame("Button", name, panel, "UIPanelButtonTemplate")
    b:SetWidth(width)
    b:SetHeight(20)
    b:SetPoint("TOPLEFT", panel, "TOPLEFT", x, y)
    b:SetText(label)
    b.key, b.label = key, label
    b:SetScript("OnClick", function() ER.ToggleTag(title, this.key, info) end)
    Explain(b, label, tip)
    table.insert(tagButtons, b)
    return b
  end
  TagButton("EasyRouteQuestLogNoCombat", "nocombat", "No combat", 10, -116, 98,
    "Talk, deliver, explore, pick things up, nothing to kill. Click to mark it, click again to unmark. An unrated quest becomes Easy with it.")
  TagButton("EasyRouteQuestLogSolo", "solo", "Better solo", 10, -140, 98,
    "Pick-up or gather quest: a group only competes for the same spawns. Click to mark, click again to unmark.")
  TagButton("EasyRouteQuestLogCoop", "coop", "Better coop", 112, -140, 98,
    "Kill quest with shared credit or drops: faster and safer with a friend. Click to mark, click again to unmark.")

  moreButton = CreateFrame("Button", "EasyRouteQuestLogMore", panel, "UIPanelButtonTemplate")
  moreButton:SetWidth(40)
  moreButton:SetHeight(20)
  moreButton:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -10, -116)
  moreButton:SetText("...")

  chainText = panel:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  chainText:SetPoint("TOPLEFT", panel, "TOPLEFT", 10, -166)
  chainText:SetWidth(WIDTH - 20)
  chainText:SetHeight(12)
  chainText:SetJustifyH("LEFT")

  saidText = panel:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  saidText:SetPoint("TOPLEFT", panel, "TOPLEFT", 10, -182)
  saidText:SetWidth(WIDTH - 20)
  saidText:SetHeight(26)
  saidText:SetJustifyH("LEFT")
  saidText:SetJustifyV("TOP")

  storyText = panel:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  storyText:SetPoint("TOPLEFT", panel, "TOPLEFT", 10, -212)
  storyText:SetWidth(WIDTH - 20)
  storyText:SetHeight(106)
  storyText:SetJustifyH("LEFT")
  storyText:SetJustifyV("TOP")
  moreButton:SetScript("OnClick", function()
    if title then ER.OpenRate(title, info) end
  end)
  Explain(moreButton, "Reason and note", "Tick why (needs a group, crowded, cave, long walk) and write a note like 'do this at 14'.")
end

-- The quest log refreshes through QuestLog_Update (opening it, clicking a quest, any change to the
-- log) and picks a quest through QuestLog_SetSelection. Both are followed by a panel refresh.
if QuestLog_Update then
  local origUpdate = QuestLog_Update
  QuestLog_Update = function()
    origUpdate()
    if not panel and QuestLogFrame then Build() end
    Update()
  end
end
if QuestLog_SetSelection then
  local origSelect = QuestLog_SetSelection
  QuestLog_SetSelection = function(id)
    origSelect(id)
    Update()
  end
end
