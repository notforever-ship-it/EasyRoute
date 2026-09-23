-- Easy Route: a relaxed leveling guide for the 1.12 client. This first version is the notebook: it
-- records what you do while you level (quests taken, turned in, deaths, level-ups, where you were)
-- and lets you say with one click whether a quest was easy or hard. The guide gets built from that.

EasyRoute = {}
local ER = EasyRoute
ER.VERSION = "0.2.1"

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
  autoPrompt = false,     -- also open the "how was it?" popup right after every turn-in
  partyAnnounce = true,   -- tell your party in /p when you hand a quest in
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
function ER.Where()
  if not (WorldMapFrame and WorldMapFrame:IsVisible()) then SetMapToCurrentZone() end
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
-- Returns rating, tags, reason.
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
    return "hard", tags, "it is a " .. info.tag .. " quest"
  end
  if deaths > 0 then
    return "hard", tags, "you died " .. (deaths == 1 and "once" or (deaths .. " times")) .. " while it was in your log"
  end
  if close >= 2 then
    return "hard", tags, "you nearly died " .. close .. " times while it was in your log"
  end
  if not info.qlevel then
    return "medium", tags, "it has no level to go on"
  end
  local diff = info.qlevel - plevel
  if diff >= 5 then
    return "hard", tags, "it is " .. diff .. " levels above you (red)"
  elseif diff >= 3 then
    return "hard", tags, "it is " .. diff .. " levels above you (orange)"
  elseif diff >= -2 then
    return "medium", tags, "it is about your level (yellow)"
  end
  if close == 1 then
    return "medium", tags, "it is " .. (-diff) .. " levels below you, but you still got low on health once"
  end
  return "easy", tags, "it is " .. (-diff) .. " levels below you (green). Packs of them? Then say Hard"
end

-- The objectives the way you want to remember them: "Gnoll Bands: 3/6" becomes "Gnoll Bands x6",
-- and lines without a count ("Speak with Marshal Dughan") stay as they are.
function ER.ObjectiveLines(obj)
  local lines = {}
  if type(obj) ~= "table" then return lines end
  for _, line in ipairs(obj) do
    local _, _, name, total = string.find(line, "^(.-):%s*%d+%s*/%s*(%d+)%s*$")
    if name and name ~= "" then
      table.insert(lines, name .. " x" .. total)
    elseif line ~= "" then
      table.insert(lines, line)
    end
  end
  return lines
end

function ER.ObjectiveSummary(obj)
  local lines = ER.ObjectiveLines(obj)
  if table.getn(lines) == 0 then return nil end
  return table.concat(lines, ", ")
end

function ER.GetRating(title)
  return ER.db.ratings[title]
end

-- Saves your answer for a quest. Rating again replaces the old answer; the journal keeps both.
function ER.SetRating(title, rating, tags, note, info)
  if not title or title == "" or not ER.RatingInfo(rating) then return end
  info = info or {}
  local class, race = ER.ClassRace()
  local zone, sub, x, y = ER.Where()
  local old = ER.db.ratings[title]
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
    chain = info.chain or (old and old.chain),
    plevel = UnitLevel("player"),
    class = class,
    race = race,
    char = ER.Char(),
    zone = zone, sub = sub, x = x, y = y,
    time = time(),
    when = date("%Y-%m-%d %H:%M"),
  }
  ER.db.ratings[title] = entry
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
  local old = ER.GetRating(title)
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

function ER.FindRated(text)
  local lower = string.lower(text)
  for title in pairs(ER.db.ratings) do
    if string.find(string.lower(title), lower, 1, true) then return title end
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

local function CheckAllLoaded()
  if ER.Recorder and ER.OpenRate and ER.ToggleWindow and ER.RefreshQuestLogPanel and ER.ShowExport
    and ER.ShowHelp and ER.InitMinimapButton then
    return true
  end
  ER.RestartNeeded()
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
    if not title then title = ER.FindRated(rest) end
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
  local old = ER.GetRating(title)
  ER.SetRating(title, key, old and old.tags, old and old.note, info)
end

local function Slash(msg)
  msg = ER.Trim(msg)
  local _, _, word = string.find(string.lower(msg), "^(%S+)")
  word = word or ""
  local rest = string.sub(msg, string.len(word) + 1)
  if word == "" then
    if ER.ToggleWindow then ER.ToggleWindow() end
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
    ER.Print("asking after every turn-in is now " .. (ER.db.autoPrompt and "on" or "off") .. ".")
    if ER.RefreshWindow then ER.RefreshWindow() end
  elseif word == "party" then
    ER.db.partyAnnounce = not ER.db.partyAnnounce
    ER.Print("telling your party when you hand a quest in is now " .. (ER.db.partyAnnounce and "on" or "off") .. ".")
    if ER.RefreshWindow then ER.RefreshWindow() end
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
    ER.Print("commands: " .. GOLD .. "/er" .. END .. " window, " .. GOLD .. "/er easy|medium|hard|skip [quest]" .. END ..
      ", " .. GOLD .. "/er note <text>" .. END .. ", " .. GOLD .. "/er rate" .. END .. ", " .. GOLD .. "/er export" .. END ..
      ", " .. GOLD .. "/er party" .. END .. ", " .. GOLD .. "/er prompt" .. END .. ", " .. GOLD .. "/er about" .. END ..
      ", " .. GOLD .. "/er help" .. END)
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
    local rated = ER.Counts()
    ER.Print("recording. " .. rated .. " quests rated so far. Rate them in your quest log, " .. GOLD .. "/er" .. END .. " opens the notebook.")
    CheckAllLoaded()
  end
end)
