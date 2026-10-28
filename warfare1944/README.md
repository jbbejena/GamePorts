# Warfare 1944

Lead the American or German army across the battlefields of 1944, for [ActivityHub](https://github.com/vertyco/vrt-cogs/blob/main/activityhub/README.md). A port of the Flash game "Warfare 1944", with its original art, sounds and music. Spend resource points to send riflemen, machine guns, bazookas, snipers, mortars, officers and tanks down three lanes, give your squads orders, take cover and win the morale war.

- **Both campaigns.** Eight missions as the Americans and eight as the Germans, with the original's map, units, objectives and mission briefings. Win a mission to move on, lose it to retry. Winning the last one ends the campaign with your campaign stats.
- **Orders and cover.** Select a squad to advance it, throw grenades or smoke, or call in artillery, air support and smoke rounds. Squads take cover behind walls, fences, sandbags and log piles.
- **Upgrades that work.** Kills earn experience, experience earns levels, and levels buy upgrades from the original's two upgrade trees. Every upgrade does what its description says, including the ones that were broken in the original.
- **Custom Battle.** Pick a side, difficulty, units, supports, map and starting resource points, and fight it out.
- **Solo, watching or 1 vs 1.** Play alone, watch any battle running in your Discord server, or open a versus battle for anyone in the server (or only your voice channel) to take the other side. Anyone in the server can watch your battles. Battles and games from your own voice channel are listed first.
- **The tutorial.** The original's narrated tutorial, offered when you start your first campaign and on the Instructions page.
- **One campaign save per person.** Your campaign follows your Discord account, so you can pick it up from any server or device.
- **Desktop and phones.** The original's menus and screens, drawn from its own art. Works held upright or sideways.

There are no Red currency payouts.

## Online play on your phone

Host the game directly from GitHub so you can open its website in Safari or another phone browser. Your Mac or PC can stay off. No local download, Python installation, or Discord account is needed to play the hosted version.

[Deploy Warfare 1944 to Render](https://render.com/deploy?repo=https://github.com/jbbejena/GamePorts/tree/codex/warfare1944-cloud)

You can complete setup on your phone:

1. Open the deployment link above and sign in to Render. You can use your GitHub account.
2. Let Render access `jbbejena/GamePorts` if it asks. Review the deployment: the included `render.yaml` creates **one Free web service**, with no database or paid disk.
3. Tap **Deploy Blueprint** and wait until the service is **Live**.
4. Open the service's `https://…onrender.com` address in Safari. That is your playable game link; bookmark it and use it for future visits.

The Python server, graphics, and WebSocket connections all use that one address. Campaigns, custom battles, watching and versus play use the existing engine. The deployment link currently selects the `codex/warfare1944-cloud` branch; automatic redeploys are off. If that branch is later removed, update the Render service to the branch containing these changes before deploying an update.

### Free hosting and saves

Render's free service sleeps after fifteen minutes without inbound traffic. Opening it again can take about a minute. The first visit after a sleep may show Render's loading page before the game opens.

Free-host server files can disappear on a sleep, restart or redeploy. The browser therefore keeps a campaign backup and sends it back **only when the server has no saved campaign**. Existing server progress is kept. Use the same browser and website address when returning, and keep its cookies and website data. Backups belong to that browser profile; they do not sync to another phone. An unfinished live battle starts again from its mission after the host restarts.

### Hosting configuration

`render.yaml` installs `requirements-local.txt`, starts a single Python process on Render's `PORT`, and uses `/healthz` for health checks. The server detects `RENDER_EXTERNAL_URL` to accept the public HTTPS origin and secure cookies behind Render's TLS proxy. For a custom domain or another reverse-proxy host, set `WARFARE_PUBLIC_URL=https://your-domain.example` or pass `--public-url` with that origin.

Netlify's static hosting alone does not run this version's continuous Python battle server. A Netlify page can link to the hosted game; no additional frontend host is required for the Render setup.

## Standalone local play

You can run Warfare 1944 directly in a browser without Discord, Red-DiscordBot, or ActivityHub. The same Python battle engine and browser graphics run both versions, including the campaigns, custom battles, upgrades and tutorial. Assets are included in the repository.

Install **Python 3.10 or later**, then open a terminal in the **GamePorts repository root**:

```sh
python -m venv .venv
```

Activate the environment with `source .venv/bin/activate` on macOS/Linux, or `.venv\Scripts\activate` on Windows. Then:

```sh
python -m pip install -r requirements-local.txt
python -m warfare1944
```

On macOS/Linux, use `python3` for the first command if `python` is unavailable. Open **http://127.0.0.1:8744/** in your browser and leave the terminal running. Stop the server with **Ctrl+C**. After installing the dependency, playing on the host computer does not need an internet connection.

### Play on your phone

Start the server with:

```sh
python -m warfare1944 --host 0.0.0.0
```

Connect your phone to the same Wi-Fi as the computer. In Safari or another mobile browser, open the **Phone on the same Wi-Fi** address printed in the terminal, such as `http://192.168.1.50:8744/`. Allow the server through your computer's firewall for your private network if prompted. If the printed address is from a VPN or virtual adapter, use your computer's Wi-Fi IP address instead.

The computer runs the battles and must stay on. The phone works in either orientation; landscape gives a larger battlefield. Separate browsers/devices get separate local player profiles, and can use the existing Versus and Watch menus together. There is no Discord account or sign-in step.

### Campaign saves

Progress and upgrades are saved as JSON files in **`.local/warfare1944/`** inside the repository. These files are excluded from Git. The browser also keeps a campaign backup, restored only if the server's copy is missing. Back up the JSON folder to keep your campaigns independently of browser data. Use a different folder or port with:

```sh
python -m warfare1944 --data-dir /path/to/my-saves --port 9000
```

A browser cookie identifies your campaign. Use the same browser profile and server hostname when returning; clearing its cookies creates a new profile. A phone and a computer have separate profiles. Closing the game pauses a solo battle for up to ten minutes while the server stays running. Restarting the server keeps campaign progress but replays the current unfinished mission.

### Development checks

From the repository root:

```sh
python -m unittest discover -s warfare1944/tests -v
```

These checks cover startup, real WebSocket gameplay, campaign persistence, browser-backup recovery after a host loses its files, HTTPS proxy origins, separate player profiles, reconnects, and versus battles. The launcher needs only the dependency in `requirements-local.txt`.

## Discord setup

Warfare 1944 needs ActivityHub 0.10.0 or later, loaded and set up (see its README). Then:

```
[p]cog install gameports warfare1944
[p]load warfare1944
```

It appears in the hub's menu by itself. `[p]activityhub games` lists it.

## Fair play

The server runs every battle: each squad, shot, shell, smoke screen and kill. A player's page sends orders (deploy in a lane, a squad's order, pause, surrender), and the server checks each one against the original's rules, including the resource points it costs. In standalone and hosted play, a browser can also restore its own validated campaign backup when no server copy or live battle exists. These backups support personal progress recovery; they are not competitive score verification. Versus matches do not use campaign upgrades.

## Credits

Warfare 1944 is a port of the Flash game "Warfare 1944", made by Con Artist Games and published by Armor Games in 2009 (the original's own credits read "Developed by: Armor Games" and "© Armor Games 2009"). It uses the original's art, sounds, music and tutorial narration. Drawing uses PixiJS (MIT License).
