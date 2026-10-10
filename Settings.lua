-- Easy Route: the settings window. Every option and every window of the addon in one place, so nothing needs a
-- slash command: four pages (Guide, Auto mode, Helpers, Feedback) picked with the page buttons along the top, each with its
-- ticks and buttons. The gear on the guide (step box or quest list) opens it, so does right-clicking the minimap button, or /er settings.

local ER = EasyRoute
local GOLD, GREY, WHITE, END = ER.GOLD, ER.GREY, ER.WHITE, ER.END

local W = 520
local LEFT = 22                      -- the left edge of a page's words
local COL_W = math.floor((W - 44) / 2)   -- one of the two columns of ticks
local TOP_Y = -84                    -- where a page starts, under the title, the line about the guide and the page buttons
local S = { checks = {}, buttons = {}, tabs = {}, pages = {} }

local function Db() return ER.db or {} end

local function Running() return ER.Steps and ER.Steps.Running() end

local function Hide() if S.frame then S.frame:Hide() end end

-- A tick: label, is it on now, turn it on or off, and a short tooltip (tip). wide: the tick has a whole row; part: one of Auto mode's own
-- ticks (greyed while Auto mode is off). The toggles that already have their own function use it, so the chat line and the windows follow
-- as with the slash command. A button: label, what the tooltip says, what it does. note: a grey line under the ticks.
local PAGES = {
  { title = "Guide", head = "Your guide and how hard it is.",
    checks = {
      { "Simple mode (quest list)",
        function() return Db().simple end,
        function(on) if ER.SetSimple then ER.SetSimple(on) end end,
        tip = "A quest list on the left instead of the step box." },
      { "Go on to the next guide",
        function() return not Db().autoNextOff end,
        function(on) if ER.db then ER.db.autoNextOff = not on end end,
        tip = "When a guide ends, the next one starts by itself." },
      { "Ask every 3 levels how it goes",
        function() return not Db().checkinOff end,
        function(on) if ER.db then ER.db.checkinOff = not on end end,
        tip = "Every 3 levels: Too easy, About right or Too hard?" },
      { "Leave out money steps",
        function() return ER.HasMoney and ER.HasMoney() end,
        function(on) if ER.SetHasMoney then ER.SetHasMoney(on) end end,
        tip = "For when you have money on another character." },
    },
    buttons = {
      { "Pick a guide", "Every guide for your faction, by level.", function()
        Hide()
        if ER.ShowGuideMenu then ER.ShowGuideMenu() end
      end },
      { "Change difficulty", "Casual, Medium or Hard.", function()
        Hide()
        if ER.ShowWizardMood then ER.ShowWizardMood() end
      end },
      { "Start guide again", "Back to step 1 of this guide.", function()
        local info = Running() and ER.Steps.Info()
        if info then ER.Steps.Load(ER.Steps.Key(info), true) end
        Hide()
      end },
      { "Stop the guide", "Close the guide. Pick a guide starts one again.", function()
        if Running() then
          ER.Steps.Stop()
          ER.Print("guide stopped.")
        end
        Hide()
      end },
      { "Find my place", "Puts the guide back where your quest log says you are.", function()
        if ER.FindMyPlace then ER.FindMyPlace() end
        Hide()
      end },
    },
  },
  { title = "Auto mode", head = "Easy Route does the clicking at NPCs.",
    checks = {
      { "Auto mode (hold Shift to do it yourself)",
        function() return not Db().autoOff end,
        function(on) if ER.db then ER.db.autoOff = not on end end,
        tip = "Does the clicking at NPCs. Hold Shift when you talk to do it yourself.", wide = true },
      { "Take and hand in quests",
        function() return not Db().autoquestOff end,
        function(on) if ER.db then ER.db.autoquestOff = not on end end,
        tip = "Takes your route's quests and hands in finished ones.", part = true },
      { "Pick quests in NPC menus",
        function() return not Db().automenuOff end,
        function(on) if ER.db then ER.db.automenuOff = not on end end,
        tip = "When an NPC has several quests, picks the right one.", part = true },
      { "Take the flight on fly steps",
        function() return not Db().autoflightOff end,
        function(on) if ER.db then ER.db.autoflightOff = not on end end,
        tip = "Opens the flight map and flies to the step's town.", part = true },
      { "Set my hearthstone at the inn",
        function() return not Db().autoinnOff end,
        function(on) if ER.db then ER.db.autoinnOff = not on end end,
        tip = "On a set-hearthstone step, at that inn only.", part = true },
      { "Sell grey items and repair",
        function() return not Db().autosellOff end,
        function(on) if ER.db then ER.db.autosellOff = not on end end,
        tip = "At any vendor. Never white or quest items.", part = true },
      { "Show the Use your hearthstone button",
        function() return not Db().hearthBtnOff end,
        function(on)
          if ER.db then ER.db.hearthBtnOff = not on end
          if ER.StepsChanged then ER.StepsChanged() end
        end,
        tip = "On hearth steps. It never hearths by itself. Works with Auto mode off too.", wide = true },
    },
    note = "Rewards: you pick. If none fit you, it takes the one that sells for the most.",
    buttons = {},
  },
  { title = "Helpers", head = "Extra help on screen.",
    checks = {
      { "Show the arrow",
        function() return not Db().arrowOff end,
        function(on) if (not Db().arrowOff) ~= on and ER.ToggleArrow then ER.ToggleArrow() end end,
        tip = "The arrow that points the way." },
      { "Show the tips box",
        function() return not Db().tipsOff end,
        function(on) if (not Db().tipsOff) ~= on and ER.ToggleTips then ER.ToggleTips() end end,
        tip = "The \"Easy Route says\" box under the guide." },
      { "Show grind spots",
        function() return not Db().grindOff end,
        function(on) if ER.db then ER.db.grindOff = not on end end,
        tip = "Safe mobs to kill when there are no good quests." },
      { "Show warnings",
        function() return not Db().warnOff end,
        function(on)
          if ER.db then ER.db.warnOff = not on end
          if ER.StepsChanged then ER.StepsChanged() end
        end,
        tip = "Dangerous mobs, caves and mines." },
      { "Skulls on quest enemies",
        function() return not Db().skullsOff end,
        function(on) if (not Db().skullsOff) ~= on and ER.ToggleSkulls then ER.ToggleSkulls() end end,
        tip = "Over enemies your quests need. V shows their health bars." },
      { "Easy / Hard on enemy tooltips",
        function() return not Db().rateOff end,
        function(on) if ER.db then ER.db.rateOff = not on end end,
        tip = "Enemy tooltips say Easy, Medium or Hard." },
      { "Minimap button",
        function() return not Db().minimapHidden end,
        function(on)
          if ER.db then ER.db.minimapHidden = not on end
          if ER.UpdateMinimapButton then ER.UpdateMinimapButton() end
        end,
        tip = "The Easy Route button on the minimap." },
    },
    buttons = {},
  },
  { title = "Feedback", head = "For testers. Nothing leaves your computer.",
    checks = {
      { "Ask how hard each quest was",
        function() return Db().autoPrompt end,
        function(on) if ER.db then ER.db.autoPrompt = on end end,
        tip = "After each quest: Easy, Medium or Hard?" },
      { "Tell my party when I hand in",
        function() return Db().partyAnnounce end,
        function(on) if ER.db then ER.db.partyAnnounce = on end end,
        tip = "One line in party chat." },
      { "Popup on a chain's first quest",
        function() return Db().chainPopup end,
        function(on) if ER.db then ER.db.chainPopup = on end end,
        tip = "Says what the chain gives at the end." },
    },
    buttons = {
      { "Send feedback", "Your ratings and notes, ready to copy (Ctrl+C) and send to stealthzi.", function()
        Hide()
        if ER.ShowExport then ER.ShowExport() end
      end },
      { "Notebook", "Your quests with Easy / Medium / Hard / Skip buttons.", function()
        Hide()
        if ER.ToggleWindow then ER.ToggleWindow() end
      end },
      { "What it records", "What the addon writes down. Nothing leaves your computer.", function()
        Hide()
        if ER.ShowNotice then ER.ShowNotice() end
      end },
    },
  },
}

-- The row along the bottom, under every page.
local BOTTOM = {
  { "How to use", "The help page.", function()
    Hide()
    if ER.ShowHelp then ER.ShowHelp() end
  end },
  { "Welcome", "The welcome notice: what Easy Route does and how to start.", function()
    Hide()
    if ER.ShowWelcome then ER.ShowWelcome() end
  end },
  { "Close", "Close the settings.", function() Hide() end },
}

-- Every tick of every page in one list, in the order they are made; each one knows its page.
local CHECKS = {}
for p, page in ipairs(PAGES) do
  for _, c in ipairs(page.checks) do
    c.page = p
    table.insert(CHECKS, c)
  end
end

-- What the window holds, for the tests: each page's title, its ticks (labels), how many are Auto mode's part ticks, its buttons (labels);
-- the bottom row; the page open now.
function ER.SettingsInfo()
  local out = { pages = {}, bottom = {}, page = S.page }
  for _, page in ipairs(PAGES) do
    local parts, labels, buttons = 0, {}, {}
    for _, c in ipairs(page.checks) do
      if c.part then parts = parts + 1 end
      table.insert(labels, c[1])
    end
    for _, b in ipairs(page.buttons) do table.insert(buttons, b[1]) end
    table.insert(out.pages, { title = page.title, head = page.head, checks = labels, parts = parts, buttons = buttons })
  end
  for _, b in ipairs(BOTTOM) do table.insert(out.bottom, b[1]) end
  return out
end

-- A window taller than the screen is made smaller to fit: 1 when it fits (or the screen height is not known), else the share that fits
-- with 20 units to spare.
function ER.SettingsScale(height, screen)
  if type(height) == "number" and height > 0 and type(screen) == "number" and screen >= 300 and height > screen - 20 then
    return (screen - 20) / height
  end
  return 1
end

local function Refresh()
  local off = Db().autoOff
  for i, c in ipairs(S.checks) do
    c:SetChecked(CHECKS[i][2]() and 1 or nil)
    -- The part ticks of auto mode are greyed while auto mode is off (they still work; the Auto mode tick decides).
    if CHECKS[i].part then c:SetAlpha(off and 0.5 or 1) end
  end
  local info = Running() and ER.Steps.Info()
  local mode = ER.MODES and ER.Mode and ER.MODES[ER.Mode()]
  S.sub:SetText(GREY .. "Difficulty: " .. END .. WHITE .. (mode and mode.label or "?") .. END .. GREY .. "     Guide: " .. END ..
    WHITE .. (info and (info.title or info.name) or "none") .. END)
end

-- Shows page n (1 to 4) and keeps it as the page to open next time.
local function ShowPage(n)
  n = tonumber(n)
  if not n or not PAGES[n] then n = 1 end
  S.page = n
  if ER.db then ER.db.settingsPage = n end
  for i, page in ipairs(S.pages) do
    if i == n then page:Show() else page:Hide() end
    local tab = S.tabs[i]
    if tab then
      if i == n then tab:LockHighlight() else tab:UnlockHighlight() end
    end
  end
end

local function Tooltip(owner, title, text)
  GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
  GameTooltip:SetText(title)
  if text then GameTooltip:AddLine(text, 1, 1, 1, 1) end
  GameTooltip:Show()
end

local function Button(name, parent, def, width)
  local b = CreateFrame("Button", name, parent, "UIPanelButtonTemplate")
  b:SetWidth(width)
  b:SetHeight(22)
  b:SetText(def[1])
  b.def = def
  b:SetScript("OnClick", function() this.def[3]() end)
  b:SetScript("OnEnter", function() Tooltip(this, this.def[1], this.def[2]) end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  return b
end

-- Builds one page's ticks, note and buttons in its own frame and returns how tall it is. Ticks sit in two columns; a wide tick has a whole
-- row. The first of a pair waits (pendingH) for the second, so the pair is as tall as the taller of the two labels.
local function BuildPage(p, def, nc, nb)
  local page = CreateFrame("Frame", "EasyRouteSettingsPage" .. p, S.frame)
  page:SetPoint("TOPLEFT", S.frame, "TOPLEFT", 0, TOP_Y)
  page:SetWidth(W)
  S.pages[p] = page

  local y = 0
  local head = page:CreateFontString(nil, "ARTWORK", "GameFontNormal")
  head:SetPoint("TOPLEFT", page, "TOPLEFT", LEFT, y)
  head:SetJustifyH("LEFT")
  y = y - ER.FitHeight(head, def.head, W - 2 * LEFT, 14) - 4
  local rule = page:CreateTexture(nil, "ARTWORK")
  rule:SetTexture(1, 1, 1, 0.15)
  rule:SetHeight(1)
  rule:SetWidth(W - 2 * LEFT)
  rule:SetPoint("TOPLEFT", page, "TOPLEFT", LEFT, y)
  y = y - 6

  local col, pendingH = 0, nil
  for _, c in ipairs(def.checks) do
    nc = nc + 1
    if c.wide and pendingH then
      y = y - pendingH
      pendingH, col = nil, 0
    end
    local b = CreateFrame("CheckButton", "EasyRouteSettingsCheck" .. nc, page, "UICheckButtonTemplate")
    b:SetWidth(24)
    b:SetHeight(24)
    local x, labelW = LEFT, W - 2 * LEFT - 30
    if not c.wide then
      x = LEFT + col * COL_W + (c.part and 10 or 0)
      labelW = COL_W - 34 - (c.part and 10 or 0)
    end
    b:SetPoint("TOPLEFT", page, "TOPLEFT", x, y)
    local rowH = 24
    local label = getglobal("EasyRouteSettingsCheck" .. nc .. "Text")
    if label then
      label:ClearAllPoints()
      label:SetPoint("TOPLEFT", b, "TOPRIGHT", 0, -4)
      label:SetJustifyH("LEFT")
      rowH = math.max(24, ER.FitHeight(label, c[1], labelW, 16) + 8)
    end
    b.index, b.page = nc, p
    b:SetScript("OnClick", function()
      local on = this:GetChecked() and true or false
      CHECKS[this.index][3](on)
      Refresh()
    end)
    b:SetScript("OnEnter", function()
      local d = CHECKS[this.index]
      Tooltip(this, d[1], d.tip)
    end)
    b:SetScript("OnLeave", function() GameTooltip:Hide() end)
    S.checks[nc] = b
    if c.wide then
      y = y - rowH
    elseif col == 0 then
      pendingH, col = rowH, 1
    else
      y = y - math.max(pendingH or 24, rowH)
      pendingH, col = nil, 0
    end
  end
  if pendingH then y = y - pendingH end

  if def.note then
    y = y - 4
    local note = page:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
    note:SetPoint("TOPLEFT", page, "TOPLEFT", LEFT + 4, y)
    note:SetJustifyH("LEFT")
    y = y - ER.FitHeight(note, GREY .. def.note .. END, W - 2 * LEFT - 4, 14)
  end

  if table.getn(def.buttons) > 0 then y = y - 8 end
  local bw = math.floor((W - 2 * LEFT - 8) / 2)
  for i, bd in ipairs(def.buttons) do
    nb = nb + 1
    local b = Button("EasyRouteSettingsButton" .. nb, page, bd, bw)
    local bc = math.mod(i - 1, 2)
    b:SetPoint("TOPLEFT", page, "TOPLEFT", LEFT + 2 + bc * (bw + 8), y)
    S.buttons[nb] = b
    if bc == 1 then y = y - 26 end
  end
  if math.mod(table.getn(def.buttons), 2) == 1 then y = y - 26 end

  local height = -y + 6
  page:SetHeight(height)
  return height, nc, nb
end

local function Build()
  local f = CreateFrame("Frame", "EasyRouteSettings", UIParent)
  S.frame = f
  f:SetWidth(W)
  f:SetFrameStrata("DIALOG")
  f:SetPoint("CENTER", UIParent, "CENTER", 0, 40)
  f:SetClampedToScreen(true)
  f:EnableMouse(true)
  f:SetMovable(true)
  f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", function() this:StartMoving() end)
  f:SetScript("OnDragStop", function() this:StopMovingOrSizing() end)
  f:SetBackdrop({
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 11, right = 12, top = 12, bottom = 11 },
  })
  f:Hide()
  table.insert(UISpecialFrames, "EasyRouteSettings")

  local title = f:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
  title:SetPoint("TOP", f, "TOP", 0, -18)
  title:SetText("Easy Route settings")
  S.sub = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  S.sub:SetPoint("TOP", title, "BOTTOM", 0, -6)
  local close = CreateFrame("Button", "EasyRouteSettingsClose", f, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", f, "TOPRIGHT", -6, -6)

  -- The page buttons along the top.
  local count = table.getn(PAGES)
  local tw = math.floor((W - 2 * LEFT - (count - 1) * 6) / count)
  for p, page in ipairs(PAGES) do
    local tab = Button("EasyRouteSettingsTab" .. p, f, { page.title, page.head, function() end }, tw)
    tab:SetPoint("TOPLEFT", f, "TOPLEFT", LEFT + (p - 1) * (tw + 6), -54)
    tab.page = p
    tab:SetScript("OnClick", function() ShowPage(this.page) end)
    S.tabs[p] = tab
  end

  -- Every page is as tall as the tallest, so the window keeps one size while the pages change.
  local tallest, nc, nb = 0, 0, 0
  for p, page in ipairs(PAGES) do
    local h
    h, nc, nb = BuildPage(p, page, nc, nb)
    if h > tallest then tallest = h end
  end
  for _, page in ipairs(S.pages) do page:SetHeight(tallest) end

  local bw = math.floor((W - 2 * LEFT - 2 * 8) / 3)
  for i, def in ipairs(BOTTOM) do
    local b = Button("EasyRouteSettingsBottom" .. i, f, def, bw)
    b:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", LEFT + (i - 1) * (bw + 8), 38)
  end

  local credit = f:CreateFontString(nil, "ARTWORK", "GameFontHighlightSmall")
  credit:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -20, 16)
  credit:SetText(GREY .. "Made by " .. END .. "|cffabd473stealthzi" .. END .. GREY .. "   v" .. ER.VERSION .. END)
  local height = -TOP_Y + tallest + 70   -- the bottom row and the credit line under the pages
  f:SetHeight(height)
  f:SetScale(ER.SettingsScale(height, UIParent:GetHeight()))
end

function ER.ShowSettings(page)
  if not S.frame then Build() end
  Refresh()
  ShowPage(page or Db().settingsPage or S.page or 1)
  S.frame:Show()
end

function ER.ToggleSettings()
  if S.frame and S.frame:IsShown() then S.frame:Hide() else ER.ShowSettings() end
end

ER.Loaded("Settings.lua")
