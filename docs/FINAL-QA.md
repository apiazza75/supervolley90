# Gameplay and visual QA

## Why this document was rewritten

The previous version of this file said the evidence showed the game running "without
page errors, white sprite backgrounds or duplicated art". Two of those three claims were
untrue at the time they were written:

- the renderer drew every player twice per frame and cross-faded the two bodies, which is
  duplicated art by construction;
- the committed sprite sheets carried 1902 px of white fringing.

They went unnoticed because the checks behind them were the wrong checks. CI validated
that the assets had the right dimensions and that the bundle loaded them — facts about
files, not about what appears on screen — and the screenshot tool that produced the
"final evidence" set `p.height`, `p.anim` and `p.swing` by hand before each shot, so it
photographed poses the game had never reached.

The lesson is the one this file now tries to hold onto: a check that cannot fail on the
thing you care about is not evidence of it.

## What is checked now

### Gameplay, measured from real matches

`src/qa/gameplay-metrics.ts` plays matches and watches them. It writes nothing to the
simulation; it reads state and drains events. The unit tests, the `npm run metrics` CLI
and the visual QA all call the same module, so a threshold cannot pass in one place and
fail in another.

Gates, all from the brief:

| Metric | Threshold |
|---|---|
| `backFacingContacts` | 0 |
| `longestOverTwoApproach` | ≤ 0.25 s |
| `longestApproachRun` | ≤ 1.6 s |
| `serveReadyApproachPlayers` | 0 |
| `coverApproachSamples` | 0 |
| `spike.approachDistance` (median) | ≥ 1.4 m |
| `spike.apexHeight` (median) | ≥ 0.65 m |
| `jumpServe.approachDistance` (median) | 1.2 – 2.6 m |
| `jumpServe.apexHeight` (median) | ≥ 0.55 m |
| `block.attempts` / `block.contacts` | > 0 |
| `block.groundedContacts` | 0 |

Sequence figures are medians over every occurrence, not the best example seen, and
`airborneContact` means all of them rather than one. A gate an outlier can satisfy is not
a gate.

### Rendering

`renderStats.playerBodyDraws` counts body draws per player per display frame. The visual
QA asserts the maximum is exactly 1 — one is the whole point, and zero would mean nothing
was drawn.

### Visual QA, from play rather than from poses

`tools/visual-qa-v3.ts` may choose the seed, the teams and the difficulty and send input,
because those are the game's own public commands, and it may stop the clock so a real
moment can be photographed before it passes. It may not write `anim`, `height`, `swing`,
`airborne` or any other simulation state.

Each required screenshot therefore waits for a condition on live state — a genuine block
at its apex, a serve contact made in the air — and the run fails if the moment never
arrives. If the game stops producing real blocks, the shot times out; it is never staged.

### Sprites

`tools/sprite-qc-v3.ts` renders every sheet over checkerboard, magenta and black and
counts white fringing: near-white, near-opaque pixels touching a transparent one. It does
not count white in the interior of a figure, because socks, numbers and eyes are meant to
be white and a check that flagged them would simply be switched off.

`tools/sanitize-sprites-v3.ts` removes that fringing from the committed art at build
time, repainting each fringe pixel with the nearest genuine colour rather than erasing it
— erasing eats a pixel off every edge and thins the figure. The committed sheets measure
zero; the QC budget is 24 px per sheet as a regression guard.

## Build identity

`public/build-info.json` is generated at build time from the CI environment and shown in
the app as `BUILD <sha> · RUN <id>` in the menu and on the pause screen. CI fails if it
disagrees with `github.sha`. A screenshot of the menu is now enough to identify the commit
that produced it.

## What is not covered

Honest limits, so this file does not repeat its own history:

- Character identity is still colour and scale variation over a single silhouette. There
  are not six structurally distinct signatures per team.
- The arena is the existing three-asset setup, not a five-layer v3 system, and the net is
  not rebuilt from projected post geometry.
- Super-move and impact effects are unchanged.
- Nothing here measures whether the game is *fun*, which remains a matter for playing it.
