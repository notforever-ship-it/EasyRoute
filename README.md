# Easy Route

A relaxed leveling guide for the 1.12 client (Turtle WoW, Ravencraft, OctoWoW and other vanilla servers).

- One zone at a time, level 1 to 60.
- Keeps the fun quests, leaves out the really hard ones.
- A step box on the right and an arrow on screen show the way.
- Does the NPC clicking for you.

## Start

- Type `/er`, pick how hard, click **Go with this**.
- On a new character it starts by itself.
- Steps tick off by themselves as you play.
- The grey line under the step shows where you are in the plan.
- Up to level 20, a grey **Why:** line says why a step is worth doing.

## Buttons

- `<` and `>`: go back or forward a step.
- **Skip**: leave a quest out. It counts as Hard for you from then on.
- **Right-click a quest** in the list: **Skip quest** leaves just that one out.
- **Stuck? Skip this step**: shows after 10 minutes on one step.
- Gear button: **Settings**, with pages: Guide, Auto mode, Helpers, Feedback.
- Click the guide's name to pick another guide, or the **Fast route**.

## Auto mode (on by default)

- Takes your route's quests and hands in finished ones.
- Takes the flight, sets your hearthstone, sells grey items and repairs.
- Rewards: you pick. If none fit you, it takes the one that sells for the most.
- Never takes escort quests for you.
- Hold **Shift** when you talk to an NPC to do it yourself.
- Each part has its own tick in Settings, Auto mode page.
- Hearth steps: click **Use your hearthstone**. It never hearths by itself.
- Works alongside AutoQuest.

## Helpers

- **Grind spots**: safe mobs to kill when there are no good quests.
- **Warnings**: dangerous mobs, caves and mines.
- **Quest chains**: kept only when worth it. The first step says what you get.
- **How is it going?**: every 3 levels, answer Too easy, About right or Too hard.
- **Simple mode**: a quest list instead of the step box.
- Enemy tooltips say Easy, Medium or Hard. Gold skulls mark the mobs your quests need.

## How hard

- **Casual**: no group, elite, dungeon, escort or risky quests.
- **Medium**: escorts and risky quests stay, with a warning.
- **Hard**: everything except dungeon quests.
- Quests you skip or die on twice count as Hard for you.

## Commands

| Command | What it does |
|---|---|
| `/er` | Show or hide the guide |
| `/er settings` | All options |
| `/er arrow` | Arrow on or off |
| `/er next` | Next step |
| `/er unskip` | Bring back skipped quests |
| `/er stop` | Stop the guide |
| `/er help` | How to use |
| `/er welcome` | The welcome notice |

## Install

- Copy the `EasyRoute` folder into `Interface\AddOns\`, or update through your launcher.
- If an update adds a file: close the game completely and start it again.

## Feedback

- Settings > Feedback: tick **Ask how hard each quest was**.
- **Send feedback** gives you text to copy and send to stealthzi.
- Nothing leaves your computer by itself.

# For developers

## Checking the code

`node tools/check-lua.js .` parses every Lua file as Lua 5.0, lists anything the 1.12 client does not have, and checks that the version, the file list in `EasyRoute.toc` and each file's last line agree.

`node tools/test-director.js` and `node tools/test-guide.js` run the zone logic, the windows and Core.lua against a mock of the game. `node tools/test-steps.js Human:WARRIOR:Alliance` plays that character's guides to the end in a pretend game, and the whole casual route from the automatic start to the last zone, and checks the guide moves on by itself. `node tools/test-route-run.js` plays the casual route of every race quickly and checks the position line, the travel steps, the difficulty rules and the stuck line; `node tools/test-route.js Alliance Human Dwarf Gnome NightElf` and `node tools/test-route.js Horde Orc Troll Tauren Undead` check the route data for each faction. They need the Lua VM `fengari` (`npm install` in the `tools` folder). None of them can show how the windows look in the game.

## Rebuilding the data

`Data\Zones.lua` and `Data\Mobs.lua` are generated, not written by hand:

    node tools/build-director.js <folder holding pfQuest and pfQuest-turtle> [rewards_data.lua]

`Data\Guides.lua` (the guides) and `Data\ZoneSizes.lua` (map sizes for the arrow) come from

    node tools/build-guides.js <RXPGuides folder> <folder holding pfQuest and pfQuest-turtle>

which keeps the classic Alliance and Horde fast routes for the normal game (no Season of
Discovery, hardcore or double-XP steps). The same run writes `Data\Survival.lua` (the risky quests, the danger warnings
in Easy Route's own words and the caves; add the game's `Data` folder as a third argument for the cave list).
Building it twice gives the same files. `Media\Arrow.tga` is drawn by `node tools/make-arrow.js`.

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
- The quest-chain facts come from pfQuest and pfQuest-turtle (which quest comes after which), the
  [CMaNGOS classic-db](https://github.com/cmangos/classic-db) (GPL-3.0; quest experience and reward items;
  only these facts are kept, in `tools\data\chain-facts.tsv` and `Data\Chains.lua`) and pfExtend's reward list
  (gathered from the OctoWoW database).
- The casual route was built from RestedXP, TourGuide, VanillaGuide, pfQuest and pfExtend.
- The risky-quest facts and the danger warnings come from RestedXP's Survival Guide (CC BY-NC-SA 4.0); the Hard list also comes from friends' feedback.
- Leveling-route hints: TourGuideVanilla by cralor, based on TourGuide by Tekkub (credits: Road-block,
  rsheep). Only facts are used.
- Leveling-route hints: VanillaGuide by mrmr and lanjelin (route authors Joana for the Horde and Brian Kopp
  for the Alliance). Only facts are used.
- Testing: Nonnally.
- Easy Route by stealthzi (MIT).
