-- Easy Route: the "how was this quest?" popup, for reasons and notes. It opens from the "..." button
-- in the quest log panel or the notebook window, with /er rate, or after every turn-in when that
-- option is on. The addon fills in its own guess first, so often Save is all it takes.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local WIDTH, HEIGHT = 390, 416
local frame, nameText, whatText, askText, didText, infoText, levelBox, whyText, noteBox, saveButton, laterButton
local rateButtons, tagChecks = {}, {}
local current            -- { title = , info = }
local chosen             -- rating key picked in the popup
local autoLevel          -- the level the box was filled with; typing another makes it yours
local filling = false    -- the popup itself is setting the level box
local lastLevelText      -- what the level box said last time it was looked at
local userPicked = false -- you clicked a rating yourself, so the guess stops changing it
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

-- The level typed in the box, or nil if it is not a sensible number.
local function TypedLevel()
  local text = string.gsub(levelBox:GetText() or "", "%D", "")
  local n = tonumber(text)
  if n and n >= 1 and n <= 99 then return math.floor(n) end
  return nil
end

-- The guess follows the level in the box, so "I was 8 when I did it" changes what it says. A rating
-- you clicked yourself stays; only the words change.
local function UpdateGuess()
  if not current then return end
  local old = ER.GetRating(current.title)
  if old then
    whyText:SetText(GREY .. "You rated this " .. ER.Coloured(old.rating) .. GREY .. " before, on " .. (old.when or "?") .. "." .. END)
    return
  end
  local info = current.info or {}
  local level = TypedLevel() or info.donelevel
  local rating, _, why = ER.Suggest({ qlevel = info.qlevel, tag = info.tag, deaths = info.deaths, close = info.close, donelevel = level })
  whyText:SetText(GREY .. "My guess: " .. ER.Coloured(rating) .. GREY .. ", because " .. why .. ". Change it if you disagree." .. END)
  if not userPicked then Choose(rating) end
end

-- The box does not report every keystroke, so it is looked at a few times a second instead.
local function WatchLevelBox()
  if not current or filling then return end
  local text = levelBox:GetText()
  if text ~= lastLevelText then
    lastLevelText = text
    UpdateGuess()
  end
end

local function Fill()
  local info = current.info or {}
  nameText:SetText(GOLD .. current.title .. END)
  local old = ER.GetRating(current.title)
  -- What it asked for, in short and in the quest's own words, then one line of what you did.
  local what = info.what or ER.ObjectiveSummary(info.obj or (old and old.obj))
  whatText:SetText(what and (WHITE .. what .. END) or "")
  local ask = info.ask or (old and old.ask) or ER.Recorder.Ask(nil, info.pfid or (old and old.pfid))
  askText:SetText(ask and (GREY .. "\"" .. ask .. "\"" .. END) or "")
  local did = info.did or (old and old.did)
  didText:SetText(did and (WHITE .. did .. END) or "")
  local bits = {}
  if info.qlevel then table.insert(bits, "level " .. info.qlevel .. " quest") end
  if info.chain then table.insert(bits, "chain " .. info.chain) end
  if info.tag and info.tag ~= "" then table.insert(bits, info.tag) end
  if ER.Span(info.mins) then table.insert(bits, ER.Span(info.mins) .. " in your log") end
  if info.deaths and info.deaths > 0 then table.insert(bits, info.deaths .. (info.deaths == 1 and " death" or " deaths")) end
  if info.close and info.close > 0 then table.insert(bits, info.close .. (info.close == 1 and " close call" or " close calls")) end
  infoText:SetText(GREY .. table.concat(bits, "  -  ") .. END)
  autoLevel = (old and old.donelevel) or info.donelevel or UnitLevel("player") or 1
  filling = true
  levelBox:SetText(tostring(autoLevel))
  lastLevelText = levelBox:GetText()
  filling = false
  userPicked = false
  local rating, tags = ER.Suggest(info)
  if old then
    rating, tags = old.rating, old.tags or {}
  end
  Choose(rating)
  for _, c in ipairs(tagChecks) do
    c:SetChecked(tags[c.key] and 1 or nil)
  end
  noteBox:SetText((old and old.note) or "")
  UpdateGuess()
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
  local info = current.info or {}
  local typed = TypedLevel()
  if typed then
    info.donelevel = typed
    if typed ~= autoLevel then info.donelevelManual = true end
  end
  ER.SetRating(current.title, chosen, tags, noteBox:GetText(), info)
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
  frame:SetScript("OnUpdate", WatchLevelBox)
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
  -- What it asked for ("Collect 8 Torn Murloc Fins"), the quest's own words for it, and one line of
  -- what you did (where, how long). So you know which quest this was.
  whatText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  whatText:SetPoint("TOP", nameText, "BOTTOM", 0, -4)
  whatText:SetWidth(WIDTH - 50)
  whatText:SetHeight(12)
  askText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  askText:SetPoint("TOP", whatText, "BOTTOM", 0, -3)
  askText:SetWidth(WIDTH - 50)
  askText:SetHeight(38)
  askText:SetJustifyV("TOP")
  didText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  didText:SetPoint("TOP", askText, "BOTTOM", 0, -2)
  didText:SetWidth(WIDTH - 50)
  didText:SetHeight(26)
  didText:SetJustifyV("TOP")
  infoText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  infoText:SetPoint("TOP", didText, "BOTTOM", 0, -2)
  infoText:SetWidth(WIDTH - 50)
  infoText:SetHeight(12)

  -- The level you were when you did it. Filled in from what the addon saw; type over it if not.
  local levelLabel = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  levelLabel:SetPoint("TOPLEFT", frame, "TOPLEFT", 28, -170)
  levelLabel:SetText("I was level")
  levelBox = CreateFrame("EditBox", "EasyRouteRateLevel", frame, "InputBoxTemplate")
  levelBox:SetWidth(54)   -- the template pads the sides; narrower than this shows only one digit
  levelBox:SetHeight(20)
  levelBox:SetPoint("LEFT", levelLabel, "RIGHT", 10, 0)
  levelBox:SetAutoFocus(false)
  levelBox:SetMaxLetters(2)
  levelBox:SetNumeric(true)
  levelBox:SetJustifyH("CENTER")
  levelBox:SetScript("OnEscapePressed", function() this:ClearFocus() end)
  levelBox:SetScript("OnEnterPressed", function() this:ClearFocus() end)
  levelBox:SetScript("OnTextChanged", function() WatchLevelBox() end)
  Explain(levelBox, "I was level", "The level you were when you did this quest, filled in for you from what the addon saw. Nothing to do unless you are rating a quest you did days ago: then type the level you really were, and the guess follows.")
  local levelAfter = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  levelAfter:SetPoint("LEFT", levelBox, "RIGHT", 6, 0)
  levelAfter:SetText("when I did it" .. GREY .. "  (filled in for you)" .. END)

  local n = table.getn(ER.RATINGS)
  local bw, gap = 78, 6
  local x0 = (WIDTH - (n * bw + (n - 1) * gap)) / 2
  for i, r in ipairs(ER.RATINGS) do
    local b = Button("EasyRouteRateButton" .. i, frame, bw, r.label)
    b:SetHeight(24)
    b:SetPoint("TOPLEFT", frame, "TOPLEFT", x0 + (i - 1) * (bw + gap), -198)
    b.key, b.label, b.colour = r.key, r.label, r.colour
    b:SetScript("OnClick", function()
      userPicked = true
      Choose(this.key)
    end)
    Explain(b, r.label, r.tip)
    rateButtons[i] = b
  end

  whyText = frame:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  whyText:SetPoint("TOP", frame, "TOP", 0, -228)
  whyText:SetWidth(WIDTH - 50)

  for i, t in ipairs(ER.TAGS) do
    local c = CreateFrame("CheckButton", "EasyRouteRateTag" .. i, frame, "UICheckButtonTemplate")
    c:SetWidth(24)
    c:SetHeight(24)
    local col = math.mod(i - 1, 2)
    local row = math.floor((i - 1) / 2)
    c:SetPoint("TOPLEFT", frame, "TOPLEFT", 44 + col * 170, -250 - row * 24)
    getglobal(c:GetName() .. "Text"):SetText(t.label)
    c.key = t.key
    Explain(c, t.label, t.tip)
    tagChecks[i] = c
  end

  local noteLabel = frame:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
  noteLabel:SetPoint("TOPLEFT", frame, "TOPLEFT", 28, -356)
  noteLabel:SetText("Note")
  noteBox = CreateFrame("EditBox", "EasyRouteRateNote", frame, "InputBoxTemplate")
  noteBox:SetWidth(WIDTH - 104)
  noteBox:SetHeight(20)
  noteBox:SetPoint("TOPLEFT", frame, "TOPLEFT", 68, -352)
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

------------------------------------------------------------------------------------------------------
-- A small notice when you pick up the first quest of a chain
------------------------------------------------------------------------------------------------------

local notice, noticeText

function ER.ShowChainNotice(title, total, nextTitle)
  if not notice then
    notice = CreateFrame("Frame", "EasyRouteChainNotice", UIParent)
    notice:SetWidth(360)
    notice:SetHeight(140)
    notice:SetPoint("TOP", UIParent, "TOP", 0, -140)
    notice:SetFrameStrata("DIALOG")
    notice:SetClampedToScreen(true)
    notice:EnableMouse(true)
    notice:SetMovable(true)
    notice:RegisterForDrag("LeftButton")
    notice:SetScript("OnDragStart", function() this:StartMoving() end)
    notice:SetScript("OnDragStop", function() this:StopMovingOrSizing() end)
    Opaque(notice)
    notice:SetBackdrop({
      bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
      tile = true, tileSize = 32, edgeSize = 32,
      insets = { left = 11, right = 12, top = 12, bottom = 11 },
    })
    table.insert(UISpecialFrames, "EasyRouteChainNotice")

    local head = notice:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    head:SetPoint("TOP", notice, "TOP", 0, -18)
    head:SetText("Chain quest")
    noticeText = notice:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    noticeText:SetPoint("TOP", head, "BOTTOM", 0, -8)
    noticeText:SetWidth(320)
    noticeText:SetHeight(40)
    noticeText:SetJustifyV("TOP")
    local hint = notice:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    hint:SetPoint("TOP", noticeText, "BOTTOM", 0, -2)
    hint:SetText(GREY .. "/er chain turns this popup off" .. END)
    local ok = Button("EasyRouteChainNoticeOk", notice, 100, "Got it")
    ok:SetPoint("BOTTOM", notice, "BOTTOM", 0, 16)
    ok:SetScript("OnClick", function() notice:Hide() end)
  end
  local text = GOLD .. title .. END .. WHITE .. " is the start of a chain: quest 1 of " .. total .. "." .. END
  if nextTitle then text = text .. GREY .. " Next comes " .. nextTitle .. "." .. END end
  noticeText:SetText(text)
  notice:Show()
  PlaySound("igQuestListOpen")
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
