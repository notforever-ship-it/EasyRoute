# Easy Route

A relaxed leveling guide for the 1.12 client (Turtle WoW, Ravencraft, OctoWoW and other vanilla
servers). It is not a fastest-route walkthrough. It looks at where you are and your level and tells
you which quests are worth doing here, in stops so you collect them in one visit, which chains are
worth following, where to grind for a break, and when an area is used up it asks where you would
like to go. It also keeps the notebook that records what you do and lets you rate quests easy or
hard with one click.

## What to do here (`/er go`)

- **Stops, not a route.** The quests that suit you in the area you are standing in, grouped by who
  hands them out. Page through the stops, click a quest to be told where it is, right-click for
  "not today" (`/er unskip` brings them back).
- **Three moods.** `Casual` does nearly everything in an area before moving on and leaves out
  anything hard or grouped. `Medium` is in between: a good few quests per area, some challenge, no
  group quests. `Normal` takes harder quests and moves on sooner. `/er mode casual|medium|normal`.
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
| `/er mode casual\|medium\|normal` | How much of an area to do, and how hard |
| `/er unskip` | Bring back every quest you said "not today" to |
| `/er` | Open or close the notebook window |
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
window (against a mock of the game's UI) on the real data. They need the Lua VM `fengari`
(`npm install` in the `tools` folder). Neither can show how the window looks in the game.

## Rebuilding the data

`Data\Zones.lua` and `Data\Mobs.lua` are generated, not written by hand:

    node tools/build-director.js <folder holding pfQuest and pfQuest-turtle> [rewards_data.lua]

`Data\Quests.lua` comes from `node tools/build-quests.js <TourGuideVanilla folder>` and keeps only
facts (ids, titles, givers, places, chains), not the route's wording.

## Credits

- Quest and mob data: [pfQuest](https://github.com/shagu/pfQuest) and pfQuest-turtle by Shagu (MIT).
- Quest experience and reward numbers: pfExtend by Cliencer (MIT), whose table was gathered from the
  OctoWow database.
- Leveling-route hints: TourGuideVanilla by cralor, based on TourGuide by Tekkub (credits: Road-block,
  rsheep). Only facts are used.
- Easy Route by stealthzi (MIT).
