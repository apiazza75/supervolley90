# Schiacciata e muro manga — 10 settembre 2026

## Stato della consegna locale

Integrati **48 nuovi disegni**: 24 per la schiacciata e 24 per il muro.
Sono disponibili nel gioco su `http://127.0.0.1:5176/` e nella galleria
`http://127.0.0.1:5176/art-review.html`. Nessun commit, push, rilascio remoto o
nuovo pacchetto macOS in questo passaggio. La revisione grafica completa resta
aperta; questa non è un'accettazione artistica da parte dell'utente.

## Immagini e provenienza

Creati con lo strumento integrato **image_gen**, usando la camminata manga come
riferimento di identità, anatomia e inchiostrazione. Ogni azione contiene
8 pose chiave e 16 intermedi disegnati separatamente. Non sono deformazioni di
un omino vettoriale, fotogrammi duplicati o dissolvenze fra corpi.

- [Atlante schiacciata](../public/sprites/spike.png), 3072×2048 RGBA.
- [Atlante muro](../public/sprites/block.png), 3072×2048 RGBA.
- [Prompt completi, sorgenti selezionate, hash e tentativi scartati](../assets/source/manga-2026-09/attack-generation.json).
- Le sei tavole sorgenti sono salvate in `assets/source/manga-2026-09/`:
  `spike-keyposes.png`, `spike-between-1.png`, `spike-between-2.png`,
  `block-keyposes.png`, `block-between-1.png`, `block-between-2.png`.
- Gli atlanti precedenti sono conservati in
  `artifacts/art-direction/spike-before-2026-09-10.png` e
  `artifacts/art-direction/block-before-2026-09-10.png`.

SHA-256 dei PNG effettivamente consumati dal gioco, identici alle copie in `dist`:

| Atlante | SHA-256 |
| --- | --- |
| Schiacciata | `e833e3b3c314d538682cdb39520294c94365ce8f9fc176f4d305c2d7e2d91e07` |
| Muro | `626bb6b294941910fa1c8568c25ecfe2e9772f73fc652fa5ac7cfcce8e7d5bb1` |

## Correzioni di importazione e movimento

- Scartate le prime tavole con trasparenza finta e le schiacciate che cambiavano
  braccio fra caricamento e contatto. Il riferimento finale mantiene il braccio
  destro vicino alla camera come braccio di attacco.
- L'estrazione segue il personaggio connesso completo anche oltre le divisioni
  virtuali della tavola: conserva le dita già disegnate, senza inventarle o
  tagliarle. I tagli sul bordo esterno reale della sorgente sono rifiutati.
- Un'unica scala uniforme per tutte le pose di ogni azione; nessuna modifica
  separata alla lunghezza delle gambe. Calibrazione fra azioni basata sulla testa.
- Appoggi dei nuovi disegni registrati a y=470; è la fisica del gioco a sollevare
  il corpo. Non si sommano due traiettorie di salto.
- Muro sincronizzato con salita, apice, discesa e atterraggio reali. La posa di
  recupero a ginocchia flesse non viene più anticipata durante il volo.
- Schiacciata: caricamento in 0,10 s, salita in 0,28 s, contatto, seguito in aria
  e recupero a terra. Corretto l'uso del tempo zero dell'animazione.
- Gli ultimi 2 cm di discesa non consentono più un nuovo salto/tuffo né cancellano
  l'identità dell'atterraggio. La tolleranza pubblica di contatto non è cambiata.
- Scintille di schiacciata, muro e supercolpo originate dallo stesso punto della
  mano illustrata usato dalla palla visiva; la posizione fisica della palla non
  viene modificata. Le scritte dei colpi sono in alto a sinistra, accanto al
  tabellone, senza ingrandimento iniziale sulla mano.
- Galleria più alta: le mani sollevate non vengono tagliate nell'anteprima.

## Verifiche tecniche e visive, tenute separate

- **148 test passati** su 10 file anche dopo l'ultimo spostamento delle scritte;
  eseguiti inoltre 61 test mirati durante la correzione e la build completa.
- **11 test Python dell'importatore passati**: alpha, ordine, scala uniforme,
  estrazione oltre i divisori e rifiuto dei tagli reali.
- `assets:check`, `sprite:motion` e `git diff --check` passati. Il confronto dei
  fotogrammi rileva differenze, non certifica anatomia o fluidità.
- QC dei 12 atlanti: 0 hard-white e 0 near-white matte rilevati.
- Palette: schiacciata 397.824 controlli di pelle, muro 444.353; nessuna modifica
  indebita di pelle, alpha o inchiostro scuro. Nessun pixel chiaramente blu escluso
  dalle rispettive maschere primarie.
- Build finale `index-B1EW0mll.js`: 12/12 atlanti, 12/12 maschere, 5/5 livelli
  arena caricati; arbitri illustrati caricati e disegnati; nessun errore rilevato.
- Galleria controllata nel browser Codex: caricamento, pausa, avanzamento al
  fotogramma di contatto e ripresa. Ispezionate le dita e l'intera figura.
- Partita demo reale, senza assegnare pose o posizioni artificiali: osservati
  muro dal salto al recupero e schiacciata con contatto, seguito e atterraggio.
  La sequenza del muro osservata è un tentativo, non una prova di intercetto.
  L'ultima acquisizione della schiacciata dura circa 2,41 s e campiona 15 indici
  distinti dal caricamento all'atterraggio. Non dimostra che ogni disegno venga
  mostrato su ogni dispositivo: alcuni passaggi brevi possono sfuggire alla
  cattura. I 24 disegni sono ispezionabili separatamente nella galleria.

Evidenze riproducibili:

- [Schiacciata in partita, con mano e palla visibili](../artifacts/attack-review/spike-match.png).
- [Fasi della schiacciata in partita](../artifacts/attack-review/spike.png) e
  [dati della cattura](../artifacts/attack-review/spike.json).
- [Fasi del muro in partita](../artifacts/attack-review/block.png) e
  [dati della cattura](../artifacts/attack-review/block.json).
- [Partita dalla build finale](../artifacts/build-check/match.png).

Comandi principali:

```sh
npm test
python3 tools/test_import_gait_keyframes.py
npm run assets:check
npm run sprite:motion
python3 tools/sprite_qc_pil.py
npm run build
npx tsx tools/build-check.ts
npx tsx tools/attack-review.ts
```

Python richiede Pillow. Le catture del browser richiedono un server Vite sulla
porta 5176; il controllo della build avvia il proprio server sulla porta 5188.

## Limiti e prossimi interventi

Restano da affinare tuffo, rincorsa, battute, riposo/esultanza e i raccordi fra
azioni. Restano variazioni di busto e testa da controllare durante la riproduzione;
non si dichiara una fluidità perfetta sulla base del numero di fotogrammi.
Palleggio e ricezione hanno già disegni illustrati ma richiedono ancora il
controllo della coerenza con i nuovi atlanti. Corsa e camminata non sono state
rigenerate in questo passaggio e mantengono i loro hash precedenti.
Pubblico manga e arbitro seduto sono quelli integrati nei passaggi precedenti,
verificati anche qui. Arena/parquet e accettazione completa delle regole di gioco
non sono stati completati da questo intervento sulle due sequenze.
