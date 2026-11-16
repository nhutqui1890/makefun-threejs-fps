[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/nhutqui1890/makefun-threejs-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/nhutqui1890/makefun-threejs-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# RIDGEPOINT — a three.js tactical FPS

A round-based tactical first-person shooter, Counter-Strike-style, built for
[make.fun's threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02).
Vanguard attacks, Sentinel defends a desert outpost at dusk. Plant the charge
at Site A or B — or hold the outpost. First to 5 rounds takes the match.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network: static files plus vendored three.js 0.187.0.

## What's in the game

- **Round-based tactics** — 4v4 against bots, buy phase between rounds, money
  for kills and round wins, first to 5 rounds.
- **An objective beyond killing** — plant the charge (hold E at a site) and
  defend it for 35 seconds, or defuse it as Sentinel.
- **Gunplay where accuracy counts** — four guns (sidearm, SMG, rifle, longshot)
  plus a frag grenade, each with its own damage, fire rate, recoil and spread;
  spread grows with movement and falls when still or crouched; headshots deal
  4× damage.
- **Bots that play** — waypoint navigation, holds, pushes, reaction delays,
  burst fire, hearing (they investigate gunshots), planting and defusing.
- **A full HUD** — health, armour, ammo, money, round timer, team scores,
  kill feed, live minimap, buy menu, scoreboard, hitmarkers and a damage
  vignette.
- **An original map** — RIDGEPOINT: three lanes, a central silo, two sites,
  procedural canvas textures, dusk lighting with long shadows.
- **Synthesized sound** — every shot, reload, beep and sting is made with
  WebAudio; no audio files.

## Layout

- `game/index.html` — the page and the HUD
- `game/src/main.js` — boot, the fixed-step loop, screenshot modes
- `game/src/game.js` — the match: rounds, money, the bomb, scoring
- `game/src/world.js` — the map, textures and the waypoint graph
- `game/src/bots.js` — bot figures and AI
- `game/src/combat.js` — shooting, damage, tracers, grenades
- `game/src/weapons.js` — the armoury and the view model
- `game/src/actor.js` — movement and collision, shared by player and bots
- `game/src/hud.js` — every pixel of interface
- `game/src/audio.js` — synthesized sound
- `game/src/input.js` — keyboard, mouse, pointer lock
- `main.ts` — hands the game in (copies `game/` + `screenshots/`, writes the dossier)

## License

MIT — see [LICENSE](LICENSE).
