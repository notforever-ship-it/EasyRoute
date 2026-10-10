-- Easy Route: a relaxed leveling guide for the 1.12 client: one step at a time in a box on the right, and an arrow on
-- screen. This file holds what every other file uses: the colours, the journal, the ratings, the saved settings and
-- the /er command.

EasyRoute = {}
local ER = EasyRoute
ER.VERSION = "0.9.3"

-- Each file of the addon calls ER.Loaded("<its name in EasyRoute.toc>") on its last line, so the login check knows which
-- files the game really ran.
ER.loaded = {}
function ER.Loaded(name) ER.loaded[name] = true end

local GOLD, GREY, WHITE, RED, GREEN, ORANGE, END = "|cffffd100", "|cff9d9d9d", "|cffffffff", "|cffff4040", "|cff40ff40", "|cffff8000", "|r"
ER.GOLD, ER.GREY, ER.WHITE, ER.RED, ER.GREEN, ER.ORANGE, ER.END = GOLD, GREY, WHITE, RED, GREEN, ORANGE, END

-- The four answers to "how was this quest?", in the order they appear on buttons.
ER.RATINGS = {
  { key = "easy",   label = "Easy",   colour = GREEN,  tip = "Relaxed. A casual player can do this alone without stress." },
  { key = "medium", label = "Medium", colour = WHITE,  tip = "Fine. Takes some care, but nothing that spoils the evening." },
  { key = "hard",   label = "Hard",   colour = ORANGE, tip = "Stressful, dangerous or annoying alone. The guide will warn about it, delay it, or suggest a partner." },
  { key = "skip",   label = "Skip",   colour = RED,    tip = "Not worth doing. The guide will leave it out." },
}

-- Extra details that explain a Hard or Skip. Tick as many as fit.
ER.TAGS = {
  { key = "nocombat", label = "No combat",    tip = "Talk, deliver, explore, pick things up. Nothing to kill. The most relaxing kind of quest, and the guide likes to know." },
  { key = "solo",    label = "Better solo",   tip = "Pick-up or gather quest: a group only competes for the same spawns. Do it on your own." },
  { key = "coop",    label = "Better coop",   tip = "Kill quest with shared credit or shared drops: faster and safer with a friend along." },
  { key = "group",   label = "Needs a group", tip = "Too much for one player. Bring a friend, or come back a few levels later." },
  { key = "crowded", label = "Crowded",       tip = "Mobs packed close together. You pull two or three when you wanted one." },
  { key = "cave",    label = "Cave",          tip = "Indoors or underground. Hard to run away, easy to get cornered." },
  { key = "walk",    label = "Long walk",     tip = "Too much travel for what it gives." },
}

local DEFAULTS = {
  minimapAngle = 200,
  minimapHidden = false,
  autoPrompt = false,     -- the tester tick "Ask me how hard each quest was"
  partyAnnounce = false,  -- say in party chat when you hand a quest in (a tester option, off unless ticked)
  chainPopup = false,     -- a small popup when you pick up the first quest of a chain (a tester option)
}

local MAX_JOURNAL = 4000

function ER.Print(msg)
  if DEFAULT_CHAT_FRAME then
    DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99Easy Route:|r " .. msg)
  end
end

function ER.Trim(s)
  if type(s) ~= "string" then return "" end
  s = string.gsub(s, "^%s+", "")
  s = string.gsub(s, "%s+$", "")
  return s
end

function ER.RatingInfo(key)
  for _, r in ipairs(ER.RATINGS) do
    if r.key == key then return r end
  end
  return nil
end

function ER.Coloured(key)
  local r = ER.RatingInfo(key)
  if not r then return GREY .. "not rated" .. END end
  return r.colour .. r.label .. END
end

------------------------------------------------------------------------------------------------------
-- Who, where, when
------------------------------------------------------------------------------------------------------

function ER.Char()
  return (UnitName("player") or "?") .. "-" .. (GetRealmName() or "?")
end

function ER.ClassRace()
  local _, class = UnitClass("player")
  local race = UnitRace("player")
  return class, race
end

-- Zone, subzone and map position as 0-100 with one decimal, like the numbers people share.
-- Setting the map to your zone makes the map (and pfQuest's map pins) redraw, and doing that ten times a second for
-- the arrow made the game hitch, so the camera jumped when turning with the mouse. Now only when the map may be on
-- another zone: after a zone change, after the world map was open, when it gives no position, or every few seconds.
local mapZone, mapAt, mapWasOpen
function ER.Where()
  local now = GetTime()
  if WorldMapFrame and WorldMapFrame:IsVisible() then
    mapWasOpen = true
  else
    local zone = GetZoneText() or ""
    local x, y = GetPlayerMapPosition("player")
    local nowhere = (x or 0) == 0 and (y or 0) == 0
    if mapWasOpen or zone ~= mapZone or not mapAt or now < mapAt or now - mapAt > 5 or (nowhere and now - mapAt > 1) then
      SetMapToCurrentZone()
      mapZone, mapAt, mapWasOpen = zone, now, false
    end
  end
  local x, y = GetPlayerMapPosition("player")
  x = math.floor((x or 0) * 1000 + 0.5) / 10
  y = math.floor((y or 0) * 1000 + 0.5) / 10
  return GetZoneText() or "", GetSubZoneText() or "", x, y
end

function ER.WhereText()
  local zone, sub, x, y = ER.Where()
  local place = zone
  if sub ~= "" and sub ~= zone then place = place .. ", " .. sub end
  return place .. " (" .. x .. ", " .. y .. ")"
end

-- One line in the journal. Every line carries the character, level, time and place, so the guide
-- can be read back later as "who was where, at what level, when this happened".
function ER.Log(kind, fields)
  local entry = fields or {}
  entry.t = kind
  entry.char = ER.Char()
  entry.plevel = entry.plevel or UnitLevel("player")
  entry.time = time()
  entry.when = date("%Y-%m-%d %H:%M")
  local zone, sub, x, y = ER.Where()
  entry.zone, entry.sub, entry.x, entry.y = zone, sub, x, y
  table.insert(ER.db.journal, entry)
  while table.getn(ER.db.journal) > MAX_JOURNAL do
    table.remove(ER.db.journal, 1)
  end
  return entry
end

------------------------------------------------------------------------------------------------------
-- Ratings
------------------------------------------------------------------------------------------------------

-- What the addon would answer on its own, right now. In order: the quest's Group or Elite tag,
-- deaths and close calls (health under 30%) while it was in your log, then its level next to yours
-- using the game's own colours (green, yellow, orange, red). A quest well below your level is
-- only "easy" until the mobs come in packs, which is what the close calls are there to catch.
-- Returns rating, tags, reason, and which rule decided (tag, deaths, close, nolevel, red, orange,
-- yellow, closeone, green), for the advice below.
function ER.Suggest(info)
  info = info or {}
  local tags = {}
  local tag = string.lower(info.tag or "")
  -- The level you did it at, when known; otherwise the level you are now.
  local plevel = info.donelevel or info.plevel or UnitLevel("player") or 1
  local deaths = info.deaths or 0
  local close = info.close or 0
  if string.find(tag, "group", 1, true) or string.find(tag, "elite", 1, true)
    or string.find(tag, "dungeon", 1, true) or string.find(tag, "raid", 1, true) then
    tags.group = true
    return "hard", tags, "it is a " .. info.tag .. " quest", "tag"
  end
  if deaths > 0 then
    return "hard", tags, "you died " .. (deaths == 1 and "once" or (deaths .. " times")) .. " while it was in your log", "deaths"
  end
  if close >= 2 then
    return "hard", tags, "you nearly died " .. close .. " times while it was in your log", "close"
  end
  if not info.qlevel then
    return "medium", tags, "it has no level to go on", "nolevel"
  end
  local diff = info.qlevel - plevel
  if diff >= 5 then
    return "hard", tags, "it is " .. diff .. " levels above you (red)", "red"
  elseif diff >= 3 then
    return "hard", tags, "it is " .. diff .. " levels above you (orange)", "orange"
  elseif diff >= -2 then
    return "medium", tags, "it is about your level (yellow)", "yellow"
  end
  if close == 1 then
    return "medium", tags, "it is " .. (-diff) .. " levels below you, but you still got low on health once", "closeone"
  end
  return "easy", tags, "it is " .. (-diff) .. " levels below you (green). Packs of them? Then say Hard", "green"
end

-- The guess said as advice: "Hard for you at level 12: it is 3 levels above you. Sure you want it now?
-- Fine at level 13, easy at 18." A hard quest that is part of a chain gets its step, since that can
-- be a reason to do it anyway. Returns rating, advice.
function ER.Advice(info, step, total)
  info = info or {}
  local rating, _, why, kind = ER.Suggest(info)
  local plevel = info.donelevel or info.plevel or UnitLevel("player") or 1
  local q = info.qlevel or plevel
  local text
  if kind == "red" or kind == "orange" then
    text = "Hard for you at level " .. plevel .. ": it is " .. (q - plevel) .. " levels above you. Sure you want it now? " ..
      "Fine at level " .. (q - 2) .. ", easy at " .. (q + 3) .. "."
  elseif kind == "tag" then
    text = "Hard: it is a " .. (info.tag or "group") .. " quest. Bring a friend, or leave it for now."
  elseif kind == "deaths" or kind == "close" then
    text = "Hard: " .. why .. ". Leave it a few levels, or bring a friend."
  elseif kind == "nolevel" then
    text = "No level to go on, so medium until you say otherwise."
  elseif kind == "closeone" then
    text = "Below your level, but you still got low on health once. Fine with some care."
  elseif kind == "yellow" then
    text = "About your level. Fine with some care."
  else
    text = "Easy at your level, go for it. Packs of mobs? Then say Hard."
  end
  if rating == "hard" and step and total then
    text = text .. " Might still be worth it: step " .. step .. " of " .. total .. " in a chain."
  end
  return rating, text
end

-- Words that stay the same in the plural, and words that change more than an s.
local SAME = { vermin = true, sheep = true, deer = true, fish = true, moose = true, swine = true, bison = true,
  offspring = true, spawn = true, kin = true, remains = true, meat = true, flesh = true, dust = true, ore = true,
  cloth = true, water = true, wood = true, blood = true, sand = true, silk = true, leather = true, ash = true,
  salt = true, oil = true, powder = true, venom = true, ichor = true, slime = true, grain = true, honey = true,
  milk = true, mud = true, dirt = true, moss = true, grass = true, kelp = true, wool = true, iron = true,
  copper = true, tin = true, silver = true, gold = true, mithril = true, thorium = true, coal = true, fungus = true,
  bark = true, sap = true, resin = true, poison = true, essence = true, mead = true, ale = true, wine = true }
local IRREGULAR = { wolf = "Wolves", thief = "Thieves", leaf = "Leaves", hoof = "Hooves", calf = "Calves",
  man = "Men", woman = "Women", child = "Children", foot = "Feet", tooth = "Teeth", mouse = "Mice", goose = "Geese",
  ox = "Oxen", elf = "Elves", knife = "Knives", loaf = "Loaves", scarf = "Scarves", half = "Halves", wharf = "Wharves" }

-- "Torn Murloc Fin", 8 -> "Torn Murloc Fins". Only the last word changes.
function ER.Plural(name, n)
  if not n or n == 1 then return name end
  local _, _, head, last = string.find(name, "^(.*%s)(%S+)$")
  if not last then head, last = "", name end
  local lower = string.lower(last)
  if SAME[lower] then return name end
  local irregular = IRREGULAR[lower]
  if irregular then
    if string.sub(last, 1, 1) == string.lower(string.sub(last, 1, 1)) then irregular = string.lower(irregular) end
    return head .. irregular
  end
  local one, two = string.sub(lower, -1), string.sub(lower, -2)
  if one == "s" or one == "x" or one == "z" or two == "ch" or two == "sh" then return name .. "es" end
  if one == "y" and not string.find(string.sub(lower, -2, -2), "[aeiou]") then return head .. string.sub(last, 1, -2) .. "ies" end
  return name .. "s"
end

-- An objective as a sentence: "Collect 8 Torn Murloc Fins", "Kill 6 Riverpaw Gnolls", and "Speak with
-- Marshal Dughan" as it is. kind is what the game calls it (item, monster, object, event), when known.
-- have: how many so far, for a quest still in the log.
function ER.Phrase(name, need, kind, have)
  if not need then return name end
  local verb = "Collect"
  local _, _, mob = string.find(name, "^(.-)%s+slain$")
  if mob then
    name, verb = mob, "Kill"
  elseif kind == "monster" then
    verb = "Kill"
  elseif kind == "object" then
    verb = "Find"
  end
  local text = verb .. " " .. need .. " " .. ER.Plural(name, need)
  if have and have < need then text = text .. " (" .. have .. " so far)" end
  return text
end

-- The objectives the way you want to remember them: "Torn Murloc Fin: 3/8" becomes "Collect 8 Torn
-- Murloc Fins", and lines without a count ("Speak with Marshal Dughan") stay as they are.
function ER.ObjectiveLines(obj)
  local lines = {}
  if type(obj) ~= "table" then return lines end
  for _, line in ipairs(obj) do
    local _, _, name, total = string.find(line, "^(.-):%s*%d+%s*/%s*(%d+)%s*$")
    if name and name ~= "" then
      table.insert(lines, ER.Phrase(name, tonumber(total)))
    elseif line ~= "" then
      table.insert(lines, line)
    end
  end
  return lines
end

-- "25 min", "3 h" or "2 days": how long a quest sat in the log, in words that stay sensible.
function ER.Span(mins)
  if not mins or mins <= 0 then return nil end
  if mins < 120 then return mins .. " min" end
  if mins < 48 * 60 then return math.floor(mins / 60 + 0.5) .. " h" end
  return math.floor(mins / 1440 + 0.5) .. " days"
end

function ER.ObjectiveSummary(obj)
  local lines = ER.ObjectiveLines(obj)
  if table.getn(lines) == 0 then return nil end
  return table.concat(lines, ", ")
end

-- Ratings are kept by quest title. A chain that uses one title for several quests in a row (the
-- paladin's "Tome of Divinity") tells them apart by pfQuest's quest id: the first keeps the plain
-- title as its key, the others get the id after it.
function ER.RatingKey(title, pfid)
  if not title or not pfid then return title end
  local plain = ER.db.ratings[title]
  if plain and plain.pfid and plain.pfid ~= pfid then return title .. " [" .. pfid .. "]" end
  return title
end

function ER.GetRating(title, pfid)
  if not title then return nil end
  return ER.db.ratings[ER.RatingKey(title, pfid)]
end

-- Saves your answer for a quest. Rating again replaces the old answer; the journal keeps both.
function ER.SetRating(title, rating, tags, note, info)
  if not title or title == "" or not ER.RatingInfo(rating) then return end
  info = info or {}
  local class, race = ER.ClassRace()
  local zone, sub, x, y = ER.Where()
  local key = ER.RatingKey(title, info.pfid)
  local old = ER.db.ratings[key]
  -- The level you did the quest at. A level you typed yourself wins over what the addon saw.
  local donelevel, manual = info.donelevel, info.donelevelManual
  if old and old.donelevelManual and not manual then
    donelevel, manual = old.donelevel, true
  end
  donelevel = donelevel or (old and old.donelevel) or UnitLevel("player")
  local entry = {
    title = title,
    rating = rating,
    tags = tags or {},
    note = ER.Trim(note),
    donelevel = donelevel,
    donelevelManual = manual or nil,
    qlevel = info.qlevel or (old and old.qlevel),
    tag = info.tag or (old and old.tag),
    deaths = info.deaths or (old and old.deaths),
    close = info.close or (old and old.close),
    mins = info.mins or (old and old.mins),
    pfid = info.pfid or (old and old.pfid),
    obj = info.obj or (old and old.obj),
    desc = info.desc or (old and old.desc),
    ask = info.ask or (old and old.ask),
    chain = info.chain or (old and old.chain),
    story = info.story or (old and old.story),
    did = info.did or (old and old.did),
    plevel = UnitLevel("player"),
    class = class,
    race = race,
    char = ER.Char(),
    zone = zone, sub = sub, x = x, y = y,
    time = time(),
    when = date("%Y-%m-%d %H:%M"),
  }
  ER.db.ratings[key] = entry
  local tagList = {}
  for _, t in ipairs(ER.TAGS) do
    if entry.tags[t.key] then table.insert(tagList, t.label) end
  end
  ER.Log("rate", { title = title, rating = rating, tags = tagList, note = entry.note, qlevel = entry.qlevel, donelevel = donelevel })
  local extra = ""
  if table.getn(tagList) > 0 then extra = GREY .. " (" .. table.concat(tagList, ", ") .. ")" .. END end
  ER.Print(GOLD .. title .. END .. " rated " .. ER.Coloured(rating) .. GREY .. " at level " .. donelevel .. END .. extra)
  if ER.RefreshWindow then ER.RefreshWindow() end
  if ER.RefreshQuestLogPanel then ER.RefreshQuestLogPanel() end
end

-- Switches one reason on or off for a quest. A quest that has no rating yet gets one too:
-- "no combat" makes it Easy, anything else takes the addon's guess.
function ER.ToggleTag(title, key, info)
  if not title then return end
  local old = ER.GetRating(title, info and info.pfid)
  local tags = {}
  if old and old.tags then
    for k, v in pairs(old.tags) do tags[k] = v end
  end
  if tags[key] then tags[key] = nil else tags[key] = true end
  local rating = old and old.rating
  if not rating then
    if key == "nocombat" then rating = "easy" else rating = ER.Suggest(info) end
  end
  ER.SetRating(title, rating, tags, old and old.note, info)
end

function ER.AddNote(text)
  text = ER.Trim(text)
  if text == "" then
    ER.Print("type the note after the command, for example " .. GOLD .. "/er note nice quiet boar spot" .. END)
    return
  end
  ER.Log("note", { note = text })
  ER.Print("noted at " .. ER.WhereText() .. ": " .. WHITE .. text .. END)
  if ER.RefreshWindow then ER.RefreshWindow() end
end

function ER.Counts()
  local rated = 0
  for _ in pairs(ER.db.ratings) do rated = rated + 1 end
  return rated, table.getn(ER.db.journal)
end

-- A rated quest whose title contains the text: its title and pfQuest id.
function ER.FindRated(text)
  local lower = string.lower(text)
  for key, r in pairs(ER.db.ratings) do
    if string.find(string.lower(key), lower, 1, true) then return r.title or key, r.pfid end
  end
  return nil
end

------------------------------------------------------------------------------------------------------
-- Settings, events, /er
------------------------------------------------------------------------------------------------------

-- The game reads an addon's file list only when it starts. Updating with the game open and
-- reloading loads new code into old files but never a file that is new to the list, so a piece
-- can be missing until the game is restarted. Say so instead of erroring.
function ER.RestartNeeded()
  ER.Print(RED .. "part of Easy Route is not loaded yet. Close the game completely and start it again (a /reload is not enough after an update)." .. END)
end

-- The files in EasyRoute.toc, in order. tools/check-lua.js fails when this line and the .toc differ and prints the line to paste.
local EXPECTED = "Core.lua,Data\\Quests.lua,Data\\Zones.lua,Data\\Mobs.lua,Data\\Guides.lua,Data\\ZoneSizes.lua,Data\\Route.lua,Data\\Survival.lua,Data\\Ratings.lua,Recorder.lua,Director.lua,Steps.lua,RouteReader.lua,RouteRun.lua,Grind.lua,Auto.lua,Arrow.lua,Tracker.lua,Simple.lua,Adapt.lua,Plates.lua,Settings.lua,Wizard.lua,Selftest.lua,Rate.lua,UI.lua,QuestLog.lua,Share.lua,Help.lua,Minimap.lua"

-- Files the game has not run, plus the .toc's version when the game holds one from another version. Empty: all loaded.
function ER.MissingFiles()
  local missing = {}
  for name in string.gfind(EXPECTED, "[^,]+") do
    local _, _, base = string.find(name, "^Data\\(.+)%.lua$")
    local ok
    if base then
      ok = type(getglobal("EasyRoute_" .. base)) == "table"
    else
      ok = ER.loaded[name]
    end
    if not ok then table.insert(missing, name) end
  end
  local v
  if GetAddOnMetadata then
    local ok, r = pcall(GetAddOnMetadata, "EasyRoute", "Version")
    if ok and type(r) == "string" then v = string.gsub(r, "%s+$", "") end
  end
  if v and v ~= "" and v ~= ER.VERSION then table.insert(missing, "EasyRoute.toc " .. v) end
  return missing
end

-- All loaded: true. The game holding an old .toc: the restart line. Otherwise a file errored while loading and a
-- restart will not help, so say which one.
local function CheckAllLoaded()
  local missing = ER.MissingFiles()
  if table.getn(missing) == 0 then return true end
  local names = {}
  for i = 1, table.getn(missing) do
    if string.find(missing[i], "^EasyRoute%.toc") then
      ER.RestartNeeded()
      return false
    end
    if i <= 3 then table.insert(names, missing[i]) end
  end
  local list = table.concat(names, ", ")
  if table.getn(missing) > 3 then list = list .. " and " .. (table.getn(missing) - 3) .. " more" end
  ER.Print(RED .. list .. " did not load." .. END .. " Please send a screenshot of the error.")
  return false
end

local function InitDB()
  if type(EasyRouteDB) ~= "table" then EasyRouteDB = {} end
  for k, v in pairs(DEFAULTS) do
    if EasyRouteDB[k] == nil then EasyRouteDB[k] = v end
  end
  if type(EasyRouteDB.ratings) ~= "table" then EasyRouteDB.ratings = {} end
  if type(EasyRouteDB.journal) ~= "table" then EasyRouteDB.journal = {} end
  if type(EasyRouteDB.active) ~= "table" then EasyRouteDB.active = {} end
  -- 0.1.0 asked after every turn-in by default; the quest log buttons replaced that. Switch it off
  -- once for anyone who started on 0.1.0, they can turn it back on with /er prompt.
  if not EasyRouteDB.promptDefaultFixed then
    EasyRouteDB.autoPrompt = false
    EasyRouteDB.promptDefaultFixed = true
  end
  -- Once per account, for saves made before this version: Hard was saved as "normal", Everything is now Hard with the
  -- tick "Ask me how hard each quest was", and party chat and the chain popup are off until ticked again in Settings.
  if not EasyRouteDB.tidy090 then
    if ER.MigrateMode then ER.MigrateMode(EasyRouteDB) end
    EasyRouteDB.partyAnnounce = false
    EasyRouteDB.chainPopup = false
    EasyRouteDB.tidy090 = true
  end
  -- "Cramped" became "Crowded" in 0.1.6; ratings saved with the old word follow.
  for _, r in pairs(EasyRouteDB.ratings) do
    if type(r.tags) == "table" and r.tags.cramped then
      r.tags.crowded = true
      r.tags.cramped = nil
    end
  end
  EasyRouteDB.version = ER.VERSION
  ER.db = EasyRouteDB
end

-- "/er hard Wanted: Hogger" rates that quest. "/er hard" alone rates the quest picked in your quest log.
local function QuickRate(key, rest)
  local title, info
  rest = ER.Trim(rest)
  if rest ~= "" then
    title, info = ER.Recorder.FindQuest(rest)
    if not title then
      local pfid
      title, pfid = ER.FindRated(rest)
      if title then info = { pfid = pfid } end
    end
    if not title then
      ER.Print("no quest in your log or notes matches '" .. rest .. "'.")
      return
    end
  else
    title, info = ER.Recorder.SelectedQuest()
    if not title then
      ER.Print("pick a quest in your quest log first, or add its name: " .. GOLD .. "/er " .. key .. " Wanted: Hogger" .. END)
      return
    end
  end
  local old = ER.GetRating(title, info and info.pfid)
  ER.SetRating(title, key, old and old.tags, old and old.note, info)
end

-- Opens the start screen. If its file did not load, say to restart; never fall back to another window.
local function OpenGuide()
  if not ER.ToggleWizard then
    ER.RestartNeeded()
    return
  end
  local ok, err = pcall(ER.ToggleWizard)
  if not ok then
    ER.Print(RED .. "the guide hit a problem:" .. END .. " " .. tostring(err) .. "  (please send a screenshot of this line).")
  end
end

local function Running()
  return ER.Steps and ER.Steps.Running and ER.Steps.Running() and true or false
end

local function Slash(msg)
  msg = ER.Trim(msg)
  local _, _, word = string.find(string.lower(msg), "^(%S+)")
  word = word or ""
  local rest = string.sub(msg, string.len(word) + 1)
  if word == "" or word == "wizard" then
    -- Plain /er: with a guide running it shows or hides the step box; with none it opens the start screen to pick one.
    -- /er wizard always opens the start screen.
    if word == "" and Running() and ER.ToggleTracker then
      ER.ToggleTracker()
    elseif word == "wizard" and Running() and ER.ShowWizard then
      ER.ShowWizard()
    else
      OpenGuide()
    end
  elseif word == "notebook" or word == "book" or word == "window" then
    if ER.ToggleWindow then ER.ToggleWindow() end
  elseif word == "go" or word == "area" then
    -- Only plain /er hides the step box; these always show the guide.
    ER.Print("that window is gone. Here is your guide.")
    if Running() and ER.ShowTracker then ER.ShowTracker() else OpenGuide() end
  elseif word == "guides" or word == "guide" or word == "menu" then
    if ER.ShowGuideMenu then ER.ShowGuideMenu() else ER.RestartNeeded() end
  elseif word == "arrow" then
    if ER.ToggleArrow then ER.ToggleArrow() else ER.RestartNeeded() end
  elseif word == "stop" then
    if ER.Steps and ER.Steps.Running() then
      ER.Steps.Stop()
      ER.Print("guide stopped. " .. GOLD .. "/er" .. END .. " starts one again.")
    else
      ER.Print("no guide is running.")
    end
  elseif word == "next" then
    if ER.Steps and ER.Steps.Running() then ER.Steps.Next() end
  elseif word == "settings" or word == "options" or word == "config" then
    if ER.ToggleSettings then ER.ToggleSettings() else ER.RestartNeeded() end
  elseif word == "simple" or word == "list" then
    if ER.SetSimple then ER.SetSimple(not ER.db.simple) else ER.RestartNeeded() end
  elseif word == "tips" then
    if ER.ToggleTips then ER.ToggleTips() else ER.RestartNeeded() end
  elseif word == "skulls" or word == "skull" then
    if not ER.ToggleSkulls then
      ER.RestartNeeded()
    elseif string.find(string.lower(rest), "test") then
      ER.SkullTest()
    else
      ER.ToggleSkulls()
    end
  elseif word == "money" then
    if ER.SetHasMoney then ER.SetHasMoney(not ER.HasMoney()) else ER.RestartNeeded() end
  elseif word == "rate" and ER.Trim(rest) == "enemies" then
    ER.db.rateOff = not ER.db.rateOff
    ER.Print("Easy / Medium / Hard on enemy tooltips is now " .. (ER.db.rateOff and "off" or "on") .. ".")
  elseif word == "mode" then
    local key = string.lower(ER.Trim(rest))
    if key == "normal" then key = "hard" end   -- the old name still works
    if key == "everything" then
      ER.Print("there is no Everything any more. To be asked how hard each quest was, tick " .. GOLD .. "Ask me how hard each quest was" .. END ..
        " in Settings (the gear on the guide).")
    elseif ER.MODES and ER.MODES[key] then
      ER.SetMode(key)
    else
      ER.Print("modes: " .. GOLD .. "/er mode casual" .. END .. ", " .. GOLD .. "medium" .. END .. ", " .. GOLD .. "hard" .. END ..
        ". Now: " .. (ER.MODES and ER.MODES[ER.Mode()].label or "?") .. ".")
    end
  elseif word == "selftest" then
    if ER.SelfTest then ER.SelfTest() else ER.RestartNeeded() end
  elseif word == "unskip" then
    if ER.ClearSkipped then ER.ClearSkipped() end
    ER.Print("every quest you said 'not today' to is back on the list.")
  elseif word == "note" then
    ER.AddNote(rest)
  elseif word == "rate" then
    local title, info = ER.Recorder.SelectedQuest()
    if title then
      ER.OpenRate(title, info)
    else
      ER.Print("pick a quest in your quest log first, then " .. GOLD .. "/er rate" .. END .. ".")
    end
  elseif ER.RatingInfo(word) then
    QuickRate(word, rest)
  elseif word == "prompt" then
    ER.db.autoPrompt = not ER.db.autoPrompt
    ER.Print("the tick \"Ask me how hard each quest was\" is now " .. (ER.db.autoPrompt and "on" or "off") .. ".")
    if ER.RefreshWindow then ER.RefreshWindow() end
  elseif word == "party" then
    ER.db.partyAnnounce = not ER.db.partyAnnounce
    ER.Print("telling your party when you hand a quest in is now " .. (ER.db.partyAnnounce and "on" or "off") .. ".")
    if ER.RefreshWindow then ER.RefreshWindow() end
  elseif word == "chain" then
    ER.db.chainPopup = not ER.db.chainPopup
    ER.Print("the popup when you pick up the first quest of a chain is now " .. (ER.db.chainPopup and "on" or "off") .. ".")
  elseif word == "minimap" then
    ER.db.minimapHidden = not ER.db.minimapHidden
    if ER.UpdateMinimapButton then ER.UpdateMinimapButton() end
    ER.Print("minimap button " .. (ER.db.minimapHidden and "hidden" or "shown") .. ".")
  elseif word == "help" or word == "?" then
    if ER.ShowHelp then ER.ShowHelp() end
  elseif word == "export" or word == "copy" then
    if ER.ShowExport then ER.ShowExport() else ER.RestartNeeded() end
  elseif word == "about" then
    if ER.ShowNotice then ER.ShowNotice() else ER.RestartNeeded() end
  else
    ER.Print("commands: " .. GOLD .. "/er" .. END .. " the guide, " .. GOLD .. "/er settings" .. END .. ", " .. GOLD .. "/er arrow" .. END ..
      ", " .. GOLD .. "/er next" .. END .. ", " .. GOLD .. "/er stop" .. END .. ", " .. GOLD .. "/er help" .. END)
  end
end

SLASH_EASYROUTE1 = "/er"
SLASH_EASYROUTE2 = "/easyroute"
SlashCmdList["EASYROUTE"] = Slash

local events = CreateFrame("Frame")
events:RegisterEvent("VARIABLES_LOADED")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function()
  if event == "VARIABLES_LOADED" then
    InitDB()
  elseif event == "PLAYER_LOGIN" then
    if not ER.db then InitDB() end
    if ER.InitMinimapButton then ER.InitMinimapButton() end
    ER.Print("version " .. ER.VERSION .. ". Type " .. GOLD .. "/er" .. END .. " for your guide, " .. GOLD .. "/er help" .. END .. " for the commands.")
    CheckAllLoaded()
  end
end)

ER.Loaded("Core.lua")
