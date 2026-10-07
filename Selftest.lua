-- Easy Route: /er selftest. Runs the director and the window inside the real game, one step at a time, and
-- writes what happened to the saved file (EasyRouteDB.selftest) so a developer can read it after /reload.
-- Also keeps any Lua error that mentions Easy Route in EasyRouteDB.errors.

local ER = EasyRoute

-- Remember errors from this addon, then hand them on to whatever shows errors normally.
local previousHandler = geterrorhandler and geterrorhandler()
if seterrorhandler then
  seterrorhandler(function(msg)
    msg = tostring(msg)
    if ER.db and string.find(msg, "EasyRoute", 1, true) then
      if type(ER.db.errors) ~= "table" then ER.db.errors = {} end
      table.insert(ER.db.errors, date("%Y-%m-%d %H:%M") .. "  " .. msg)
      while table.getn(ER.db.errors) > 20 do table.remove(ER.db.errors, 1) end
    end
    if previousHandler then previousHandler(msg) end
  end)
end

local function Click(frame, button)
  this = frame
  arg1 = button or "LeftButton"
  local script = frame:GetScript("OnClick")
  if script then script() end
end

function ER.SelfTest()
  local results, failed = {}, 0
  local function Step(label, fn)
    local ok, err = pcall(fn)
    if ok then
      table.insert(results, label .. ": ok" .. (err and (" - " .. tostring(err)) or ""))
    else
      failed = failed + 1
      table.insert(results, label .. ": ERROR " .. tostring(err))
    end
  end

  Step("data loaded", function()
    local zones, quests = 0, 0
    for _, z in pairs(EasyRoute_Zones or {}) do zones = zones + 1 quests = quests + table.getn(z.q) end
    assert(zones > 50 and quests > 4000, "Zones.lua is missing or short")
    assert(EasyRoute_Mobs and EasyRoute_Quests, "Mobs.lua or Quests.lua is missing")
    return zones .. " zones, " .. quests .. " quests"
  end)
  Step("who you are", function()
    local race, class, faction = ER.PlayerMasks()
    return "race bit " .. race .. ", class bit " .. class .. ", mask " .. faction .. ", level " .. UnitLevel("player")
  end)
  Step("pfQuest", function()
    return "pfQuest " .. (pfQuest and "yes" or "no") .. ", pfMap " .. (pfMap and "yes" or "no") .. ", pfDB " .. (pfDB and "yes" or "no")
  end)

  local plan
  Step("plan for here", function()
    plan = ER.Plan()
    return plan.zone .. " (zone id " .. tostring(plan.zid) .. "), level " .. plan.level .. ", " .. plan.count .. " quests, " ..
      table.getn(plan.hubs) .. " stops, " .. table.getn(plan.chains) .. " chains, " .. table.getn(plan.grind) .. " grind spots"
  end)
  Step("every mode", function()
    local text = {}
    for _, key in ipairs(ER.MODE_ORDER) do
      local p = ER.Plan(plan.zone, plan.level, key)
      table.insert(text, key .. " " .. p.count)
    end
    return table.concat(text, ", ")
  end)
  Step("where next", function()
    local list = ER.WhereNext(plan.level, ER.Mode(), plan.zid)
    return table.getn(list) .. " suggestions, first: " .. (list[1] and list[1].name or "none")
  end)
  Step("window opens", function()
    ER.ShowGuide()
    local frame = getglobal("EasyRouteGuideFrame")
    assert(frame and frame:IsShown(), "window not shown")
  end)
  Step("quest rows", function()
    local shown = 0
    for i = 1, 9 do
      local row = getglobal("EasyRouteGuideRow" .. i)
      if row and row:IsShown() then shown = shown + 1 end
    end
    return shown .. " rows shown"
  end)
  Step("click a quest (find it)", function()
    local row = getglobal("EasyRouteGuideRow1")
    if row and row:IsShown() and row.cand then Click(row, "LeftButton") return "clicked " .. row.cand.q.n end
    return "no quest row to click"
  end)
  Step("show this stop", function()
    local b = getglobal("EasyRouteGuideGo")
    if b then Click(b) end
  end)
  Step("page stops", function()
    Click(getglobal("EasyRouteGuideNext"))
    Click(getglobal("EasyRouteGuidePrev"))
  end)
  Step("where next button", function()
    Click(getglobal("EasyRouteGuideWhere"))
    return getglobal("EasyRouteGuideAsk1"):IsShown() and "answers shown" or "no answers"
  end)
  Step("mode buttons", function()
    local keep = ER.Mode()
    Click(getglobal("EasyRouteGuideMode2"))
    Click(getglobal("EasyRouteGuideMode3"))
    ER.SetMode(keep)
  end)
  Step("hover tooltips", function()
    for _, name in ipairs({ "EasyRouteGuideRow1", "EasyRouteGuideRow101", "EasyRouteGuideRow201", "EasyRouteGuideMode1" }) do
      local f = getglobal(name)
      if f and f:IsShown() then
        this = f
        local enter, leave = f:GetScript("OnEnter"), f:GetScript("OnLeave")
        if enter then enter() end
        if leave then leave() end
      end
    end
  end)
  Step("grind spots", function()
    local g = plan.grind[1]
    if not g then return "none for this zone and level" end
    return table.concat(g.mobs, ", ") .. " around " .. math.floor(g.x) .. ", " .. math.floor(g.y)
  end)

  ER.db.selftest = { when = date("%Y-%m-%d %H:%M"), version = ER.VERSION, failed = failed, results = results }
  ER.Print("self-test " .. ER.VERSION .. ": " .. (failed == 0 and "everything ran" or (failed .. " step(s) failed")) ..
    ". Details are saved when you " .. ER.GOLD .. "/reload" .. ER.END .. " or log out.")
  for _, line in ipairs(results) do DEFAULT_CHAT_FRAME:AddMessage("  " .. line) end
end
