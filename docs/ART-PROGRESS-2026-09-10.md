# Recupero visivo manga — 10 settembre 2026

Passaggio locale successivo a [quello del 9 settembre](ART-PROGRESS-2026-09-09.md).
L'obiettivo completo resta aperto. Nessun commit, push, CI o rilascio macOS in questo passaggio.

## Nuove illustrazioni integrate

- Palleggio: ridisegnate 24 pose. Profilo verso destra mantenuto, mani che salgono progressivamente, caricamento, estensione e recupero disegnato; eliminata la brusca rotazione frontale della vecchia tavola.
- Ricezione: ridisegnate 24 pose. Preparazione della piattaforma e ritorno delle braccia intermedi; eliminato il salto diretto dal follow-through alla posizione di attesa.
- Camminata: altre 24 pose corrette a passi più corti, dopo aver visto l'apertura eccessiva nei ritagli della partita. Sorgente finale `assets/source/manga-2026-09/walk-short-step.png`; runtime `public/sprites/walk.png`. Le sagome di contatto hanno larghezza mediana 247 px rispetto ai precedenti 309 px, a parità di scala della testa: è una misura della sagoma complessiva, non della sola distanza fra piedi.
- Runtime: `public/sprites/set.png` e `public/sprites/bump.png`, entrambi 3072×2048 RGBA.
- Originali generati: `assets/source/manga-2026-09/{set,bump}-natural.png`.
- Copie locali prima della sostituzione: `artifacts/art-direction/{set,bump}-before-natural.png`.

Generazione con lo strumento **imagegen integrato**, non CLI/API esterna. L'import tecnico riutilizza la rimozione del magenta e la registrazione uniforme del progetto, senza stirare le parti del corpo o fondere fotogrammi.

## Scala e punti mano-palla

Il precedente valore unico di 340 pixel per tutte le tavole faceva cambiare taglia alla stessa persona fra azioni. La scala ora è calibrata sui riferimenti testa del primo fotogramma, con un fattore unico e uniforme per tutta la sequenza. La posa di attesa conserva la dimensione precedente. Non viene normalizzato il bounding box di ogni posa: accovacciamento, estensione e salto rimangono nel disegno.

I riferimenti sono approssimazioni riesaminate visivamente nella tavola diagnostica `artifacts/art-direction/proportions/heads.png`, non una certificazione anatomica. Il colletto NON è usato come mento: cambia quota con l'inclinazione del busto. Dati in `SPRITE_HEAD_REFERENCE` di `src/render/sprites.ts`.

I punti mano/piattaforma sono ora in coordinate del disegno e passano dalla stessa scala, dalla stessa variazione di corporatura e dalla stessa profondità del corpo. Il contatto tiene conto anche della quota dei piedi nella tavola, per non sommare due volte il salto. I test confrontano la proiezione con il rettangolo effettivo passato a `drawImage`. I punti sono riesaminati in `artifacts/art-direction/proportions/contacts.png`.

## Evidenza, con limiti espliciti

- Typecheck e 134 test in nove file superati.
- Formati asset, controllo di movimento e controllo alpha/bianco superati su tutte le dodici tavole; zero residui secondo le soglie del controllo Pillow.
- Il nuovo osservatore registra un intervallo CONTINUO del medesimo giocatore: interrompe la presa se cambiano azione, andatura, velocità o presenza in campo. Non cambia mai posa, posizione o velocità.
- Presa finale dopo l'ultima tavola — corsa: giocatore 103, tutti i 24 frame, 0,747 s, 2,795 m di percorso.
- Presa finale dopo l'ultima tavola — camminata: giocatore 2, tutti i 24 frame, 1,851 s, 0,690 m di percorso. I ritagli conservano la proporzione originale con zoom uniforme 2×.
- Ritagli dalla partita e dati: `artifacts/locomotion-review/{run,walk}.{png,json}`.
- La prova precedente della camminata cambiava giocatore e quella della corsa era troppo breve. Sostituite nel controllo completo. I vecchi segni destra/sinistra, derivati dal seno dell'indice, non vengono più usati come prova dell'anatomia.
- Verifica visuale automatica completa superata, zero violazioni e cinque video registrati dopo palleggio/ricezione/calibrazione. Questa esecuzione precede la sola ultima tavola di camminata a passi corti; dati conservati in `artifacts/art-direction/metrics-after-set-bump.json`. Il controllo NON è approvazione estetica.
- Dopo l'ultima camminata: controlli dei dodici atlas e alpha nuovamente superati; 134 test finali, typecheck, build e controllo del bundle superati. La build carica 12/12 tavole, 12/12 maschere, 5/5 livelli arena e gli ufficiali illustrati. Presa continua finale di corsa/camminata superata sullo stesso giocatore. Cattura del bundle in `artifacts/build-check/match.png`; bundle `index-FK3NoZNd.js`. `git diff --check` senza errori.

Hash SHA-256 delle tavole finali:

| Tavola | SHA-256 |
| --- | --- |
| walk.png | 7383f31b960641a5bd78dc67d8e8bc98e18113d37ab6ef6438c401fed159a261 |
| set.png | 39ffe46234ffda9f20b5035867d313e90c40b929a0d7926e411ba8f12ff755f6 |
| bump.png | 8124e470edadd39ed426912e86c583fa5bd5c10467354150491e30224840117c |

**Non completato:** alcune pose di corsa/camminata restano troppo simili e l'alternanza anatomica richiede ancora rifinitura. Il nuovo controllo certifica la continuità temporale dello stesso soggetto, NON la qualità dei disegni. Altre azioni e transizioni restano da rifinire; non dichiarare tutte le animazioni naturali o il gioco finito.

## Prompt finali

### Camminata a passi corti

```text
Use case: precise-object-edit. Edit this existing 24-frame WALK atlas for a manga volleyball game. Preserve the exact 1536x1024 size, 6-column by 4-row layout, character, head sizes and positions, torso dimensions, detailed manga linework, blue number-7 kit, black knee pads and magenta background. All figures continue facing RIGHT.
Correct only the walking mechanics: this is a SLOW SHORT-STEP WALK, not a marching stride. The old spread legs are far too wide. REDRAW the limbs anatomically; never squash/stretch the body. Keep exactly the SAME thigh and calf lengths and thickness as the input, but place both legs mostly below the pelvis with hip angles only about 10-15 degrees from vertical. Maximum separation of shoe centers is ONE THIRD of the standing body height, often much narrower. No high knee lifts, no long lunges. Body upright with only mild athletic forward lean, hips and shoulders steady.
Use smooth sequential in-betweens across all 24 drawings. At least one foot on the floor in every frame, natural heel-to-toe rolling and low toe clearance.
Frames 1-6: the NEAR/RIGHT leg leads by a SMALL distance, heel touches ahead of pelvis and rolls into support while the far/left heel lifts slightly behind. Arm opposition: near/right arm swings BACK by a modest amount, far/left arm forward.
Frames 7-12: near/right foot passes under the pelvis then trails behind; far/LEFT leg moves forward, visibly bent at the passing instant before straightening slightly. Near/RIGHT arm now swings FORWARD, drawn over the torso, while far/LEFT arm moves back.
Frames 13-18: the far/LEFT leg now leads and supports. The brightly lit NEAR/RIGHT leg must be BEHIND the pelvis with heel slightly lifted, NOT another copy of frames 1-6. Keep the near leg visually in front of the far leg where thighs overlap. Near/RIGHT arm FORWARD over the torso, far/LEFT arm BACK. The face keeps looking right.
Frames 19-24: LEFT support moves behind, RIGHT foot swings low forward across the planted left leg, near/right arm moves back again, arriving smoothly at frame 1. Passing poses are compact, with the feet nearly beneath the hips; no abrupt jump to spread legs.
Same limbs remain near/far throughout; near skin brighter, far skin shaded. Their occlusion order does not switch. A modest bent knee follows through during swing. Draw subtle but genuine successive changes, not blocks of duplicated poses.
Keep the ORIGINAL detailed hand-inked manga rendering and normal muscular anatomy. Keep torso/head scale fixed in all cells, complete soles and hands within safe cell borders. No extra limbs, detached kneecaps, giant feet, speed effects, floor, shadows, grid, labels or background texture. Uniform pure MAGENTA #FF00FF including all negative spaces between limbs, no white or checkerboard patches.
```

### Palleggio

```text
Use case: stylized-concept. Production animation sprite atlas for an existing manga volleyball game.
Input image 1 is the character and drawing-style reference. Input image 2 is the OLD SETTING atlas to replace: its sudden turn towards the viewer and its many repeated fully extended poses are defects, DO NOT copy those defects.
Create 24 genuinely drawn in-between frames of a smooth STANDING OVERHEAD VOLLEYBALL SET. Exactly six columns by four rows, 1536x1024, all figures completely inside their equal cells. Reading order left to right, top to bottom. SAME adult athletic male in every cell, SAME size of head, torso, thighs and calves, SAME camera three-quarter side profile FACING RIGHT in all 24 frames. Blue short sleeve jersey number 7 and blue shorts with white side panels, black knee pads, white socks, navy shoes with small yellow soles. Detailed expressive manga face, short dark hair, crisp dark hand-inked outlines, nuanced clean cel shading and natural folds matching image 1. Normal athletic adult proportions, thigh and calf balanced; never long thin legs.
Animation, not a collection of disconnected poses. He stays planted in one small staggered stance, near/right foot slightly forward. Head and shoulders always in right-facing profile, never rotating frontally. No running or jump.
ROW ONE, frames 1-6: starts in the slightly flexed ready stance of image 1 with relaxed hands at waist; then gradually raises the open hands past chest, chin and eyes while bending knees gently to receive. Every cell is a small progressive change.
ROW TWO, frames 7-12: hands form a volleyball-setting window ABOVE and slightly in FRONT of forehead, thumbs toward eyes; elbows flexed, fingers naturally spread, not praying hands. Frames 7-9 finish the cushioning dip, 10-11 start extending knees and elbows together, 12 is the CONTACT frame, hands about one head above forehead and slightly forward. Do not turn towards the viewer.
ROW THREE, frames 13-18: smooth upward-forward release, elbows extend without locking, heels rise modestly on toes, wrists follow through. Peak stretch is frame 15, then 16-18 progressively relax wrists and bend elbows back down. Never repeat six identical extended poses.
ROW FOUR, frames 19-24: smoothly lower both hands past face, chest and waist; heels settle, knees gently return to the original ready stance, last frame closely approaches first. Do NOT jump from raised hands directly to hands at waist.
Keep pelvis centered consistently in each cell, one constant illustration scale, feet at same baseline, sufficient headroom for extended hands. Do not deform or elongate any body part. All twenty-four full-body poses actually drawn, clean silhouettes, no extra limbs, no chopped fingers or soles. No ball because the game draws it separately, no text except small jersey 7, no grid lines, no motion ghosts, no floor/shadow/effects. Flat uniform PURE MAGENTA #FF00FF background including all holes between arms and legs for clean extraction; no checkerboard, white matte or gradients.
```

### Ricezione

```text
Use case: stylized-concept. Production 24-frame animation sprite sheet of a FOREARM VOLLEYBALL RECEIVE (bump/bagher), 1536x1024, exact six columns by four rows.
Image 1: character identity, normal human anatomy and crisp detailed 1990s manga drawing style reference. Image 2: old BUMP sequence to replace, its sudden snap back to ready between rows three and four is a defect. Do not copy repeated holds. Draw natural in-between frames.
Same athletic adult male, right-facing three-quarter SIDE PROFILE in EVERY cell, short dark hair, blue jersey small number 7, blue shorts with white side panels, dark knee pads, white socks, navy/yellow-soled shoes. Consistent head, torso and limb lengths throughout. Balanced muscular thighs/calves, natural athletic proportions, NO elongated thin legs. Detailed hand-inked contours, clean nuanced cel shading, expressive face and cloth folds exactly in established manga style, not simplified vector.
One continuous controlled standing reception, no run, no jump. Compact staggered stance, near/right foot slightly ahead, modest width. Feet stay in their planted positions through the receive; knees absorb, shoulders and pelvis rise/fall gently. Arms join into a straight forearm platform with overlapping hands, elbows extended naturally, never two detached arms.
ROW ONE frames 1-6: ready knees flexed, hands relaxed at thighs. Smoothly shift weight and bend a little deeper, join hands and bring the platform forward/down; gradual small differences, not repeated poses.
ROW TWO frames 7-12: extend the joined platform diagonally forward at waist level, torso slightly forward, shoulders lift gradually and knees begin extending. Frame 12 approaches ball contact. The wrists stay below shoulders, forearms form a flat plane.
ROW THREE frames 13-18: frame 13 is ball CONTACT at middle forearms, platform slopes from shoulder down to hands. Then a short controlled follow-through led by extending knees, raising platform a little (never above shoulder height), followed immediately by gradually LOWERING the arms and separating hands by frame 18. Each frame progresses through the gesture, no five-frame repeated hold.
ROW FOUR frames 19-24: keep smoothly relaxing elbows and lowering open hands from lower chest toward thighs, torso settles into the original ready stance, knees soften. Never snap from straight raised arms to arms at thighs. Last frame nearly matches first.
Exactly 24 unique full-body drawings, centered pelvis in each equal cell, common scale and baseline, generous blank margin, no cropped soles/hands. Preserve a clear separation between legs. No ball (game renders its own), shadows, floor, effect lines, labels, panel borders or numbers outside jersey. Flat solid pure MAGENTA #FF00FF background throughout and between limbs; no white matte, checkerboard or gradients.
```
