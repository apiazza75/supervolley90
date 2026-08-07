# Handoff — lavori artistici rimasti (Recovery V3)

Documento per chi prosegue il lavoro. Descrive **cosa è già fatto e va protetto**, **cosa resta**,
e **come si verifica**. Scritto per essere autosufficiente: non serve la conversazione precedente.

---

## 1. Punto di partenza

```
repository   apiazza75/supervolley90
branch       claude/continue-codex-chatgpt-work-2zwryo
HEAD         8e89dc5f9e67919bb0dbf029169db466bfbe8ac4
PR           https://github.com/apiazza75/supervolley90/pull/3   (draft, aperta)
CI verde     run 31132245365 — 4/4 job, DMG incluso
```

Questo branch discende da `claude/volley-2d-macos-game-cl9ary` (PR #1), che a sua volta è un
superset stretto di entrambi i branch `codex/*`. Non c'è lavoro perduto altrove: parti da qui.

Setup:

```bash
git clone https://github.com/apiazza75/supervolley90
cd supervolley90
git checkout claude/continue-codex-chatgpt-work-2zwryo
npm ci
npx playwright install --with-deps chromium
```

---

## 2. Cosa è già fatto — e la regola che lo protegge

Il gameplay e il sistema di prove sono a posto e **misurati**. La regola per chi prosegue è una
sola: puoi cambiare qualsiasi cosa, ma questi numeri devono restare veri. Non sono opinioni, sono
gate in `src/qa/gameplay-metrics.ts` che fanno fallire la CI.

| Cosa | Valore attuale | Gate |
|---|---|---|
| Corpi disegnati per giocatore per frame | 1 | `== 1` |
| Contatti dati di schiena alla rete | 0 | `== 0` |
| Rincorsa continua più lunga | 0,75 s | `<= 1,6 s` |
| Tempo con >2 giocatori in rincorsa | 0,075 s | `<= 0,25 s` |
| Rincorsa in formazione di battuta | 0 | `== 0` |
| Formazione ferma prima della battuta | 39/45 | `>= 80%` |
| Spike: rincorsa / apice | 1,43 m / 1,53 m | `>= 1,4 m` / `>= 0,65 m` |
| Jump serve: rincorsa / apice | 1,50 m / 1,16 m | `1,2–2,6 m` / `>= 0,55 m` |
| Muro: tentativi / contatti / da terra | 385 / 19 / 0 | `> 0` / `> 0` / `== 0` |
| Bianco residuo negli sprite | 0 px | `<= 24 px per foglio` |
| Raccattapalle | 0 | — |

**Il punto più importante da capire prima di toccare qualsiasi cosa.** La build precedente fu
rifiutata pur avendo la CI verde, perché la CI verificava fatti sui *file* (dimensioni, caricamento)
e non su cosa appare a schermo. E lo strumento che produceva gli "screenshot di prova" assegnava a
mano `p.height`, `p.anim` e `p.swing` prima di ogni scatto: fotografava pose che il gioco non
raggiungeva mai.

`tools/visual-qa-v3.ts` lo sostituisce e gioca secondo regole esplicite: può scegliere seed,
squadre e difficoltà e inviare input (comandi pubblici del gioco), e può fermare l'orologio per
fotografare un momento reale prima che passi. **Non può scrivere stato della simulazione.** Se il
gioco smette di produrre muri veri o battute in salto, gli scatti vanno in timeout e il run
fallisce, invece di fotografare una bugia.

Non aggirare questo meccanismo. Se un tuo cambiamento fa fallire il QA, quasi sempre il QA ha
ragione: durante questo lavoro ha scoperto un crash del renderer sul replay (schermo nero) che né
i test né il typecheck vedevano.

---

## 3. Cosa resta da fare

Quattro lavori, tutti di **produzione artistica**: richiedono immagini e atlas nuovi, non refactor.
Sono elencati in ordine di impatto visivo.

### 3.1 — §9 Sei identità strutturali per squadra

**Stato attuale.** I dodici giocatori si distinguono solo per colore e scala. In
`src/render/renderer.ts:1055` (`spriteStyleFor`) ogni giocatore riceve:

- `palette`: primary/secondary dalla divisa, `skin` e `hair` da palette indicizzate per id
- `heightScale`: 0,93–1,065 per ruolo, più un jitter di ±0,024
- `widthScale`: 0,94–1,035

Silhouette, capelli disegnati, viso, ginocchiere e abbigliamento sono **identici per tutti**.

**Cosa serve.** Almeno sei firme visive strutturalmente distinguibili per squadra, stabili per
tutta la partita: testa e profilo diversi, 6 tagli di capelli, ≥3 varianti barba/viso, corporatura
per ruolo, lunghezza maniche, ginocchiere, calze, scarpe, pattern secondario della divisa, libero
con kit fortemente contrastante.

**Come.** Gli sprite sono **generati proceduralmente**, non disegnati a mano — questo rende il
lavoro fattibile:

```
make-sheets.html  →  src/dev/make-sheets.ts  →  src/render/rig.ts   (735 righe: la figura)
npm run sheets    →  riscrive public/sprites/*.png
```

Le strade praticabili sono due, in ordine di preferenza:

1. **Layer separati** (testa/capelli/barba/accessori) disegnati sopra la figura e animati con
   essa. Non moltiplica gli atlas e non tocca la geometria.
2. **Sei atlas base distinti** per squadra, cioè `public/sprites/<variant>/<action>.png`, con il
   loader esteso a scegliere la variante per giocatore.

Vincoli da rispettare in ogni caso:

```
formato foglio   3072 × 2048 px, RGBA
layout           6 colonne × 4 righe, celle di 512 × 512, 24 frame
linea del suolo  y = 470 dentro la cella
scala corpo      fissa su tutti e 24 i frame
```

Dopo aver rigenerato gli sprite **esegui obbligatoriamente**
`npx tsx tools/sanitize-sprites-v3.ts` (rimuove l'alone bianco ridipingendolo col colore vicino
anziché cancellarlo, per non assottigliare la figura) e poi `npm run sprite:qc:v3`.

**Come si verifica.** `metrics.json` deve riportare `distinctCharacterSignaturesHome: 6` e
`distinctCharacterSignaturesAway: 6`. Il campo **non è ancora calcolato**: va aggiunto a
`src/qa/gameplay-metrics.ts` insieme al suo gate. Serve anche una lineup comparativa home 1–6 vs
away 1–6 in `14-team-lineup.png` — oggi quello screenshot è un fotogramma di gioco qualunque.

### 3.2 — §11.1/11.2 Arena v3 a cinque layer

**Stato attuale.** Tre asset, caricati in `src/render/arena-art.ts:64`:

```
public/arena/arena-back.png    2560 × 900
public/arena/arena-floor.png   1024 × 512
public/arena/net.png            512 × 512
```

Il renderer sovrappone ancora buona parte della vecchia arena procedurale.

**Cosa serve.**

```
public/arena/v3/backdrop.png     2560 × 1440
public/arena/v3/crowd-far.png    2560 × 900   RGBA
public/arena/v3/led-mid.png      2560 × 512   RGBA
public/arena/v3/floor.png        2048 × 1024
public/arena/v3/foreground.png   2560 × 512   RGBA
```

File da modificare: `src/render/arena-art.ts`, `src/render/arena.ts`, `src/render/renderer.ts`.

Regole: in release, se i layer v3 mancano il visual QA deve **fallire**; il fallback procedurale
resta solo in modalità sviluppo; non sovrapporre tribune/pubblico legacy sopra i layer v3; le luci
dinamiche devono usare la palette dell'arena v3. Aggiungi `arenaV3LayersLoaded: 5` alle metriche
con il relativo gate, e aggiorna `tools/validate-art-assets.ts`.

### 3.3 — §11.3 Rete da geometria dei pali

Oggi la rete è un'immagine. Va costruita dai **quattro vertici proiettati** (palo lontano
basso/alto, palo vicino basso/alto), disegnando pali, protezioni, nastro superiore e inferiore,
maglia, antenne, e con l'occlusione corretta far/near rispetto ai giocatori.

La camera espone già quello che serve: `cam.project(x, y, z)` restituisce anche `depth`, che il
renderer usa per l'ordinamento (`src/render/renderer.ts`, array `drawables`).

### 3.4 — §11.4 Effetti del super colpo

`src/render/fx.ts` (378 righe) e `src/render/renderer.ts`. Da rifare: super spike trail, hit spark,
shockwave, floor impact, knockdown, polvere, lethal move, block impact, replay transition. Il brief
è esplicito: **non devono essere gli stessi cerchi e gradienti legacy ricolorati.**

---

## 4. Limite minore, se ti capita sotto mano

Nelle tracce di fase il plant del jump serve compare come `spike:plant`, perché l'anim `plant` è
mappata sul foglio spike in `ANIM_PRESENTATION` (`src/core/player.ts`). La fase è giusta,
l'etichetta dell'azione è approssimativa. Cosmetico.

Inoltre `shuffle`, `run` e `approach` sono stati distinti, con velocità e cadenza di riproduzione
diverse, ma condividono un solo foglio di locomozione. Fogli distinti li renderebbero davvero
diversi a schermo.

---

## 5. Come si verifica il lavoro

```bash
npm run typecheck        # deve passare
npm test                 # 60 test, devono passare tutti
npm run assets:check     # dimensioni e formato degli asset
npm run metrics          # gate di gameplay: deve stampare "all gameplay acceptance thresholds met"
npm run sprite:qc:v3     # bianco residuo: deve stampare "sprite QC passed"
npm run visual:qa:v3     # 19 screenshot + 5 video da gioco reale, 0 violazioni
npm run build            # genera public/build-info.json e builda
```

Il visual QA impiega 10–20 minuti e apre un Chromium: è normale. Su macchine lente riduci `FAST`
in `tools/visual-qa-v3.ts` (attualmente 3) — **non alzarlo**: a 6× l'observer campiona ogni ~96 ms
di tempo simulato e salta gli stati brevi.

In CI il job `Visual gameplay acceptance` è obbligatorio e `macos-app` dipende da lui: nessun DMG
può uscire da una build che non è stata mostrata funzionare. Gli artifact sono nominati con lo
short SHA del commit consegnato.

---

## 6. Trappole in cui sono già caduto — non ripeterle

Elenco onesto, costano ore ciascuna.

1. **`tsx` e `page.evaluate`.** Passare una funzione con funzioni annidate a `page.evaluate` esplode
   con `__name is not defined`: tsx inserisce un helper che nella pagina non esiste. Passa il codice
   come **stringa**, vedi `tools/sprite-qc-v3.ts`.
2. **Backtick dentro un template literal.** Un commento con `` `nome` `` dentro la stringa
   `CONDITIONS` chiude il literal e rompe la sintassi.
3. **Il replay non ha `presentation`.** `src/render/renderer.ts:300` ricostruisce corpi dai frame
   registrati: hanno la posa ma non lo stato di presentazione. Leggerlo senza guardia manda in crash
   il render loop e lo schermo diventa nero. C'è un test di regressione in `tests/sprites.test.ts`.
4. **`github.sha` sulle PR è il merge commit.** Per nominare artifact e stampare la build identity
   serve `github.event.pull_request.head.sha`, propagato come `DELIVERY_SHA`. Già risolto: non
   tornare indietro.
5. **Un gate che sfarfalla è peggio di nessun gate.** Avevo stretto la condizione dello screenshot
   della formazione a "tutti e undici fermi": la foto era giusta ma il run diventava lento e
   inaffidabile. La forma rigorosa del requisito è **misurata su ogni battuta**
   (`serveFormationSettled`), che è anche prova migliore — una fotografia dimostra che è successo
   una volta.
6. **Non fidarti della sola CI verde.** È esattamente ciò che ha lasciato passare la build
   rifiutata. Guarda gli screenshot in `artifacts/visual-qa-v3/screenshots/` con i tuoi occhi.

---

## 7. Definizione di fatto

- [ ] almeno sei identità strutturali per squadra, stabili per tutta la partita
- [ ] `distinctCharacterSignatures{Home,Away}: 6` calcolate e gated
- [ ] `14-team-lineup.png` mostra davvero home 1–6 vs away 1–6
- [ ] cinque layer arena v3 committati, caricati, con gate `arenaV3LayersLoaded: 5`
- [ ] nessuna sovrapposizione di arena legacy sopra i layer v3
- [ ] rete costruita dai quattro vertici proiettati, con occlusione corretta
- [ ] effetti del super colpo sostituiti, non ricolorati
- [ ] `npm run sprite:qc:v3` a 0 px di bianco dopo la rigenerazione degli sprite
- [ ] `npm run metrics` supera tutte le soglie esistenti (non abbassarle)
- [ ] `npm run visual:qa:v3` con 0 violazioni, 19 screenshot e 5 video
- [ ] CI verde su tutti e quattro i job **sullo stesso SHA** che consegni
- [ ] PR #3 aggiornata, con elencato onestamente ciò che resta fuori

Ultima cosa, che vale più di tutto l'elenco: se qualcosa non riesce, **scrivilo**. Il difetto
originale di questa consegna non era il codice, era una descrizione che dichiarava completate cose
non dimostrate.
