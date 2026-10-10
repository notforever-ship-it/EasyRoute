// Shared word lists: which text warns of danger, which text is only practical advice, which words name a cave.
// tools/build-guides.js (the Survival Guide pass) and tools/build-route.js read the same lists, so both judge text the same way.
// Plain CommonJS, no dependencies. Every list is a whole-word test (\b), never a part of a word.

// Words that make a line a danger warning (the words Steps.lua already shows as warnings, plus the ones the Survival Guide uses).
const DANGER = /\b(avoid|careful|caution|cautious|watch out|danger|dangerous|beware|elite|elites|elite pack|difficult|very difficult|hits hard|hit hard|aggro|tougher|patrol|patrols|patrolling|stealth|stealthed|flee|flees|pull|pulls|pulled|double pull|stun|stuns|fatal|net|nets|a lot of damage|execute|fear|ambush)\b/i;

// Words of practical advice (shopping, timers, spells): a line with one of them is not a danger warning.
const PRACTICAL = /\b(buy|vendor|sell|logout|log out|auction|bank|mail|equip|destroy|delete|train|hearth|fly to|flight|video|click here|timer|duration|minute|cheap|optional|later|not have to|link|cast \[|use \[|polymorph|renew|power word|frost nova|rain of fire|blizzard|summon)\b/i;

// Text that calls a quest too hard to do alone.
const FATAL = /\b(very difficult|can be fatal|this quest (is|can be) difficult|unable to find a group|find a group for|extremely dangerous)\b/i;

// Names of guides. The player never sees one, so a warning that holds one is not used.
const GUIDE_NAMES = /\b(RestedXP|RXP|TourGuide|VanillaGuide|Questie|Guidelime)\b/i;

// Words about another kind of server ("way too dangerous in Hardcore"). This server is a normal one, so a warning that holds one is
// not used.
const SERVER_TYPE = /\b(hardcore|softcore|HC)\b/i;

// Words that name a cave-like place. "mine" is only a place as a noun (after "the", "a", or a capital word, or written "Mine").
const CAVE_WORDS = ["cave", "caves", "cavern", "caverns", "crypt", "crypts", "den", "grotto", "burrow", "burrows", "hollow", "tunnel",
  "tunnels", "barrow", "barrows", "catacomb", "catacombs", "lair", "tomb", "tombs", "quarry", "mines", "mine"];
const CAVE_PLAIN = new RegExp("\\b(" + CAVE_WORDS.filter((w) => w !== "mine").join("|") + ")\\b", "i");
// The three ways "mine" is a place; case matters for the capital-word rule, so each is tested on its own.
const MINE_CAPITAL = /\b[A-Z][\w'-]+\s+(mine)\b/;
const MINE_WRITTEN = /\b(Mine)\b/;
const MINE_AFTER_THE = /\b(?:the|a|an)\s+(mine)\b/i;

// The cave word in a text, lower case, or null. "The Den" (a Durotar area that is no cave) is taken out first.
function caveIn(text) {
  const t = String(text || "").replace(/\bThe Den\b/g, " ");
  const plain = t.match(CAVE_PLAIN);
  if (plain) return plain[1].toLowerCase();
  const mine = t.match(MINE_AFTER_THE) || t.match(MINE_CAPITAL) || t.match(MINE_WRITTEN);
  return mine ? mine[1].toLowerCase() : null;
}

// What a cave word is called in the game's list: mine, crypt or cave.
function caveWordFor(word) {
  const w = String(word || "").toLowerCase();
  if (w === "mine" || w === "mines" || w === "quarry") return "mine";
  if (/^(crypts?|barrows?|catacombs?|tombs?)$/.test(w)) return "crypt";
  return "cave";
}

// Names that hold a cave word but are not caves, so they never join the list.
const CAVE_NOISE = ["The Den", "Caverns of Time", "Hollow Web Woods", "Hollow Web Cemetery", "Westhaven Hollow", "Slaughter Hollow",
  "Moonsilk Hollow"];
function isCaveNoise(name) {
  return CAVE_NOISE.indexOf(name) >= 0 || /UNUSED/i.test(name);
}

// Caves the game's area table does not name with a cave word, added by hand with their zone.
const CAVE_EXTRA = [
  { zone: "Durotar", name: "Burning Blade Coven" },
  { zone: "Durotar", name: "Skull Rock" },
  { zone: "Dun Morogh", name: "Frostmane Hold" },
  { zone: "Mulgore", name: "Palemane Rock" },
  { zone: "Mulgore", name: "Thunderhorn Water Well" },
  { zone: "Mulgore", name: "Winterhoof Water Well" },
  { zone: "Mulgore", name: "Wildmane Water Well" },
  { zone: "Loch Modan", name: "Mo'grosh Stronghold" },
  { zone: "Wetlands", name: "Whelgar's Excavation Site" },
];

module.exports = { DANGER, PRACTICAL, FATAL, GUIDE_NAMES, SERVER_TYPE, CAVE_WORDS, CAVE_NOISE, CAVE_EXTRA, caveIn, caveWordFor, isCaveNoise };
