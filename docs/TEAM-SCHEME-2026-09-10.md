# Squadra e movimenti — verifica locale del 10 settembre 2026

Stato: modifiche locali, non pubblicate. La qualità grafica complessiva e la fluidità di tutte le azioni NON sono approvate.

## Modifiche applicate

- Schieramenti predisposti prima della battuta, senza riposizionamenti continui con la palla in mano. Prima linea della squadra al servizio a rete; tre ricevitori nominati, palleggiatore escluso dalla ricezione ordinaria. Ordinamento laterale e fronte/retro verificato per tutte le sei rotazioni e per entrambe le metà campo.
- La squadra che serve mantiene la difesa durante il volo della propria battuta. Il flag di servizio resta attivo anche dopo il passaggio sopra la rete, fino al primo tocco della squadra che riceve: non si può murare una battuta.
- Attaccante nella corsia del ruolo, proprietario del secondo tocco mantenuto finché può arrivare, coperture con destinazioni distinte. Il soccorso di un compagno non ruba una palla raggiungibile al giocatore designato.
- Frenata proporzionale alla distanza; eliminata la spinta fisica basata sulla sovrapposizione apparente dei corpi sullo schermo. I due muratori possono restare vicini senza respingersi.
- Rimosse le cadute dei muratori attivate a distanza nell'istante della schiacciata. Il contatto a muro può avvenire appena prima o appena dopo la rete e non viene annullato dal blocco temporaneo dei tocchi del battitore.
- Preparazione di palleggio/ricezione distinta dal contatto. Nel palleggio osservato non compare più il ritorno al primo fotogramma prima di toccare la palla. L'ingresso in ricezione è ancora da rifinire.

L'impostazione usa una base 5-1 semplificata, non pretende di simulare tutte le combinazioni di una squadra agonistica. Riferimenti consultati: [manuale allenatori FIVB, livello II, sezioni sulle formazioni di ricezione e il 5-1](https://www.fivb.com/wp-content/uploads/2024/03/Coaches_Manual_Level_II_EN.pdf), [USA Volleyball, lettura dell'attaccante e rapporto muro-difesa](https://usavolleyball.org/resource/so-you-want-to-be-a-great-defender-learn-to-read-the-hitter/).

## Evidenza, non accettazione artistica

Cartella delle osservazioni: `/Users/alessandropiazza/Documents/Codex/2026-08-08/il/contact-qa-2026-09-10.qERAVI`.

- `before-team-scheme.json` e `final-team-scheme.json`: sei rotazioni, dieci secondi simulati di attesa ciascuna. Dopo la modifica: zero spostamento e zero campioni di corsa dei giocatori non al servizio.
- Due partite simulate da 90 secondi, seed 21 e 4242: destinazioni duplicate di copertura 495/355 prima, 0/0 dopo; campioni di attacco sulla propria battuta 569/713 prima, 0/0 dopo. Contatti effettivi 51/45 prima, 57/66 dopo. Questi numeri non certificano ogni possibile partita.
- Coorte di sei partite, 7000 passi ciascuna: 55 attacchi; due difensori in aria su 54; tre contatti a muro reali, nessuno da terra. Rincorsa mediana degli attacchi 1,52 m. Tutte le soglie di gameplay esistenti passate senza abbassarle.
- `service/serve.json`, `service/jumpServe.json`: menu e tastiera reali, nessuna assegnazione artificiale di pose. Attesa oltre nove secondi simulati senza avvio automatico; corpo fermo durante preparazione/lancio, poi rincorsa e contatto in aria della battuta in salto. Nessun errore nel controllo.
- `scheme-set.json`: disegni di preparazione 1–10, contatto 11, seguito 12–23, senza riavvolgimento. Il primo disegno non è stato campionato dal browser in questa cattura: non si dichiara una cattura di tutti i 24.
- `scheme-bump.json`: la prima ricezione catturata entra ancora direttamente al contatto 12. Non risolta dal solo cambio di temporizzazione.
- Browser di test Chromium, 1280×720: un solo corpo raster per giocatore, zero fallback vettoriali, nessun errore di pagina nelle catture. La fluidità sul display nativo dell'utente non è certificata. Il tentativo di accesso diretto al browser dell'app ha avuto un timeout di autorizzazione; la partita dell'utente non è stata interrotta.
- Compilazione e typecheck riusciti. Pacchetto compilato verificato separatamente: 13/13 fogli sprite, 13/13 maschere, 5/5 livelli arena e ufficiali illustrati caricati. Nessun pacchetto macOS, CI, commit, push o deploy eseguito.

## Correzioni ai controlli

Il laboratorio della battuta prima usava il punto della ricezione come surrogato del punto di caduta. Con una ricezione ordinata questo falsava la misura: ricevitori alla stessa profondità non implicano traiettorie uguali. Ora si misura la previsione fisica del volo prima dell'intercetto e si variano esplicitamente gli input di mira nelle 32 prove. Risultato: 27 battute valide, 19 in salto, dispersione delle destinazioni X 1,81 m e Y 1,91 m; cinque pressioni tardive correttamente mancate. Non è una promessa di casualità con la stessa mira.

Il test sul tuffo ricerca il primo salvataggio effettivo nella coorte fissa delle sei partite di accettazione, invece di obbligare il vecchio seed 4242 a produrre un tuffo non più necessario. Una volta avvenuto il salvataggio, il recupero di quel giocatore deve riuscire: non si passa a un altro seed per nascondere un errore.

## Disegni nuovi, ancora candidati

Generati con lo strumento immagini integrato: otto pose chiave e due serie da otto intermedi per ciascuna azione, ricezione e palleggio. Le sei immagini sono in `assets/source/manga-2026-09/`, nomi `bump-keyposes.png`, `bump-between-1.png`, `bump-between-2.png`, `set-keyposes.png`, `set-between-1.png`, `set-between-2.png`.

Prompt e provenienza: `assets/source/manga-2026-09/contact-candidates-generation.json`. Queste 48 illustrazioni NON sono 48 fotogrammi accettati in partita. Alcuni intermedi invertono la compressione/estensione e il rilascio delle braccia; vanno corretti prima dell'importazione. I fogli runtime di ricezione e palleggio non sono stati sostituiti in questo passaggio. Nessun riempitivo vettoriale, duplicazione o deformazione degli arti aggiunta.

Prossima priorità visiva: ingresso in ricezione, raccordi tra spostamento e gesto, revisione degli intermedi nuovi e prova sul display dell'utente. Il goal complessivo resta aperto.
