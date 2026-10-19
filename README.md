# GamePorts

Classic games rebuilt to play together inside Discord, as cogs (plugins) for **[Red-DiscordBot](https://github.com/Cog-Creators/Red-DiscordBot)**, a Discord bot you run yourself.

![Red-DiscordBot](https://img.shields.io/badge/Red%20DiscordBot-V3.5-red?style=for-the-badge)
![Py](https://img.shields.io/badge/python-v3.11-orange?style=for-the-badge)

> [!IMPORTANT]
> **These are ports of existing games.** Each cog recreates a game made by someone else, usually an old Flash game or a phone game, and most of them use the original's art, sounds, music or levels. How much each one changes the original varies: some are close copies with bugs fixed and multiplayer added, others keep only the original's rules and levels and redraw the rest. Every cog's README names the original game and its makers in a Credits section. The games themselves and their original assets belong to their owners. This repo is a non-commercial fan project and is not affiliated with or endorsed by any of them. If you made one of these games and want it taken down, see [Contact and takedown requests](#contact-and-takedown-requests).

<img src=".github/ASSETS/divider.svg" width="100%" alt="">

<img src=".github/ASSETS/marquee.svg" width="100%" alt="Activity Games">

## What these are

Discord lets a bot open an Activity: a small web page that runs inside a voice channel or a chat, where everyone in the call can play together. These cogs are games for that Activity.

They don't run on their own. They plug into **[ActivityHub](https://github.com/vertyco/vrt-cogs/blob/main/activityhub/README.md)**, a cog in the [Vrt-Cogs](https://github.com/vertyco/vrt-cogs) repo. ActivityHub turns the bot's Activity into a menu of games, handles the Discord login and runs the web server. Each game below adds itself to that menu once it's loaded.

| Cog | Description |
|-----|-------------|
| [AgeOfWar](ageofwar/README.md) | <details><summary>Defend your base through five ages</summary> Louissi's Flash game with its original art, sounds and music. Train units, build turrets and evolve from cavemen to super soldiers against the computer or a friend, with a global leaderboard of the fastest wins.</details> |
| [BlockBlaster](blockblaster/README.md) | <details><summary>Clear pixel pictures with shooting cats</summary> A remake of Loom Games' phone puzzle Pixel Flow! in live 3D, with its sounds and pictures and all-new cats. Tap cats onto a belt around a pixel picture to shoot away its cubes color by color, across the original's 2,600 levels and boosters, with progress kept on every server and an optional credit shop for boosters. Still being built: levels from 2,401 on are missing some twists.</details> |
| [Bloxorz](bloxorz/README.md) | <details><summary>Roll the block into the hole</summary> Damien Clarke's 2007 Flash puzzle with its original art, sounds and music. Roll a tall stone block across all 33 floating stages, past fragile tiles, switches, bridges and a split into two cubes, with passcodes, Continue and a global leaderboard of the fewest moves.</details> |
| [BotArena3](botarena3/README.md) | <details><summary>Build robots and battle through 15 arenas</summary> The Armor Games Flash game with its original art, sounds and music. Run a career with the original's parts, shop, arenas and challenges, watch any battle in the server, or fight other players 1 vs 1 on a global leaderboard.</details> |
| [LastStand](laststand/README.md) | <details><summary>Zombie survival RPG across Union City</summary> Con Artist Games' Flash game The Last Stand: Union City with its original art and sounds. Build a survivor and fight, search and trade your way across 11 areas and 285 rooms to find your partner and escape by boat, with quests, shops, companions, 12 skills and three save slots per player kept by the bot.</details> |
| [Warfare1917](warfare1917/README.md) | <details><summary>Trench warfare in 1917</summary> The Armor Games Flash game with its original art, sounds and music. Lead the British or German army through two campaigns or a Custom Battle, then play alone, watch any battle, or fight someone 1 vs 1.</details> |
| [Warfare1944](warfare1944/README.md) | <details><summary>The battlefields of 1944</summary> The Armor Games Flash game with its original art, sounds and music. Lead the American or German army through two campaigns or a Custom Battle with squad orders, cover and air support, then play alone, watch any battle, or fight someone 1 vs 1.</details> |

<img src=".github/ASSETS/divider.svg" width="100%" alt="">

# Installation

1. **Set up Red.** If you don't have a Red bot yet, follow Red's [install guide](https://docs.discord.red/en/stable/install_guides/index.html) for your system.
2. **Install and set up ActivityHub.** It lives in the Vrt-Cogs repo. Replace `[p]` with your bot's prefix:

    ```ini
    [p]load downloader
    [p]repo add vrt-cogs https://github.com/vertyco/vrt-cogs
    [p]cog install vrt-cogs activityhub
    [p]load activityhub
    ```

    Then follow [ActivityHub's README](https://github.com/vertyco/vrt-cogs/blob/main/activityhub/README.md) to turn on your bot's Activity in the Discord Developer Portal and point it at the hub. Check that the hub's menu opens in Discord before adding games.
3. **Add this repo and install the games you want:**

    ```ini
    [p]repo add gameports https://github.com/vertyco/GamePorts
    [p]cog install gameports <list of cogs>
    [p]load <list of cogs>
    ```

    Each loaded game shows up in the hub's menu by itself. `[p]activityhub games` lists them.

# Contact and takedown requests

**If you own the rights to one of these games** and want its port removed, open an issue titled "Takedown request" on this repo, or message **vertyco** on Discord. Say which game it is and that you hold the rights to it. Please send it from an official email address or account for the studio or publisher, so I can confirm it's really you. I'll take the cog down promptly.

For help or bug reports, open an [issue](https://github.com/vertyco/GamePorts/issues), or ask in [#support_vrt-cogs](https://discord.com/channels/240154543684321280/1123338506396254240/1123341301212000429) in the [Red Cog Support](https://discord.gg/GET4DVk) server.
