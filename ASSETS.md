# ASSETS AND LICENSING

## Summary

GOLD RING ships **no third-party art, audio or font files**. Everything is generated at runtime:

| Asset | Source | Licence |
| --- | --- | --- |
| Archer, bows, arrows | Procedural geometry in `client/src/archer` and `client/src/equipment` | Original, MIT |
| Target faces | Canvas 2D drawing in `client/src/range/target.ts` | Original, MIT |
| Venues (stadium, club, indoor) | Procedural geometry + canvas textures | Original, MIT |
| Crowd | Instanced capsule/sphere geometry | Original, MIT |
| Grass | Instanced quads with a wind vertex shader | Original, MIT |
| Sky / IBL | Three.js `Sky` shader + PMREM | Three.js (MIT) |
| Sound effects | Web Audio synthesis in `client/src/audio/audio.ts` | Original, MIT |
| Judge voice | Browser `SpeechSynthesis` | Platform voice |
| Fonts | System UI fonts (`Inter` if installed, otherwise system sans) | System |

This is deliberate: the game must run with no network access and no asset download step, which is one of
the stated requirements. It also avoids trademark and licence exposure.

## Fictional brands

All equipment brands in `shared/src/data/equipment.json` are fictional:

- **Aurelian Forge** — recurve risers
- **Northwind** — limbs
- **Meridian** — sights, rests, scopes
- **Kestrel** — stabilisers
- **Ironwood** — compound risers and limbs
- **Talon** — release aids
- **Fletchworks** — arrows
- **Cordis** — strings and tabs

Any resemblance to real manufacturers is coincidental. Do not replace these with real trademarks without
checking the licence for each product name and logo.

## If you add external assets

1. Prefer CC0 sources: Poly Haven (HDRI), ambientCG (PBR materials), Kenney (audio/UI), freesound.org
   (CC0 filter only).
2. Record the asset, author, source URL, licence and the date downloaded in the table above.
3. Keep a procedural fallback so the game still boots if the file is missing.
4. For GLB models, export with Draco or Meshopt compression and KTX2 textures, and place them under
   `client/public/assets/`.
5. Do not import protected marks: Olympic rings, "Olympic", "World Archery" logos, national federation
   crests, or real equipment logos.

## Third-party code

| Package | Licence |
| --- | --- |
| three | MIT |
| gsap | Standard "no charge" licence (GreenSock) |
| zustand | MIT |
| howler | MIT |
| fastify and plugins | MIT |
| ws | MIT |
| zod | MIT |
| vite, vitest, typescript | MIT / Apache-2.0 |

`howler` and `@dimforge/rapier3d-compat` are installed for optional recorded-audio packs and future prop
physics; the shipped build uses Web Audio synthesis and the deterministic shared arrow integrator.
