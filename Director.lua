-- Easy Route director: instead of one fixed route, it looks at where you are and what level you are and says
-- what is worth doing here, in what order, which chains are worth following, where to grind for a break
-- and when the area is used up. No windows in this file, only decisions, so it can be tested away from the game.
--
-- The facts come from Data\Zones.lua (quests by zone), Data\Mobs.lua (where ordinary mobs of each level stand)
-- and Data\Quests.lua (the order a leveling route does things in, used as a hint of which quests are good).

local ER = EasyRoute

-- The three difficulties. behind and ahead: how far below and above your level a quest may be. leaveAt: when this many
-- or fewer quests are left that fit, the director asks whether to move on. elites: quests with a group-sized kill
-- target stay in the list. travel: how much a long walk counts against a quest. prefer: the quest level, compared
-- with yours, that ranks best (Casual likes quests a little below you, Hard a little above).
ER.MODES = {
  casual = { label = "Casual", behind = 6, ahead = 0, prefer = -1, leaveAt = 2, elites = false, hard = false, travel = 0.10,
    tip = "The guide leaves out group, elite, dungeon and escort quests, and risky ones." },
  medium = { label = "Medium", behind = 4, ahead = 2, prefer = 0.5, leaveAt = 4, elites = false, hard = true, travel = 0.07,
    tip = "Leaves out group, elite and dungeon quests; warns on escorts and risky ones." },
  hard = { label = "Hard", behind = 2, ahead = 4, prefer = 1, leaveAt = 6, elites = true, hard = true, travel = 0.05,
    tip = "Everything except dungeon quests." },
}
ER.MODE_ORDER = { "casual", "medium", "hard" }

-- Mobs for the grind suggestions: never more than this far below you, and this far above.
ER.GRIND_BEHIND = 1
ER.GRIND_AHEAD = 2

-- Places that are not for leveling a character: dungeons, raids, cities, and the game masters' island.
local NOT_LEVELING = {
  ["razorfen kraul"] = true, ["gnomeregan"] = true, ["blackfathom deeps"] = true, ["razorfen downs"] = true,
  ["zul'farrak"] = true, ["uldaman"] = true, ["the temple of atal'hakkar"] = true, ["blackrock spire"] = true,
  ["blackrock depths"] = true, ["blackrock mountain"] = true, ["zul'gurub"] = true, ["stratholme"] = true,
  ["maraudon"] = true, ["ragefire chasm"] = true, ["dire maul"] = true, ["alterac valley"] = true,
  ["blackwing lair"] = true, ["ahn'qiraj"] = true, ["tower of karazhan"] = true, ["scarlet monastery graveyard"] = true,
  ["gm island"] = true, ["deeprun tram"] = true, ["stormwind city"] = true, ["ironforge"] = true, ["orgrimmar"] = true,
  ["undercity"] = true, ["deadwind pass"] = true, ["moonglade"] = true, ["winter veil vale"] = true,
  ["lapidis isle"] = true, ["gillijim's isle"] = true,
}

------------------------------------------------------------------------------------------------------
-- Who you are
------------------------------------------------------------------------------------------------------

local RACE_BITS = { Human = 1, Orc = 2, Dwarf = 4, NightElf = 8, Scourge = 16, Undead = 16, Tauren = 32, Gnome = 64, Troll = 128,
  Goblin = 256, HighElf = 512 }
local CLASS_BITS = { WARRIOR = 1, PALADIN = 2, HUNTER = 4, ROGUE = 8, PRIEST = 16, SHAMAN = 64, MAGE = 128, WARLOCK = 256, DRUID = 1024 }
local RACE_LIST = { 1, 2, 4, 8, 16, 32, 64, 128, 256, 512 }
local ALLIANCE_MASK = 1 + 4 + 8 + 64 + 512
local HORDE_MASK = 2 + 16 + 32 + 128 + 256

local function HasBit(mask, bit)
  if not mask or not bit or bit == 0 then return false end
  return math.mod(math.floor(mask / bit), 2) == 1
end

-- Race bit, class bit and the mask of the whole faction for the character playing.
function ER.PlayerMasks()
  local _, raceToken = UnitRace("player")
  local _, classToken = UnitClass("player")
  local faction = UnitFactionGroup("player")
  local factionMask = faction == "Horde" and HORDE_MASK or ALLIANCE_MASK
  return RACE_BITS[raceToken or ""] or 0, CLASS_BITS[classToken or ""] or 0, factionMask
end

-- Can this character take the quest at all? A quest for another race or class is not offered. A race this
-- file does not know falls back to the faction.
local function ForMe(q, raceBit, classBit, factionMask)
  if q.r then
    if raceBit ~= 0 then
      if not HasBit(q.r, raceBit) then return false end
    else
      local ok = false
      for _, bit in ipairs(RACE_LIST) do
        if HasBit(factionMask, bit) and HasBit(q.r, bit) then ok = true end
      end
      if not ok then return false end
    end
  end
  if q.c and classBit ~= 0 and not HasBit(q.c, classBit) then return false end
  return true
end

------------------------------------------------------------------------------------------------------
-- What you have already done, and what you said no to
------------------------------------------------------------------------------------------------------

local function DoneTable()
  if not ER.db then return {} end
  if type(ER.db.done) ~= "table" then ER.db.done = {} end
  local char = ER.Char()
  if type(ER.db.done[char]) ~= "table" then
    ER.db.done[char] = {}
    -- First time: learn from the journal what this character already handed in.
    for _, e in ipairs(ER.db.journal or {}) do
      if e.t == "turnin" and e.char == char and e.title then
        ER.db.done[char][e.pfid or e.title] = true
        ER.db.done[char][e.title] = true
      end
    end
  end
  return ER.db.done[char]
end

function ER.MarkDone(title, pfid)
  local done = DoneTable()
  if title then done[title] = true end
  if pfid then done[pfid] = true end
end

-- Everything that happens when a quest is handed in, in this order: the done list first, then the guide.
-- Recorder.lua calls it once per hand-in.
function ER.OnTurnIn(title, pfid)
  if not title then return end
  ER.MarkDone(title, pfid)
  if ER.Steps and ER.Steps.OnTurnIn then ER.Steps.OnTurnIn(title, pfid) end
end

function ER.IsDone(q)
  local done = DoneTable()
  return done[q.id] or done[q.n] or false
end

local function Skipped(q)
  return ER.db and type(ER.db.skipped) == "table" and ER.db.skipped[q.id] or false
end

-- "Not today": the director stops suggesting this quest. /er unskip brings them all back.
function ER.SkipQuest(id)
  if not ER.db then return end
  if type(ER.db.skipped) ~= "table" then ER.db.skipped = {} end
  ER.db.skipped[id] = true
end

-- Also brings back the quests the guide learned to leave out for this character (died twice on, skipped).
function ER.ClearSkipped()
  if not ER.db then return end
  ER.db.skipped = {}
  local a = type(ER.db.adapt) == "table" and ER.db.adapt[ER.Char()]
  if type(a) == "table" then
    a.hard, a.deaths = {}, {}
  end
end

local function InLog(q)
  local known = ER.Recorder and ER.Recorder.Known and ER.Recorder.Known()
  return known and known[q.n] or false
end

------------------------------------------------------------------------------------------------------
-- Zones and chains
------------------------------------------------------------------------------------------------------

local zoneByName, byId, followers

local function BuildIndex()
  if zoneByName then return end
  zoneByName, byId, followers = {}, {}, {}
  for zid, z in pairs(EasyRoute_Zones or {}) do
    zoneByName[string.lower(z.name)] = zid
    for i = 1, table.getn(z.q) do
      local q = z.q[i]
      q.zone = zid
      byId[q.id] = q
      if q.p then
        if not followers[q.p] then followers[q.p] = {} end
        table.insert(followers[q.p], q.id)
      end
    end
  end
end

function ER.ZoneId(name)
  BuildIndex()
  if not name then return nil end
  return zoneByName[string.lower(name)]
end

function ER.ZoneRows(zid)
  local z = EasyRoute_Zones and EasyRoute_Zones[zid]
  return z and z.q or {}, z and z.name
end

-- A quest's place in its chain: { first = id, ids = {all, in order}, pos = this one's step, len = how many }.
-- nil when it stands alone.
function ER.ChainOf(id)
  BuildIndex()
  local q = byId[id]
  if not q then return nil end
  local seen, first, steps = { [id] = true }, id, 0
  while byId[first] and byId[first].p and byId[byId[first].p] and not seen[byId[first].p] and steps < 40 do
    first = byId[first].p
    seen[first] = true
    steps = steps + 1
  end
  local ids, cur, guard = { first }, first, 0
  while followers[cur] and guard < 40 do
    local nxt
    for _, f in ipairs(followers[cur]) do
      if not nxt or (byId[f] and byId[f].zone == byId[first].zone) then nxt = f end
    end
    if not nxt then break end
    table.insert(ids, nxt)
    cur = nxt
    guard = guard + 1
  end
  if table.getn(ids) < 2 then return nil end
  local pos
  for i, v in ipairs(ids) do if v == id then pos = i end end
  return { first = first, ids = ids, pos = pos or 1, len = table.getn(ids) }
end

-- The database has a few absurd experience numbers (custom quests); a quest is never counted for more than
-- a generous amount for its level.
local function XP(q)
  if not q.xp then return 0 end
  return math.min(q.xp, q.l * 120 + 300)
end
ER.QuestXP = XP

-- The chain's total: levels it spans, experience (when known), and whether anything in it gives an item.
function ER.ChainSummary(chain)
  BuildIndex()
  local lo, hi, xp, rewards, names = 99, 0, 0, false, {}
  for _, id in ipairs(chain.ids) do
    local q = byId[id]
    if q then
      if q.l < lo then lo = q.l end
      if q.l > hi then hi = q.l end
      xp = xp + XP(q)
      if q.rw then rewards = true end
      table.insert(names, q.n)
    end
  end
  return { lo = lo, hi = hi, xp = xp, rewards = rewards, names = names }
end

------------------------------------------------------------------------------------------------------
-- Which quests, and in what order
------------------------------------------------------------------------------------------------------

local function Colour(diff)
  if diff >= 5 then return "red" elseif diff >= 3 then return "orange" elseif diff >= -2 then return "yellow" end
  return "green"
end
ER.QuestColour = Colour

-- A set of the quest ids the leveling route (Data\Quests.lua) does: a hint that a quest is a good one.
local onRoute
local function RouteSet(faction)
  if onRoute then return onRoute end
  onRoute = {}
  local guides = EasyRoute_Quests and EasyRoute_Quests[faction]
  if guides then
    for _, g in ipairs(guides) do
      for _, q in ipairs(g.quests) do onRoute[q.id] = true end
    end
  end
  return onRoute
end

-- Ratings you gave in the notebook count: skip is never offered, hard is left out in casual, easy goes first.
local function Opinion(q, mode)
  local r = ER.db and ER.db.ratings and ER.db.ratings[q.n]
  if not r then return 0 end
  if r.rating == "skip" then return nil end
  local tags = r.tags or {}
  if mode.elites == false and tags.group then return nil end
  local score = 0
  if r.rating == "hard" then
    if not mode.hard then return nil end
    score = score - 3
  elseif r.rating == "easy" then
    score = score + 2
  end
  if tags.nocombat then score = score + 1.5 end
  if tags.walk then score = score - 2 end
  if tags.crowded and not mode.hard then score = score - 2 end
  return score
end

local function Distance(ax, ay, bx, by)
  if not ax or not bx then return 0 end
  local dx, dy = ax - bx, ay - by
  return math.sqrt(dx * dx + dy * dy)
end

-- The list of quests worth doing in a zone: { q = row, score, diff, colour, chain }, best first.
-- px, py: where you stand (map percent), so nearby quests rank higher. Pass nil to ignore distance.
function ER.Candidates(zid, level, modeKey, px, py)
  local mode = ER.MODES[modeKey] or ER.MODES.casual
  local rows = ER.ZoneRows(zid)
  local raceBit, classBit, factionMask = ER.PlayerMasks()
  local faction = factionMask == HORDE_MASK and "Horde" or "Alliance"
  local route = RouteSet(faction)
  local out = {}
  for i = 1, table.getn(rows) do
    local q = rows[i]
    local diff = q.l - level
    if diff <= mode.ahead and diff >= -mode.behind and (q.m or 1) <= level
      and ForMe(q, raceBit, classBit, factionMask) and not ER.IsDone(q) and not Skipped(q) and not InLog(q)
      and (mode.elites or not q.e) then
      local opinion = Opinion(q, mode)
      if opinion then
        -- Closer to your level is better; a quest above you counts a little less than one below.
        local score = 10 - math.abs(diff - (mode.prefer or 0.5)) * 1.5 + opinion
        local chain = ER.ChainOf(q.id)
        if chain then
          if chain.len >= 3 then score = score + 2 end
          -- A middle step is only worth it if the earlier steps are done or already in hand.
          if chain.pos > 1 then
            local prev = byId[chain.ids[chain.pos - 1]]
            if prev and not ER.IsDone(prev) then score = score - 6 end
          end
        end
        if route[q.id] then score = score + 1.5 end
        if q.rw then score = score + (q.rw >= 10 and 2 or 1) end
        if q.xp then score = score + math.log(1 + XP(q)) / 4 end
        if q.e then score = score - 4 end
        score = score - Distance(px, py, q.x, q.y) * mode.travel
        table.insert(out, { q = q, score = score, diff = diff, colour = Colour(diff), chain = chain })
      end
    end
  end
  table.sort(out, function(a, b) return a.score > b.score end)
  return out
end

-- Quests handed out close together make a "stop": gather them all in one visit. Hubs are listed best first.
-- Each hub: { x, y, giver, items = {candidates}, score, xp }.
function ER.Hubs(candidates, px, py, modeKey)
  local mode = ER.MODES[modeKey] or ER.MODES.casual
  local hubs = {}
  for _, c in ipairs(candidates) do
    local home
    for _, h in ipairs(hubs) do
      if Distance(h.x, h.y, c.q.x, c.q.y) <= 7 then home = h break end
    end
    if not home then
      home = { x = c.q.x, y = c.q.y, giver = c.q.g or "somebody", items = {}, score = 0, xp = 0 }
      table.insert(hubs, home)
    end
    table.insert(home.items, c)
    -- Only the best few at a stop count for its score, so a huge pile does not outweigh a better place.
    if table.getn(home.items) <= 6 then home.score = home.score + c.score end
    home.xp = home.xp + XP(c.q)
  end
  for _, h in ipairs(hubs) do
    h.score = h.score - Distance(px, py, h.x, h.y) * mode.travel * 3
  end
  table.sort(hubs, function(a, b) return a.score > b.score end)
  return hubs
end

-- Other zones that suit this level and mode, for when this one is used up. The leveling route's own next
-- zone gets a lift. Each: { zid, name, count, xp, giver, x, y }.
function ER.WhereNext(level, modeKey, fromZone)
  BuildIndex()
  local mode = ER.MODES[modeKey] or ER.MODES.casual
  local _, _, factionMask = ER.PlayerMasks()
  local faction = factionMask == HORDE_MASK and "Horde" or "Alliance"
  local routeZone = {}
  local guides = EasyRoute_Quests and EasyRoute_Quests[faction]
  if guides then
    for _, g in ipairs(guides) do
      -- Inside the band, not at its very end: a zone you are about to finish is not where to go next.
      if level >= g.lo and level < g.hi then routeZone[string.lower(g.zone)] = true end
    end
  end
  local out = {}
  for zid, z in pairs(EasyRoute_Zones or {}) do
    if zid ~= fromZone and not NOT_LEVELING[string.lower(z.name)] then
      local list = ER.Candidates(zid, level, modeKey, nil, nil)
      local n, xp = table.getn(list), 0
      if n >= 3 then
        local hubs = ER.Hubs(list, nil, nil, modeKey)
        local best = hubs[1]
        for _, h in ipairs(hubs) do xp = xp + h.xp end
        local score = math.min(n, 25) + (routeZone[string.lower(z.name)] and 10 or 0)
        table.insert(out, { zid = zid, name = z.name, count = n, xp = xp, giver = best.giver, x = best.x, y = best.y, score = score })
      end
    end
  end
  table.sort(out, function(a, b) return a.score > b.score end)
  return out
end

-- Chains worth following, from what is on offer here: three or more quests, best first. A chain with a
-- reward at its end, more quests and more experience counts for more. Each: { name, len, lo, hi, xp,
-- rewards, start = the candidate to begin (or carry on) with }.
function ER.ChainIdeas(candidates, want)
  local best = {}
  for _, c in ipairs(candidates) do
    if c.chain and c.chain.len >= 3 then
      local have = best[c.chain.first]
      if not have or c.chain.pos < have.chain.pos then best[c.chain.first] = c end
    end
  end
  local out = {}
  for first, c in pairs(best) do
    local sum = ER.ChainSummary(c.chain)
    local root = byId[first]
    table.insert(out, { name = root and root.n or c.q.n, len = c.chain.len, lo = sum.lo, hi = sum.hi, xp = sum.xp,
      rewards = sum.rewards, start = c, value = c.chain.len + (sum.rewards and 4 or 0) + math.min(sum.xp, 6000) / 1000 })
  end
  table.sort(out, function(a, b) return a.value > b.value end)
  local trimmed = {}
  for i = 1, math.min(want or 3, table.getn(out)) do table.insert(trimmed, out[i]) end
  return trimmed
end

------------------------------------------------------------------------------------------------------
-- Grinding for a break
------------------------------------------------------------------------------------------------------

local mobCache = {}

local function MobGroups(zid)
  if mobCache[zid] then return mobCache[zid] end
  local groups = {}
  local text = EasyRoute_Mobs and EasyRoute_Mobs[zid]
  if text then
    for entry in string.gfind(text, "([^;]+)") do
      local _, _, name, lo, hi, x, y, n = string.find(entry, "^(.-),(%d+),(%d+),([%d%.]+),([%d%.]+),(%d+)$")
      if name then
        table.insert(groups, { name = name, lo = tonumber(lo), hi = tonumber(hi), x = tonumber(x), y = tonumber(y), n = tonumber(n) })
      end
    end
  end
  mobCache[zid] = groups
  return groups
end

-- Where to grind between quests: groups of ordinary mobs from one level below you to two above, with
-- no elites. Nearby groups join into one spot. Returns up to `want` spots, best first:
-- { x, y, lo, hi, count, mobs = {names, most common first}, distance }.
function ER.GrindSpots(zid, level, px, py, want)
  local behind, ahead = ER.GRIND_BEHIND, ER.GRIND_AHEAD
  local spots = {}
  for _, g in ipairs(MobGroups(zid)) do
    if g.lo >= level - behind and g.hi <= level + ahead then
      local home
      for _, s in ipairs(spots) do
        if Distance(s.x, s.y, g.x, g.y) <= 9 then home = s break end
      end
      if not home then
        home = { x = g.x, y = g.y, lo = g.lo, hi = g.hi, count = 0, tally = {} }
        table.insert(spots, home)
      end
      -- The spot's centre drifts toward where the most mobs are.
      home.x = (home.x * home.count + g.x * g.n) / (home.count + g.n)
      home.y = (home.y * home.count + g.y * g.n) / (home.count + g.n)
      home.count = home.count + g.n
      if g.lo < home.lo then home.lo = g.lo end
      if g.hi > home.hi then home.hi = g.hi end
      home.tally[g.name] = (home.tally[g.name] or 0) + g.n
    end
  end
  for _, s in ipairs(spots) do
    s.distance = Distance(px, py, s.x, s.y)
    s.mobs = {}
    for name, n in pairs(s.tally) do table.insert(s.mobs, { name = name, n = n }) end
    table.sort(s.mobs, function(a, b) return a.n > b.n end)
    local names = {}
    for i = 1, math.min(3, table.getn(s.mobs)) do table.insert(names, s.mobs[i].name) end
    s.mobs = names
    s.tally = nil
    -- Plenty of mobs, close to you, and at your level rather than below it.
    s.score = math.min(s.count, 30) - s.distance * 0.5 + (s.lo >= level and 3 or 0)
  end
  table.sort(spots, function(a, b) return a.score > b.score end)
  local out = {}
  for i = 1, math.min(want or 3, table.getn(spots)) do table.insert(out, spots[i]) end
  return out
end

------------------------------------------------------------------------------------------------------
-- Putting it together
------------------------------------------------------------------------------------------------------

-- Everything the director window needs for where you stand: the zone's stops, whether it is time to move
-- on (and where to), and grind spots for a break. zoneName, level, modeKey, px, py default to now.
function ER.Plan(zoneName, level, modeKey, px, py)
  level = level or UnitLevel("player") or 1
  modeKey = modeKey or ER.Mode()
  if not zoneName then
    local zone, _, x, y = ER.Where()
    zoneName, px, py = zone, px or x, py or y
  end
  local zid = ER.ZoneId(zoneName)
  local plan = { zone = zoneName, zid = zid, level = level, mode = modeKey, hubs = {}, count = 0, grind = {}, next = {}, chains = {} }
  if not zid then return plan end
  local list = ER.Candidates(zid, level, modeKey, px, py)
  plan.count = table.getn(list)
  plan.hubs = ER.Hubs(list, px, py, modeKey)
  plan.chains = ER.ChainIdeas(list, 3)
  plan.grind = ER.GrindSpots(zid, level, px, py, 3)
  local mode = ER.MODES[modeKey]
  plan.leave = plan.count <= mode.leaveAt
  if plan.leave then plan.next = ER.WhereNext(level, modeKey, zid) end
  return plan
end

-- A quest's row in the data, by id, and whether it is in your quest log now (the wizard uses both).
function ER.QuestRow(id)
  BuildIndex()
  return byId[id]
end
ER.InLog = InLog


function ER.Mode()
  local key = ER.db and ER.db.mode
  if key == "normal" or key == "everything" then return "hard" end
  if ER.MODES[key] then return key end
  return "casual"
end

function ER.SetMode(key, quiet)
  if not ER.MODES[key] then return end
  ER.db.mode = key
  if not quiet then
    ER.Print("difficulty is now " .. ER.GOLD .. ER.MODES[key].label .. ER.END .. ". " .. ER.MODES[key].tip)
  end
  -- A guide that is running carries on with the new difficulty (Steps.lua asks it at every step).
  if ER.Steps and ER.Steps.Running() then
    ER.Steps.Check()
    if ER.StepsChanged then ER.StepsChanged() end
  end
end

-- Saves made before this version: Hard was saved as "normal", and Everything (every quest, a rating box after each
-- hand-in) is now Hard with the tick "Ask me how hard each quest was". Core.lua calls this once (EasyRouteDB.tidy090).
function ER.MigrateMode(db)
  if type(db) ~= "table" then return end
  if db.mode == "normal" then
    db.mode = "hard"
  elseif db.mode == "everything" then
    db.mode = "hard"
    db.autoPrompt = true
  end
end

-- A sentence about one suggestion: why it is on the list.
function ER.WhyQuest(c)
  local q = c.q
  local parts = {}
  local d = c.diff
  if d == 0 then table.insert(parts, "your level")
  elseif d > 0 then table.insert(parts, d .. " above you")
  else table.insert(parts, (-d) .. " below you") end
  if c.chain then
    table.insert(parts, "step " .. c.chain.pos .. " of a " .. c.chain.len .. "-quest chain")
  end
  if q.xp then table.insert(parts, XP(q) .. " xp") end
  if q.rw then table.insert(parts, q.rw >= 10 and "choose a reward" or "gives an item") end
  if q.e then table.insert(parts, "needs a group") end
  return table.concat(parts, ", ")
end

ER.Loaded("Director.lua")
