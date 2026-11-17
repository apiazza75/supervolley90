# Super Volley 90 — passaggio a Claude Code

## Punto di partenza autorevole

Questa cartella contiene l'ultima versione completata in questo task Codex, del **13 settembre 2026**, esportata e verificata il **17 novembre 2026**. È la più recente delle tre copie locali Git collegate confrontate. I sorgenti del gioco corrispondono esattamente alla build finale: SHA-256 `c61b0676e5ed3a47d5491b87908865818e09d1859cb7cf09b9cd7aaa5b2cd7c0`.

**Lavora su questa cartella completa.** Il commit `862e93c89e26325ab052569c57cf4dc9509f6b1b` è soltanto la base di agosto: le modifiche successive e molti asset non erano committati. Un clone o checkout di quel commit perderebbe il lavoro. L'export include anche i file non tracciati. Il riferimento locale era `codex/supervolley90-full-game-2026-09-13`.

Non sono inclusi `.git`, il collegamento locale `node_modules`, cache e vecchi output intermedi. I sorgenti grafici originali in `assets/source` sono inclusi e alcuni test li richiedono. Non sostituire le animazioni manga con figure provvisorie, non rigenerare indiscriminatamente gli atlanti e non cancellare gli originali. Se crei un repository, salva prima questo stato come base del nuovo lavoro.

## Richiesta di Alessandro

Portare il gioco a una versione completa e piacevole da giocare, con:
- muro più efficace del 25% e due compagni AI che saltano insieme;
- alzatore con veloci, palle alte/dietro, finte tipo alley-oop con attaccante esca e attacchi legali dalla seconda linea;
- pause fra azioni più brevi, timing della palla rossa più facile e premiante, movimenti fluidi;
- arbitro ridotto del 10% e pubblico più animato;
- comandi touch per smartphone, controller Mac/PC e sfide 1 vs 1;
- 2 su 3 o 3 su 5; set a 15 con cambio palla, a 25 rally point (decisivo a 15) oppure tutti a 15 tie-break;
- abilità con effetti reali, divise alternative e omaggi storici, nazionali/palloni/parquet sbloccabili.

Queste funzioni sono **già implementate**. Il multiplayer è **locale sullo stesso schermo**; non è multiplayer online. Il +25% riguarda la copertura fisica del muro, non una garanzia del 25% di punti in più. Le sei skill modificano realmente potenza, precisione, controllo, portata o velocità dell'alzata. La progressione salva nel browser; demo e abbandoni non assegnano premi. Vedi `docs/GIOCARE.md` e `docs/PROGRESSIONE-E-CONTENUTI.md`.

## Cosa resta da completare o verificare

1. Prova realmente il gioco e correggi i difetti osservati; un test verde da solo non dimostra fluidità o divertimento. Segui piedi, atterraggi, transizioni, alzate e doppi muri. L'ultima correzione blocca nuove micro-partenze degli AI fermi negli ultimi 0,18 secondi della pausa; una breve dissolvenza copre il cambio di formazione senza allungare la pausa.
2. Prova controller fisici, inclusi due pad, disconnessione/riconnessione e menu pausa/fine. I test disponibili simulano la Gamepad API, non certificano hardware reale.
3. Prova smartphone reali in orizzontale e verticale, tocchi simultanei, annullamento del puntatore, pausa e ripresa. Le prove precedenti erano emulazioni Chromium.
4. Verifica l'accesso dal telefono sulla stessa rete. Nel controllo di settembre localhost funzionava, ma l'indirizzo Wi-Fi del Mac non rispondeva, con server sia Python sia Node. La causa non è stata accertata; non dare per certo un problema di firewall e non disattivare protezioni indiscriminatamente.
5. Se la consegna richiede l'app nativa, compila e prova Tauri. Il pacchetto consegnato finora è web. La configurazione Tauri attuale produce `app`/`dmg` macOS; non contiene un installer Windows pronto. Non dichiarare compilazione, firma o pubblicazione eseguite senza verificarle.
6. Riprova salvataggi e sblocchi dopo una partita completata e dopo un riavvio; mantieni compatibilità con `supervolley90.progression.v1`.

Non ampliare automaticamente il lavoro a servizi online, account, acquisti o pubblicazione. Usa agenti specialisti se utili, come chiesto da Alessandro, e termina con una versione realmente giocabile più un riepilogo dei limiti rimasti.

## Avvio e controlli

Node e npm sono necessari; la precedente esecuzione locale usava Node 26, la CI è configurata per Node 22. Installa dal lockfile, senza aggiornare dipendenze per abitudine:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5176
```

Per le prove telefoniche usa `--host 0.0.0.0` e l'indirizzo attuale del computer sulla stessa rete. `localhost` sul telefono indica il telefono stesso. Il vecchio URL sulla porta 5182 dipendeva da un processo locale e non va considerato ancora attivo.

```sh
npm run typecheck
npm test
npm run assets:check
npm run build
npx playwright install chromium
npm run check:build
```

`check:build` usa la porta 5188 e testa il bundle compilato. Diversi strumenti di revisione grafica puntano alla porta 5176. `tools/render-performance.ts` accetta `--url=...`; il flag `--gpu` richiede accelerazione disponibile. Non confrontare un test software/headless con un test GPU come se fossero lo stesso dispositivo. Le utility Python per gli asset richiedono Pillow; non servono per giocare o compilare il frontend.

Per macOS nativo servono anche Rust e gli strumenti Xcode; il comando esistente è `npm run app:build`. La build web funziona senza metadati Git, ma il commit mostrato sarà `unknown` dopo l'export: il contenuto si identifica con `sourceHash` e con il manifesto del pacchetto.

## Verifiche storiche, non appena rieseguite

Il 13 settembre 2026: 1.270 test su 99 file, zero errori o test saltati; typecheck, asset e build compilata superati. Tutti i sei formati hanno concluso una partita. Verificati salvataggio XP, sblocco USA e persistenza dopo reload. Campione GPU Chromium su Mac M5 Pro: 25 secondi, circa 120 fps, nessun intervallo oltre 33 ms, nessun rapido cambio A-B-A di animazione, un corpo disegnato per atleta e nessun fallback vettoriale.

Il 17 novembre sono stati ricontrollati identità dei sorgenti, completezza e integrità dell'export. La suite gameplay e le prove hardware non sono state rieseguite per questo passaggio. Le ricevute in `../verifiche-2026-09-13/` sono storiche; non presentarle come risultati odierni.

## Mappa essenziale

- `src/main.ts`: ciclo, input dei due giocatori, menu pausa/fine, ricompense.
- `src/core/world.ts`, `ai.ts`, `contact.ts`, `set-play.ts`: regole, contatti, muro e tattiche.
- `src/core/match-format.ts`, `skills.ts`, `team.ts`: set e abilità.
- `src/game/input.ts`, `touch-controls.ts`: tastiera, pad e touch.
- `src/game/menu.ts`, `teams.ts`, `progression.ts`: selezioni, contenuti e salvataggi.
- `src/render/sprite-figure.ts`, `sprites.ts`, `renderer.ts`, `round-transition.ts`: animazioni e resa.
- `src/render/officials.ts`, `arena.ts`, `crowd-reactions.ts`: arbitro e pubblico.
- `tests/`, `tools/`, `.github/workflows/ci.yml`, `src-tauri/`: regressioni, strumenti, CI e app nativa.

I vecchi documenti artistici e il README storico descrivono anche fasi precedenti: per stato e priorità usa questo file, i sorgenti presenti e le verifiche effettive.
