# Piano V4 — esito

Cosa è stato fatto rispetto a `docs/PIANO-V4.md`, cosa il piano dava per assodato e non lo era,
e cosa resta fuori.

---

## 1. I quattro fatti della sezione 1, verificati per esecuzione

Il piano dichiara i suoi fatti «ricostruiti da lettura del codice, non da esecuzione» e chiede di
verificarli. Verificati.

### 1.1 — regge

I dieci fogli sono `3072x2048` RGBA (header PNG). `src/render/rig.ts` esporta un solo array di
keyframe, `SPIKE`, ed è importato da un solo file in tutto il repository: `src/dev/rig-sheet.ts`.
`src/dev/make-sheets.ts` produce `1456x1080` da `drawPlayer`. La conclusione operativa — non esiste
un giunto `head` interrogabile per l'arte disegnata — è confermata: in `sprite-figure.ts`
`Playhead`/`Head` sono testine di lettura dell'animazione, non anatomia.

Imprecisione senza conseguenze: il piano dice che `rig.ts` è usata «come fallback vettoriale». Non
lo è; il fallback è `drawPlayer` in `src/render/players.ts`, che non importa `rig.ts`.

### 1.2 — regge, misurato

Caricati i dieci PNG in Chromium e riprodotto il campionamento di `cutOut()`. Frazione di pixel
trasparenti:

```
idle 0.904  approach 0.892  spike 0.896  block 0.924  bump 0.884
set 0.908   dive 0.899      serve 0.906  jumpServe 0.913  celebrate 0.894
```

Soglia `cutOut()` = 0.15: tutti e dieci prendono la via `sliceCutOut()`, tutti danno 24 celle non
vuote, `measure()` produce `boxTop`/`boxBottom` per ciascuna. Su quella via
`layout.top/bottom/left/right` non vengono mai letti.

### 1.3 — NON regge come scritto

Il piano cita, a `src/render/arena.ts:345`:

```ts
if (!this.artwork.drawCourtFloor(ctx, cam, COURT_HALF_WIDTH, COURT_HALF_LENGTH)) {
  this.drawGrain(ctx, cam, outX, outY);
}
```

Il codice reale era, a `src/render/arena.ts:382-414`:

```ts
if (this.artwork.complete) {
  this.artwork.drawArenaFloor(ctx, cam, outX, outY);
} else {
  fillQuad(/* SURROUND */); fillQuad(/* COURT_NEAR */); fillQuad(/* COURT_NEAR */);
  this.drawGrain(ctx, cam, outX, outY);
}
```

Tre differenze che cambiano l'implementazione:

1. `drawCourtFloor` esisteva ma era un alias di compatibilità **senza un solo chiamante**. Il metodo
   vivo era `drawArenaFloor`.
2. Il gate non era il caricamento del layer pavimento ma `artwork.complete`, cioè tutti e cinque i
   layer.
3. A saltare non era solo `drawGrain` ma anche i tre `fillQuad` di base. Il PNG non copriva il
   parquet: lo sostituiva insieme al terreno sotto, ed era disegnato su tutta la zona libera
   (`outX = STAND_FRONT - 0.3`, `outY = COURT_HALF_LENGTH + 9`), non sul campo regolamentare.

La conclusione di 1.3 regge: `drawGrain()` campiona `cam.projectFloor()` doga per doga, quindi è
allineata alla proiezione per costruzione, e `floor.png` la cortocircuitava.

### 1.4 — regge, e la fragilità è misurabile

`applyCharacterSignature` era un post-processo su bitmap finito. Misurata la larghezza della fascia
che `hairBounds()` scandagliava (il 20% superiore del disegno), in unità di altezza del corpo,
contro il `maxHeadWidth = 0.34` del codice:

```
idle 0.24   approach 0.90  spike 0.79  block 0.44  bump 0.59
set 0.50    dive 2.39      serve 0.56  jumpServe 0.50  celebrate 0.96
```

Su nove fogli su dieci quella fascia è più larga di una testa plausibile; su `dive` è 2.39 volte
l'altezza del corpo. Il codice o rinunciava o trovava un avambraccio, frame per frame.

---

## 2. Difetti trovati guardando lo schermo, che il piano non poteva conoscere

### Due dei cinque layer non arrivavano allo schermo

`drawCrowdFar` ancorava a scena y 345 e la prima fila di spettatori del foglio sta 245 pixel più in
basso: la folla partiva a scena 590 e il bordo lontano del pavimento proiettato è a scena 598. Ogni
spettatore veniva disegnato e poi coperto dal campo. `led-mid` ancorava a 760, interamente dietro il
campo. Il gate `arenaV3LayersLoaded === 5` passava onestamente mentre due layer su cinque non
producevano un pixel visibile.

### I capelli avevano due tinte su sei

`HAIR_PALETTE[abs(id * 3 + 2) % 6]`: tre e sei non sono coprimi, quindi i sei giocatori di una
squadra ricevevano gli indici `2, 5, 2, 5, 2, 5`. Due tinte, sull'asse che più di ogni altro
distingue un atleta da un altro — e uno dei quattro assi su cui il piano fonda l'identità.

### L'identità cambiava nel replay

`characterSignatureId` riduce l'id `% 100` proprio perché le copie di replay aggiungono 1000, ma
incarnato, capelli e jitter di corporatura usavano l'id grezzo. Lo stesso giocatore era una persona
in campo e un'altra a rivederla.

### Non c'è spazio per una balaustra in primo piano

`foreground.png` metteva una fascia opaca sugli ottanta pixel bassi. Non è un errore di taratura: il
pavimento proiettato arriva a schermo y 652 e le barre overdrive e i comandi occupano 620–702, quindi
una balaustra che sta sotto il campo finisce necessariamente sull'HUD, e una che sta sopra l'HUD
finisce sul campo. Il layer ora è ottica — sfumatura ai bordi e appoggio scuro sotto i comandi — non
arredo.

---

## 3. Verifiche, con l'esito reale

Nell'ordine in cui le esegue la CI. `npm run build` va **prima** del visual QA: genera
`public/build-info.json`, che è in `.gitignore`, e senza quel file `tools/visual-qa-v3.ts:290`
riceve `index.html` al posto del JSON e muore. La sezione 5 di `docs/HANDOFF-ART-V3.md` lo elenca
per ultimo; è un errore, ed è costato un run.

```
npm run typecheck     OK
npm test              65/65
npm run assets:check  OK — i cinque layer hanno dimensioni e colour type corretti
npm run build         OK — tsc --noEmit + vite build, 33 moduli
npm run metrics       "all gameplay acceptance thresholds met"
npm run sprite:qc:v3  "sprite QC passed" — 0 px di bianco residuo su tutti e dieci i fogli
npm run visual:qa:v3  "visual acceptance passed" — violations: []
```

Valori finali da `artifacts/visual-qa-v3/metrics.json`:

| Metrica | Valore | Gate |
|---|---|---|
| `bodyDrawsPerPlayerPerFrameMax` | 1 | `== 1` |
| `arenaV3LayersLoaded` | 5 | `== 5` |
| `distinctCharacterSignaturesHome` / `Away` | 6 / 6 | `== 6` |
| `backFacingContacts` | 0 | `== 0` |
| `serveReadyApproachPlayers` | 0 | `== 0` |
| `longestOverTwoApproach` | 0,075 s | `<= 0,25 s` |
| `longestApproachRun` | 0,75 s | `<= 1,6 s` |
| `spike` rincorsa / apice (mediane) | 1,43 m / 1,53 m | `>= 1,4 m` / `>= 0,65 m` |
| `jumpServe` rincorsa / apice (mediane) | 1,50 m / 1,16 m | `1,2–2,6 m` / `>= 0,55 m` |
| `block` tentativi / contatti / da terra | 385 / 19 / 0 | `> 0` / `> 0` / `== 0` |
| `violations` | `[]` | vuoto |

Nessun gate è stato indebolito, rimosso o aggirato. L'unico gate il cui **contenuto** cambia è
`distinctCharacterSignatures`, e cambia nella direzione più severa: conta sette campi tutti
disegnati invece di nove di cui due che non arrivavano a nessun pixel.

### Giudizio a vista

I 19 screenshot e i 5 video sono stati aperti e guardati, non solo prodotti. I video sono stati
rivisti come provini di otto fotogrammi ciascuno, estratti a un fotogramma al secondo.

| Prova | Giudizio |
|---|---|
| `16-arena-v3.png` | parquet in prospettiva, tribuna e balaustra visibili, tabellone su campo pulito |
| `02-formation-ready.png` | le linee del campo cadono sulle doghe allineate; zona libera teal |
| `14-team-lineup.png` | dodici figure integre; i sei di casa e i sei ospiti distinguibili uno a uno |
| `10-block-apex.png` | muro a due in posa alta, teste e visi integri, occlusione della rete corretta |
| `18-replay.png` | replay senza schermo nero, figure integre sotto le fasce di luce |
| `15-sprite-white-qc.png` | 24 frame su scacchiera, nessun alone bianco |
| `01-menu.png` | `BUILD 7d35e27 · RUN local`, identità di build leggibile |
| 5 video | arena coerente durante la panoramica, fascia comandi sempre leggibile |

L'identità dei sei si legge soprattutto per colore dei capelli, incarnato e corporatura. Il pattern
del kit è il più debole dei quattro assi sulla maglia ospite, dove primario e secondario sono
entrambi vicini al bianco.

---

## 4. Cosa resta fuori

- **La forma dei capelli.** Le sette silhouette (`crop`, `fade`, `part`, …) restano dati autoriali
  nella tabella e non vengono disegnate. La via per aggiungerle è quella che il piano indica: una
  tabella statica di ancoraggi misurati, 10 azioni x 24 frame, verificata a vista su un contact
  sheet. Non è stata pagata perché i quattro assi bastano a distinguere i sei.
- **`hair` e `beard` fuori dal fingerprint.** Nulla li disegna, quindi non contano più verso
  `distinctCharacterSignatures`. I sette campi rimasti sono tutti disegnati e restano distinti a
  coppie: il gate legge 6 e 6 su attributi che si vedono.
- **Il pattern del kit legge debolmente sulla maglia ospite**, perché primario e secondario sono
  entrambi vicini al bianco. Si vede, ma è il più debole dei quattro assi su quella squadra.
- **Le altre proporzioni di finestra.** Le bande sono calcolate a 16:9, che è ciò su cui gira il
  visual QA. `coverSourceRect` ritaglia il resto come prima; non è stato cambiato.
