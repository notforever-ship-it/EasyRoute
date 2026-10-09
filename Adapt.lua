-- Easy Route: the advice. It watches how levelling goes and says what is worth knowing in the tips box
-- (Simple.lua), and it rates enemies on their tooltip.
--  * The guide leaves out quests too easy for you (Steps.lua); this says how many, now and then.
--  * When you have outlevelled the guide it asks whether to move on to one that fits your level.
--  * Once per character it asks whether you have money on another character, to leave out the money-farming steps.
--  * It reminds you to visit your class trainer when new spells have been waiting a couple of levels, and says what
--    the big levels (10, 20, 30, 40) bring.
--  * In simple mode (no step box) RestedXP's own warnings for the step you are on ("try to avoid ...") and quests
--    above your comfort show here too; with the step box they show in the box.
--  * Enemies get Easy, Medium or Hard at the bottom of their tooltip: their level against yours and your difficulty,
--    elites, and the guide's warnings.

local ER = EasyRoute
local GOLD, GREY, WHITE, RED, GREEN, END = ER.GOLD, ER.GREY, ER.WHITE, ER.RED, ER.GREEN, ER.END

-- What is remembered per character: { money = true/false/nil (not asked), trained = level of the last trainer visit,
-- stay = { [guide key] = true } guides you chose to stay in, told = { [key] = true } things said once }.
local function Mine()
  if not ER.db then return nil end
  if type(ER.db.adapt) ~= "table" then ER.db.adapt = {} end
  local c = ER.Char()
  local a = ER.db.adapt[c]
  if type(a) ~= "table" then
    a = {}
    ER.db.adapt[c] = a
  end
  if type(a.stay) ~= "table" then a.stay = {} end
  if type(a.told) ~= "table" then a.told = {} end
  return a
end

local function Tip(key, text, buttons, life)
  if ER.AddTip then ER.AddTip(key, text, buttons, life) end
end

local function Simple()
  return ER.SimpleShown and ER.SimpleShown()
end

------------------------------------------------------------------------------------------------------
-- Hooks the guide calls
------------------------------------------------------------------------------------------------------

-- How many levels the comfort line moves for this character: 0, it does not move.
function ER.AdaptShift() return 0 end

-- Called when a step is skipped by hand before it was done. Nothing is learned from it.
function ER.OnStepSkipped(step) end

------------------------------------------------------------------------------------------------------
-- Money on another character
------------------------------------------------------------------------------------------------------

function ER.HasMoney()
  local a = Mine()
  return a and a.money == true or false
end

function ER.SetHasMoney(on)
  local a = Mine()
  if not a then return end
  a.money = on and true or false
  ER.Print(on and "the steps that only farm money are left out now (untick it in Settings to keep them)."
    or "the money-farming steps are kept.")
  if ER.Steps and ER.Steps.Running() then ER.Steps.Check() end
end

local askedNow = {}   -- questions asked this session (closing the box without an answer is not asked again today)

local function AskMoney()
  local a = Mine()
  if not a or a.money ~= nil or askedNow.money then return end
  askedNow.money = true
  Tip("money", "Do you have money on another character you can mail over? Then I can leave out the steps that only " ..
    "farm money (\"loot them until you have 10 copper\").", {
      { label = "Yes, leave them out", fn = function() ER.SetHasMoney(true) end },
      { label = "No", fn = function() ER.SetHasMoney(false) end },
    })
end

------------------------------------------------------------------------------------------------------
-- Too hard for you now
------------------------------------------------------------------------------------------------------

-- The first quest in a step that is above your comfort: id, title, its level, how far above you. Only quests you
-- are doing; picking one up early is fine (RestedXP often takes quests for later).
local function HardQuest(step)
  local Steps = ER.Steps
  for _, e in ipairs(step.elements) do
    if (e.kind == "C" or e.kind == "K") and e.id and e.id ~= 0 then
      local done = Steps.ElementDone(step, e)
      local over = done == false and Steps.TooHard(e.id)
      if over then return e.id, Steps.QuestTitle(e.id) or ("quest " .. e.id), Steps.QuestLevel(e.id), over end
    end
  end
  return nil
end

-- The red line in the step box for a quest above your comfort; nil when the step is fine.
function ER.HardLine(step)
  local id, title, level = HardQuest(step)
  if not id then return nil end
  return RED .. "Hard for your level: " .. END .. title .. " is level " .. level .. ", you are " .. (UnitLevel("player") or 1) ..
    ". Kill a few mobs on the way first, or Skip it."
end

------------------------------------------------------------------------------------------------------
-- How hard is this quest? A line in the step box with the addon's guess or your own answer; click to change it
------------------------------------------------------------------------------------------------------

-- The quest the step is about: the first one in your log that it finishes, kills for or hands in.
local function StepQuest(step)
  local Steps = ER.Steps
  for _, e in ipairs(step.elements) do
    if (e.kind == "C" or e.kind == "K" or e.kind == "T") and e.id and e.id ~= 0 then
      local title, row = Steps.QuestTitle(e.id), Steps.InLog(e.id)
      if title and row then return title, row, e.id end
    end
  end
  return nil
end

-- Enough about the quest for the guess (the full details are only gathered when you change it).
local function QuickInfo(title, row, id)
  local a = ER.Recorder.Active()[title]
  return { qlevel = row.qlevel or ER.Steps.QuestLevel(id), tag = row.tag, pfid = row.pfid or (a and a.pfid),
    deaths = (a and a.deaths) or 0, close = (a and a.close) or 0 }
end

-- { text, rate = { title, row, rating, mine, why } } for the step box, or nil when the step has no quest of yours.
function ER.QuestRateLine(step)
  if not (ER.Recorder and ER.Recorder.Active) then return nil end
  local title, row, id = StepQuest(step)
  if not title then return nil end
  local info = QuickInfo(title, row, id)
  local mine = ER.GetRating(title, info.pfid)
  local rating, why
  if mine and mine.rating then
    rating = mine.rating
  else
    local _
    rating, _, why = ER.Suggest(info)
  end
  local whose = mine and "your answer" or "my guess"
  return {
    text = GREY .. "How hard: " .. END .. ER.Coloured(rating) .. GREY .. " (" .. whose .. ", click to change)" .. END,
    rate = { title = title, row = row, rating = rating, mine = mine and true or false, why = why },
  }
end

-- Clicking the line: Easy -> Medium -> Hard -> Easy. Saved like a rating from the quest log, so it goes in the
-- notebook and in "Send feedback".
function ER.NextQuestRating(r)
  local order = { easy = "medium", medium = "hard", hard = "easy", skip = "easy" }
  local rating = order[r.rating] or "medium"
  local info = ER.Recorder.InfoFor(r.title, r.row)
  local old = ER.GetRating(r.title, info.pfid)
  ER.SetRating(r.title, rating, old and old.tags, old and old.note, info)
end

------------------------------------------------------------------------------------------------------
-- Looking every few seconds while a guide runs
------------------------------------------------------------------------------------------------------

local lastStep, easyTotal = nil, 0

local function StepTips()
  local Steps = ER.Steps
  local cur = Steps.Current()
  local key = (Simple() and "list:" or "box:") .. (cur and cur.n or 0)
  for _, s in ipairs(Steps.Side()) do key = key .. "+" .. s.n end
  if key == lastStep then return end
  lastStep = key
  ER.RemoveTips("warn:")
  ER.RemoveTips("hard:")
  -- With the step box up these are in the box already.
  if not Simple() then return end
  for i, w in ipairs(Steps.Warnings()) do
    if i > 2 then break end
    Tip("warn:" .. i, GOLD .. "Heads up: " .. END .. w.text)
  end
  if cur then
    local id, title, level = HardQuest(cur)
    if id then
      Tip("hard:" .. id, RED .. "Hard for your level: " .. END .. title .. " is level " .. level .. ", you are " ..
        (UnitLevel("player") or 1) .. ". Kill a few mobs on the way first, or press Skip.")
    end
  end
end

local function GuideTips()
  local Steps = ER.Steps
  local a = Mine()
  if not a then return end
  local info = Steps.Info()
  local key = Steps.Key(info)
  local level = UnitLevel("player") or 1

  -- Quests left out for being too easy.
  local n = Steps.TakeEasySkipped()
  if n > 0 then
    easyTotal = easyTotal + n
    Tip("easy", "Left out " .. easyTotal .. " quest" .. (easyTotal == 1 and "" or "s") ..
      " that give next to no experience at your level.", nil, 20)
  end

  -- Outlevelled: ask whether to move on (once a session per guide; "Stay here" for good).
  if Steps.Outlevelled() and not a.stay[key] and not askedNow["move:" .. key] then
    askedNow["move:" .. key] = true
    local nxt = Steps.NextGuide()
    if not nxt or level >= nxt.hi + 2 then nxt = Steps.Suggest()[1] end
    if nxt and nxt ~= info then
      Tip("move", "You are level " .. level .. " and this guide is for " .. info.lo .. "-" .. info.hi ..
        ": most of what is left gives little experience. Move on to " .. GOLD .. (nxt.title or nxt.name) .. END .. "?", {
          { label = "Move on", fn = function() ER.StartGuide(Steps.Key(nxt)) end },
          { label = "Stay here", fn = function() a.stay[key] = true end },
        })
    end
  end

  StepTips()
  AskMoney()
end

------------------------------------------------------------------------------------------------------
-- The class trainer
------------------------------------------------------------------------------------------------------

-- What the big levels bring. Class lines are the usual classic ones; Turtle WoW keeps them.
local MILESTONES = {
  [10] = { all = "Your first talent point: spend it (press N).",
    HUNTER = "Hunters can now tame a pet: ask your class trainer.",
    WARLOCK = "Your trainer has the Voidwalker quest.",
    DRUID = "Your trainer has the Bear Form quest.",
    WARRIOR = "Your trainer has the Defensive Stance quest.",
    SHAMAN = "Your trainer has the fire totem quest." },
  [20] = { all = "Lots of new ranks of your spells.",
    ROGUE = "Your trainer has the poisons quest.",
    DRUID = "Cat Form is ready at your trainer.",
    WARLOCK = "Your trainer has the Succubus quest.",
    SHAMAN = "Your trainer has the water totem quest." },
  [30] = { all = "A big round of new spells.",
    WARRIOR = "Your trainer has the Berserker Stance quest.",
    DRUID = "Travel Form is ready at your trainer.",
    WARLOCK = "Your trainer has the Felhunter quest.",
    SHAMAN = "Your trainer has the air totem quest." },
  [40] = { all = "Riding and your first mount, if you have the gold.",
    HUNTER = "You can wear mail armor now.", SHAMAN = "You can wear mail armor now.",
    WARRIOR = "You can wear plate armor now.", PALADIN = "You can wear plate armor now." },
}

local function OnLevelUp(level)
  local a = Mine()
  if not a then return end
  a.trained = a.trained or (level - 1)
  local _, class = UnitClass("player")
  local m = MILESTONES[level]
  if m then
    local text = GOLD .. "Level " .. level .. "! " .. END .. m.all
    if class and m[class] then text = text .. " " .. m[class] end
    text = text .. " Visit your class trainer for the new spells."
    Tip("trainer", text, nil, 240)
  elseif math.mod(level, 2) == 0 and level - a.trained >= 2 then
    Tip("trainer", "New spells have been waiting since level " .. (a.trained + 1) ..
      ". A visit to your class trainer makes the fights easier.", nil, 180)
  end
end

------------------------------------------------------------------------------------------------------
-- Enemies on the tooltip
------------------------------------------------------------------------------------------------------

-- Easy, Medium or Hard for an enemy, and why: { word, why, r, g, b }. nil for players, friends and the dead.
function ER.RateEnemy(unit)
  if not UnitExists(unit) or UnitIsPlayer(unit) or not UnitCanAttack("player", unit) or UnitIsDead(unit) then return nil end
  local Steps = ER.Steps
  local level = UnitLevel(unit) or 0
  local me = UnitLevel("player") or 1
  local kind = UnitClassification and UnitClassification(unit) or "normal"
  local name = Steps.Singular(UnitName(unit))
  local warned
  if Steps.Running() then
    for _, w in ipairs(Steps.WarnedEnemies()) do
      if w.name == name then warned = true break end
    end
  end
  local hardAt = Steps.Comfort()
  local diff = level - me
  if level <= 0 then return { "Hard", "far above you", 1, 0.25, 0.25 } end
  if kind == "worldboss" or kind == "elite" or kind == "rareelite" then return { "Hard", "elite", 1, 0.25, 0.25 } end
  if warned then return { "Hard", "the guide says to watch out", 1, 0.25, 0.25 } end
  if diff >= hardAt then return { "Hard", diff .. " levels above you", 1, 0.25, 0.25 } end
  if diff >= 1 and diff >= hardAt - 2 then
    return { "Medium", diff .. (diff == 1 and " level" or " levels") .. " above you", 1, 0.82, 0 }
  end
  if kind == "rare" then return { "Medium", "rare", 1, 0.82, 0 } end
  if level <= Steps.GreyLevel(me) then return { "Easy", "no experience", 0.6, 0.6, 0.6 } end
  return { "Easy", nil, 0.25, 0.85, 0.25 }
end

-- Adds the line to the tooltip of the enemy under the mouse, once.
local function RateTooltip()
  if not (ER.db and not ER.db.rateOff) then return end
  if not UnitExists("mouseover") then return end
  local first = getglobal("GameTooltipTextLeft1")
  if not first or first:GetText() ~= UnitName("mouseover") then return end
  local lines = GameTooltip:NumLines() or 0
  for i = 2, lines do
    local line = getglobal("GameTooltipTextLeft" .. i)
    local text = line and line:GetText()
    if text == "Easy" or text == "Medium" or text == "Hard" then return end
  end
  local r = ER.RateEnemy("mouseover")
  if not r then return end
  -- Just the word, in its colour (the reason stays in ER.RateEnemy).
  GameTooltip:AddLine(r[1], r[3], r[4], r[5])
  GameTooltip:Show()
end

-- A frame inside the tooltip is shown each time the tooltip is, the way pfQuest adds its lines; the mouseover event
-- catches going straight from one enemy to the next, when the tooltip never hides in between.
local hook = CreateFrame("Frame", "EasyRouteTooltipHook", GameTooltip)
hook:SetScript("OnShow", RateTooltip)
hook:RegisterEvent("UPDATE_MOUSEOVER_UNIT")
hook:SetScript("OnEvent", function()
  if GameTooltip:IsVisible() then RateTooltip() end
end)

------------------------------------------------------------------------------------------------------
-- Events
------------------------------------------------------------------------------------------------------

local watch = CreateFrame("Frame", "EasyRouteAdapt")
watch:RegisterEvent("PLAYER_LEVEL_UP")
watch:RegisterEvent("TRAINER_SHOW")
watch:RegisterEvent("PLAYER_ENTERING_WORLD")
watch:SetScript("OnEvent", function()
  local a = Mine()
  if not a then return end
  if event == "PLAYER_LEVEL_UP" then
    OnLevelUp(tonumber(arg1) or (UnitLevel("player") or 1))
  elseif event == "TRAINER_SHOW" then
    a.trained = UnitLevel("player") or 1
    if ER.RemoveTip then ER.RemoveTip("trainer") end
  elseif event == "PLAYER_ENTERING_WORLD" then
    a.trained = a.trained or (UnitLevel("player") or 1)
  end
end)
watch.wait = 0
watch:SetScript("OnUpdate", function()
  this.wait = this.wait + arg1
  if this.wait < 2 then return end
  this.wait = 0
  if not (ER.db and ER.Steps and ER.Steps.Running() and ER.AddTip) then return end
  GuideTips()
end)

ER.Loaded("Adapt.lua")
