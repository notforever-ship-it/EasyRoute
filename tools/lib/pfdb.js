// Shared loader for the dev tools: a Lua VM (fengari) with the Lua 5.0 helpers the game has, and the pfQuest,
// pfQuest-turtle and pfExtend quest databases read into plain JS objects. Requiring this file does nothing by itself.
//   const { newLuaVM, loadPf } = require("./lib/pfdb.js");
//   const vm = newLuaVM(); vm.run(luaCode, "name"); const obj = vm.get("SomeLuaGlobal");
//   const { db, place } = loadPf("E:/Ravencraft/twmoa_1181/Interface/AddOns");
// The loading code comes from tools/build-director.js (same files, same Turtle patch, same place() rule).

const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = require("fengari");

// Lua 5.0 names the game has and fengari (Lua 5.3) lacks, an empty EasyRoute table for the Data files, and ER_SER:
// a Lua value to JSON text. Newline, tab and carriage return stay as \n, \t and \r so guide strings survive.
const PRELUDE = String.raw`
table.getn = function(t) return #t end
string.gfind = string.gmatch
math.mod = math.fmod
unpack = unpack or table.unpack
EasyRoute = { Loaded = function() end }
function ER_SER(v)
  local t = type(v)
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    return tostring(v)
  elseif t == "boolean" then
    return tostring(v)
  elseif t == "string" then
    local s = v:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n'):gsub('\t', '\\t'):gsub('\r', '\\r'):gsub('[%c]', ' ')
    return '"' .. s .. '"'
  elseif t == "table" then
    local n = 0
    for _ in pairs(v) do n = n + 1 end
    if n == 0 then return "[]" end
    local isarr = true
    for i = 1, n do if v[i] == nil then isarr = false break end end
    local parts = {}
    if isarr then
      for i = 1, n do parts[#parts + 1] = ER_SER(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for k, x in pairs(v) do parts[#parts + 1] = '"' .. tostring(k) .. '":' .. ER_SER(x) end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end
`;

function newLuaVM() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  function run(code, name) {
    const buf = typeof code === "string" ? to_luastring(code) : code;
    if (lauxlib.luaL_loadbuffer(L, buf, buf.length, to_luastring(name)) !== 0 || lua.lua_pcall(L, 0, 0, 0) !== 0) {
      throw new Error(name + ": " + to_jsstring(lua.lua_tostring(L, -1)));
    }
  }
  function get(expr) {
    run("ER_OUT = ER_SER(" + expr + ")", "get " + expr);
    lua.lua_getglobal(L, to_luastring("ER_OUT"));
    const text = to_jsstring(lua.lua_tostring(L, -1));
    lua.lua_pop(L, 1);
    return JSON.parse(text);
  }
  run(PRELUDE, "prelude");
  return { run, get };
}

// The Turtle patch, pfExtend's corrections and the dump of everything the route builder needs.
const PATCH = String.raw`
local function patch(base, diff)
  for k, v in pairs(diff) do
    if v == "_" then base[k] = nil else base[k] = v end
  end
end
for _, db in ipairs({"quests", "units", "objects", "zones", "items"}) do
  if rawget(pfDB[db], "data-turtle") then patch(pfDB[db]["data"], pfDB[db]["data-turtle"]) end
  if rawget(pfDB[db], "enUS-turtle") then patch(pfDB[db]["enUS"], pfDB[db]["enUS-turtle"]) end
end
`;
const DUMP = String.raw`
local function names(db, key)
  local out = {}
  for id, v in pairs(pfDB[db]["enUS"]) do
    if type(v) == "table" then out[id] = v[key] else out[id] = v end
  end
  return out
end
local function texts()
  local out = {}
  for id, v in pairs(pfDB["quests"]["enUS"]) do
    if type(v) == "table" then
      out[id] = string.lower((v.O or "") .. " " .. (v.D or ""))
    end
  end
  return out
end
local function drops()
  local out = {}
  for _, q in pairs(pfDB["quests"]["data"]) do
    local items = type(q) == "table" and type(q.obj) == "table" and q.obj.I
    if type(items) == "table" then
      for _, itemId in pairs(items) do
        local it = pfDB["items"]["data"][itemId]
        if type(it) == "table" and not out[itemId] then out[itemId] = { U = it.U, O = it.O } end
      end
    end
  end
  return out
end
ER_DUMP = {
  quests = pfDB["quests"]["data"], qnames = names("quests", "T"), qtext = texts(),
  units = pfDB["units"]["data"], unames = names("units"),
  objects = pfDB["objects"]["data"], onames = names("objects"),
  zones = pfDB["zones"]["data"], znames = names("zones"),
  items = drops(),
}
`;

function loadPf(root) {
  if (!root || !fs.existsSync(path.join(root, "pfQuest", "db", "quests.lua"))) {
    throw new Error("pfQuest was not found in " + root + " (looked for pfQuest/db/quests.lua)");
  }
  const vm = newLuaVM();
  vm.run('pfDB = setmetatable({}, {__index = function(t, k) local v = {} rawset(t, k, v) return v end})', "init");
  const files = [];
  for (const db of ["quests", "units", "objects", "zones"]) {
    files.push(`pfQuest/db/${db}.lua`, `pfQuest/db/enUS/${db}.lua`, `pfQuest-turtle/db/${db}-turtle.lua`, `pfQuest-turtle/db/enUS/${db}-turtle.lua`);
  }
  files.push("pfQuest/db/items.lua", "pfQuest-turtle/db/items-turtle.lua");
  for (const f of files) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) vm.run(fs.readFileSync(p), f);
    else console.warn("missing (skipped): " + f);
  }
  vm.run(PATCH, "turtle patch");
  const extend = path.join(root, "pfExtend", "dbOverwrite.lua");
  if (fs.existsSync(extend)) {
    vm.run(fs.readFileSync(extend), "pfExtend/dbOverwrite.lua");
    console.log("pfExtend corrections applied");
  } else {
    console.log("pfExtend not found: no corrections");
  }
  vm.run(DUMP, "dump");
  const db = vm.get("ER_DUMP");

  const titled = Object.keys(db.quests).filter((id) => db.qnames[id] && db.quests[id] && db.quests[id].lvl != null).length;
  const unitCount = Object.keys(db.units).length;
  if (titled < 6000) throw new Error(`source looks incomplete: only ${titled} quests have a title and a level (expected more than 6000)`);
  if (unitCount < 5000) throw new Error(`source looks incomplete: only ${unitCount} units (expected more than 5000)`);

  // pfQuest stores a few towns (Darkshire in Duskwood) as zones of their own, with the town's own 0-100 map. Fold such
  // a sub-area back into its parent zone: the zone table gives parent, width, height, centre x and centre y on the parent.
  function place(c) {
    const sub = db.zones[c[2]];
    if (Array.isArray(sub) && sub[0] > 0 && db.znames[sub[0]]) {
      return [Math.round((sub[3] + (c[0] - 50) * sub[1] / 100) * 10) / 10, Math.round((sub[4] + (c[1] - 50) * sub[2] / 100) * 10) / 10, sub[0]];
    }
    return [c[0], c[1], c[2]];
  }
  return { db, place };
}

module.exports = { newLuaVM, loadPf };
