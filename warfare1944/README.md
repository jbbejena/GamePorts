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

Free-host server files can disappear on a sleep, restart or redeploy. The browser therefore keeps a campaign backup and sends it back **only when the server has no saved campaign**. Existing server progress is kept. Use the same browser and website address when returning, and keep its cookies and website data. Backups belong to that browser profile; use **Campaign saves** on the main menu to export a file to another browser or phone. An unfinished live battle starts again from its mission after the host restarts.

Touch devices download prebuilt, lossless 1024-pixel WebP sheets, decoded one at a time. Menu artwork is packed separately from battle-only artwork: the menu needs 9 sheets (36 MiB of decoded pixels and about 4.1 MB of files), instead of 31 full-source sheets (43.7 MB of files). The complete compact artwork is 26.6 MB across 32 sheets, compared with 47.4 MB across 33 original sheets. These figures describe artwork only, excluding fonts, code and metadata. Original source artwork, placements, button hit areas and gameplay coordinates are retained. Touch devices also use a 1x drawing buffer without multisample antialiasing. Desktop retains the original artwork.

An artwork progress bar counts actual completed sheets. **Retry download** retries failed pages using the existing cache and decode limit. An interrupted solo mission download asks the server to pause; after retrying, close the battle menu to resume. Graphics loss offers **Reload game** and **Return to menu**. Reconnecting never replays deployments, orders or purchases.

### Phone battle controls

The touch dock has buttons at least 44 CSS pixels high. Tap a unit to read its description, then choose **Top lane**, **Middle lane** or **Bottom lane** (or tap the battlefield). Select your own squad on the field or with **Select squad** to show its orders. A support order is aimed by tapping a target and then tapping its marker again to confirm. **Cancel** clears deployment/aiming; **Deploy** returns from squad orders to unit selection. Scroll the unit strip to reach more units, and drag the battlefield to pan.

The original ground/morale bars and mission clock stay above the battlefield. The dock uses the existing HUD and order owners; the server still checks every cost, cooldown, ownership rule, target and action. Menu/upgrade screens retain their original layout. After switching apps or hiding a solo battle, the page requests a server pause and requires an explicit resume. Versus battles continue for the other player. Interrupted drags and cancelled touches do not send an order.

### Export and import a campaign

1. Return to the main menu and open **Campaign saves**.
2. Choose **Export campaign** and keep the JSON file in Files/Downloads or transfer it to another device.
3. In the destination browser, open the same game, open **Campaign saves**, and choose **Import campaign**.
4. Choose **Continue Campaign** after the server confirms the import.

Import requires a profile without an existing campaign and no active battle. It never overwrites another campaign. The server validates mission, XP, levels, upgrades and career totals through the existing backup validator, under the same player lock. Identical repeated imports are idempotent; two simultaneous different imports keep the first accepted campaign. The version-1 file envelope is `{ "format": "warfare1944.campaign", "version": 1, "campaign": { ... } }`, limited to 8 KiB on upload. It contains durable campaign fields, with no browser profile identifier or view-only unlock lists. Storage on the server and the automatic browser-backup format have not changed; no migration is needed. Files support personal progress portability, not competitive score verification. Live battle checkpoints are not included.

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
node --test warfare1944/tests/test_graphics.mjs
node --test warfare1944/tests/test_recovery.mjs
```

These checks cover startup, real WebSocket gameplay, persistence, browser-backup recovery, portable-save validation/isolation/concurrency, HTTPS proxy origins, separate profiles, reconnects, versus, graphics geometry/concurrency/retries, and browser recovery policy. Node is needed only for JavaScript checks; the launcher needs only the dependency in `requirements-local.txt`. Browser emulation is separate evidence from physical iPhone Safari or Home Screen testing.

### Rebuilding compact artwork

The original `web/art/atlas-*.png` and `web/art/flash.json` own the artwork. Regenerate their checked-in derivatives with:

```sh
python -m pip install -r warfare1944/tools/requirements.txt
python warfare1944/tools/build_compact_art.py
```

The deterministic packer preserves every shape's logical size/placement, copies the original sprites/buttons/text definitions, groups menu dependencies separately, and generates `web/art/compact/flash.json` plus lossless WebP sheets. Do not hand-edit these derivatives. Pillow is a build dependency only; it is not needed to run the server. No bundle, service worker or cache-version bump is required for these source assets.

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
