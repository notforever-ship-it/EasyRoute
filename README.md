# Easy Route

The notebook for a relaxed leveling guide, for the 1.12 client (Turtle WoW, Ravencraft, OctoWoW and
other vanilla servers). This version does not guide yet. It records what you do while you level and
lets you say, with one click in your quest log, whether each quest is easy or hard. The guide gets
built from that.

## What it does

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
