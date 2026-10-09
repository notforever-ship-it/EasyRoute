# Easy Route

A relaxed leveling guide for the 1.12 client (Turtle WoW, Ravencraft, OctoWoW and other vanilla servers). It looks and feels like RestedXP: one step at a time in a box on the right of the screen, and an arrow at the top that points the way. Pick how hard you want it, pick a guide for your level and faction, and follow along. The routes are RestedXP's free classic guides for the Alliance and the Horde, levels 1 to 60.

## The guide (`/er`)

Type `/er` (or click the minimap button). It asks how hard you want it, then suggests a guide for your level and faction (the starting zone made for your race, or the guide whose levels you are in). **Go with this** starts it.

- **The step box** (right side of the screen) shows the step you are on: talk to this person, accept these, kill these (with the count), hand in, buy, train, fly, set your hearthstone. Each part ticks itself off as you do it and the guide moves on by itself. Below it, the guide's name with a gear for Settings, then the next few steps; click one to jump to it. `<` and `>` step by hand, **Skip** leaves a step out, **Done** ticks a step the game cannot check.
- **The arrow** (top of the screen) points at the next place and says how many yards away it is, green when you face it, red when it is behind you. Drag it to move it, right-click hides it, `/er arrow` brings it back. With pfQuest installed the place is also marked on the world map and the minimap.
- **When a guide ends** the next one starts by itself (you can turn that off in Settings). Clicking the guide's name lists every guide for your faction by level.
- **It fits your level.** Quests that have gone grey for you are left out, a quest above your comfort gets a red "Hard for your level" line, and when you are two levels past the top of a guide it offers one that fits.
- **Simple mode**: a quest list on the left instead of the step box. Click a quest and the arrow points there; click it again and the arrow follows the guide.
- **Easy Route says**: a small tips box under the guide with the guide's own warnings, trainer reminders, and a question now and then.
- **Enemies** say Easy, Medium or Hard at the bottom of their tooltip, and a gold skull over their health bar (the V key shows the bars) marks the ones your quests still need.
- The guide remembers where you are on each character.

## How hard

- **Casual** leaves out group quests and quests with an elite to kill.
- **Medium** leaves out group quests.
- **Hard** does them all.

Change it any time with **Change difficulty** in Settings.

## Settings

The gear on the guide, right-clicking the minimap button, or `/er settings` opens every option in one place, in two groups:

- **The guide**: pick a guide, change difficulty, start again, stop, simple mode, the arrow, tips, skulls, enemy tooltips, leaving out the steps that only farm money, going straight on to the next guide, the minimap button, and How to use.
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

`node tools/test-director.js` and `node tools/test-guide.js` run the zone logic, the windows and Core.lua against a mock of the game. `node tools/test-steps.js Human:WARRIOR:Alliance` plays that character's guides to the end in a pretend game and checks the guide moves on by itself. They need the Lua VM `fengari` (`npm install` in the `tools` folder). None of them can show how the windows look in the game.

## Rebuilding the data

`Data\Zones.lua` and `Data\Mobs.lua` are generated, not written by hand:

    node tools/build-director.js <folder holding pfQuest and pfQuest-turtle> [rewards_data.lua]

`Data\Guides.lua` (the guides) and `Data\ZoneSizes.lua` (map sizes for the arrow) come from

    node tools/build-guides.js <RXPGuides folder> <folder holding pfQuest and pfQuest-turtle>

which keeps RestedXP's classic Alliance and Horde leveling guides for the normal game (no Season of
Discovery, hardcore or double-XP steps). `Media\Arrow.tga` is drawn by `node tools/make-arrow.js`.

`Data\Quests.lua` comes from `node tools/build-quests.js <TourGuideVanilla folder>` and keeps only
facts (ids, titles, givers, places, chains), not the route's wording.

## Credits

- Leveling routes: [RestedXP Guides](https://github.com/RestedXP/RXPGuides) by RestedXP, their free
  classic guides, used under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 licence. The
  guide data in `Data\Guides.lua` is shared under that same licence; Easy Route is free and not sold.
- Map sizes for the arrow: pfQuest and pfQuest-turtle.
- Quest and mob data: [pfQuest](https://github.com/shagu/pfQuest) and pfQuest-turtle by Shagu (MIT).
- Quest experience and reward numbers: pfExtend by Cliencer (MIT), whose table was gathered from the
  OctoWow database.
- Leveling-route hints: TourGuideVanilla by cralor, based on TourGuide by Tekkub (credits: Road-block,
  rsheep). Only facts are used.
- Easy Route by stealthzi (MIT).
