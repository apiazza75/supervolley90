# Recupero visivo manga — 9 settembre 2026

Stato: passaggio locale verificabile, **non completamento dell'intero obiettivo grafico/gameplay**. Nessun commit, push o rilascio macOS eseguito in questo passaggio.

## Risultato integrato

- Tribuna illustrata: `public/arena/v3/grandstand-manga.png` (2048×768). Il renderer preserva il rapporto d'aspetto; non sovrappone più la vecchia fascia LED e i coni geometrici ai volti.
- Arbitro seduto con seggiolone completo e due guardalinee: `public/officials/manga-seated.png` (1536×1024 RGBA, otto pose). Nessun corpo o seggiolone ricostruito con rettangoli sopra l'illustrazione. Segnali collegati agli eventi esistenti.
- Camminata: `public/sprites/walk.png`, 24 pose disegnate da una guida articolare. Sorgente conservata in `assets/source/manga-2026-09/walk.png`.
- Corsa: `public/sprites/run.png`, 24 pose, con successiva correzione di oscillazione delle braccia e alternanza dei lati. Sorgente finale `assets/source/manga-2026-09/run-mechanics.png`; prima versione conservata accanto.
- Tuffo: sostituito **solo il fotogramma 9**; evitato il ritorno del busto verso l'alto nel lancio. Gli altri 23 fotogrammi sono identici byte per byte. Sorgente `assets/source/manga-2026-09/dive-correction.png`.
- Cadenza di camminata/corsa separata dalla rincorsa: la precedente velocità di riferimento riduceva la camminata a circa 4,5 disegni al secondo alla velocità di gioco effettiva. I test ora coprono il clock reale rallentato.
- Inquadratura della battuta: conserva un margine per il corpo intero del battitore anche quando il servizio cambia lato.
- Preview macOS: file watching con polling; il precedente processo Vite serviva moduli vecchi nonostante le modifiche su disco.
- Galleria locale `art-review.html`: riproduzione, pausa, rallentatore, fotogramma singolo e tre sfondi. È un controllo delle immagini, **non una prova del gameplay**.
- Menu: riutilizza le illustrazioni manga già caricate dal renderer, senza sagome schematiche.
- Formato video: composizione unica 1280×720 ridimensionata uniformemente con bande laterali/sopra-sotto quando necessario. Nel pannello stretto il pubblico non diventa più gigante rispetto al campo.

## Verifiche eseguite

- Suite finale: 127 test superati in nove file; typecheck, build e controllo della build superati. `git diff --check` senza errori.
- Build locale aperta in Chromium: 12/12 fogli, 12/12 maschere, 5/5 livelli arena, arbitro illustrato effettivamente disegnato. Cattura in `artifacts/build-check/match.png`.
- Controlli asset e movimento superati; controllo Pillow su tutti i dodici fogli: zero residui bianchi e zero aloni quasi bianchi secondo i criteri del controllo.
- Catture dalla partita e cinque video in `artifacts/visual-qa-v3/` completati. Zero ricorso al corpo vettoriale; un solo corpo disegnato per giocatore.
- **La verifica visuale completa NON è verde**: il campione di corsa registra solo i fotogrammi 14, 16, 19, 21 prima del passaggio a shuffle; non copre entrambi gli appoggi mentre il giocatore è ancora classificato come `run`. Il controllo resta segnalato in `metrics.json`. Non è una certificazione dell'alternanza anatomica dei disegni: le sue direzioni sono metadati derivati dall'indice del frame. Serve una cattura più estesa dello stesso giocatore e revisione visiva del ciclo completo.
- Il campione di camminata del vecchio harness cambia giocatore fra alcune catture: la sua distanza complessiva non è una misura valida della falcata individuale. Non usarlo per affermare naturalezza.

I video e le catture complete precedono soltanto le ultime modifiche di menu/formato; il rendering della partita a 1280×720 non cambia. La build è stata nuovamente verificata dopo tali modifiche. Nessuna accettazione estetica dell'utente è stata presunta.

## Limiti aperti

Le altre sequenze restano quelle preesistenti. Il numero di celle distinte non certifica anatomia, continuità, contatto mano-palla o naturalezza. In particolare restano da affinare la coerenza di scala fra azioni, alcune transizioni e la camminata. Non descrivere tutte le movenze come definitivamente fluide.

La variante successiva di camminata `exec-d286e27a-5a9d-432e-8aa9-2831814a3b36.png` è stata scartata: introduceva troppe falcate aperte ripetute. Anche la prima generazione non guidata `exec-117e5a48-593a-4381-965e-b7dcb5a96d3d.png` era stata scartata. Non importarle.

## Pipeline e salvaguardie

Generazione eseguita con il **tool integrato imagegen**, non CLI/API esterna. I risultati scelti sono copiati nel progetto; nessun asset runtime dipende dalla cartella personale del generatore.

Import tecnico: `tools/import_generated_sprites.py` rimuove il fondo magenta e registra l'intera figura, con un'unica scala uniforme per sequenza. Non stira separatamente gambe, busto o braccia; non inventa intermedi deformando o fondendo raster. `--frame 9` importa soltanto la correzione indicata. `tools/import_officials_manga.py` conserva la figura seduta e la sedia come un'unica illustrazione.

Il vecchio `tools/enrich_manga_sprites.py` ora si arresta esplicitamente: lo stretching/shearing di immagini esistenti non è nuova animazione.

Per questi strumenti serve Pillow; su questa macchina è disponibile nel runtime Python di Codex. I fogli finali dei giocatori sono tutti 3072×2048 RGBA, griglia 6×4, celle 512×512 e baseline 470.

I controlli automatici verificano caricamento, formati, frame non vuoti, registrazione, trasparenza, cadenza e comportamento degli eventi. I precedenti vincoli che premiavano gambe artificialmente strette e conteggi di primitive del pubblico sono stati rimossi: non misuravano qualità visiva.

## Prompt finali e riferimenti

Le guide `artifacts/art-direction/{walk,run}-poses.png` sono riferimenti per l'illustratore, **mai sprite usati nel gioco**. Il personaggio di riferimento è una cella dell'illustrazione manga preesistente.

### Tribuna — generazione con riferimento allo stile esistente

```text
Use case: stylized-concept. Asset type: production background illustration for the existing 2D volleyball game Super Volley 90.
Input image: reference for the established inked, cel-shaded manga illustration style ONLY; do not put this player into the background.
Create a panoramic indoor volleyball arena GRANDSTAND viewed straight across the court, from a slightly elevated side broadcast camera, extremely wide landscape 2560 x 720. It is a background layer, NOT a complete game screenshot.
Composition: upper 25 percent contains a high dark steel roof with credible perspective beams and small strip lights. Middle and lower 75 percent contain steeply raked crowded stands in five to seven receding rows, with aisles and slender handrails, ending in a narrow plain navy courtside barrier at the exact bottom edge. No court or floor, no net, no foreground athletes, no scoreboard, no text, no logos.
Draw hundreds of SMALL detailed manga spectators as a dense coherent crowd: varied silhouettes, hairstyles, ages, shirts, arms, seated posture, a few clapping or with arms raised, believable proportions. Closest heads at most 1/28 of image height; people get smaller toward the top. Natural clusters and overlapping bodies, organically varied posing, no repeated stamp figures. A handful of tiny blue and yellow fabric banners. Stylized 1990s sports anime background art, crisp dark ink contours, restrained cel shading and subtle painted grain matching the reference. The crowd recedes in soft desaturated navy, slate, muted teal and warm skin accents; preserve detail but keep the values darker and less saturated than the foreground players. Warm diffuse arena lighting, no giant spotlight cones. Solid opaque art all the way to the edges, no vignettes or borders. High-quality hand-painted manga arena, not primitive geometric people, not dots, not 3D, not photorealism, not vector clip art.
```

### Camminata — guida delle articolazioni + personaggio manga

```text
Use case: sketch-to-render. Production 2D animation atlas.
Image 1 is the EXACT 24-pose layout and movement reference: keep every joint's position and every limb's bend in its corresponding cell. Image 2 is the character and detailed MANGA ART STYLE reference.
Replace all 24 schematic figures in image 1 with fully illustrated versions of the male blue-uniform volleyball athlete in image 2. Match the SAME sequence and grid: six columns, four rows. Each cell must follow its own pose, not repeat a typical walking pose. Red guide limbs = the near/right limbs; cyan limbs = far/left limbs. These guide colours must be replaced with the character's normal skin, knee pads and uniform. In frames 6-8 and 18-20 one leg passes underneath the pelvis with a clearly bent knee: faithfully draw these narrow passing poses. In frames 1 and 13 opposite legs lead. Left and right arms counter-swing. Always facing right. NORMAL athletic human proportions, consistent head/torso/thigh/calf sizes, no thin stretched legs. Detailed hand ink, 1990s sports manga cel shading, blue jersey and blue shorts with white side panels, small number 7, dark hair, black knee pads, white socks and navy shoes as in image 2.
Keep generous empty space around all feet and hands. Remove all numbers, text, ground lines and schematic guide strokes. NO ball, shadows or effects. Flat solid pure magenta #FF00FF background for accurate game chroma-key extraction; also magenta inside the gaps between legs and arms. No checkerboard, no gradients, no paper, no background highlights. Output 1536x1024. All 24 individually drawn poses with clean anatomy and exact pose fidelity to image 1.
```

### Corsa — guida delle articolazioni + personaggio manga

```text
Use case: sketch-to-render. Production sprite atlas, 24 drawn RUN animation frames, 6 columns by 4 rows, 1536x1024.
Image 1 is an EXACT joint position guide for the whole continuous run cycle. Image 2 is the character design and manga rendering style. Replace each schematic runner with the detailed volleyball athlete from image 2, strictly preserving each cell's individual leg positions, knees and contacts. Red limbs in guide are the right/near side, cyan the left/far side; render them in normal skin/kit colours with near limbs lit slightly brighter and far limbs darker. Each of the 24 frames must follow its OWN pose, no substitute repeated run poses.
One athletic adult male, short dark hair, expressive profile facing right, blue jersey small number 7 and white side panels, blue shorts, black knee pads, white socks, navy shoes with small yellow sole. Exact same character proportions and head size throughout: normal muscular thighs and calves of believable length, torso around three head lengths, legs from crotch to soles around 3.5 head lengths. Do not elongate or thin the legs.
Smooth alternating two-foot RUN: rolling foot contact, flexed-knee absorption, trailing heel rises behind thigh, next knee drives forward while other foot pushes off, short suspension, opposite foot contact. Keep the foot positions/bends from the guide, modest forward body lean, elbows flexed about 90 degrees and arms pumping in opposition. Faithful continuous in-between drawings, slight vertical body compression and lift. Never slide a rigid spread-leg pose. All 24 complete figures isolated with safe borders, no clipped limbs.
1990s sports anime/manga hand-inked contours, sharp detailed cel shading, natural clothing folds, same style as image 2. Remove guide, numbers, text, baselines and all shadows. NO ball, floor or motion effects. Flat uniform PURE MAGENTA #FF00FF background and also magenta in every opening between legs and arms, no checkerboard, no paper, no gradients.
```

### Corsa — correzione mirata della meccanica sul risultato precedente

```text
Use case: precise-object-edit. Edit the provided production RUN animation atlas, preserving the manga athlete's face, hair, uniform, body proportions, 1536x1024 image and exact 6-column by 4-row layout.
The only task is to CORRECT THE RUN MECHANICS. It currently repeats the right leg in front and leaves the arms almost straight. All 24 figures must face RIGHT throughout.
Render one continuous full right+left run cycle, reading rows left to right. The near limb is the athlete's RIGHT limb: lightly lit skin. The far limb is LEFT: shaded skin. Their layer order NEVER changes.
Cells 1-6: near/right leg initially reaches in front, then plants and supports; left heel folds behind. Right elbow behind ribs, right forearm folded FORWARD at 90 degrees; left arm pumping forward near chest.
Cells 7-12: right foot pushes backward and trails behind, left knee swings forward. Crucial: RIGHT ARM IS NOW FORWARD across the chest, elbow bent 90 degrees, LEFT ARM BACK. The near/right thigh is drawn over the far/left thigh but points BACK behind the pelvis.
Cells 13-18: LEFT leg extended FORWARD and taking support; RIGHT leg BEHIND, heel folding up toward buttock. This must look observably different from cells 1-6: the BACK leg is now the fully visible, brightly lit NEAR leg. Near/right arm forward across the chest, far/left arm behind ribs. Keep the face looking right, do not rotate the whole character backwards.
Cells 19-24: left foot pushes backward while RIGHT KNEE drives forward, near arm swings back, leading seamlessly into cell 1.
There must be real overlap/crossing of the thighs at cells 5-6 and 17-18. Opposite arm/leg pumping, bent elbows, a small forward lean. Keep the same full-body scale in every cell and preserve all 24 foot positions and silhouettes as much as compatible with the corrections.
Keep highly detailed 1990s manga sports drawing, blue number-7 uniform, black knee pads, white socks, navy shoes, sharp natural ink contours, existing proportional legs. No extra limbs, no duplicated knees, no straight pendulum arms, no giant hands. Preserve flat PURE MAGENTA #FF00FF background and magenta holes between limbs, no text, no floor or shadows.
```

### Arbitro seduto e guardalinee — generazione nello stile manga

```text
Use case: illustration-story. Asset type: production 8-frame officials sprite atlas for the manga volleyball game.
Style reference: the supplied athlete's crisp detailed 1990s sports manga ink/cel-shading and normal human proportions. Draw officials, not athletes.
Output a precise grid 4 columns x 2 rows, 1536x1024 landscape, eight equal 384x512 cells. Flat pure MAGENTA #FF00FF background throughout, including holes in chairs and between limbs, for clean alpha extraction. No checkerboard, no text, no labels, no panels, no shadows, no floor or net. Keep each complete cutout wholly inside its cell, generous 8% safe border, identical scale and registration across each row.
TOP ROW, 4 poses of ONE seated first referee WITH HIS ENTIRE HIGH VOLLEYBALL REFEREE CHAIR: a middle-aged male in a navy polo with narrow gold trim, charcoal trousers and dark shoes. Seen three-quarter from his left front, watching toward the LEFT of the picture. He is seated naturally with visibly bent hips and knees, feet on a footrest. Slim practical tall steel umpire chair/ladder with low backrest, narrow blue seat, four slender stable legs, two or three rungs and handrail, credible perspective and structural joints. Chair base is visible and aligned across all four cells; human and chair are drawn as a single coherent illustration. Head height about one-eighth of the complete cutout, total chair+person not bulky.
Top poses: 1 neutral alert seated, hands lightly resting; 2 blows whistle and extends one arm to authorize service; 3 extends one arm horizontally toward LEFT to award a point, stays seated; 4 extends other arm horizontally toward RIGHT to award a point, stays seated.
BOTTOM ROW 4 poses of one line judge, full body standing three-quarter facing LEFT. Dark forest-green polo with cream collar trim, charcoal trousers, dark shoes, a small square RED flag on a short staff. Same face and human scale across all four cells. Bottom poses: 1 flag relaxed down along thigh; 2 signal ball IN, arm and flag point diagonally downward toward court; 3 signal OUT, arm and flag raised vertically above shoulder/head; 4 signal TOUCH, flag upright in front of upper body and opposite hand visibly touching its top edge.
Accurate hands, clothing folds, inked hair and facial features, solid athletic-adult but not exaggerated anatomy. NO geometric stick figures, no office chair, no giant throne, no floating body, no cropped feet/chair, no white background patches.
```

### Tuffo — correzione mirata, importazione della sola cella 9

```text
Use case: precise-object-edit. Repair ONE incorrect in-between drawing in this 24-frame manga volleyball DIVE sprite sheet.
Preserve all existing character artwork, the blue number-7 kit, face/hair, normal body proportions, frame order and exact 6 columns by 4 rows. Output the same complete 24-frame sheet, 1536x1024, with a perfectly uniform MAGENTA #FF00FF background replacing the transparent background.
Change ONLY frame 9 (counting from 1, second row, THIRD column). Currently the torso rises upright and the knees tuck under the body even though the preceding frame 8 is already diving forward. This makes a backwards pop. Redraw frame 9 as the natural intermediate between frames 8 and 10: lean the torso further forward to almost horizontal, head moves a little lower, both arms stretch forward together, chest and hips advance into the dive, trailing legs extend behind, toes leaving the floor. The drawing must progress toward the horizontal flight of frame 10, NEVER return upright. Match the exact local head size and thigh/calf lengths of frames 8 and 10. Keep the athlete fully inside that cell with no clipped hands or feet.
Keep all other 23 poses unchanged in shape, scale and sequence. Do not retime or duplicate them. Preserve detailed 1990s manga linework and cel shading. No ball, floor, borders, numbers, text, shadows, speed lines or new elements. Magenta in every opening between the limbs, no white matte or checkerboard.
```
