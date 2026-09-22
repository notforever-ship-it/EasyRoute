-- Easy Route: the panel on the side of the quest log. Pick a quest in the list, see how hard it looks
-- for your level right now and why, and click Easy, Medium, Hard or Skip. "..." adds a reason or note.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local WIDTH, HEIGHT = 220, 150
local panel, guessText, whyText, saidText, moreButton, noCombatButton
local buttons = {}
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
    noCombatButton:UnlockHighlight()
    noCombatButton:Disable()
    moreButton:Disable()
    return
  end
  moreButton:Enable()
  noCombatButton:Enable()
  local rating, _, why = ER.Suggest(info)
  guessText:SetText(WHITE .. "Looks " .. END .. ER.Coloured(rating) .. WHITE .. " at level " .. (UnitLevel("player") or "?") .. END)
  whyText:SetText(GREY .. "because " .. why .. END)
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
  if r and r.tags and r.tags.nocombat then
    noCombatButton:LockHighlight()
    noCombatButton:SetText(ER.GREEN .. "No combat" .. END)
  else
    noCombatButton:UnlockHighlight()
    noCombatButton:SetText("No combat")
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
  whyText:SetHeight(24)
  whyText:SetJustifyH("LEFT")
  whyText:SetJustifyV("TOP")

  local bw, gap = 48, 2
  for i, r in ipairs(ER.RATINGS) do
    local b = CreateFrame("Button", "EasyRouteQuestLogRate" .. i, panel, "UIPanelButtonTemplate")
    b:SetWidth(bw)
    b:SetHeight(20)
    b:SetPoint("TOPLEFT", panel, "TOPLEFT", 10 + (i - 1) * (bw + gap), -68)
    b:SetText(r.label)
    b.key, b.label, b.colour = r.key, r.label, r.colour
    b:SetScript("OnClick", function() Rate(this.key) end)
    Explain(b, r.label, r.tip)
    buttons[i] = b
  end

  -- Second row: the one reason worth its own button, and "..." for the rest.
  noCombatButton = CreateFrame("Button", "EasyRouteQuestLogNoCombat", panel, "UIPanelButtonTemplate")
  noCombatButton:SetWidth(98)
  noCombatButton:SetHeight(20)
  noCombatButton:SetPoint("TOPLEFT", panel, "TOPLEFT", 10, -90)
  noCombatButton:SetText("No combat")
  noCombatButton:SetScript("OnClick", function() ER.ToggleTag(title, "nocombat", info) end)
  Explain(noCombatButton, "No combat", "Talk, deliver, explore, pick things up, nothing to kill. Click to mark it, click again to unmark. An unrated quest becomes Easy with it.")

  moreButton = CreateFrame("Button", "EasyRouteQuestLogMore", panel, "UIPanelButtonTemplate")
  moreButton:SetWidth(40)
  moreButton:SetHeight(20)
  moreButton:SetPoint("TOPRIGHT", panel, "TOPRIGHT", -10, -90)
  moreButton:SetText("...")

  saidText = panel:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  saidText:SetPoint("TOPLEFT", panel, "TOPLEFT", 10, -116)
  saidText:SetWidth(WIDTH - 20)
  saidText:SetHeight(26)
  saidText:SetJustifyH("LEFT")
  saidText:SetJustifyV("TOP")
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
