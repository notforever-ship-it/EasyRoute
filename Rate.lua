-- Easy Route: the "how was this quest?" popup, for reasons and notes. It opens from the "..." button
-- in the quest log panel or the notebook window, with /er rate, or after every turn-in when that
-- option is on. The addon fills in its own guess first, so often Save is all it takes.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local WIDTH, HEIGHT = 390, 290
local frame, nameText, objText, infoText, whyText, noteBox, saveButton, laterButton
local rateButtons, tagChecks = {}, {}
local current            -- { title = , info = }
local chosen             -- rating key picked in the popup
local queue = {}         -- turn-ins that happened while the popup was already open

local Save, Later

-- The 1.12 dialog background art is partly see-through; a solid layer underneath keeps text readable.
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

local function Choose(key)
  chosen = key
  for _, b in ipairs(rateButtons) do
    if b.key == key then
      b:LockHighlight()
      b:SetText(b.colour .. b.label .. END)
    else
      b:UnlockHighlight()
      b:SetText(b.label)
    end
  end
end

local function Fill()
  local info = current.info or {}
  nameText:SetText(GOLD .. current.title .. END)
  local what = ER.ObjectiveSummary(info.obj)
  objText:SetText(what and (WHITE .. what .. END) or "")
  local bits = {}
  if info.qlevel then table.insert(bits, "level " .. info.qlevel .. " quest, you are " .. (UnitLevel("player") or "?")) end
  if info.tag and info.tag ~= "" then table.insert(bits, info.tag) end
  if info.mins and info.mins > 0 then table.insert(bits, info.mins .. " min in your log") end
  if info.deaths and info.deaths > 0 then table.insert(bits, info.deaths .. (info.deaths == 1 and " death" or " deaths")) end
  infoText:SetText(GREY .. table.concat(bits, "  -  ") .. END)
  local old = ER.GetRating(current.title)
  local rating, tags, why = ER.Suggest(info)
  if old then
    rating, tags = old.rating, old.tags or {}
    whyText:SetText(GREY .. "You rated this " .. ER.Coloured(old.rating) .. GREY .. " before, on " .. (old.when or "?") .. "." .. END)
  else
    whyText:SetText(GREY .. "My guess: " .. ER.Coloured(rating) .. GREY .. ", because " .. why .. ". Change it if you disagree." .. END)
  end
  Choose(rating)
  for _, c in ipairs(tagChecks) do
    c:SetChecked(tags[c.key] and 1 or nil)
  end
  noteBox:SetText((old and old.note) or "")
end

local function Next()
  noteBox:ClearFocus()
  local nxt = table.remove(queue, 1)
  if nxt then
    current = nxt
    Fill()
  else
    current = nil
    frame:Hide()
  end
end

Save = function()
  if not current then return end
  local tags = {}
  for _, c in ipairs(tagChecks) do
    if c:GetChecked() then tags[c.key] = true end
  end
  ER.SetRating(current.title, chosen, tags, noteBox:GetText(), current.info)
  Next()
end

Later = function()
  Next()
end

local function Build()
  frame = CreateFrame("Frame", "EasyRouteRateFrame", UIParent)
  frame:SetWidth(WIDTH)
  frame:SetHeight(HEIGHT)
  frame:SetPoint("CENTER", UIParent, "CENTER", 0, 120)
  frame:SetFrameStrata("DIALOG")
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
  table.insert(UISpecialFrames, "EasyRouteRateFrame")

  local title = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOP", frame, "TOP", 0, -18)
  title:SetText("How was this quest?")

  local close = CreateFrame("Button", "EasyRouteRateCloseButton", frame, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -6, -6)
  close:SetScript("OnClick", function() Later() end)

  nameText = frame:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  nameText:SetPoint("TOP", frame, "TOP", 0, -46)
  nameText:SetWidth(WIDTH - 50)
  -- What you had to do, so you remember which quest this was.
  objText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  objText:SetPoint("TOP", nameText, "BOTTOM", 0, -4)
  objText:SetWidth(WIDTH - 50)
  objText:SetHeight(12)
  infoText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  infoText:SetPoint("TOP", objText, "BOTTOM", 0, -2)
  infoText:SetWidth(WIDTH - 50)
  infoText:SetHeight(12)

  local n = table.getn(ER.RATINGS)
  local bw, gap = 78, 6
  local x0 = (WIDTH - (n * bw + (n - 1) * gap)) / 2
  for i, r in ipairs(ER.RATINGS) do
    local b = Button("EasyRouteRateButton" .. i, frame, bw, r.label)
    b:SetHeight(24)
    b:SetPoint("TOPLEFT", frame, "TOPLEFT", x0 + (i - 1) * (bw + gap), -106)
    b.key, b.label, b.colour = r.key, r.label, r.colour
    b:SetScript("OnClick", function() Choose(this.key) end)
    Explain(b, r.label, r.tip)
    rateButtons[i] = b
  end

  whyText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  whyText:SetPoint("TOP", frame, "TOP", 0, -136)
  whyText:SetWidth(WIDTH - 50)

  for i, t in ipairs(ER.TAGS) do
    local c = CreateFrame("CheckButton", "EasyRouteRateTag" .. i, frame, "UICheckButtonTemplate")
    c:SetWidth(24)
    c:SetHeight(24)
    local col = math.mod(i - 1, 2)
    local row = math.floor((i - 1) / 2)
    c:SetPoint("TOPLEFT", frame, "TOPLEFT", 44 + col * 170, -158 - row * 24)
    getglobal(c:GetName() .. "Text"):SetText(t.label)
    c.key = t.key
    Explain(c, t.label, t.tip)
    tagChecks[i] = c
  end

  local noteLabel = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  noteLabel:SetPoint("TOPLEFT", frame, "TOPLEFT", 28, -216)
  noteLabel:SetText("Note")
  noteBox = CreateFrame("EditBox", "EasyRouteRateNote", frame, "InputBoxTemplate")
  noteBox:SetWidth(WIDTH - 104)
  noteBox:SetHeight(20)
  noteBox:SetPoint("TOPLEFT", frame, "TOPLEFT", 68, -212)
  noteBox:SetAutoFocus(false)
  noteBox:SetMaxLetters(200)
  noteBox:SetScript("OnEscapePressed", function() this:ClearFocus() end)
  noteBox:SetScript("OnEnterPressed", function() this:ClearFocus(); Save() end)
  Explain(noteBox, "Note", "Anything the guide should remember, like 'do this at 14' or 'the cave is the bad part'. Enter saves.")

  saveButton = Button("EasyRouteRateSave", frame, 100, "Save")
  saveButton:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -24, 18)
  saveButton:SetScript("OnClick", Save)
  Explain(saveButton, "Save", "Keeps this answer. The next quest waiting, if any, comes up after it.")
  laterButton = Button("EasyRouteRateLater", frame, 100, "Not now")
  laterButton:SetPoint("RIGHT", saveButton, "LEFT", -8, 0)
  laterButton:SetScript("OnClick", Later)
  Explain(laterButton, "Not now", "Closes without saving. You can still rate it later from the notebook (/er).")
end

-- Opens the popup for a quest. If it is already open for another quest, this one waits its turn.
function ER.OpenRate(title, info)
  if not title then return end
  if not frame then Build() end
  if frame:IsShown() and current then
    if current.title == title then
      current.info = info or current.info
      Fill()
      return
    end
    for _, q in ipairs(queue) do
      if q.title == title then
        q.info = info or q.info
        return
      end
    end
    table.insert(queue, { title = title, info = info or {} })
    return
  end
  current = { title = title, info = info or {} }
  Fill()
  frame:Show()
  PlaySound("igQuestListOpen")
end
