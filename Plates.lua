-- Easy Route: a small gold skull over the health bar of every enemy your quests still need: the ones a quest log
-- objective names ("Young Scavenger slain: 3/8"), the ones that drop an item a quest still needs (from pfQuest's
-- data, when it is installed), and the ones the guide's current step says to kill. The bars are the game's own
-- enemy nameplates, so they only show while those are on (the V key).

local ER = EasyRoute
local ICON = "Interface\\TargetingFrame\\UI-RaidTargetingIcons"

local plates, count = {}, 0   -- nameplates found so far, and how many children of the world frame were looked at
local wanted = {}             -- singular names of the enemies wanted now

-- A nameplate: a nameless button on the world frame with a health bar in it. (Not by its border picture: some
-- clients and nameplate addons change that.)
local function IsPlate(frame)
  if not frame or not frame.GetObjectType or frame:GetObjectType() ~= "Button" then return false end
  if frame.GetName and frame:GetName() then return false end
  local bar = frame.GetChildren and frame:GetChildren()
  return bar and bar.GetObjectType and bar:GetObjectType() == "StatusBar" and true or false
end

-- The enemy's name on a plate: the first text on it that is not the level.
local function PlateName(plate)
  local regions = { plate:GetRegions() }
  for _, r in ipairs(regions) do
    if r.GetObjectType and r:GetObjectType() == "FontString" then
      local text = r:GetText()
      if text and text ~= "" and not string.find(text, "^[%d%?%+ ]+$") then return text, r end
    end
  end
  return nil
end

-- The enemies the quest log still needs: kill objectives by name, item objectives through what drops them.
local function FromQuestLog(out)
  local Steps = ER.Steps
  local known = ER.Recorder and ER.Recorder.Known and ER.Recorder.Known() or {}
  local n = GetNumQuestLogEntries() or 0
  for i = 1, n do
    local title, _, _, header, _, complete = GetQuestLogTitle(i)
    if title and not header and not complete then
      local objectives = GetNumQuestLeaderBoards and GetNumQuestLeaderBoards(i) or 0
      for j = 1, objectives do
        local text, kind, finished = GetQuestLogLeaderBoard(j, i)
        if text and not finished then
          local _, _, thing = string.find(text, "^(.-):%s*%d+%s*/%s*%d+")
          thing = thing or text
          if kind == "monster" then
            local _, _, mob = string.find(thing, "^(.-) slain$")
            out[Steps.Singular(mob or thing)] = true
          elseif kind == "item" then
            local info = known[title]
            local facts = info and info.pfid and ER.QuestFacts and ER.QuestFacts(info.pfid)
            local o = facts and facts.objectives[string.lower(thing)]
            for _, src in ipairs(o and o.sources or {}) do
              if src.db == "units" then out[Steps.Singular(src.name)] = true end
            end
          end
        end
      end
    end
  end
end

local function Rebuild()
  local out = {}
  FromQuestLog(out)
  if ER.Steps.Running() then
    for name in pairs(ER.Steps.TargetNames()) do out[name] = true end
  end
  wanted = out
end

-- Is this enemy wanted? By its whole name, or by its first name when the guide only uses that ("Kill Meven" for
-- Meven Korgal).
local function Wanted(text)
  if not text then return false end
  if wanted[ER.Steps.Singular(text)] then return true end
  local _, _, first = string.find(text, "^(%S+) ")
  return first and wanted[first] and true or false
end

local function Mark(plate)
  local text, name = PlateName(plate)
  local want = Wanted(text) and not (ER.db and ER.db.skullsOff)
  if want then
    if not plate.easyRouteSkull then
      local t = plate:CreateTexture(nil, "OVERLAY")
      t:SetTexture(ICON)
      t:SetTexCoord(0.75, 1, 0.25, 0.5)
      t:SetVertexColor(1, 0.82, 0.25)
      t:SetWidth(18)
      t:SetHeight(18)
      t:SetPoint("BOTTOM", name, "TOP", 0, 2)
      plate.easyRouteSkull = t
    end
    plate.easyRouteSkull:Show()
  elseif plate.easyRouteSkull then
    plate.easyRouteSkull:Hide()
  end
end

local scan = CreateFrame("Frame", "EasyRoutePlates")
scan.wait, scan.since = 0, 10
scan:SetScript("OnUpdate", function()
  this.wait = this.wait + arg1
  if this.wait < 0.2 then return end
  this.since = this.since + this.wait
  this.wait = 0
  if not (ER.Steps and WorldFrame and WorldFrame.GetNumChildren) then return end
  local total = WorldFrame:GetNumChildren()
  if total > count then
    local kids = { WorldFrame:GetChildren() }
    for i = count + 1, total do
      if IsPlate(kids[i]) then table.insert(plates, kids[i]) end
    end
    count = total
  end
  if table.getn(plates) == 0 then return end
  if this.since >= 1 then
    this.since = 0
    Rebuild()
  end
  for _, plate in ipairs(plates) do
    if plate:IsVisible() then Mark(plate) end
  end
end)

-- /er skulls test: what the skulls see, for a screenshot when they do not show.
function ER.SkullTest()
  Rebuild()
  local names = {}
  for name in pairs(wanted) do table.insert(names, name) end
  table.sort(names)
  local shown = {}
  for _, plate in ipairs(plates) do
    if plate:IsVisible() then table.insert(shown, (PlateName(plate) or "?") .. (Wanted(PlateName(plate)) and " (skull)" or "")) end
  end
  ER.Print("skulls are " .. (ER.db and ER.db.skullsOff and "OFF" or "on") .. ". Enemies wanted: " ..
    (table.getn(names) > 0 and table.concat(names, ", ") or "none") .. ".")
  ER.Print("Health bars on screen (" .. table.getn(shown) .. "): " .. (table.getn(shown) > 0 and table.concat(shown, ", ") or
    "none found. Press V to show enemy health bars."))
end

-- /er skulls: on or off.
function ER.ToggleSkulls()
  if not ER.db then return end
  ER.db.skullsOff = not ER.db.skullsOff
  ER.Print("skulls over quest enemies " .. (ER.db.skullsOff and "off." or "on (they show on the enemy health bars: the V key)."))
end

ER.Loaded("Plates.lua")
