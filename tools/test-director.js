// Runs the director's decision logic on the real generated data, in a Lua VM (fengari), with the game's API stubbed.
// Lua 5.0 helpers the game has and fengari (Lua 5.3) lacks are added first.
// Usage: node tools/test-director.js        (needs: npm install, in this tools folder, or NODE_PATH set to fengari's folder)

const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

const ROOT = path.resolve(__dirname, "..");
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

function run(code, name) {
  const buf = typeof code === "string" ? to_luastring(code) : code;
  if (lauxlib.luaL_loadbuffer(L, buf, buf.length, to_luastring(name)) !== 0 || lua.lua_pcall(L, 0, 0, 0) !== 0) {
    console.error("FAILED in " + name + ": " + to_jsstring(lua.lua_tostring(L, -1)));
    process.exit(1);
  }
}

run(`
table.getn = function(t) return #t end
string.gfind = string.gmatch
math.mod = math.fmod
unpack = unpack or table.unpack
EasyRoute = { GOLD = "", END = "", Print = function(m) print("[print] " .. m) end,
  Char = function() return "Tester-Realm" end,
  Where = function() return "Westfall", "", 50, 50 end,
  Log = function(kind, fields) fields = fields or {} fields.t = kind fields.char = "Tester-Realm" return fields end,
  db = { journal = {}, ratings = {} } }
BASE_LOG = EasyRoute.Log
function setup(race, class, faction, level)
  UnitRace = function() return race, race end
  UnitClass = function() return class, string.upper(class) end
  UnitFactionGroup = function() return faction end
  UnitLevel = function() return level end
  EasyRoute.db.done = nil
  EasyRoute.db.skipped = nil
end
`, "prelude");

for (const f of ["Data/Quests.lua", "Data/Zones.lua", "Data/Mobs.lua", "Director.lua"]) {
  run(fs.readFileSync(path.join(ROOT, f)), f);
}

run(`
local ER = EasyRoute
local failures = 0
local function check(cond, msg)
  if not cond then failures = failures + 1 print("  FAIL: " .. msg) end
end
local function show(plan, howmany)
  print(string.format("  %s, level %d, %s mode: %d quests fit, %d stops%s", plan.zone, plan.level, plan.mode,
    plan.count, #plan.hubs, plan.leave and " -> time to move on" or ""))
  for i = 1, math.min(howmany or 2, #plan.hubs) do
    local h = plan.hubs[i]
    print(string.format("    stop %d: around %s (%.0f, %.0f), %d quests", i, h.giver, h.x, h.y, #h.items))
    for j = 1, math.min(4, #h.items) do
      local c = h.items[j]
      print(string.format("      L%d %s  [%s] (%s)", c.q.l, c.q.n, c.colour, ER.WhyQuest(c)))
    end
  end
  for i, ch in ipairs(plan.chains or {}) do
    print(string.format("    chain %d: %s, %d quests, levels %d-%d, ~%d xp%s", i, ch.name, ch.len, ch.lo, ch.hi, ch.xp, ch.rewards and ", rewards" or ""))
    check(ch.len >= 3, "a chain idea shorter than 3 quests")
  end
  for i, s in ipairs(plan.grind) do
    print(string.format("    grind %d: %s at (%.0f, %.0f), levels %d-%d, %d spawns", i, table.concat(s.mobs, ", "), s.x, s.y, s.lo, s.hi, s.count))
  end
  for i = 1, math.min(3, #plan.next) do
    local n = plan.next[i]
    print(string.format("    next: %s (%d quests, start near %s)", n.name, n.count, n.giver))
  end
end

print("1. Human warrior, level 12, Westfall, casual")
setup("Human", "Warrior", "Alliance", 12)
local plan = ER.Plan("Westfall", 12, "casual", 50, 50)
show(plan, 2)
check(plan.count > 5, "expected several quests in Westfall at level 12")
for _, h in ipairs(plan.hubs) do
  for _, c in ipairs(h.items) do
    check(c.q.l - 12 <= 2 and c.q.l - 12 >= -5, "quest level out of the casual window: " .. c.q.n)
    check(c.q.m <= 12, "quest needs a higher level: " .. c.q.n)
    check(not c.q.e, "casual should not list elite quests: " .. c.q.n)
    check(not c.q.r or math.floor(c.q.r / 1) % 2 == 1 or math.floor(c.q.r / 4) % 2 == 1, "race check: " .. c.q.n)
  end
end
for _, s in ipairs(plan.grind) do
  check(s.lo >= 11 and s.hi <= 14, "grind mobs outside level 11-14: " .. table.concat(s.mobs, ","))
end
check(#plan.grind > 0, "expected at least one grind spot in Westfall at 12")

print("2. Orc warrior, level 5, Durotar, casual: no Alliance quests")
setup("Orc", "Warrior", "Horde", 5)
plan = ER.Plan("Durotar", 5, "casual", 50, 50)
show(plan, 1)
check(plan.count > 3, "expected quests in Durotar at level 5")
for _, h in ipairs(plan.hubs) do
  for _, c in ipairs(h.items) do
    check(not c.q.r or math.floor(c.q.r / 2) % 2 == 1, "an Orc was offered a quest for another race: " .. c.q.n .. " r=" .. c.q.r)
  end
end

print("3. Same level 12 Westfall quests by mode (casual does more, hard moves on sooner)")
setup("Human", "Warrior", "Alliance", 12)
local counts = {}
for _, m in ipairs({ "casual", "medium", "hard" }) do
  counts[m] = ER.Plan("Westfall", 12, m, 50, 50).count
  print("  " .. m .. ": " .. counts[m])
end
check(counts.casual >= 1 and counts.hard >= 1, "every mode should find quests")

print("4. Marking a quest done removes it, skipping removes it too")
local first = plan
setup("Human", "Warrior", "Alliance", 12)
local list = ER.Candidates(ER.ZoneId("Westfall"), 12, "casual", 50, 50)
local target = list[1].q
ER.MarkDone(target.n, target.id)
local after = ER.Candidates(ER.ZoneId("Westfall"), 12, "casual", 50, 50)
local still = false
for _, c in ipairs(after) do if c.q.id == target.id then still = true end end
check(not still, "a done quest is still being suggested: " .. target.n)
local second = after[1].q
ER.SkipQuest(second.id)
local after2 = ER.Candidates(ER.ZoneId("Westfall"), 12, "casual", 50, 50)
still = false
for _, c in ipairs(after2) do if c.q.id == second.id then still = true end end
check(not still, "a skipped quest is still being suggested: " .. second.n)
print("  done and skip both honoured (" .. target.n .. ", " .. second.n .. ")")
check(EasyRoute.Log == BASE_LOG, "Director.lua still wraps ER.Log")
ER.OnTurnIn("Test Quest Done", 424242)
check(ER.IsDone({ id = 424242, n = "Test Quest Done" }), "ER.OnTurnIn did not mark the quest done")
check(pcall(ER.OnTurnIn, nil), "ER.OnTurnIn(nil) raised an error")

print("5. Chains hang together")
local found = 0
for zid, z in pairs(EasyRoute_Zones) do
  for _, q in ipairs(z.q) do
    if q.p then
      local chain = ER.ChainOf(q.id)
      if chain then
        found = found + 1
        for i = 2, #chain.ids do
          -- every step names the one before it as its prerequisite
          local rowId = chain.ids[i]
          local ok = false
          for _, z2 in pairs(EasyRoute_Zones) do
            for _, r in ipairs(z2.q) do if r.id == rowId and r.p == chain.ids[i - 1] then ok = true end end
          end
          check(ok, "chain step " .. i .. " does not follow step " .. (i - 1))
        end
      end
    end
    if found >= 40 then break end
  end
  if found >= 40 then break end
end
print("  checked " .. found .. " chain quests")

print("6. Level 20 Alliance, medium: where next from Ashenvale")
setup("Human", "Mage", "Alliance", 20)
plan = ER.Plan("Ashenvale", 20, "medium", 50, 50)
show(plan, 1)
local nxt = ER.WhereNext(20, "medium", ER.ZoneId("Ashenvale"))
check(#nxt > 0, "expected somewhere to go next at level 20")
for i = 1, math.min(4, #nxt) do print(string.format("  next %d: %s (%d quests fit)", i, nxt[i].name, nxt[i].count)) end

print("7. Level 45 Horde troll hunter, casual, Tanaris")
setup("Troll", "Hunter", "Horde", 45)
plan = ER.Plan("Tanaris", 45, "casual", 50, 50)
show(plan, 1)

print("8. Unknown zone does not crash")
plan = ER.Plan("Nowhere Land", 10, "casual", 50, 50)
check(plan.count == 0 and #plan.hubs == 0, "unknown zone should give an empty plan")

print("9. Difficulty names and the one-time switch")
check(table.getn(ER.MODE_ORDER) == 3, "there should be three difficulties, found " .. table.getn(ER.MODE_ORDER))
check(ER.MODES.everything == nil and ER.MODES.normal == nil, "the old difficulty names are still in ER.MODES")
local m1 = { mode = "normal" }
ER.MigrateMode(m1)
check(m1.mode == "hard", "normal did not become hard")
local m2 = { mode = "everything" }
ER.MigrateMode(m2)
check(m2.mode == "hard" and m2.autoPrompt == true, "everything did not become hard with the tester tick")
local m3 = { mode = "casual" }
ER.MigrateMode(m3)
check(m3.mode == "casual", "casual was changed")
local m4 = {}
ER.MigrateMode(m4)
check(m4.mode == nil, "a save with no difficulty was given one")
check(pcall(ER.MigrateMode, nil), "MigrateMode(nil) raised an error")
check(pcall(ER.MigrateMode, "x"), "MigrateMode of a string raised an error")
ER.MigrateMode(m1)
check(m1.mode == "hard", "running MigrateMode twice changed hard")
for _, case in ipairs({ { "normal", "hard" }, { "everything", "hard" }, { "hard", "hard" }, { false, "casual" } }) do
  EasyRoute.db.mode = case[1] or nil
  check(ER.Mode() == case[2], "ER.Mode() for a saved " .. tostring(case[1]) .. " gave " .. ER.Mode() .. ", wanted " .. case[2])
end
EasyRoute.db.mode = nil
print("  difficulty names ok")

if failures == 0 then print("ALL CHECKS PASSED") else print(failures .. " CHECK(S) FAILED") os.exit(1) end
`, "scenarios");

