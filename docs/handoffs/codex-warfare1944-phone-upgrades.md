# Warfare 1944 phone upgrades — 2026-10-29

Change branch: `codex/warfare1944-phone-upgrades`
Target branch: `main`
Baseline: `2157e5a97f7a9f2a7d0d37c9ffe2aae6566f42ca`

## Review state

Implementation validated locally and prepared for draft review. No merge or deployment is part of this branch. Latest `origin/main` was fetched and remained at the baseline; no reconciliation was necessary. This is `jbbejena/GamePorts`, the repository identified by the prior Warfare 1944 work, rather than the separate WhatDew repository.

## Changes and owners

- Phone artwork is generated from the existing source atlas into separate menu and battle groups. The menu loads 9 sheets / 4,112,668 image bytes, versus 31 / 43,726,587 previously. All compact art is 32 sheets / 26,609,612 bytes versus 33 / 47,449,283 originally. Retained menu pixels fall from 124 MiB to 36 MiB; complete phone backing pixels remain within the preceding memory budget. These are image figures, not whole-page transfer or GPU-process measurements.
- `Loading` presents actual completed sheets and retries through `Library.need`, retaining successful textures and the shared decode limit. Mission-download failures request a server pause, then leave resume to the battle menu after recovery.
- `MobileControls` presents the existing `Hud`/`Orders` projections. Large buttons select units, lanes, owned squads and orders. Top bars stay on the canvas. Pointer coordinates use the stage scale when the small bottom HUD is cropped. Primary-touch ownership, outside release, cancellation and interruption cleanup prevent stale drags.
- `Recovery` offers reconnect/reload/menu actions. Backgrounding a solo battle requests an authoritative pause and explicit resume; versus keeps running. Reconnection is serialized and never resends deployments, orders or purchases.
- Campaign files use a versioned envelope around the same durable fields as automatic browser backups. `LocalServer.restore` and `validated_backup` retain ownership under the existing player lock. Imports never replace different existing progress or act during a live battle. Identical retries are idempotent. No persistence migration is required.

## Validation performed

- `python -m unittest discover -s warfare1944/tests -v`: **22 passed**.
- `node --test warfare1944/tests/test_graphics.mjs warfare1944/tests/test_recovery.mjs`: **11 passed**.
- Impeccable mechanical checks across the changed UI targets: **no findings**.
- `git diff --check`: passed.
- Playwright with the installed Microsoft Edge Chromium engine: U.S. campaign through normal menu/difficulty/map/mission controls, unit deployment, squad selection, pause/resume, portrait/landscape rotation, and all visible dock buttons at least 44 by 44 CSS pixels with no page-width overflow.
- Additional Chromium checks: German campaign launch; export and import into a separate browser profile; interrupted menu and mission downloads followed by Retry; accepted server pause during mission failure; browser-dispatched camera dragging, second-finger ownership and touch cancellation; native unit-strip touch scrolling without activation; officer selection and two-tap fire support; synthetic visibility interruption and explicit resume; WebSocket closure/manual reconnect to the same battle; actual `WEBGL_lose_context` loss followed by reload/rejoin to the same battle; desktop original artwork/HUD. No JavaScript page errors in the final runs. Screenshots inspected.

The first browser pass caught an early ResizeObserver call before graphics initialization; `fit` now guards the uninitialized app. A later test harness reload assertion used an undeclared global before startup; the harness was corrected, and the complete recovery run passed. Neither failure is left open.

## Generated files and documentation

Generated: `warfare1944/web/art/compact/flash.json` and 32 lossless WebP sheets. Regenerate with `python warfare1944/tools/build_compact_art.py`, using the optional Pillow build requirement in `warfare1944/tools/requirements.txt`. Do not modify generated derivatives manually. Original source artwork is untouched.

Canonical docs updated: `warfare1944/README.md` (controls, loading/recovery, file contract and asset build) and `warfare1944/CHANGELOG.md`. No shared main handoff existed or was edited. No runtime bundle, service worker, cache constant or version bump was needed.

## Open gates and intentionally deferred work

- Physical iPhone Safari, Home Screen/PWA, real Safari graphics memory pressure and OS process termination remain unverified. Chromium touch emulation and forced WebGL context loss do not establish those outcomes.
- These changes have not been deployed to Render; hosted gameplay still uses the previously deployed code. Live Discord/ActivityHub integration was not exercised.
- No GitHub Actions workflow is configured in this repository; there is no remote CI success claim or pending run to wait for.
- Live battle checkpoints remain deferred. Campaign files preserve durable progression; a host restart still replays an unfinished mission. No broader combat changes, save replacement/reset, migration, merge or deployment was attempted.
