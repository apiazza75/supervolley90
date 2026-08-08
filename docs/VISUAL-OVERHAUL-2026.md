# Super Volley 90 — visual overhaul 2026

This branch replaces the partial sprite drop-in with one coherent production
system. The acceptance target is a 1990s arcade sports game reconstructed with
2026 illustration, motion, lighting and broadcast UI standards.

## Defects addressed

- exterior-connected white paper and halos inside transparent sprite cells;
- hue-based recolouring that also changed skin, hair, socks and footwear;
- identical silhouettes and complexions across both teams;
- hard 24-frame stepping and abrupt action transitions;
- physical jump height cancelled whenever the sheet already contained lift;
- a net represented as a narrow upright instead of a readable court-width plane;
- arena, officials, ball kids, HUD, pause screen and menu from incompatible art systems;
- CI that checked file presence but not pixel defects or the rendered product.

## Production pipeline

### Character sheets

Each action remains a 3072 × 2048 RGBA sheet on a strict 6 × 4 grid. During
loading, the browser clears only near-white regions reachable from the
transparent exterior of each 512 × 512 cell, preserving enclosed white trim
and socks while removing the paper polygon between the legs.

The sanitised, half-resolution packed sheet is then analysed once to create
in-memory material masks: primary kit, secondary kit, skin and hair. No extra
raster files are required and the masks can never drift away from the artwork
they describe.

The renderer therefore changes only authored materials. Team primary and
secondary colours remain distinct, while stable per-player skin, hair, height
and build variation makes the twelve athletes readable as individuals without
changing simulation or collision geometry.

### Animation

The 24 drawings are sampled by a continuous playhead. Adjacent frames dissolve
only through the latter portion of each interval, reducing visible stepping
without creating a permanent double-image. Contact events pin their exact
specified frame. Visual height is the physical jump plus the authored lift,
minus only their overlap; block, spike and jump serve visibly leave the floor.

### Environment and interface

The camera is orthographic 2.5D: no perspective divide, but a restrained depth
shear and scale shift. The net is rebuilt from projected world-space corners.
The arena backdrop, floor, app icon, officials, ball kids, effects, scoreboard,
power gauges, coaching prompts, pause screen and team-selection menu share one
angular cyan/gold/coral night-arena design language.

## Automated gates

CI rejects a build unless:

1. all ten sprite sheets have the exact 3072 × 2048 RGBA format;
2. the production bundle generates a complete material-mask set for all ten sheets;
3. typecheck, unit tests, simulation tests and production build pass;
4. the built bundle loads 10/10 sprite sets, 10/10 generated mask sets and all
   three live arena layers.

`tools/visual-overhaul-shots.ts` additionally captures the actual team-select
screen, loaded jump-serve rise and contact, spike against a double block, and a
grounded formation explicitly exposing team palette and alpha defects.
