-- Easy Route: /er selftest. Runs the zone logic, the wizard, the guide and the arrow inside the real game, and
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

function ER.SelfTest()
  -- The steps below set the game's global `this` and `arg1` to click their own buttons. The slash command that
  -- started this runs inside the chat box's own handler, which still needs its `this` afterwards, so put both
  -- back at the end (otherwise ChatFrame.lua errors with "attempt to index field '?'").
  local keepThis, keepArg1 = this, arg1
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
  Step("wizard", function()
    assert(ER.ShowWizard and ER.WizardInfo, "Wizard.lua did not load")
    ER.ShowWizard()
    local w = ER.WizardInfo()
    assert(w and w.text and w.text ~= "", "the wizard has no text")
    getglobal("EasyRouteWizardFrame"):Hide()
    return "opens and shows the " .. w.screen .. " screen"
  end)
  Step("grind spots", function()
    local g = plan.grind[1]
    if not g then return "none for this zone and level" end
    return table.concat(g.mobs, ", ") .. " around " .. math.floor(g.x) .. ", " .. math.floor(g.y)
  end)
  Step("guides", function()
    assert(ER.Steps and EasyRoute_Guides, "Steps.lua or Data\\Guides.lua did not load")
    local mine = ER.Steps.Guides()
    assert(table.getn(mine) > 10, "only " .. table.getn(mine) .. " guides for this character")
    local best = ER.Steps.Suggest()[1]
    return table.getn(mine) .. " guides for you, suggested: " .. (best and (best.title or best.name) or "none")
  end)
  Step("guide running", function()
    if not ER.Steps.Running() then return "no guide running (pick one with /er to test this part)" end
    local step = ER.Steps.Current()
    local t = ER.Steps.Target()
    return (ER.Steps.Info().title or "?") .. ", step " .. ER.Steps.Position() .. " of " .. ER.Steps.Count() ..
      (step and (": " .. string.gsub(ER.Steps.Title(step), "|c%x%x%x%x%x%x%x%x", "")) or " (finished)") ..
      (t and (", arrow to " .. t.zone .. " " .. math.floor(t.x) .. "," .. math.floor(t.y)) or ", no arrow target")
  end)
  Step("arrow", function()
    assert(ER.ToggleArrow and ER.ArrowUpdate, "Arrow.lua did not load")
    ER.ArrowUpdate()
    local f = getglobal("EasyRouteArrow")
    assert(f, "the arrow was not built")
    local size = EasyRoute_ZoneSizes and EasyRoute_ZoneSizes[GetZoneText()]
    return (f:IsShown() and "shown" or "hidden") .. (ER.db.arrowOff and " (turned off with /er arrow)" or "") ..
      ", facing " .. (GetPlayerFacing and "from the game" or (pfQuestCompat and pfQuestCompat.GetPlayerFacing and "from pfQuest" or "from the minimap")) ..
      ", zone size " .. (size and (math.floor(size[1]) .. " x " .. math.floor(size[2]) .. " yards") or "unknown")
  end)

  ER.db.selftest = { when = date("%Y-%m-%d %H:%M"), version = ER.VERSION, failed = failed, results = results }
  ER.Print("self-test " .. ER.VERSION .. ": " .. (failed == 0 and "everything ran" or (failed .. " step(s) failed")) ..
    ". Details are saved when you " .. ER.GOLD .. "/reload" .. ER.END .. " or log out.")
  for _, line in ipairs(results) do DEFAULT_CHAT_FRAME:AddMessage("  " .. line) end
  this, arg1 = keepThis, keepArg1
end

ER.Loaded("Selftest.lua")
