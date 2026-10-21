# TESTING

## Automated

```bash
npm test
```

Vitest runs three suites:

| Suite | What it proves |
| --- | --- |
| `shared/src/rules.test.ts` | Ring geometry, line-cutter, X ring, penalties, set system, cumulative ties, shoot-off, signal timeline, ranking seeding |
| `shared/src/physics.test.ts` | Draw curves (recurve vs compound let-off), launch speed vs draw weight, drop at 30/50/70 m vs an independent integrator, wind drift, spine matching |
| `client/src/camera/cameraStateMachine.test.ts` | Full camera loop, eased blend, cancel, arrow cam on/off, auto-return off, spectator |
| `client/src/competition/matchManager.test.ts` | 5-5 set system, shoot-off winner propagation, cumulative tie |
| `client/src/competition/onlineMatch.test.ts` | Server-state mirroring, end summary, final result, shot submission |
| `server/src/services/validation.test.ts` | Schema rejection, impossible aim/distance/draw weight, replay mismatch |
| `server/src/routes/routes.test.ts` | Health, score submission, impossible score, equipment sanitisation, daily seed |

`npm run typecheck` must pass for `shared`, `client` and `server`.

`npm run range-test` prints:

```
dist   time    drop(cm)  1/2gt²(cm)  drift(cm)  impact(cm)      score
 70 m  1.032s     520.3       520.3        3.1   0.4, 0.2       X
```

Drop must equal the closed-form `½gt²` to under a millimetre. Drift should be a few centimetres at 70 m in
the default 3.2 m/s wind.

## Manual matrix

| Area | Chrome | Edge | Firefox | Safari |
| --- | --- | --- | --- | --- |
| WebGL 2 render | | | | |
| WebGPU (where available) | | | | |
| Third person → aim blend | | | | |
| Recurve pin sight | | | | |
| Compound scope lens + level | | | | |
| Barebow string picture | | | | |
| Audio unlocks on first click | | | | |
| Touch draw/release | | | | |

### Checklist

1. **Camera** — hold RMB; the view reaches the eye in ~0.4 s with no snap; release; after 0.4 s the arrow
   cam follows the shaft; it returns to third person when the arrow lands. Disable "Follow the arrow" and
   repeat: it should return straight to third person.
2. **Sight pictures** — recurve shows a ring and pin; compound shows a magnified lens with reticle and a
   level bubble that moves when you press Q/E; barebow shows no sight and no stabiliser.
3. **Draw feel** — compound reaches a hard wall and holds light; recurve gets heavier to the clicker;
   holding too long makes the sight shake.
4. **Wind** — the flag nearest the target leans the same way the arrows drift. Change the daily seed and
   confirm both change together.
5. **Scoring** — hit a ring line and confirm the judge popup says "line cutter"; an arrow outside the face
   scores M; the end total matches the sum.
6. **Signals** — ranking ends are 4:00 with a yellow light for the last 30 s; match play is 20 s per arrow.
   Shoot after red and the arrow scores zero.
7. **Bracket** — complete a ranking round, win a match, confirm the winner advances and the two beaten
   semi-finalists appear in the bronze match. Win three matches: quarter-final, semi-final and final
   should lead to the gold-medal screen; the AI bronze match is played automatically.
8. **Leaderboard** — start the server, finish a ranking round, open Leaderboard from the menu, and confirm
   the score appears. Stop the server and confirm the screen explains the offline state instead of hanging.
9. **Online duel** — start the server, open two browser windows, queue both in the same division, and
   confirm the match starts, both totals update, the clock is server-owned, and the result screen appears
   after five ends. Close one window mid-match and confirm the other returns to the online screen.

## Performance

- High preset targets 60 FPS on a mid-range GPU. The adaptive resolution controller drops the pixel ratio
  in 10% steps when the 60-frame average exceeds 21 ms, and restores it below 13 ms.
- **Stress test**: set quality to Ultra, venue to stadium, start a tournament. The scene holds 520 crowd
  instances, up to 9000 grass blades, two targets, the archer, the bow and 30 pooled arrows.
- Use the FPS overlay (Settings → FPS overlay) to confirm the backend and frame rate.

## Server

```bash
npm run dev:server
curl http://127.0.0.1:8080/api/health
curl "http://127.0.0.1:8080/api/leaderboard?class=recurve&format=rankingRound&limit=5"
```

WebSocket: connect to `ws://127.0.0.1:8080/ws`, send `{"type":"queue","bowClass":"recurve","name":"Test"}`.
A second client triggers `matchFound` and the authoritative signal stream. Send a `shoot` message and
confirm the server replies with `shotResult` and rejects a `claimedScore` that does not match the replay.

## Known flaky areas

- Headless browsers often lack WebGL 2; use a real GPU or `--enable-unsafe-swiftshader` for smoke tests.
- Speech synthesis is unavailable in some headless environments; judge calls are then silent but subtitles
  still show.
