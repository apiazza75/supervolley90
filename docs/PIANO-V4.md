# SuperVolley90 — piano V4: identità dei giocatori e arena

Documento operativo per una sessione nuova. Contiene i fatti accertati sul repository, le
decisioni architetturali con la loro motivazione, l'ordine dei lavori e le verifiche.

---

## 0. Punto di partenza

```
repository  apiazza75/supervolley90
branch      claude/recovery-v3-integration-review     ← lavora qui
commit      8b97963
```

Il branch di consegna `claude/continue-codex-chatgpt-work-2zwryo` è a `75e4546`, con CI verde su
tutti e quattro i job. **Non toccarlo** finché il lavoro qui non è verificato a vista.

Sul branch di lavoro il pacchetto Recovery V3 è già applicato, con tre ancoraggi riallineati e una
correzione a `hairBounds()`. Leggi `docs/RECOVERY-V3-INTEGRATION-REVIEW.md` e guarda
`docs/evidence/` prima di scrivere codice.

```bash
git clone https://github.com/apiazza75/supervolley90
cd supervolley90
git checkout claude/recovery-v3-integration-review
npm ci
npx playwright install --with-deps chromium
```

---

## 1. Fatti accertati sul repository

Verificali tu stesso prima di partire: sono ricostruiti da lettura del codice, non da esecuzione.

### 1.1 I giocatori sono arte disegnata, non output procedurale

`public/sprites/*.png` — dieci fogli, 3072×2048, ~2 MB l'uno — sono **illustrazioni disegnate** in
stile cel-shaded, già ritagliate su trasparenza, in griglia 6×4 di celle 512×512, linea del suolo a
`CUT_OUT_FLOOR` (y=470).

`src/render/rig.ts` è una figura procedurale **separata**: scheletro a sedici giunti con catena
parent reale, keyframe interpolati. Ma ha keyframe solo per `SPIKE`, è usata da
`src/dev/rig-sheet.ts` (foglio di sviluppo) e come fallback vettoriale. **Non genera i fogli
spediti.** `src/dev/make-sheets.ts` produce fogli placeholder 1456×1080 da `drawPlayer`, che non
sono quelli committati.

Conseguenza operativa: **non esiste un giunto `head` interrogabile per l'arte disegnata.** Qualsiasi
disegno sovrapposto alla testa deve sapere dove sia la testa, e l'unico modo di saperlo su un
bitmap è misurarlo o dichiararlo.

### 1.2 Il loader misura già ogni cella

`loadOne()` in `src/render/sprites.ts` riconosce un foglio già ritagliato (`cutOut()`) e prende la
via `sliceCutOut()`: celle esatte 512×512, nessun ritaglio di chrome, e per ogni cella una
`measure()` che produce `boxTop` / `boxBottom`, conservati nel `Frame`.

Nota: le frazioni `top: 0.079` / `bottom: 0.095` in `SHEETS` sono **costanti morte** su questa via —
erano misurate sui fogli originali con intestazione e piè di pagina. Non fidartene e non usarle.

### 1.3 Il parquet procedurale esiste già e funziona

`Arena.drawFloor()` (`src/render/arena.ts:345`) disegna il campo, poi:

```ts
if (!this.artwork.drawCourtFloor(ctx, cam, COURT_HALF_WIDTH, COURT_HALF_LENGTH)) {
  this.drawGrain(ctx, cam, outX, outY);
}
```

`drawGrain()` (riga ~397) disegna le doghe di legno **campionando `cam.projectFloor()`**: le fughe
sono allineate alla proiezione per costruzione, non per taratura. Il `floor.png` del pacchetto V3 la
cortocircuita e mette al suo posto una griglia rossa in prospettiva sbagliata.

### 1.4 Cosa fa oggi `applyCharacterSignature`

`src/render/character-signature.ts` è un **post-processo su bitmap finito**: ricostruisce maschere
dai colori (primary / skin / hair), cerca la testa scansionando pixel (`hairBounds`), e ci dipinge
sopra poligoni ed ellissi (`drawHairAndFace`).

Due parti con destino diverso:

| Parte | Ancoraggio | Robustezza |
|---|---|---|
| palette (primary, secondary, skin, hair) + `patternAt` sul kit | maschera di colore, regione grande e piatta | **solida** |
| `hairBounds` + `drawHairAndFace` | posizione indovinata sul bitmap | **fragile per costruzione** |

---

## 2. Decisioni

### Decisione A — l'identità smette di dipingere sopra la testa

**Elimina** `hairBounds()` e `drawHairAndFace()`. **Conserva** la tabella delle sette firme, la
palette e il pattern del kit.

Le sei identità per squadra si costruiscono su quattro assi che non richiedono di sapere dove sia la
testa:

1. **colore dei capelli** — canale `hair` della `SpritePalette`, già mappato da `recolour()`;
2. **incarnato** — canale `skin`, idem;
3. **pattern del kit** — `patternAt()` sulla maschera primary (`centre`, `diagonal`, `side`, `yoke`,
   `chevron`, `pinstripe`, `libero`), regione grande e stabile in ogni posa;
4. **corporatura** — il renderer già scala la figura in altezza; una variazione per giocatore
   nell'ordine del ±4%, deterministica dall'id, dà differenze di stazza leggibili a colpo d'occhio.

Quattro assi indipendenti danno molte più di sei combinazioni distinte. Il gate
`distinctCharacterSignaturesHome/Away === 6` continua a valere perché la tabella delle firme resta:
cambia **cosa viene disegnato**, non quante firme esistono.

Motivazione: su arte disegnata la posizione della testa non è un dato, è una stima. Una stima
sbagliata su un fotogramma su ventiquattro produce una macchia di colore in faccia a un giocatore, ed
è precisamente il difetto per cui questa consegna è stata respinta. I quattro assi sopra non hanno
questo modo di fallire — o funzionano su tutti i frame o su nessuno.

**Via di scampo, solo se serve.** Se a schermo i sei non risultano abbastanza distinguibili, la
forma dei capelli si può aggiungere in un secondo tempo con **ancoraggi dichiarati**: una tabella
statica di 10 azioni × 24 frame con posizione, angolo e raggio della testa, misurata con uno
strumento e **verificata a vista su un contact sheet**, non ricalcolata a runtime. È il metodo che il
repository già usa altrove ("misurato con `tools/measure-sheet.ts`, non letto da una figura"). Non
farlo preventivamente: 240 ancoraggi sono un costo reale, e vanno pagati solo se il punto 1–4 non
basta.

### Decisione B — il pavimento resta procedurale

`drawCourtFloor` **non deve più sostituire** il parquet. Il campo lo disegna `drawGrain()`, che è
allineato alla proiezione per costruzione.

`floor.png` resta uno dei cinque layer e resta caricato e disegnato — ma come **grana e riflesso
sopra le doghe**, composito a bassa opacità (`multiply` o `overlay`), non come superficie del campo.
Il gate `arenaV3LayersLoaded === 5` continua a essere soddisfatto onestamente: il file si carica e si
disegna davvero. Nessun gate viene indebolito.

Se la grana non aggiunge nulla di visibile, dillo e proponi la rimozione del layer con il relativo
aggiustamento del gate — **motivandolo**, non aggirandolo.

### Decisione C — backdrop e foreground vanno ricomposti, non ridipinti

- `backdrop.png` (2560×1440) contiene scritte grandi che finiscono dietro e attraverso il tabellone
  dell'HUD. Lo sfondo deve stare sullo sfondo: architettura, tribune lontane, banchi luce. Niente
  tipografia grande nella fascia occupata dal tabellone.
- `foreground.png` (2560×512) invade la fascia bassa dove vivono comandi e barre overdrive. Quella
  fascia va lasciata libera.
- `crowd-far.png` e `led-mid.png`: accettabili, riverificali a vista una volta sistemati gli altri.

Se non hai a disposizione generazione di immagini, questi si producono **su canvas con codice**:
gradienti, geometria, banchi luce e macchie di folla sono geometria regolare. Il repository genera
già immagini così (`src/dev/*.ts` + `tools/make-sheets.ts` via Playwright). Riusa quell'impianto:
pagina Vite che espone una funzione di disegno, Playwright che la chiama e scrive il PNG.

---

## 3. Ordine dei lavori

Fai i punti nell'ordine. Ognuno è verificabile da solo; non accumulare.

**1. Pavimento.** `drawCourtFloor` da sostituzione a composito. Verifica su
`16-arena-v3.png` e `02-formation-ready.png` che le doghe seguano la prospettiva e che le linee del
campo ci cadano sopra allineate.

**2. Backdrop e foreground.** Ricomposizione dei due PNG. Verifica che tabellone e fascia comandi
siano leggibili, che non ci sia testo dello sfondo che attraversa l'HUD.

**3. Identità.** Rimozione di `hairBounds` / `drawHairAndFace`, palette e pattern conservati,
aggiunta della variazione di corporatura. Verifica su `14-team-lineup.png`: i sei di casa devono
essere distinguibili uno a uno, e così i sei ospiti.

**4. Verifica completa** e giudizio a vista dei 19 screenshot.

**5. Consegna.** Se i tre punti reggono, PR verso `claude/continue-codex-chatgpt-work-2zwryo`.

---

## 4. Regole non negoziabili

Vengono dal brief originale e restano valide parola per parola.

- Non indebolire, rimuovere o aggirare metriche, test, timeout o gate per ottenere il verde.
- Non manipolare direttamente lo stato della simulazione per creare screenshot di prova.
- Non dichiarare superato un controllo che non hai realmente eseguito.
- Non considerare sufficiente una CI verde: apri e revisiona i 19 screenshot e i 5 video.
- Se un asset o una soluzione proposta è visivamente insufficiente, migliorala.
- Proteggi il lavoro già presente sul branch e non riscrivere la storia Git senza necessità.
- Non inventare commit, push, CI o artifact.

E una che questo lavoro ha guadagnato sul campo:

> `distinctCharacterSignatures` conta **quante** firme differiscono fra loro, non se sono disegnate
> correttamente. Sei rettangoli sono sei firme diverse e il gate passa lo stesso. I gate sono
> necessari, non sufficienti. La prova è guardare le immagini.

---

## 5. Verifiche

```bash
npm run typecheck        # deve passare
npm test                 # 65 test, tutti verdi
npm run assets:check     # dimensioni e canali dei cinque layer v3
npm run metrics          # "all gameplay acceptance thresholds met", violations: []
npm run sprite:qc:v3     # "sprite QC passed"
npm run visual:qa:v3     # 19 screenshot + 5 video, zero violazioni
npm run build
```

Poi **apri gli screenshot in `artifacts/visual-qa-v3/screenshots/` e guardali.** In particolare:

| File | Cosa deve dimostrare |
|---|---|
| `14-team-lineup.png` | sei identità di casa riconoscibili una per una, e sei ospiti |
| `16-arena-v3.png` | parquet in prospettiva, sfondo che non compete con l'HUD |
| `02-formation-ready.png` | linee del campo allineate alle doghe |
| `10-block-apex.png` | figure pulite in posa alta, nessuna macchia sulla testa |

Il visual QA impiega 10–20 minuti. **Non alzare `FAST` in `tools/visual-qa-v3.ts` sopra 3**:
l'observer campiona una volta per frame di animazione e a 6× salta gli stati brevi.

---

## 6. Trappole già pagate

Sono costate tempo una volta ciascuna. Non ripeterle.

1. **`tsx` + `page.evaluate`**: passare una funzione con funzioni annidate esplode con
   `__name is not defined`. Passa il codice come **stringa** (vedi `tools/sprite-qc-v3.ts`).
2. **Backtick dentro un template literal** chiudono il literal e rompono la sintassi.
3. **I corpi del replay non hanno `presentation`**: leggerlo senza guardia manda in crash il render
   loop e lo schermo diventa nero. C'è un test di regressione in `tests/sprites.test.ts`; non
   toglierlo.
4. **Su una PR `github.sha` è il merge commit**: per nominare gli artifact serve
   `github.event.pull_request.head.sha`, propagato come `DELIVERY_SHA`. Già risolto, non regredire.
5. **Un gate che sfarfalla è peggio di nessun gate**: la forma rigorosa di un requisito si **misura
   su tutte le occorrenze** (mediana, percentuale), non si fotografa una volta.
6. **Le frazioni di chrome in `SHEETS`** (`top`, `bottom`, `left`, `right`) non si applicano ai fogli
   trasparenti. Se le usi per calcolare posizioni ottieni un ritaglio sbagliato di ~33 px in cima.
7. **Un pipe maschera l'exit code.** `npm run typecheck | tail` riporta successo anche quando
   fallisce. Controlla `${PIPESTATUS[0]}` o non usare il pipe.

---

## 7. Cosa consegnare

Commit e push su `claude/recovery-v3-integration-review`, poi PR (draft) verso il branch di
consegna. Nella descrizione, senza formule ambigue:

- cosa hai cambiato, file per file;
- l'esito reale di ogni comando di verifica;
- i valori finali delle metriche e dei gate;
- il giudizio visivo motivato su lineup, arena, rete, FX e replay, con i nomi degli screenshot che
  lo sostengono;
- **cosa resta fuori.**

Il difetto originale di questa consegna non era il codice: era una descrizione che dichiarava
completate cose non dimostrate.
