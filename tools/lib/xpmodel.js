// The game's 1.12 experience rules, used by the route builder and the route test so both work out levels the same way.
// The tables and the kill formula are the ones in the owner's BoarChallengePlus addon (Where.lua); the quest numbers
// (about 90 xp per quest level, about 6 kills for every kill or collect quest) were calibrated against RestedXP's
// whole route (see 02-RESEARCH, F2). pfExtend's own xp numbers are not used for levels.
//   const x = require("./lib/xpmodel.js");  x.walk(0, [{ l: 3, m: 1, k: true }], 10) -> { total, grind }

// Experience from each level to the next, levels 1 to 59.
const XP_TABLE = [
  400, 900, 1400, 2100, 2800, 3600, 4500, 5400, 6500, 7600,
  8800, 10100, 11400, 12900, 14400, 16000, 17700, 19400, 21300, 23200,
  25200, 27300, 29400, 31700, 34000, 36400, 38900, 41400, 44300, 47400,
  50800, 54500, 58600, 62800, 67100, 71600, 76100, 80800, 85700, 90700,
  95800, 101000, 106300, 111800, 117500, 123200, 129100, 135100, 141200, 147500,
  153900, 160400, 167100, 173900, 180800, 187900, 195000, 202300, 209800,
];
const K = 6; // kills of the quest's own level counted for every quest with something to kill or collect
const QUEST_XP_PER_LEVEL = 90;

// The highest mob level that gives no experience at all to a character of this level.
function greyLevel(level) {
  if (level <= 5) return 0;
  if (level <= 39) return level - 5 - Math.floor(level / 10);
  if (level <= 59) return level - 1 - Math.floor(level / 5);
  return level - 9;
}

function zeroDiff(level) {
  if (level < 8) return 5;
  if (level < 10) return 6;
  if (level < 12) return 7;
  if (level < 16) return 8;
  if (level < 20) return 9;
  if (level < 30) return 11;
  if (level < 40) return 12;
  if (level < 45) return 13;
  if (level < 50) return 14;
  if (level < 55) return 15;
  if (level < 60) return 16;
  return 17;
}

function killXP(level, mobLevel) {
  const base = level * 5 + 45;
  if (mobLevel >= level) {
    const d = Math.min(mobLevel - level, 4);
    return Math.floor((Math.floor(base * (20 + d) / 10) + 1) / 2);
  }
  if (mobLevel > greyLevel(level)) {
    const zd = zeroDiff(level);
    return Math.floor(base * (zd + mobLevel - level) / zd);
  }
  return 0;
}

// diff = the player's level minus the quest's level
function reduction(diff) {
  if (diff <= 5) return 1;
  if (diff === 6) return 0.8;
  if (diff === 7) return 0.6;
  if (diff === 8) return 0.4;
  if (diff === 9) return 0.2;
  return 0.1;
}

function questXP(questLevel, playerLevel) {
  return Math.floor(QUEST_XP_PER_LEVEL * Math.max(questLevel, 1) * reduction(playerLevel - questLevel));
}

// Total xp at the start of a level (level 1 = 0, level 60 = 4084700). The level is clamped, so the table is never
// read past its end.
function xpAt(level) {
  const lv = Math.max(1, Math.min(60, Math.floor(level)));
  let sum = 0;
  for (let i = 0; i < lv - 1; i++) sum += XP_TABLE[i];
  return sum;
}

// The level as a decimal (10.5 = half way through level 10), never above 60.
function levelAt(total) {
  let level = 1, left = Math.max(0, total);
  while (level < 60 && left >= XP_TABLE[level - 1]) {
    left -= XP_TABLE[level - 1];
    level++;
  }
  if (level >= 60) return 60;
  return level + left / XP_TABLE[level - 1];
}

// Plays a list of quests in plan order, { l: quest level, m: lowest level that may take it, k: kill or collect }.
// A quest the character is too low for is waited for by grinding; at the end the character grinds up to the target level.
// Grinding is progress, never "stuck". Returns the xp total and the levels ground, as a decimal.
function walk(total, quests, target) {
  let grind = 0;
  function grindTo(level) {
    const goal = xpAt(level);
    if (total < goal) {
      grind += levelAt(goal) - levelAt(total);
      total = goal;
    }
  }
  for (const q of quests) {
    const m = q.m || 1;
    if (Math.floor(levelAt(total)) < m) grindTo(m);
    const level = Math.floor(levelAt(total));
    total += questXP(q.l, level) + (q.k ? K * killXP(level, q.l) : 0);
  }
  grindTo(target);
  return { total, grind };
}

module.exports = { XP_TABLE, K, QUEST_XP_PER_LEVEL, greyLevel, zeroDiff, killXP, reduction, questXP, xpAt, levelAt, walk };
