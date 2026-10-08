# Easy Route

A leveling guide for the 1.12 client (Turtle WoW, Ravencraft, OctoWoW and other vanilla servers) that
works like RestedXP: pick how hard you want it, pick a guide for your level and faction, then follow the
steps on the right of the screen and the arrow at the top. The routes are RestedXP's free classic guides
for the Alliance and the Horde, levels 1 to 60. It also lists the quests worth doing where you stand
(`/er go`) and keeps a notebook that records what you do and lets you rate quests easy or hard with one
click.

## The guide (`/er`)

Type `/er` (or click the minimap button). The wizard asks how you want to play, then suggests a guide
for your level and faction (the starting zone made for your race, or the guide whose levels you are in).
**Go with this** starts it:

- **The step window** (right side of the screen). At the top, the step you are on in a box ("Step 12 of
  301"): talk to this person, accept these, kill these (with the count, "Tough Wolf Meat: 3/8"), hand
  in, buy, train, fly, set your hearthstone. Each part ticks itself off as you do it and the guide moves
  on by itself. Things to do on the way show under it. Below that, the guide's name with a gear for the
  guide menu, then the next few steps; click one to jump to it. `<` and `>` step by hand, **Skip**
  leaves a step out, **Done** ticks a step the game cannot check.
- **The arrow** (top of the screen) turns to point at the next place and says how many yards away it is,
  green when you face it, red when it is behind you. It needs no other addon. Drag it to move it,
  right-click hides it, `/er arrow` brings it back. With pfQuest installed the place is also marked on
  the world map and the minimap.
- **Settings** (the gear, right-clicking the minimap button, or `/er settings`): every option in one
  place, tick boxes for what can be on or off (simple mode, arrow, tips, skulls, enemy ratings, money
  steps, party chat, popups, minimap button) and buttons for the rest (pick a guide, difficulty, start
  again, stop, quests around me, notebook, send feedback, help). No slash commands needed.
- **The guide menu** (click the guide's name, or `/er guides`): every guide for your faction, grouped by
  level like RestedXP's menu ("RestedXP Alliance 1-20", "20-30" ...), the ones that suit you now marked.
- **Difficulty.** `Casual` leaves out group quests and quests with an elite to kill, `Medium` leaves out
  group quests (taking RestedXP's way round them), `Hard` does everything. `Everything` turns the guide
  off: play your own way, with a rating box after each hand-in.
- **When a guide ends** the box offers the next one.
- **It fits your level.** Quests that have gone grey for you (next to no experience) are left out, a
  quest you are doing that is above your comfort gets a red "Hard for your level" line, and when you are
  two levels past the top of a guide it asks whether to move on to one that fits.
- **Simple mode** (gear menu, or `/er simple`): instead of the step box, a quest list on the left like
  pfQuest's tracker. "Now:" says what to do, then every quest the guide is busy with, coloured by level,
  with what is left of it. Click a quest and the arrow points there; click it again and it follows the
  guide.
- **Easy Route says**: a small tips box under the guide window. RestedXP's own warnings ("try to avoid
  ..."), how many too-easy quests were left out, trainer reminders (new spells waiting, and what levels
  10, 20, 30 and 40 bring), moving on to the next guide, and once per character whether you have money on
  another character: then the steps that only farm money are left out. `/er tips` hides it.
- **Enemies** say Easy, Medium or Hard at the bottom of their tooltip (their level against yours and your
  difficulty, elites, and the guide's warnings), and a gold skull over their health bar (the V key turns
  the bars on) marks the ones your quests still need.
- The guide remembers where you are on each character. Picking a guide part-way through starts at the
  step after the quests you already have, and past the quests that are too easy for you.
- The first time you log in on a character (and once after updating to 0.7.0) the wizard opens by itself.

## The quests around you (`/er go`)

- **Stops, not a route.** The quests that suit you in the area you are standing in, grouped by who
  hands them out. Page through the stops, click a quest to be told where it is, right-click for
  "not today" (`/er unskip` brings them back).
- **Four moods.** `Casual` offers nothing above your level, does nearly everything in an area before moving on and leaves out
  anything hard or grouped. `Medium` is in between: a good few quests per area, some challenge, no
  group quests. `Hard` takes harder quests, fewer per area, and moves on sooner. `Everything` is for testers: no guiding, every quest whatever its level, and a rating box after each hand-in. `/er mode casual|medium|hard|everything`.
- **Chains worth doing.** Three or more quests in a row, best first, with how many quests, the
  levels it spans, the experience and whether it ends in a reward.
- **Grind for a break.** Between quests: ordinary mobs (no elites) that are never more than one
  level below you and up to two above, where most of them stand close together.
- **It asks.** When only a few quests are left for your level it asks "where next?" and offers the
  best places, or "stay a while".
- **Your ratings count.** Skip is never offered, Hard is left out in Casual, Easy goes first.
- **Quests you handed in are remembered**, so they are not suggested again.
- With pfQuest installed, "show me" also puts a marker on the map and aims pfQuest's arrow at it.

The quest and mob facts are generated from the pfQuest and pfQuest-turtle databases, the
experience and reward numbers from pfExtend, and the leveling-route hints from TourGuideVanilla
(see Credits). Quests and spawns are only as complete as those databases.

## What the notebook does

- **Buttons in your quest log.** Pick a quest and a small panel on the right says how hard it looks
  for your level right now, and why. Click Easy, Medium, Hard or Skip. Done.
- **The guess** uses the quest's level next to yours with the game's own colours (green, yellow,
  orange, red), its Group or Elite tag, and whether you died or nearly died while it was in your
  log. A quest well below your level only counts as easy until the mobs come in packs, which the
  close calls catch. You always have the last word.
- **No combat, Better solo, Better coop.** Buttons on the panel. No combat is for quests with
  nothing to kill (an unrated quest becomes Easy with it). Better solo is for pick-up quests where
  a group only competes for spawns, Better coop for kill quests with shared credit or drops.
- **Reasons and notes.** The `...` button opens a popup to tick why (no combat, better solo, better
  coop, needs a group, crowded, cave, long walk) and write a note like "do this at 14".
- **Chain quests.** With pfQuest installed, the panel says "chain quest, step 2 of 5" and what
  comes next, chat says so when you pick one up, and the first quest of a chain gets a small popup
  ("The Killing Fields is the start of a chain: quest 1 of 8. Next comes ..."). `/er chain` turns
  the popup off. A hard quest in a chain gets "Might still be worth it: step 1 of 8" in its advice.
- **Party chat.** When you are in a party, handing a quest in posts "I've done Wanted: Hogger
  (Hogger x1)." in party chat. Untick it in the `/er` window or type `/er party`.
- **The level you did it at** is kept with every rating, separate from the level you rated it at.
  The popup has "I was level __ when I did it", filled in from what the addon saw. Type over it
  when you rate something days later, and the guess follows.
- **A reminder of what the quest was.** When you hand one in, chat says
  "Wanted: Hogger handed in (Kill 1 Hogger)", so you remember which quest you are rating.
- **Which quest was that?** Three short lines wherever you rate: what it asked for ("Collect 8
  Torn Murloc Fins"), the quest's own words for it ("Bring 8 Torn Murloc Fins to Guard Thomas at
  the Eastvale Logging Camp in Elwynn."), and where you did it ("Done at Crystal Lake (Elwynn
  Forest), 16 min."). In the quest log panel while the quest is in your log, in chat and the popup
  on turn-in, and in the `/er` tooltips. The places are noted as the counters tick up; for a quest
  the addon did not watch you do, pfQuest's database says where the things are instead.
- **Chains that reuse a name** (the paladin's "Tome of Divinity", several quests in a row with
  the same title) are told apart by their objectives and pfQuest's ids, so each step gets its own
  turn-in, popup and rating.
- **The full story** of each quest (who gave it and where, each objective with the place and the
  mobs, who took it back, map positions) is kept for the export, where whoever builds the guide
  can use it.
- **A notebook window** (`/er`) lists your whole log, quests handed in without a rating, and
  everything rated so far, each row with the four buttons. Hover a quest for what it asked you to
  do, your rating and note.
- **Notes about places.** `/er note nice quiet boar spot`, or the box at the bottom of the window,
  saves a note with your zone and map position.
- **A journal** written by itself: quests taken and handed in (with time spent and deaths on them),
  abandons, deaths, level-ups, zone changes, each with character, level, time and place.

## Giving it to friends

- The first time it loads, a one-time notice says exactly what it writes down, that nothing leaves
  the computer by itself (addons on this client have no internet access), and how to send notes
  back. `/er about` brings it back.
- **Copy for dev** in the `/er` window (or `/er export`) puts every rating and place note in a box.
  Ctrl+C, paste it into Discord. The complete file, journal included, is the SavedVariables file
  below.
- It records: quests taken, handed in or abandoned and what they asked for; the Easy / Medium /
  Hard / Skip clicks with reasons and notes; the character's name, class, level, zone and map
  position at those moments; deaths, close calls (health under 30% in a fight), level-ups and zone
  changes with the time. It does not read chat, other players, bags, gear or gold.

## Commands

| Command | What it does |
|---|---|
| `/er go` | What to do here: stops, chains, a grind spot, and where next |
| `/er mode casual\|medium\|hard` | How much of an area to do, and how hard |
| `/er unskip` | Bring back every quest you said "not today" to |
| `/er` | The guide: pick Casual, Medium or Hard, then it takes you one stop at a time (also the minimap button) |
| `/er simple` | Quest list on the left, or the step box |
| `/er tips` | The tips box on or off |
| `/er skulls` | Skulls over the enemies your quests need, on or off |
| `/er money` | Leave out (or keep) the steps that only farm money |
| `/er rate enemies` | Easy / Medium / Hard on enemy tooltips, on or off |
| `/er notebook` | Open or close the notebook window (also Ctrl-click the minimap button) |
| `/er easy`, `/er medium`, `/er hard`, `/er skip` | Rate the quest picked in your quest log from chat. Add a name to rate by name: `/er hard Hogger` |
| `/er rate` | The reasons-and-note popup for the picked quest |
| `/er note <text>` | Save a note with where you are standing |
| `/er export` | Copy for dev: all ratings and place notes in a box, ready for Ctrl+C |
| `/er about` | The one-time notice: what it records and how to share |
| `/er party` | Party chat line on turn-in on or off |
| `/er chain` | The popup when you pick up the first quest of a chain, on or off |
| `/er prompt` | Open the popup by itself when you hand in a quest you have not rated yet (off by default) |
| `/er minimap` | Show or hide the minimap button |
| `/er help` | The "how to use" window |

## Where the data goes

Everything is saved when you log out or reload, in
`WTF\Account\<account>\SavedVariables\EasyRoute.lua`. Send that file to whoever is building the
guide. Ratings are account-wide and remember which character rated the quest and at what level.

If pfQuest is installed, each quest also gets its pfQuest quest ID, which makes matching against the
quest database exact. Without it, quests are matched by name.

## Installing

Copy the `EasyRoute` folder into `Interface\AddOns\`, or run `node tools/install.js` from this
folder (it takes the AddOns path as an optional argument).

## Checking the code

`node tools/check-lua.js .` parses every Lua file as Lua 5.0 and lists anything the 1.12 client
does not have.

`node tools/test-director.js` and `node tools/test-guide.js` run the director's decisions and the
windows (against a mock of the game's UI) on the real data. `node tools/test-steps.js` plays every
guide to the end in a pretend game (taking, finishing and handing in each quest, walking to each
place) and checks the guide moves on by itself and the arrow points the right way; add `all` to do
it for 18 race and class pairs. They need the Lua VM `fengari`
(`npm install` in the `tools` folder). Neither can show how the window looks in the game.

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
  guide data in `DataGuides.lua` is shared under that same licence; Easy Route is free and not sold.
- Map sizes for the arrow: pfQuest and pfQuest-turtle.
- Quest and mob data: [pfQuest](https://github.com/shagu/pfQuest) and pfQuest-turtle by Shagu (MIT).
- Quest experience and reward numbers: pfExtend by Cliencer (MIT), whose table was gathered from the
  OctoWow database.
- Leveling-route hints: TourGuideVanilla by cralor, based on TourGuide by Tekkub (credits: Road-block,
  rsheep). Only facts are used.
- Easy Route by stealthzi (MIT).
