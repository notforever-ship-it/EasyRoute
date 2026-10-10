-- Easy Route: the advice. It watches how levelling goes and says what is worth knowing in the tips box
-- (Simple.lua), and it rates enemies on their tooltip.
--  * The guide leaves out quests too easy for you (Steps.lua); this says how many, now and then.
--  * Every 3 levels it asks how it is going; when you have outlevelled the guide, the same question asks whether to move on
--    (once per guide; nothing asks in between).
--  * Once per character it asks whether you have money on another character, to leave out the money-farming steps.
--  * At levels 10, 20, 30, 40, 50 and 60 it says what the level brings and to visit your class trainer (only then: the guide
--    sends you to the trainer at those levels only, Steps.lua).
--  * In simple mode (no step box) the warnings for the step you are on (a cave, dangerous enemies, "try to avoid ...") and
--    quests above your comfort show here too; with the step box they show in the box.
--  * Walking into a mine, cave or crypt while a guide runs says so once in the tips box.
--  * Enemies get Easy, Medium or Hard at the bottom of their tooltip: their level against yours and your difficulty,
--    elites, and the guide's warnings.

local ER = EasyRoute
local GOLD, GREY, WHITE, RED, GREEN, END = ER.GOLD, ER.GREY, ER.WHITE, ER.RED, ER.GREEN, ER.END

-- What is remembered per character: { money = true/false/nil (not asked), trained = level of the last trainer visit,
-- stay = { [guide key] = true } guides you chose to stay in, told = { [key] = true } things said once,
-- picked = { [guide key] = level } guides picked by hand from the guide list and the level then,
-- moved = { [guide key] = true } guides already asked about moving on,
-- shift = -2..2 (how you answered "how is it going"), asked = the last level mark asked about,
-- deaths = { [quest id] = deaths on it }, hard = { [quest id] = "died", "skip", "dropped" or "rated" } quests that count as Hard for you;
-- "dropped" is a quest skipped on its own (right-click, Skip quest), which the guide leaves out on every difficulty }.
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
  if type(a.deaths) ~= "table" then a.deaths = {} end
  if type(a.hard) ~= "table" then a.hard = {} end
  if type(a.picked) ~= "table" then a.picked = {} end
  if type(a.moved) ~= "table" then a.moved = {} end
  local shift = tonumber(a.shift) or 0
  a.shift = math.floor(math.max(-2, math.min(2, shift)))
  a.asked = tonumber(a.asked) or 0
  -- The level Easy Route first saw this character at: the check-in waits a few levels after it (CheckIn).
  if not tonumber(a.since) then a.since = UnitLevel("player") or 1 end
  return a
end

local function Tip(key, text, buttons, life)
  if ER.AddTip then ER.AddTip(key, text, buttons, life) end
end

local function Simple()
  return ER.SimpleShown and ER.SimpleShown()
end

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
    ". Kill a few mobs on the way first, or press Skip."
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
  local rating, why, reason
  if mine and mine.rating then
    rating = mine.rating
  else
    local learned = ER.LearnedHard(id)
    if learned == "died" then
      rating, reason = "hard", "you died twice on it"
    elseif learned == "skip" then
      rating, reason = "hard", "you skipped it"
    else
      local _
      rating, _, why = ER.Suggest(info)
      if string.find(ER.Steps.Kinds(id), "h", 1, true) then rating, reason = "hard", "friends found it hard" end
    end
  end
  local whose = mine and "your answer" or "my guess"
  if reason then whose = whose .. ": " .. reason end
  return {
    text = GREY .. "How hard: " .. END .. ER.Coloured(rating) .. GREY .. " (" .. whose .. ", click to change)" .. END,
    rate = { title = title, row = row, rating = rating, mine = mine and true or false, why = why, id = id },
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
  local a = Mine()
  if a and r.id then
    if rating == "hard" then
      a.hard[r.id] = a.hard[r.id] or "rated"
    elseif a.hard[r.id] == "rated" then
      a.hard[r.id] = nil
    end
  end
end

------------------------------------------------------------------------------------------------------
-- Check-in every 3 levels, with "you are ahead of this zone" when the guide is behind you
------------------------------------------------------------------------------------------------------

local MARK_STEP, MARK_FIRST, MARK_LAST = 3, 6, 57 -- asked at levels 6, 9, 12 ... 57
local CHECKIN_WAIT = 3 -- levels played with Easy Route before the first check-in
local SHIFT_MAX = 2        -- the comfort line moves at most this far either way
local ASK_LIFE = 300       -- seconds the question waits; no answer changes nothing
local CONFIRM_LIFE = 10

-- How many levels the comfort line moves for this character: the sum of the answers, -2 to +2.
function ER.AdaptShift()
  local a = Mine()
  return a and a.shift or 0
end

-- The level mark to ask about, or nil: the highest mark at or below your level that was not asked yet.
local function DueMark(level, asked)
  local m = math.floor(level / MARK_STEP) * MARK_STEP
  if m < MARK_FIRST or m > MARK_LAST or m <= asked then return nil end
  return m
end

local function Levels(n) return n .. (n == 1 and " level" or " levels") end

local function Confirm(lead)
  Tip("checkin:ok", lead .. "quests up to " .. Levels(ER.Steps.Comfort()) .. " above you.", nil, CONFIRM_LIFE)
end

-- The next harder (up) or easier difficulty than the one you are on; nil at the end of the list.
local function NeighbourMode(up)
  local now = ER.Mode()
  for i, key in ipairs(ER.MODE_ORDER) do
    if key == now then return ER.MODE_ORDER[i + (up and 1 or -1)] end
  end
  return nil
end

local function Answer(delta)
  local a = Mine()
  if not a then return end
  ER.RemoveTip("checkin")
  local new = math.max(-SHIFT_MAX, math.min(SHIFT_MAX, a.shift + delta))
  local key = delta ~= 0 and new == a.shift and NeighbourMode(delta > 0)
  if key then
    local label = ER.MODES[key].label
    Tip("checkin", "Try " .. label .. "?", {
      { label = "Switch", fn = function()
        ER.RemoveTip("checkin")
        a.shift = 0
        ER.SetMode(key, true)
        Confirm("Got it: " .. label .. " from now on, ")
      end },
      { label = "No", fn = function() ER.RemoveTip("checkin") end },
    }, ASK_LIFE)
    return
  end
  a.shift = new
  Confirm("Got it: ")
  if ER.Steps.Running() then
    ER.Steps.Check()
    if ER.StepsChanged then ER.StepsChanged() end
  end
end

-- The guide to move on to when the one you follow is behind you, and that guide's key; nil when there is nothing to ask. Asked at most once
-- per guide per character (moved), never again after "Stay here" (stay; also under the guide's older name that began with "RestedXP ").
-- A guide picked by hand from the guide list waits until you are 2 levels past the level you picked it at.
local function MoveOnTo(a)
  local Steps = ER.Steps
  if not Steps.Outlevelled() then return nil end
  local info = Steps.Info()
  local key = Steps.Key(info)
  if a.stay[key] or a.stay["RestedXP " .. key] or a.moved[key] then return nil end
  local level = UnitLevel("player") or 1
  local picked = tonumber(a.picked[key])
  if picked and level < picked + 2 then return nil end
  local nxt = Steps.NextGuide()
  if not nxt or level >= nxt.hi + 2 then nxt = Steps.Suggest()[1] end
  if not nxt or nxt == info then return nil end
  return nxt, key
end

-- "You are ahead of this zone" with Move on and Stay here, under the check-in (or on its own when the check-in is off).
local function OfferMove(a)
  local nxt, key = MoveOnTo(a)
  if not nxt then return end
  a.moved[key] = true
  Tip("checkin:move", "You are ahead of this zone.", {
    { label = "Move on", fn = function() ER.StartGuide(ER.Steps.Key(nxt)) end },
    { label = "Stay here", fn = function() a.stay[key] = true end },
  }, ASK_LIFE)
end

local function Busy()
  return UnitAffectingCombat("player") or UnitIsDeadOrGhost("player") or UnitOnTaxi("player")
end

-- Nothing asks between check-ins. With the check-in tick off, only the move-on line comes (once per guide); with the tips hidden, nothing.
local function CheckIn(a)
  local level = UnitLevel("player") or 1
  -- Not at the start: only once you have played a few levels with Easy Route.
  if level < a.since + (ER.checkinWait or CHECKIN_WAIT) then return end
  local m = DueMark(level, a.asked)
  if ER.db.tipsOff then
    if m then a.asked = m end
    return
  end
  if ER.db.checkinOff then
    if m then a.asked = m end
    if not Busy() then OfferMove(a) end
    return
  end
  if not m or Busy() then return end
  a.asked = m
  OfferMove(a)
  Tip("checkin", "Level " .. m .. ": how is it going?", {
    { label = "Too easy", fn = function() Answer(1) end },
    { label = "About right", fn = function() Answer(0) end },
    { label = "Too hard", fn = function() Answer(-1) end },
    { label = "Not now", fn = function() ER.RemoveTips("checkin") end },
  }, ASK_LIFE)
end

-- Called by ER.StartGuide: a guide picked by hand from the guide list remembers the level it was picked at; any other start forgets it.
function ER.GuideStarted(key, byHand)
  local a = Mine()
  if not a or not key then return end
  a.picked[key] = byHand and (UnitLevel("player") or 1) or nil
end

------------------------------------------------------------------------------------------------------
-- Learning from deaths and skips
------------------------------------------------------------------------------------------------------

local DEATHS_HARD = 2     -- deaths on one quest before it counts as Hard for you
local SKIP_TIP_LIFE = 20
local DIED_TIP_LIFE = 300

-- Quest ids in the steps (the current one and the side steps) on the lines of these kinds that are not done yet.
local function Unfinished(steps, kinds)
  local out, seen = {}, {}
  for _, step in ipairs(steps) do
    for _, e in ipairs(step.elements) do
      local id = tonumber(e.id)
      if id and id ~= 0 and string.find(kinds, e.kind, 1, true) and not seen[id] and ER.Steps.ElementDone(step, e) == false then
        seen[id] = true
        table.insert(out, id)
      end
    end
  end
  return out
end

-- Is quest id worked on (a C or K line) in this step?
local function OnStep(step, id)
  if not step then return false end
  for _, e in ipairs(step.elements) do
    if (e.kind == "C" or e.kind == "K") and tonumber(e.id) == id then return true end
  end
  return false
end

local function OnDeath()
  local Steps = ER.Steps
  if not Steps.Running() or (IsInInstance and IsInInstance()) then return end
  local a = Mine()
  if not a then return end
  local steps = { Steps.Current() }
  for _, s in ipairs(Steps.Side()) do table.insert(steps, s) end
  for _, id in ipairs(Unfinished(steps, "CK")) do
    local row = Steps.InLog(id)
    if row and not row.complete then
      a.deaths[id] = (tonumber(a.deaths[id]) or 0) + 1
      if a.deaths[id] >= DEATHS_HARD and not a.hard[id] then
        a.hard[id] = "died"
        Tip("died:" .. id, "You died twice on " .. (Steps.QuestTitle(id) or "this quest") ..
          ". I will count it as Hard from now on. You can abandon it in your quest log.", {
            { label = "Skip it", fn = function()
              ER.RemoveTip("died:" .. id)
              -- Only the quest you died on: the step moves on when that quest is still on the step you are on (a plain page
              -- on, so the step's other quests are not marked). The quest itself is already marked Hard ("died").
              if Steps.Running() and OnStep(Steps.Current(), id) then Steps.Next() end
            end },
            { label = "Keep going", fn = function() ER.RemoveTip("died:" .. id) end },
          }, DIED_TIP_LIFE)
      end
    end
  end
end

-- "A", "A and B", "A, B and C"
local function JoinTitles(list)
  local n = table.getn(list)
  if n == 1 then return list[1] end
  return table.concat(list, ", ", 1, n - 1) .. " and " .. list[n]
end

-- A step left before it was done: the quests it picks up or works on count as Hard for you from now on.
function ER.OnStepSkipped(step)
  local a = Mine()
  if not a then return end
  local titles = {}
  for _, id in ipairs(Unfinished({ step }, "ACK")) do
    if not a.hard[id] then
      a.hard[id] = "skip"
      table.insert(titles, ER.Steps.QuestTitle(id) or ("quest " .. id))
    end
  end
  if table.getn(titles) > 0 then
    -- Hard keeps quests that are Hard for you, so there it only says what it noted.
    local head = (ER.Mode and ER.Mode() == "hard") and "Marked as hard for you: " or "Left out from now on: "
    Tip("skip", head .. JoinTitles(titles) .. " (you skipped them).", nil, SKIP_TIP_LIFE)
  end
end

-- Why a quest counts as Hard for you: "died", "skip" (also for a quest skipped on its own) or "rated" (you rated it Hard yourself); nil
-- when it does not.
function ER.LearnedHard(id)
  local a = Mine()
  id = tonumber(id)
  if not a or not id then return nil end
  if a.hard[id] == "died" or a.hard[id] == "skip" then return a.hard[id] end
  if a.hard[id] == "dropped" then return "skip" end
  local title = ER.Steps and ER.Steps.QuestTitle(id)
  local mine = title and ER.GetRating and ER.GetRating(title, id)
  if mine and mine.rating == "hard" then return "rated" end
  return nil
end

------------------------------------------------------------------------------------------------------
-- Skipping one quest
------------------------------------------------------------------------------------------------------

-- A quest skipped on its own ("dropped"). Read straight from the saved table: Steps.lua asks this for every quest of every step.
local function Dropped(id)
  local all = ER.db and ER.db.adapt
  local a = type(all) == "table" and all[ER.Char()]
  return type(a) == "table" and type(a.hard) == "table" and a.hard[tonumber(id) or 0] == "dropped"
end

-- Steps.lua asks ER.RouteLeftOut first about every quest (RouteRun.lua answers it for the casual route). A quest skipped on its own is left
-- out on every difficulty and in every guide, so the answer is widened here.
local routeLeftOut = ER.RouteLeftOut
function ER.RouteLeftOut(id)
  if Dropped(id) then return true end
  if routeLeftOut then return routeLeftOut(id) end
  return false
end

-- The line of a quest in your quest log, by its title (tidied, so case and spaces do not matter); nil when it is not there.
local function LogLine(title)
  local want = ER.Steps.NormTitle(title)
  if want == "" then return nil end
  for i = 1, GetNumQuestLogEntries() or 0 do
    local t, _, _, header = GetQuestLogTitle(i)
    if t and not header and ER.Steps.NormTitle(t) == want then return i end
  end
  return nil
end
ER.QuestLogLine = LogLine

-- "Skip quest" from the right-click menu (Simple.lua): that one quest is left out of the guide from now on and counts as Hard for you;
-- /er unskip brings it back. The guide waits for any quest still in your log, so a quest you have is abandoned there too.
-- id may be nil for a quest only the quest log knows. true when it was skipped.
function ER.SkipOneQuest(id, title)
  local a = Mine()
  local Steps = ER.Steps
  if not a or not Steps then return false end
  id = tonumber(id)
  if id == 0 then id = nil end
  title = title or (id and Steps.QuestTitle(id))
  if not id and not title then return false end
  if id then a.hard[id] = "dropped" end
  local line = title and LogLine(title)
  if line and SelectQuestLogEntry and SetAbandonQuest and AbandonQuest then
    SelectQuestLogEntry(line)
    SetAbandonQuest()
    AbandonQuest()
  end
  Tip("skip", "Skipped " .. GOLD .. (title or "that quest") .. END .. ". It counts as Hard for you. " .. GOLD .. "/er unskip" .. END ..
    " brings it back.", nil, SKIP_TIP_LIFE)
  if Steps.Running() then Steps.Check() end
  return true
end

------------------------------------------------------------------------------------------------------
-- Why this step
------------------------------------------------------------------------------------------------------

-- The grey "Why:" line under the step you are on is for new players: it shows up to this level.
local WHY_MAX_LEVEL = 20
local WHY_AHEAD = 3        -- steps after a walk that are looked at for where the next quests are
local FOLLOW_AHEAD = 10    -- steps after a hand-in that are looked at for the quest it opens
local PLACE_MAX = 30       -- a giver's place longer than this is a sentence in the data, not a name

-- Where the giver of a quest stands, from Data\Quests.lua: { [faction] = { [quest id] = place } }, made once per faction.
local placeOf = {}
local function GiverPlace(id)
  local faction = UnitFactionGroup("player") or "Alliance"
  local map = placeOf[faction]
  if not map then
    map = {}
    local guides = type(EasyRoute_Quests) == "table" and EasyRoute_Quests[faction]
    for _, g in ipairs(type(guides) == "table" and guides or {}) do
      for _, q in ipairs(type(g.quests) == "table" and g.quests or {}) do
        local p = q.place
        if q.id and not map[q.id] and type(p) == "string" and p ~= "" and string.len(p) <= PLACE_MAX and not string.find(p, ".", 1, true) then
          map[q.id] = p
        end
      end
    end
    placeOf[faction] = map
  end
  return map[tonumber(id) or 0]
end

-- The quests of the chain a quest starts on your race's path (Data\Chains.lua), in order; nil when it starts none. Made once per race.
local chainsOf = {}
local function ChainFrom(id)
  local data = EasyRoute_Chains
  if type(data) ~= "table" or type(data.chains) ~= "table" or type(data.races) ~= "table" then return nil end
  if not (ER.RouteReader and ER.RouteReader.ReadChain) then return nil end
  local info = ER.Steps.Info()
  local race = info and info.race
  if not race then
    local _, r = UnitRace("player")
    race = r
  end
  if race == "Undead" then race = "Scourge" end
  if not race then return nil end
  local map = chainsOf[race]
  if not map then
    map = {}
    local list = data.races[race]
    for numText in string.gfind(type(list) == "string" and list or "", "[^,]+") do
      local read = ER.RouteReader.ReadChain(data.chains[tonumber(numText)])
      local first = read and read.steps[1]
      if first and not map[first.id] then
        local ids = {}
        for _, s in ipairs(read.steps) do table.insert(ids, s.id) end
        map[first.id] = ids
      end
    end
    chainsOf[race] = map
  end
  return map[tonumber(id) or 0]
end

-- The last quest of the chain a pick-up starts that the guide keeps for you; nil when there is no chain of 3 or more kept quests.
local function ChainEnd(id)
  local Steps = ER.Steps
  local ids = ChainFrom(id)
  if not ids or Steps.InLog(id) or Steps.TurnedIn(id) or Steps.LeftOut(id) then return nil end
  for i = table.getn(ids), 3, -1 do
    if not Steps.LeftOut(ids[i]) then return ids[i] end
  end
  return nil
end

-- Does a quest the guide picks up soon follow this one (it is only offered once this one is handed in)?
local function OpensNext(step, id)
  local Steps = ER.Steps
  local steps = { step }
  for _, s in ipairs(Steps.Upcoming(FOLLOW_AHEAD)) do table.insert(steps, s) end
  for _, s in ipairs(steps) do
    for _, e in ipairs(s.elements) do
      local row = e.kind == "A" and e.id and ER.QuestRow and ER.QuestRow(e.id)
      if row and row.p == id and not Steps.LeftOut(e.id) then return true end
    end
  end
  return false
end

local function SameName(a, b)
  return a and b and string.lower(a) == string.lower(b)
end

-- One short reason for the step you are on, from what the data knows: "Why: hand it in for xp", "Why: the next quests are in Brill" ...
-- nil above WHY_MAX_LEVEL, for a grind step (Grind.lua says why already), and whenever there is no sure reason.
function ER.WhyLine(step)
  local Steps = ER.Steps
  if not Steps or type(step) ~= "table" or type(step.elements) ~= "table" then return nil end
  if (UnitLevel("player") or 1) > WHY_MAX_LEVEL then return nil end
  if step.flags and step.flags.grind then return nil end
  local accepts, hands, busy, goes = {}, {}, false, false
  for _, e in ipairs(step.elements) do
    local k = e.kind
    local id = tonumber(e.id)
    if k == "G" or k == "F" or k == "Z" or k == "H" then goes = true end
    if id and id ~= 0 and Steps.Line(step, e) and Steps.ElementDone(step, e) == false then
      if k == "A" then table.insert(accepts, id)
      elseif k == "T" then table.insert(hands, id)
      elseif k == "C" or k == "K" then busy = true end
    end
  end
  if table.getn(hands) > 0 then
    for _, id in ipairs(hands) do
      if OpensNext(step, id) then return "Why: hand it in to get the next quest." end
    end
    return table.getn(hands) > 1 and "Why: hand them in for xp." or "Why: hand it in for xp."
  end
  for _, id in ipairs(accepts) do
    local last = ChainEnd(id)
    local title = last and Steps.QuestTitle(last)
    if title then return "Why: starts a chain that ends with " .. title .. "." end
  end
  if table.getn(accepts) > 1 then return "Why: pick them all up now, it saves walking back later." end
  if table.getn(accepts) > 0 or busy or not goes then return nil end
  -- A walk: where the quests after it are picked up.
  for _, s in ipairs(Steps.Upcoming(WHY_AHEAD)) do
    local place, count = nil, 0
    for _, e in ipairs(s.elements) do
      local p = e.kind == "A" and e.id and Steps.Line(s, e) and GiverPlace(e.id)
      if p and (not place or p == place) then
        place, count = p, count + 1
      end
    end
    if place then
      if SameName(place, GetZoneText()) or SameName(place, GetSubZoneText and GetSubZoneText()) then return nil end
      return count > 1 and ("Why: the next quests are in " .. place .. ".") or ("Why: the next quest is in " .. place .. ".")
    end
  end
  return nil
end

------------------------------------------------------------------------------------------------------
-- Looking every few seconds while a guide runs
------------------------------------------------------------------------------------------------------

local lastStep, easyTotal = nil, 0

-- A warning line with the gold colour on its "Heads up:" words.
local function ColourHeadsUp(line)
  if string.sub(line, 1, 9) == "Heads up:" then return GOLD .. "Heads up: " .. END .. string.sub(line, 11) end
  return GOLD .. line .. END
end

local function StepTips()
  local Steps = ER.Steps
  local cur = Steps.Current()
  local key = (Simple() and "list:" or "box:") .. (cur and cur.n or 0)
  for _, s in ipairs(Steps.Side()) do key = key .. "+" .. s.n end
  local warnOff = ER.db and ER.db.warnOff
  if warnOff then key = key .. ":nowarn" end
  if key == lastStep then return end
  lastStep = key
  ER.RemoveTips("warn:")
  ER.RemoveTips("hard:")
  ER.RemoveTips("chain:")
  -- With the step box up these are in the box already.
  if not Simple() then return end
  for i, w in ipairs(warnOff and {} or Steps.Warnings()) do
    if i > 2 then break end
    Tip("warn:" .. i, ColourHeadsUp(w.line))
  end
  if cur then
    local id, title, level = HardQuest(cur)
    if id then
      Tip("hard:" .. id, RED .. "Hard for your level: " .. END .. title .. " is level " .. level .. ", you are " ..
        (UnitLevel("player") or 1) .. ". Kill a few mobs on the way first, or press Skip.")
    end
    local chain = ER.ChainLine and ER.ChainLine(cur)
    if chain then Tip("chain:" .. cur.n, GREY .. chain .. END) end
  end
end

local function GuideTips()
  local Steps = ER.Steps
  local a = Mine()
  if not a then return end
  -- Quests left out for being too easy.
  local n = Steps.TakeEasySkipped()
  if n > 0 then
    easyTotal = easyTotal + n
    Tip("easy", "Left out " .. easyTotal .. " quest" .. (easyTotal == 1 and "" or "s") ..
      " that give next to no xp at your level.", nil, 20)
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
  [50] = { all = "New ranks of your best spells." },
  [60] = { all = "The top level: your last spell ranks are ready." },
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
  if level <= Steps.GreyLevel(me) then return { "Easy", "no xp", 0.6, 0.6, 0.6 } end
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
-- Caves you walk into
------------------------------------------------------------------------------------------------------

local CAVE_TIP_LIFE = 30 -- seconds the heads-up stays in the tips box

-- Lower-case sub-zone name -> "mine", "crypt" or "cave", built once from DataSurvival.lua (every zone's lines are "name, a tab, word").
local caveMap
local function CaveMap()
  if caveMap then return caveMap end
  caveMap = {}
  local zones = type(EasyRoute_Survival) == "table" and EasyRoute_Survival.caves
  if type(zones) ~= "table" then return caveMap end
  for _, lines in pairs(zones) do
    if type(lines) == "string" then
      for line in string.gfind(lines, "[^\n]+") do
        local _, _, name, word = string.find(line, "^(.-)\t(.+)$")
        local key = name and string.lower(name)
        if key and not caveMap[key] then caveMap[key] = word end
      end
    end
  end
  return caveMap
end

-- The sub-zone you are in, from the zone text or else the minimap's.
local function SubZone()
  local sub = GetSubZoneText and GetSubZoneText()
  if (not sub or sub == "") and GetMinimapZoneText then sub = GetMinimapZoneText() end
  return sub or ""
end

-- The place you were in at the last look, and when you were last seen in each cave. The heads-up comes when you walk into a cave you
-- have not been in for CAVE_AGAIN seconds: stepping out of the mouth and back in, or questing in and out, says nothing more. Never
-- on a flight (the taxi flies over mines).
local CAVE_AGAIN = 600
local lastCaveSub
local caveSeen = {}
local function CaveWatch()
  if UnitOnTaxi and UnitOnTaxi("player") then return end
  local sub = SubZone()
  local word = sub ~= "" and CaveMap()[string.lower(sub)]
  if not word then
    lastCaveSub = sub
    return
  end
  local now, seen = GetTime(), caveSeen[sub]
  caveSeen[sub] = now
  if sub == lastCaveSub then return end
  lastCaveSub = sub
  if seen and now - seen < CAVE_AGAIN then return end
  if ER.Steps and ER.Steps.CaveLine then
    Tip("cave:" .. sub, ColourHeadsUp(ER.Steps.CaveLine(word)), nil, CAVE_TIP_LIFE)
  end
end

------------------------------------------------------------------------------------------------------
-- Events
------------------------------------------------------------------------------------------------------

local watch = CreateFrame("Frame", "EasyRouteAdapt")
watch:RegisterEvent("PLAYER_LEVEL_UP")
watch:RegisterEvent("TRAINER_SHOW")
watch:RegisterEvent("PLAYER_ENTERING_WORLD")
watch:RegisterEvent("PLAYER_DEAD")
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
  elseif event == "PLAYER_DEAD" then
    OnDeath()
  end
end)
watch.wait = 0
watch:SetScript("OnUpdate", function()
  this.wait = this.wait + arg1
  if this.wait < 2 then return end
  this.wait = 0
  if not (ER.db and ER.Steps and ER.Steps.Running() and ER.AddTip) then
    lastCaveSub = nil
    return
  end
  CaveWatch()
  GuideTips()
  local a = Mine()
  if a then CheckIn(a) end
end)

ER.Loaded("Adapt.lua")
