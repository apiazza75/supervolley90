# Camminata manga e pulizia del rendering — 10 settembre 2026

## Stato effettivo

Modifiche integrate nella prova locale su `http://127.0.0.1:5176/`.
Non è un rilascio macOS: nessun commit, push o pubblicazione in questo passaggio.
L'obiettivo grafico completo rimane aperto; i controlli tecnici non equivalgono
all'accettazione artistica delle animazioni.

## Disegni nuovi

La camminata è stata ricostruita da **8 pose chiave e 16 intermedi disegnati
separatamente** con lo strumento integrato image_gen. Le correzioni mirate
riguardano l'ordine delle cosce in profondità, l'appoggio alternato, il passaggio
del piede e il movimento opposto del braccio. Le prime varianti che mantenevano
sempre la stessa gamba in primo piano non sono state importate nel gioco.

Sorgenti selezionate, tutte salvate nel progetto:

- `assets/source/manga-2026-09/walk-keyposes.png`
- `assets/source/manga-2026-09/walk-between-1.png`
- `assets/source/manga-2026-09/walk-between-2.png`
- Prompt completi e riferimenti di generazione: [walk-generation.json](../assets/source/manga-2026-09/walk-generation.json).

L'importatore `tools/import_gait_keyframes.py` interseca i tre fogli nell'ordine
1/4/7…, 2/5/8…, 3/6/9… e produce `public/sprites/walk.png`, 3072×2048 RGBA.
Le celle sorgenti 384×512 vengono centrate in celle quadrate senza deformarle.
La registrazione usa un'unica scala per il foglio, un riferimento del busto e
la linea del pavimento: nessuna interpolazione sintetica degli arti o copia
di fotogrammi per riempire la sequenza.

SHA-256 del PNG in gioco:
`9ac222cf441cb81a4c41860338d410beb54a6531722b76a9ed3b783a6d013be1`.
La versione precedente è conservata in
`artifacts/art-direction/walk-before-keyposes.png`.

La scala della testa è stata ricontrollata sul disegno importato: corona y≈14,
mento y≈90 nel primo fotogramma. Sono riferimenti approssimativi di registrazione,
non una certificazione anatomica. Tutti i fotogrammi mantengono la stessa scala.

## Difetti del rendering corretti

Il confronto fra PNG originale e giocatore in partita ha rivelato che il codice
rovinava il disegno con sovrapposizioni procedurali:

- Rimosse maniche, ginocchiere, calze, scarpe e motivi applicati con fasce
  geometriche. Comparivano sulle braccia o interrompevano le linee dell'artista.
- I giocatori solidi non diventano più trasparenti con la distanza. La
  prospettiva continua a modificarne la dimensione; solo una dissolvenza
  esplicitamente richiesta dal rendering cambia l'opacità.
- La maschera primaria include anche i piccoli dettagli e le ombre blu poco
  sature: la dimensione di una regione non ne cambia più il colore tra le pose.
- Gli inserti chiari vengono ricolorati per regioni intere. Il bianco crema
  viene riconosciuto dalla differenza fra i canali RGB, non dalla saturazione
  HSL instabile vicino al bianco. Questo elimina le isole chiare nei pannelli
  verdi/neri e nelle calze.

Restano le variazioni di colori, corporatura e divisa del libero. I dati per
future varianti di taglio delle maniche, barba e accessori sono conservati come
brief artistici, ma non vengono più contati come dettagli effettivamente disegnati.

## Verifiche e immagini effettive

- Test completi: **138 passati**. Dopo l'ultima correzione della soglia blu,
  ripetuti i 57 test di sprite e identità: tutti passati.
- Importatore: 3 test passati su ordine, padding, trasparenza e numero di sorgenti.
  La reimportazione del palleggio produce esattamente lo SHA-256 precedente:
  il percorso standard 6×4 non è cambiato.
- `assets:check`, `sprite:motion`, controllo alpha del PNG e `git diff --check`
  passati. Il controllo alpha rileva 0 residui hard-white e 0 near-white matte
  sui 12 fogli. Non certifica da solo la qualità del movimento.
- Prova pixel su 7 identità della camminata: 544.978 controlli di pixel di pelle,
  0 modifiche indebite; 0 alterazioni di alpha e inchiostro scuro;
  50.904 pixel chiaramente blu, nessuno escluso dalla maschera primaria.
- Osservazione di una partita senza impostare pose o velocità artificiali:
  giocatore 2, camminata, 24 fotogrammi visitati in un ciclo continuo di 1,8455 s,
  spostamento 0,68494 m. Per la corsa: giocatore 103, 24 fotogrammi, 0,7144 s.
  Sono misure di continuità temporale, non un'approvazione anatomica della corsa.
- Build finale `index-Ba5fscOu.js`, verificata da `dist`: 12/12 fogli,
  12/12 maschere, 5/5 livelli arena, arbitri illustrati caricati e disegnati;
  nessun errore rilevato dal controllo della build.

Immagini della verifica:

- [Partita dalla build](../artifacts/build-check/match.png)
- [Ciclo dello stesso giocatore in partita](../artifacts/locomotion-review/walk.png)
- [Palette di controllo, non un replay](../artifacts/palette-review/walk-palettes.png)
- [Cattura prima di rimuovere le sovrapposizioni](../artifacts/art-direction/walk-before-overlay-removal.png)

La galleria `http://127.0.0.1:5176/art-review.html` carica gli stessi PNG del
gioco e permette di fermare il fotogramma o rallentare le sequenze.
L'apertura nel pannello Codex è stata accodata, non confermata visivamente:
il controllo UI del pannello esistente è andato in timeout. La verifica del
server e della build nel browser di test è invece completata.

## Ancora da rifinire

Questo passaggio ridisegna la **camminata**, non tutte le azioni. L'alternanza
anatomica della corsa, la cadenza di alcune transizioni e le sequenze di salto,
schiacciata e tuffo richiedono ancora lavoro. Le sovrapposizioni rimosse e le
correzioni delle palette si applicano a tutte le azioni.
Il pubblico manga e gli arbitri illustrati erano già stati creati nel passaggio
precedente: qui ne è stato verificato il caricamento nella build aggiornata.
La suite visuale completa della fase precedente non è stata rieseguita e non
va presentata come una certificazione di questo stato.
