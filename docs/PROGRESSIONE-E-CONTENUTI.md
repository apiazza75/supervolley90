# Progressione, divise e abilità

Le sei squadre originali restano disponibili. Le abilità iniziali coprono attacco, muro, alzata e difesa; entrambi i giocatori di una sfida locale scelgono dalla stessa collezione e possono usare la stessa abilità. Gli sblocchi offrono nuove scelte e colori: le nazionali aggiuntive non superano il rating massimo del roster iniziale.

Una partita completata con partecipazione umana accredita punti esperienza e sblocchi al profilo locale del giocatore 1. Anche una sconfitta vale come partita completata. Le vittorie e i punti segnati si riferiscono al giocatore 1; nelle sfide locali le attivazioni di abilità di entrambi contribuiscono al contatore delle abilità. Demo e partite abbandonate non assegnano ricompense.

Il profilo è conservato nel browser o nell'app, con ricevute univoche per impedire che la stessa partita sia conteggiata due volte. Se il browser rifiuta il salvataggio, il risultato lo segnala: gli sblocchi restano utilizzabili nella sessione aperta e un successivo salvataggio riuscito li conserva. Non è un account online e non sincronizza dispositivi diversi.

## Abilità

Ogni squadra parte da 25 energia su 100. L'energia aumenta attraverso i contatti e gli eventi di gioco; aspettare non la genera. Quando energia e recupero lo consentono, il prossimo contatto compatibile attiva automaticamente l'abilità. La normale barra delle mosse speciali rimane indipendente.

| Abilità | Contatto | Effetto | Energia / recupero | Sblocco |
| --- | --- | --- | --- | --- |
| Meteora | Schiacciata | Potenza +14% | 50 / 14 s | Iniziale |
| Muro d'acciaio | Muro | Portata +18%, controllo del rimbalzo migliorato | 45 / 12 s | Iniziale |
| Regista | Alzata | Dispersione −40%, controllo migliorato | 40 / 10 s | Iniziale |
| Salvataggio | Ricezione o recupero | Portata +15%, dispersione −30% | 45 / 12 s | Iniziale |
| Ago | Attacco | Dispersione dimezzata, controllo migliorato; potenza invariata | 50 / 14 s | 2 partite |
| Cometa | Alzata | Velocità di esecuzione +12%, dispersione −20% | 50 / 14 s | 4 partite |

I bonus di precisione modificano il bersaglio della palla; i bonus di potenza, velocità e portata modificano rispettivamente il colpo, il tempo di volo dell'alzata e la possibilità di raggiungere il pallone. Meteora conserva l'energia sui pallonetti bassi. Le mosse speciali della barra dedicata conservano l'energia delle abilità e non ne sommano i modificatori.

## Collezione

- Nazionali: USA dopo 1 partita, Polonia dopo 2, Cuba dopo 3, Francia dopo 5.
- Divise: 10 prime maglie, 11 alternative nazionali e 2 omaggi storici. La seconda maglia bianca dell'Italia è già disponibile; gli altri requisiti sono indicati nella Collezione.
- Palloni: Classico iniziale; Tricolore dopo 1 partita; Sunset dopo 80 punti; Neon dopo 4 partite; Vintage avorio dopo 6.
- Parquet: Acero iniziale; Noce dopo 1 partita; Miele dopo 80 punti; Artico dopo 3 partite; Notte dopo 5.

Gli omaggi storici usano disegni originali basati sui colori dei club. L'omaggio **Modena '97** richiama la squadra 1996/97 che vinse campionato, Coppa Italia e Coppa dei Campioni, come documenta [Modena Volley, intervista a Fabio Vullo](https://www.modenavolley.it/news/sportive/legends-il-sestetto-dei-sogni-fabio-vullo/). L'omaggio **Treviso '90** riprende l'identità oro e granata del club negli anni Novanta, descritta nella [storia ufficiale di Volley Treviso](https://www.volleytreviso.it/societa/anni-90-il-boom-del-volley/). Non sono repliche delle maglie commerciali.

## Verifica

`tests/progression.test.ts` copre completamento, demo e abbandono, ricevute duplicate anche dopo ricaricamento, requisiti di sblocco, dati corrotti, accesso al salvataggio negato, memoria temporanea di sessione e indipendenza delle divise. `tests/special-skills.test.ts` verifica risorse, tempi di recupero ed effetti sulle traiettorie e sulla portata dei contatti su entrambi i lati del campo. La verifica visiva e il gioco effettivo rimangono parte del controllo complessivo della versione.
