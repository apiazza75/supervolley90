# Recovery V3 — esito dell'integrazione

Questo branch contiene il pacchetto Recovery V3 applicato al branch di consegna, più una
correzione, **e non è consegnabile così com'è**. Serve a rendere ispezionabile ciò che è stato
verificato, senza toccare `claude/continue-codex-chatgpt-work-2zwryo`, che resta verde.

Base: `75e4546` (branch di consegna, CI verde su tutti e quattro i job).

## Cosa è stato verificato, e come

Il patcher non si applicava: falliva su `src/render/arena.ts: anchor not found (ArenaDrawable
interface)`. La causa non era il repository ma il pacchetto — tre ancoraggi erano stati generati
contro un sorgente con le **righe vuote normalizzate**:

| File | Ancoraggio atteso | Sorgente reale |
|---|---|---|
| `src/render/arena.ts` | `const SURROUND …;\ninterface Spectator {` | riga vuota fra i due |
| `src/render/renderer.ts` | `drawVignette(ctx, cam);\n    // Broadcast furniture.` | riga vuota fra i due |
| `tools/visual-qa-v3.ts` | `startDemo(page, SEED, FAST);\n  for (const shot …` | riga vuota fra i due |

Riallineati i tre ancoraggi, i restanti 26 si applicano puliti. `--force-sha` è stato usato solo
dopo aver verificato che l'unico commit successivo a `8e89dc5` aggiunge `docs/HANDOFF-ART-V3.md`,
che non è fra i file toccati dal patcher: nessuna sovrapposizione, nessun lavoro perso.

Risultati sul repository completo:

```
typecheck            OK
test                 65/65  (60 preesistenti + 5 nuovi, nessuna regressione)
assets:check         OK, i cinque layer v3 hanno dimensioni e canale corretti
metrics              tutte le soglie superate, violations: []
                     distinctCharacterSignaturesHome/Away: 6 / 6
                     valori gameplay IDENTICI alla baseline
smoke test browser   nessun errore JS, arenaAssetCount 5, bodyDraws 1
```

Il diff su `src/qa/gameplay-metrics.ts` è **puramente additivo**: aggiunge i due gate delle firme
senza toccare nessuna soglia preesistente. Nessun gate è stato indebolito.

## Perché non è consegnabile

I gate automatici passano tutti. Il risultato a schermo no. Questo è esattamente lo scenario che il
lavoro Recovery V3 esiste per impedire: `distinctCharacterSignatures` conta **quante** firme sono
diverse fra loro, non se sono disegnate correttamente — e sono sei firme diverse anche quando sono
sei rettangoli.

Diagnosi per isolamento, con tre catture a confronto in `docs/evidence/`:

| Componente | Esito |
|---|---|
| Rete geometrica dai quattro vertici | **buona** — pali, protezioni, nastri e antenne leggibili, occlusione corretta |
| FX nuovi | **buoni** — nessun errore, schegge e trail funzionano |
| Metriche, gate, test, validator | **buoni** — additivi e verdi |
| Overlay identità (`drawHairAndFace`) | **rotto** — disegna blocchi di colore sui giocatori |
| Arena v3 (cinque PNG) | **peggiora** — campo rosso a griglia al posto del parquet, testo del backdrop sopra il tabellone, foreground che invade l'HUD |

Con il solo overlay identità disattivato le figure tornano pulite: la responsabilità dei blocchi è
interamente sua. Con la sola arena v3 disattivata il campo torna corretto: la responsabilità del
resto è interamente sua.

## La correzione già fatta

`hairBounds()` in `src/render/character-signature.ts` cercava la testa nel **42% superiore** del
corpo e, non trovando abbastanza pixel nella maschera capelli, ripiegava sulla maschera pelle. In
qualunque posa con le braccia alzate — spike, block, serve, gran parte del foglio — quella fascia
contiene avambracci e mani: i bounds diventavano larghi quanto l'apertura delle braccia e le forme
dei capelli venivano disegnate a quella dimensione, cioè una lastra scura su mezza figura. Il
fallback per giunta accumulava sui bounds parziali invece di ripartire, così un pixel di capelli
più un avambraccio producevano un riquadro che li conteneva entrambi.

Corretto: fascia ristretta al 20% superiore, larghezza massima plausibile per una testa, ogni
canale scansionato nei propri bounds, e — se non si individua una testa con sicurezza — **non si
disegna nulla**, perché la figura originale è sempre preferibile a una macchia di colore.

Questo elimina i blocchi neri grandi. **Non** elimina i rettangoli più piccoli: le forme disegnate
da `drawHairAndFace` restano sbagliate anche con bounds corretti.

## Cosa resta da fare

1. **Rifare `drawHairAndFace`.** Le forme (`crop`, `fade`, `part`, …) vanno disegnate come capelli
   sulla calotta cranica, non come poligoni ancorati al riquadro. Va verificata a vista su tutti e
   24 i frame di ogni foglio, non su un fotogramma.
2. **Rifare gli asset dell'arena v3.** `floor.png` è una griglia rossa dove serve un parquet;
   `backdrop.png` contiene testo grande che compete con il tabellone; `foreground.png` invade la
   fascia dell'HUD. Le dimensioni sono giuste, il contenuto no.
3. **Poi** rieseguire `visual:qa:v3` e giudicare i 19 screenshot a vista.

Rete, FX, metriche e test sono invece integrabili una volta separati dai due punti sopra.
