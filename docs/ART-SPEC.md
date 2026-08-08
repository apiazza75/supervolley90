# Art specification

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
- A standing player is about **340 px** from the floor line to the top of the
  head — roughly two thirds of the cell — leaving room above for reaching and
  jumping, and to the sides for a full stride.
- Keep that height consistent across every frame of every sheet. The game
  scales each frame by the figure's own height, so a figure drawn larger in one
  frame will visibly swell for that frame.

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
