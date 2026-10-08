-- Easy Route: the arrow. A small arrow near the top of the screen turns to point at the next place in the guide,
-- with what is there and how many yards away, like RestedXP's. It needs no other addon: the picture is our own
-- (Media\Arrow.tga, 64 turns drawn by tools/make-arrow.js) and the zone sizes come from Data\ZoneSizes.lua.
-- With pfQuest installed the same place is also marked on the world map and the minimap.
--
-- Which way you face comes from the game (GetPlayerFacing, on clients that have it) or from the minimap's player
-- arrow, the way pfQuest finds it. Drag the arrow to move it; right-click hides it (/er arrow brings it back).

local ER = EasyRoute
local TEXTURE = "Interface\\AddOns\\EasyRoute\\Media\\Arrow"
local TURNS, PER_ROW = 64, 8
local ARRIVED = 6   -- yards: closer than this counts as there

local frame, pointer, titleText, distText
local facingModel
local lastMark

local function SameText(a, b)
  return a and b and string.lower(a) == string.lower(b)
end

-- Which way the character faces, in radians anticlockwise from north. nil when the game will not say.
local function Facing()
  if GetPlayerFacing then return GetPlayerFacing() end
  if not facingModel and Minimap then
    local kids = { Minimap:GetChildren() }
    for _, v in ipairs(kids) do
      if v.IsObjectType and v:IsObjectType("Model") and not v:GetName() and v.GetModel then
        local model = v:GetModel()
        if type(model) == "string" and string.find(string.lower(model), "minimaparrow", 1, true) then
          facingModel = v
          break
        end
      end
    end
  end
  return facingModel and facingModel:GetFacing() or nil
end

-- Puts the place on pfQuest's world map and minimap (quietly, no chat line), once per new place.
local function MarkMap(t)
  local key = t and (t.zone .. t.x .. t.y) or nil
  if key == lastMark then return end
  lastMark = key
  if not (pfMap and pfMap.AddNode and pfMap.GetMapIDByName and pfMap.DeleteNode) then return end
  pcall(function()
    pfMap:DeleteNode("EASYROUTE")
    if t then
      local mapId = pfMap:GetMapIDByName(t.zone)
      if mapId then
        local label = t.text or "Easy Route"
        pfMap:AddNode({ addon = "EASYROUTE", zone = mapId, x = t.x, y = t.y, title = label, spawn = label,
          spawntype = "Easy Route", level = "", respawn = "N/A" })
      end
    end
    if pfMap.queue_update == true then pfMap.queue_update = GetTime() end
    if pfMap.UpdateNodes then pfMap:UpdateNodes() end
  end)
end

local function Short(text)
  if not text then return "" end
  text = string.gsub(text, "|c%x%x%x%x%x%x%x%x", "")
  text = string.gsub(text, "|r", "")
  if string.len(text) > 60 then text = string.sub(text, 1, 57) .. "..." end
  return text
end

local function Update()
  if not frame then return end
  local Steps = ER.Steps
  if not (Steps and Steps.Running()) or (ER.db and ER.db.arrowOff) then
    frame:Hide()
    MarkMap(nil)
    return
  end
  local t = Steps.Target()
  if not t then
    frame:Hide()
    MarkMap(nil)
    return
  end
  frame:Show()
  MarkMap(t)
  titleText:SetText(Short(t.text) ~= "" and Short(t.text) or (t.zone .. " (" .. math.floor(t.x + 0.5) .. ", " .. math.floor(t.y + 0.5) .. ")"))
  local here, px, py = Steps.Here()
  if not SameText(here, t.zone) or (px == 0 and py == 0) then
    -- Another zone: no direction to give from here, just where to head.
    pointer:Hide()
    distText:SetText("|cffffd100Go to " .. t.zone .. "|r")
    return
  end
  local yards, dx, dy = Steps.Yards(t.zone, px, py, t.x, t.y)
  if yards <= math.max(ARRIVED, (t.radius or 0) * 0.5) then
    pointer:Hide()
    distText:SetText("|cff40c040You are here|r")
    return
  end
  distText:SetText(math.floor(yards + 0.5) .. " yards")
  local facing = Facing()
  if not facing then
    pointer:Hide()
    return
  end
  -- Bearing to the place, anticlockwise from north (x grows east, y grows south on the map).
  local bearing = math.atan2(-dx, -dy)
  local rel = bearing - facing
  local cell = math.mod(math.floor(rel / (2 * math.pi) * TURNS + 0.5), TURNS)
  if cell < 0 then cell = cell + TURNS end
  local col, row = math.mod(cell, PER_ROW), math.floor(cell / PER_ROW)
  pointer:SetTexCoord(col / PER_ROW, (col + 1) / PER_ROW, row / PER_ROW, (row + 1) / PER_ROW)
  -- Green when you face it, through yellow, to red when it is behind you.
  local off = math.abs(math.mod(rel + 3 * math.pi, 2 * math.pi) - math.pi) / math.pi
  pointer:SetVertexColor(math.min(1, off * 2), math.min(1, (1 - off) * 2), 0.1)
  pointer:Show()
end

local function Build()
  frame = CreateFrame("Button", "EasyRouteArrow", UIParent)
  frame:SetWidth(220)
  frame:SetHeight(96)
  local pos = ER.db and ER.db.arrowPos
  if type(pos) == "table" and pos.point then
    frame:SetPoint(pos.point, UIParent, pos.relPoint or pos.point, pos.x or 0, pos.y or 0)
  else
    frame:SetPoint("TOP", UIParent, "TOP", 0, -110)
  end
  frame:SetFrameStrata("MEDIUM")
  frame:SetClampedToScreen(true)
  frame:EnableMouse(true)
  frame:SetMovable(true)
  frame:RegisterForDrag("LeftButton")
  frame:RegisterForClicks("RightButtonUp")
  frame:SetScript("OnDragStart", function() this:StartMoving() end)
  frame:SetScript("OnDragStop", function()
    this:StopMovingOrSizing()
    local point, _, relPoint, x, y = this:GetPoint()
    if ER.db then ER.db.arrowPos = { point = point, relPoint = relPoint, x = x, y = y } end
  end)
  frame:SetScript("OnClick", function()
    if ER.db then ER.db.arrowOff = true end
    this:Hide()
    if DEFAULT_CHAT_FRAME then
      DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99Easy Route:|r arrow hidden. |cffffd100/er arrow|r brings it back.")
    end
  end)
  frame:SetScript("OnEnter", function()
    GameTooltip:SetOwner(this, "ANCHOR_BOTTOM")
    GameTooltip:SetText("Easy Route arrow")
    GameTooltip:AddLine("Points at the next place in your guide.", 1, 1, 1, 1)
    GameTooltip:AddLine("Drag to move. Right-click to hide (/er arrow brings it back).", 0.6, 0.6, 0.6, 1)
    GameTooltip:Show()
  end)
  frame:SetScript("OnLeave", function() GameTooltip:Hide() end)

  pointer = frame:CreateTexture(nil, "ARTWORK")
  pointer:SetTexture(TEXTURE)
  pointer:SetWidth(52)
  pointer:SetHeight(52)
  pointer:SetPoint("TOP", frame, "TOP", 0, 0)
  pointer:SetTexCoord(0, 1 / PER_ROW, 0, 1 / PER_ROW)

  titleText = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  titleText:SetPoint("TOP", pointer, "BOTTOM", 0, -2)
  titleText:SetWidth(220)
  distText = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  distText:SetPoint("TOP", titleText, "BOTTOM", 0, -2)
  frame:Hide()

  -- A hidden frame never gets OnUpdate, so a separate always-shown frame turns the arrow.
  local driver = CreateFrame("Frame", "EasyRouteArrowDriver")
  driver.wait = 0
  driver:SetScript("OnUpdate", function()
    this.wait = this.wait + arg1
    if this.wait < 0.05 then return end
    this.wait = 0
    Update()
  end)
end

-- Points the arrow now (the guide calls this when the step changes). Builds it the first time.
function ER.ArrowUpdate()
  if not frame then Build() end
  Update()
end

-- /er arrow: show it again (or hide it).
function ER.ToggleArrow()
  if not ER.db then return end
  ER.db.arrowOff = not ER.db.arrowOff
  if not frame then Build() end
  Update()
  if DEFAULT_CHAT_FRAME then
    DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99Easy Route:|r arrow " .. (ER.db.arrowOff and "hidden" or "shown") .. ".")
  end
end

local starter = CreateFrame("Frame", "EasyRouteArrowStarter")
starter:RegisterEvent("PLAYER_LOGIN")
starter:SetScript("OnEvent", function()
  if not frame then Build() end
end)
