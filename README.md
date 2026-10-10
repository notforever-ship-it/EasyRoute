# Easy Route

A relaxed leveling guide for the 1.12 client (Turtle WoW, Ravencraft, OctoWoW and other vanilla servers). It is simple to use: one step at a time in a box on the right of the screen, and an arrow at the top that points the way. It is made for the casual player, not for speed: the **casual route** takes you through the game one zone at a time, from level 1 to 60, keeps the fun quests, and leaves out the really hard ones. It starts by itself on a new character. If you want to go faster, the quick routes are still there as the **Fast route**.

## The guide (`/er`)

- **It starts by itself.** On a new character the casual route starts a few seconds after you log in, with one line in the chat. `/er` (or the minimap button) opens the start screen only when you ask for it: it asks how hard you want it, then suggests a zone or guide for your level and faction. **Go with this** starts it.
- **One zone at a time.** The grey line under the step says where you are in the plan, for example "Durotar (1-10): 3 of 20 quests done. Next: Orgrimmar at 10." When a zone is done, the first step of the next one says how to get there (a walk, a boat, a flight path), the arrow points the way, and the next zone starts by itself.
- **Fast route.** Click the guide's name: the casual route is listed first, and the quick routes are below it as **Fast route**. A character that already follows one keeps it.
- **Stuck? Skip this step.** When a step has not moved for ten minutes, a line (a tip in Simple mode) offers to skip it. It only skips when you click it.

- **The step box** (right side of the screen) shows the step you are on: talk to this person, accept these, kill these (with the count), hand in, buy, train, fly, set your hearthstone. Each part ticks itself off as you do it and the guide moves on by itself. Below it, the guide's name with a gear for Settings, then the next few steps; click one to jump to it. `<` and `>` step by hand, **Skip** leaves a step out, **Done** ticks a step the game cannot check.
- **The arrow** (top of the screen) points at the next place and says how many yards away it is, green when you face it, red when it is behind you. Drag it to move it, right-click hides it, `/er arrow` brings it back. With pfQuest installed the place is also marked on the world map and the minimap.
- **When a guide ends** the next one starts by itself (you can turn that off in Settings). Clicking the guide's name lists the casual route first, then every Fast route guide for your faction by level.
- **It fits your level.** Quests that have gone grey for you are left out, a quest above your comfort gets a red "Hard for your level" line, and when you are two levels past the top of a guide it offers one that fits.
- **Simple mode**: a quest list on the left instead of the step box, with a short line like "Durotar: 12/20 done" in place of the guide's name. Click a quest and the arrow points there; click it again and the arrow follows the guide.
- **Grind spots**: when there are no good quests to do, the guide says which mobs to grind, where, and why, for example "Grind Mottled Boars near ... until level 2", and the arrow points to the spot. The step ends by itself when you reach the level. When you are behind the plan and the next quests are too high for you, a grind step comes first and asks you to grind to the level they need. Mobs that are yellow for you (they will not attack you first) are picked first; the guide also learns which mobs are yellow or red from the ones you target or point at. Settings has a tick, **Show grind spots**, to turn all of this off and get the plain grind steps back.
- **Auto mode**: at an NPC, Easy Route does the clicking for you. It takes the quests your route wants (and no others), hands in the ones you have finished, picks the right choices in NPC menus, takes the flight on a fly step, sets your hearthstone on its step, and sells grey items and repairs at a vendor. It never accepts an escort quest for you: the chat says "Escort quest: accept it yourself when you are ready." When a quest offers two or more rewards, the pick is yours: the window stays open and the chat says "Pick your reward for ...". Only when none of the rewards fits your character does it take the one that sells for the most, and it says so in one chat line. Each part has its own tick in Settings, and the whole thing has one tick. Hold **Shift** when you start talking to an NPC and that talk is left to you. On a hearth step the line **Use your hearthstone** only works when you click it; nothing ever uses your hearthstone by itself. If AutoQuest (or another addon that does the same) is on, Easy Route leaves to it what it does and says so once in the chat.
- **Warnings**: the step box (the tips box in Simple mode) shows "Heads up" lines about dangerous mobs on the step you are on, and a heads-up before a mine, cave or crypt (once, when you walk in too).
- **How is it going?** Every 3 levels the guide asks **Too easy**, **About right** or **Too hard**, and moves how many levels above you quests may be. If you say the same thing again at the end of the range, it offers to switch difficulty. There is a tick in Settings to turn it off.
- **Easy Route says**: a small tips box under the guide with the guide's own warnings, trainer reminders, and a question now and then.
- **Enemies** say Easy, Medium or Hard at the bottom of their tooltip, and a gold skull over their health bar (the V key shows the bars) marks the ones your quests still need.
- The guide remembers where you are on each character.

## How hard

- **Casual** leaves out group, elite, dungeon and escort quests, risky quests, quests friends found hard, and quests you died on twice or skipped.
- **Medium** leaves out group, elite and dungeon quests and the hard ones; escorts and risky quests stay, with a warning.
- **Hard** does everything except dungeon quests.

Change it any time with **Change difficulty** in Settings. When you press **Skip** on a quest, or die twice on one, the guide counts it as Hard for that character and leaves it out on Casual from then on; typing `/er unskip` brings those quests back.

## Settings

The gear on the guide, right-clicking the minimap button, or `/er settings` opens every option in one place, in two groups:

- **The guide**: pick a guide, change difficulty, start again, stop, simple mode, the arrow, tips, grind spots, skulls, enemy tooltips, leaving out the steps that only farm money, going straight on to the next guide, asking every 3 levels how it is going, auto mode (one tick, and a tick for each part), the minimap button, and How to use.
- **Feedback (for testers)**: tick **Ask me how hard each quest was** and a small box asks after each hand-in. **Send feedback** puts your answers in a box, already selected: press Ctrl+C and paste it to stealthzi. Party chat on hand-in and a popup for the first quest of a chain are here too, both off unless you tick them.

Nothing leaves your computer by itself: addons on this client have no internet access. Your answers are saved in `WTF\Account\<account>\SavedVariables\EasyRoute.lua` when you log out.

## Commands

| Command | What it does |
|---|---|
| `/er` | The guide (also the minimap button): starts one, or shows and hides the steps |
| `/er settings` | Every option in one place |
| `/er arrow` | The arrow on or off |
| `/er next` | Skip the step you are on |
| `/er stop` | Stop the guide |
| `/er help` | The "how to use" window |

## Installing

Copy the `EasyRoute` folder into `Interface\AddOns\`, or run `node tools/install.js <path to Interface\AddOns>` from this folder. After an update that adds or removes a file, close the game completely and start it again (a `/reload` is not enough).

## Checking the code

`node tools/check-lua.js .` parses every Lua file as Lua 5.0, lists anything the 1.12 client does not have, and checks that the version, the file list in `EasyRoute.toc` and each file's last line agree.

`node tools/test-director.js` and `node tools/test-guide.js` run the zone logic, the windows and Core.lua against a mock of the game. `node tools/test-steps.js Human:WARRIOR:Alliance` plays that character's guides to the end in a pretend game, and the whole casual route from the automatic start to the last zone, and checks the guide moves on by itself. `node tools/test-route-run.js` plays the casual route of every race quickly and checks the position line, the travel steps, the difficulty rules and the stuck line; `node tools/test-route.js Alliance Human Dwarf Gnome NightElf` and `node tools/test-route.js Horde Orc Troll Tauren Undead` check the route data for each faction. They need the Lua VM `fengari` (`npm install` in the `tools` folder). None of them can show how the windows look in the game.

## Rebuilding the data

`Data\Zones.lua` and `Data\Mobs.lua` are generated, not written by hand:

    node tools/build-director.js <folder holding pfQuest and pfQuest-turtle> [rewards_data.lua]

`Data\Guides.lua` (the guides) and `Data\ZoneSizes.lua` (map sizes for the arrow) come from

    node tools/build-guides.js <RXPGuides folder> <folder holding pfQuest and pfQuest-turtle>

which keeps the classic Alliance and Horde fast routes for the normal game (no Season of
Discovery, hardcore or double-XP steps). `Media\Arrow.tga` is drawn by `node tools/make-arrow.js`.

`Data\Route.lua` (the casual route: which zones, in which order, which quests, the travel between zones and the flight paths) is built by

    node tools/build-route.js

from the fast routes' quest order, the quest facts of older leveling guides (in `tools\data\guide-index.tsv`, rebuilt by `node tools/build-guide-index.js <TourGuide folder> <VanillaGuide folder>`) and the pfQuest data. The hand-kept parts are `tools\route-ladder.js` (the order of the zones for each race) and `tools\route-travel.js` (the way from one zone to the next). Building it twice gives the same file.

`Data\Quests.lua` comes from `node tools/build-quests.js <TourGuideVanilla folder>` and keeps only
facts (ids, titles, givers, places, chains), not the route's wording.

## Credits

- Leveling routes: [RestedXP Guides](https://github.com/RestedXP/RXPGuides) by RestedXP, their free
  classic guides (the **Fast route**, and the order of the quests the casual route is built from),
  used under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 licence. The guide data in
  `Data\Guides.lua` and the quest order in `Data\Route.lua` are shared under that same licence; Easy Route
  is free and not sold.
- Map sizes for the arrow: pfQuest and pfQuest-turtle.
- Quest and mob data: [pfQuest](https://github.com/shagu/pfQuest) and pfQuest-turtle by Shagu (MIT).
- Quest experience and reward numbers: pfExtend by Cliencer (MIT), whose table was gathered from the
  OctoWow database.
- Which mobs are yellow (they will not attack you first) or red: worked out from the
  [CMaNGOS classic-db](https://github.com/cmangos/classic-db) (GPL-3.0) creature table and the game's own
  faction data. Only these facts are kept (`tools\data\creature-react.tsv`); the database itself is not shipped.
- The casual route was built from RestedXP, TourGuide, VanillaGuide, pfQuest and pfExtend.
- The risky-quest facts and the danger warnings come from RestedXP's Survival Guide (CC BY-NC-SA 4.0); the Hard list also comes from friends' feedback.
- Leveling-route hints: TourGuideVanilla by cralor, based on TourGuide by Tekkub (credits: Road-block,
  rsheep). Only facts are used.
- Leveling-route hints: VanillaGuide by mrmr and lanjelin (route authors Joana for the Horde and Brian Kopp
  for the Alliance). Only facts are used.
- Easy Route by stealthzi (MIT).
