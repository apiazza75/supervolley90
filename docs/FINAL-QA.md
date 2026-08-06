# Final sprite and arena QA

This branch now contains the completed illustrated-player and arena pipeline.

## Player art

- 10 transparent RGBA sprite sheets under `public/sprites/`
- exact sheet size: 3072 × 2048 px
- exact layout: 6 × 4 cells, each 512 × 512 px
- authored floor line: y = 470
- fixed native body scale across all 24 frames
- gameplay contacts synchronised with the authored contact frames
- legacy paper-sheet loading retained as a fallback

## Arena art

- `public/arena/arena-back.png`: 2560 × 900 px
- `public/arena/arena-floor.png`: 1024 × 512 px, horizontally tileable
- `public/arena/net.png`: 512 × 512 px with alpha
- illustrated layers load opportunistically; the procedural arena remains the fallback
- court markings, lighting, officials and gameplay effects remain live vector elements

## Automated verification

The CI pipeline validates:

1. dimensions and PNG format of all 13 art assets;
2. TypeScript type checking;
3. unit and simulation tests;
4. production web build;
5. loading all 10 sprite sheets from the built bundle;
6. deterministic headless matches;
7. construction, ad-hoc signing and packaging of the macOS application.

## Visual verification

The browser-driven QA harness now waits for the real serve state, holds and releases
the action button, strikes only when `serveStrikeReady` is true, waits for the rally
phase, and captures menu, serve, live-rally and post-point frames. The final evidence
shows the illustrated arena, recoloured teams, ball, net and multiple action poses in
an actual exchange without page errors, white sprite backgrounds or duplicated art.
