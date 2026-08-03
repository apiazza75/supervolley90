# Super Volley 90

Arcade 6-on-6 volleyball for macOS, built in the spirit of the early-90s coin-ops
— a side-on court with the net down the middle, two buttons, a landing marker on
the floor, and rallies that resolve in a few loud seconds.

Everything here is original: the code, the procedural art, the synthesised
audio, the fictional teams. No assets or data from any existing game are used.

![gameplay](docs/screenshot.png)

## Why it was built from scratch

The obvious starting point would have been an existing open-source volleyball
game, but none of the candidates fit:

| Project | Why not |
| --- | --- |
| [blobbyvolley2](https://github.com/danielknobe/blobbyvolley2) | The best-maintained option, but it is 1-on-1 blob physics under GPLv2 — the six-player rotations, blocking and landing-marker aiming that define this genre would mean replacing essentially all of it. |
| [DJWOMS/volleyball-game-godot](https://github.com/DJWOMS/volleyball-game-godot) | 3D, 14 commits, no licence file. |
| [Ahish9009/Volleyball](https://github.com/Ahish9009/Volleyball) | Python 2.7 / PyGame, single-player-vs-computer toy. |

So the simulation is new, and the *design* is what borrows from the era: the
landing marker, the semi-automatic contacts, the knockdown on a hard spike.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173
```

### Building the macOS app

The game ships as a native `.app` via [Tauri](https://tauri.app) — a small Rust
shell around a WKWebView, so it is Metal-backed, Apple-Silicon-native and a few
megabytes rather than a bundled browser.

```sh
npm run app:dev      # run the native app with hot reload
npm run app:build    # produces src-tauri/target/release/bundle/{macos,dmg}
```

Both derive the macOS icon set from `src-tauri/icons/icon.png` first, so the
`.icns` the bundler needs is never missing — only the source PNG is in git.

Requires Rust (`rustup`) and the Xcode command line tools. Signing and
notarisation are not configured; add your identity to `tauri.conf.json` when you
need a distributable build.

**Or skip the toolchain entirely.** CI builds the app on a macOS runner for
every push; download `SuperVolley90-macos` from the run's artifacts. It contains
a `.dmg` and a `.tar.gz`, deliberately not a bare `.app`: GitHub re-zips
artifacts and drops Unix permission bits, which strips the executable flag off
the binary inside a `.app` and makes macOS report it as damaged. A disk image
and a tarball both carry their own permissions and survive intact.

### Signing and notarisation

The `macos-app` job has two modes, chosen by whether the repository has an
`APPLE_SIGNING_IDENTITY` secret.

**Without it** the app gets an ad-hoc signature. It runs, but nothing vouches
for who built it, so Gatekeeper blocks the first launch:

```sh
xattr -dr com.apple.quarantine "/Applications/Super Volley 90.app"
```

On macOS 15 and later the old right-click → Open bypass no longer works; use the
command above, or System Settings → Privacy & Security → **Open Anyway**.

**With a Developer ID** Tauri signs with hardened runtime, submits the build to
Apple's notary service and staples the ticket, so the app opens on a double
click like any other download. Add these repository secrets
(Settings → Secrets and variables → Actions):

| Secret | What it is | Where it comes from |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | Developer ID Application certificate, as base64 | Export it from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set on that `.p12` | You choose it during the export |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` | `security find-identity -v -p codesigning` |
| `APPLE_ID` | The Apple ID email on the developer account | — |
| `APPLE_PASSWORD` | An **app-specific** password, not your Apple ID password | [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | 10-character team identifier | [developer.apple.com/account](https://developer.apple.com/account) → Membership |

The certificate must be a **Developer ID Application** certificate, not a Mac
App Store or Apple Development one — only that kind is accepted for software
distributed outside the App Store.

Notarisation adds a few minutes to the job. The workflow verifies the result
with `spctl --assess` and `stapler validate`, so a build that would still be
blocked on a user's machine fails in CI rather than in a download.

## Controls

| | Keyboard | Gamepad |
| --- | --- | --- |
| Move / aim | Arrows or WASD | Left stick / D-pad |
| Play the ball | Space or J | A / X |
| Jump | Shift or K | B / Y |
| Pause | Esc or P | Start |

Two buttons carry everything, exactly as the cabinets did:

- **Hold to charge.** A tap is a controlled pass or a tip; a full hold is a
  power swing or a jump serve. The meter above your player shows it.
- **The stick aims.** Where you are pushing when you make contact is where the
  ball goes — wide or line, short or deep.
- **Jump early.** Contact quality peaks at the top of your reach, so the spike
  that lands is the one where you took off before the set arrived.
- You steer one player; the ring on the floor shows who. Control hands over to
  whoever can realistically play the next ball, never mid-jump.

### Lethal Maneuvers

The gauge at the bottom of the screen fills from **defence** — digging a hard
spike, getting a block up, laying out for a save — and barely at all from
winning points. A team under pressure is therefore the one most likely to earn a
way out of it.

When it is full, jump and press the jump button **again in mid-air** to unleash
one. Which of the three you get depends on where the stick is pushed at that
moment:

| Stick | Move | What it does |
| --- | --- | --- |
| Neutral / forward | **Meteor Smash** | Straight down off the top of the reach, at the fastest the ball travels |
| Left or right | **Comet Drive** | Leaves towards the antenna and hooks violently back inside |
| Back (short) | **Phantom Drop** | Floats over, stalls on backspin, then falls dead behind the block |

A Lethal Maneuver flattens any blocker who gets a hand to it, and empties the
gauge.

## Architecture

```
src/core/     simulation — no DOM, no rendering, fully deterministic
  rules.ts      court dimensions, scoring, tuning constants
  ball.ts       physics and the arc solvers
  player.ts     movement, jumping, diving, pose state
  contact.ts    what each kind of strike does to the ball
  team.ts       roster, rotation, formation anchors
  ai.ts         per-team job assignment and command generation
  world.ts      rally state machine, faults, scoring
src/render/   canvas presentation, projection, effects, HUD
src/game/     input, audio, menu, roster
src-tauri/    native macOS shell
tools/        headless runner, rally tracer, screenshot capture, icon generator
```

Two decisions shape the rest:

**The core never touches the DOM and never calls `Math.random()`.** Every random
draw comes from a seeded PRNG, so a match replays identically from its seed.
That is what makes `npm run sim` a usable balance tool and the tests meaningful.

**The simulation runs at a fixed 120 Hz, the renderer at display refresh.** On a
60 Hz panel that is two steps per frame; on a 120 Hz ProMotion display, one.
Physics and feel are identical either way, and there is no frame-rate-dependent
behaviour to chase.

That separation paid for itself when the camera changed. The simulation works in
metres — x across the court, y along it, z up — and knows nothing about how any
of it is drawn, so switching from a behind-the-baseline view to the side-on one
this game needed was a change to the projection alone. Not a line of gameplay
code moved.

**The projection is a flat side elevation.** There is no divide by depth
anywhere in the renderer, and that single absence is what makes the picture read
as a 2D game: court lines stay exactly parallel and a player is the same size
wherever they stand. Court width maps to a pure vertical offset of 22 px per
metre against 55 px per metre along the court, which compresses the court's 9 m
of depth to about a sixth of its 18 m of length — the ratio the arcade original
uses.

The net therefore has no width at all on screen: every point of it shares one
column, so it is drawn as a narrow vertical post. That is correct, and it is
what the original does. An intermediate version sheared the width axis
diagonally to give the net visible area, which produced a handsome picture that
was unmistakably an angled 3D scene — the wrong game.

Players are drawn as articulated vector figures rather than sprites: a skeleton
of joint angles, limbs as tapered capsules with knees and elbows, flat colours
and a dark outline. Poses ease towards their target every frame instead of
snapping, which is what lets a run flow into a jump and a jump into a swing.

## Tooling

```sh
npm test                            # unit and simulation tests
npm run typecheck
npm run sim -- --matches 6          # headless AI-vs-AI matches with statistics
npm run trace -- --seconds 20       # step-by-step rally trace
npm run shots -- shots/             # drive the real game in Chromium, capture frames
```

`npm run sim` is the balance harness. A healthy build looks roughly like this:

```
1124 points, avg rally 6.5s, avg touches/rally 7.0
reasons: kill ~68%, out ~13%, own error ~13%, serveFault ~5%
power moves ~25 per side per match, home/away wins 3-3
```

The home/away win split matters as much as the rates. Two asymmetries were found
exactly this way: sidespin that curved one way for one team and the other way
for the other, because the Magnus force depends on the sign of the velocity, and
a serve that had become risk-free once the arc solver stopped undershooting.

Rallies collapsing to one or two touches, or serve faults dominating, means a
tuning constant has drifted — both failure modes happened during development and
both showed up here first.

## Rules implemented

Rally scoring to 25 (deciding set to 15), win by two, best of five. Three
touches a side with blocks free, no consecutive contacts by one player, rotation
on side-out, back-row attack restriction behind the attack line, serve faults,
balls outside the antennae, and the plane-crossing fault under the net.

## Known gaps

- The native macOS build was not verifiable during development (built on Linux,
  where Tauri's GTK/WebKit backend cannot compile). The `macos-app` CI job now
  covers it — treat a green run there as the confirmation, not local testing.
- Unless the Apple secrets are configured, builds are ad-hoc signed and need
  one Gatekeeper bypass on first launch.
- No local two-player mode yet — the second side is always AI.

- Audio is a synthesised placeholder: functional, not composed.
