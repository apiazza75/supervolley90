# Art specification

> Historical specification. For the current 21-action raster pipeline, actual
> illustrated arena/official assets, import instructions and open visual
> issues, see [the September 2026 art progress record](ART-PROGRESS-2026-09-09.md).
> The fallback, asset counts and contact-frame values below are not the current
> runtime contract; use `SHEETS` and `CONTACT_FRAME` in the renderer.

## Current illustrated court material contract — September 2026

`public/arena/v3/surface-manga.png` is the runtime floor atlas: **1254 × 1254
RGB**, opaque, drawn maple parquet in the top half and a painted petrol-teal
free-zone material in the bottom half. The original generated file is retained
in `assets/source/manga-2026-09/court-surface-atlas.png`; the complete prompt and
generation provenance are in `court-generation.json` beside it.

The materials contain no perspective, court markings, players or effects.
`ArenaArtwork` crops a one-pixel inset from each half. It repeats the wood
swatch four times along each court axis, giving twelve board courses per
4.5 m × 2.25 m patch, and projects it onto the real 18 m × 9 m court. The teal
material covers the larger free zone. Court edges, rule lines, shadows and
impact effects remain separate live passes. `FloorSurfaceCache` retains the
projected material at backing-store density and follows the camera's affine
pan, zoom and shake; it does not lower the game's display resolution.

The previous `floor.png` is retained for historical tooling but is not loaded
by the runtime. Do not apply its former grey soft-light texture or procedural
scratches over the new drawing. The illustrated stand is
`public/arena/v3/grandstand-manga-v3.png`; seated referee and line-judge drawings
are in `public/officials/manga-seated.png`. These assets are implemented, not
automatically artistically approved. The historical guidance below does not
authorize a return to vector placeholder people.

---

What to draw, and how to hand it over, so that the game can use it directly.

The nine sheets already in `public/sprites` work. Everything below is about
removing the guesswork that stands between a drawing and the screen — most of
which comes from one decision, made once, at the top of this document.

---

## 1. The one thing that matters most: draw on nothing

**Export PNGs with a transparent background. No paper, no page, no frame.**

Every sheet so far has been a picture *of a sheet*: a title bar, a grid of
ruled cells, a number in each corner, a wooden plank under each row, a footer.
None of that is the player, so all of it has to be found and removed before the
figure can be drawn on a court — and finding it is where every defect in this
project has come from:

- the paper had to be flood-filled away from each cell separately, because the
  cell borders blocked the fill
- the borders' anti-aliased edges were too dark to remove and too pale to see,
  and they arrived on court as scratches across the players
- the plank had to be located per row, and cropping onto it sealed the gap
  between the legs so a white slab survived between them
- the frame numbers and the drawn ball had to be told apart from the body by
  labelling every connected shape and keeping the largest
- one frame is a close-up of a face, another is mostly net; both had to be
  detected and skipped, or the game showed a head the size of a person

With a transparent background, **none of that code runs**. The figure is
already the only thing in the cell. Nothing can be mistaken for it and nothing
of it can be mistaken for background.

This has to be genuine transparency — an alpha channel. A flat colour behind
the figures is not a substitute: the game did briefly try to detect one, and it
mistook the dark border of the existing sheets for a backdrop and dissolved the
artwork. If the tool cannot export an alpha channel, send the sheets on white
paper as before and the older path handles them.

---

## 2. Sheet layout

| | |
|---|---|
| Grid | 6 columns × 4 rows = 24 frames, read left to right, top to bottom |
| Cell | 512 × 512 px (sheet is 3072 × 2048) |
| Chrome | none — the grid starts at pixel 0 and every cell is exactly 512 px |
| Numbers | none |
| Borders | none |
| Background | transparent |

Frames are placed on an exact grid so the game can find them by arithmetic
instead of by inspection. Nothing should sit between or around them.

### The floor line

**Every cell has its floor at y = 470 of 512**, the same in all 24 frames and
in all sheets.

- A standing figure's feet rest ON that line.
- A jumping figure is drawn HIGHER in the cell. Do not re-centre it — the gap
  between the feet and the floor line is how the game knows they are airborne,
  and it is what makes a jump look like a jump.
- Nothing is drawn below the line. No shadow, no plank, no ground.

### Size and placement

- The figure is **centred horizontally** in its cell.
- Keep the athlete's anatomical scale constant within each sheet. Bending,
  reaching and jumping change the silhouette, not the length of the limbs.
- The current manga standing reference is approximately **six head units**:
  idle frame 0 measures 455 px sole-to-crown and 76 px crown-to-chin. Sheets
  may use another common drawing scale if all 24 poses preserve it and fit.
- Record the reviewed frame-zero crown/chin in `SPRITE_HEAD_REFERENCE`.
  The renderer uses one uniform scale per action, never a per-frame outline
  fit. Six head units map to a 1.9 m athlete before roster variation, keeping
  bodies proportional to the court and its 2.43 m net. The old 340/81 scale
  must not be restored: it enlarged ready players beyond the net height.

---

## 3. What must not be in the frame

The game draws these itself, in the right place, at the right moment. Drawn
into a sprite they appear twice, in two different places:

- **the ball** — including at the moment of contact
- **the net, posts and antennae**
- **the floor, court lines, shadows**
- **other players**
- **impact flashes, speed lines, motion trails** *(the game adds its own; a
  small one attached to the striking hand is acceptable if it helps sell the
  hit, but nothing that extends into the frame as a separate shape)*

---

## 4. The camera: strict profile

The game is a flat side elevation — the court is a horizontal band, the net a
vertical post. So:

- **Pure side view**, the same angle in every frame. No three-quarter turn, no
  perspective, no foreshortening, no camera moves between frames.
- The player **faces right**. The game mirrors the sprite for the other
  direction, so a left-facing frame is never needed — and any asymmetry
  (a number on one sleeve, a logo) will flip with it.
- Level eye line, consistent across all sheets.

---

## 5. Colour, so both teams can wear it

One sheet has to dress twelve players in two teams. The game finds the kit by
its hue and remaps it, keeping every fold and shadow exactly as drawn. That
works if, and only if:

- **The kit is one clearly saturated hue** — shirt and shorts together. Strong
  blue is ideal.
- **Nothing else on the figure shares that hue.** Skin, hair, shoes, socks,
  knee pads must be visibly different in hue, or desaturated (white, grey,
  black, skin tones). A blue shoe on a blue kit turns blue with the shirt.
- **Trim and numbers**: white, black, or grey. Those stay put while the kit
  changes, which is what makes the recoloured kits look designed rather than
  dyed.
- Shading inside the kit is welcome — it survives the swap intact.

---

## 6. The actions, and where the contact falls

One sheet per action, named exactly as below (the file name is how the game
finds it). 24 frames each, as one continuous movement — first frame flowing
into the last where the action repeats.

| File | Action | Ball is struck on frame |
|---|---|---|
| `idle.png` | ready stance, small breathing motion, loops | — |
| `approach.png` | the run, loops seamlessly | — |
| `spike.png` | approach → plant → jump → arm cocked → strike → land | **20** |
| `block.png` | crouch → jump → hands over the net → land | **17** |
| `bump.png` | drop into the platform, forearm pass, recover | **13** |
| `set.png` | under the ball, hands overhead, release, recover | **12** |
| `dive.png` | dip → launch → extend → floor contact → slide → get up | **14** |
| `serve.png` | stance → toss → strike → follow through | **13** |
| `jumpServe.png` | toss → run → jump → strike → land | **17** |
| `celebrate.png` | fists up, jump, turn to the crowd, loops | — |

The contact frame matters: the game knows the exact instant the ball is hit and
places the sprite on that frame at that instant. If the drawn strike is a frame
or two from where the table says, the hit looks like a wave.

Frames that are not a full-body pose in the same style — a close-up, a detail,
a title card — cannot be used, and the game has to detect and skip them.

---

## 7. The arena

The court, stands, crowd, lighting, scoreboard, net, referee stand and ball
kids are all drawn by the game as vector shapes. That is why they still look
older than the players. Replacing them is worth more than any further work on
the figures.

Useful, in order of impact:

| File | Size | Notes |
|---|---|---|
| `arena-back.png` | 2560 × 900 | Back wall, stands, crowd, banners, lighting rigs. Drawn flat and straight on, no perspective. Wider than the screen so the camera can pan across it. |
| `arena-floor.png` | 1024 × 512, tileable horizontally | The playing surface. Wood grain or taraflex. No court lines — the game draws those, to scale. |
| `net.png` | 512 × 512 | Net, posts, antennae, tape. Seen straight on. |

Deep shadow at the top and edges, bright at the court, is what makes it read as
an indoor arena at night. Keep the palette cooler than the court so the players
stay the brightest thing on screen.

---

## 8. How to hand it over

Put the files in `public/sprites/` (figures) and `public/arena/` (arena) on the
branch and commit them. Nothing else is needed: the game picks up anything it
finds under those names, and falls back to what it has for anything missing —
so partial deliveries are fine and safe. One new sheet can be dropped in on its
own and tried.

Please do not send images through chat. They can be seen there but not read:
the pixels never reach the machine that builds the game.
