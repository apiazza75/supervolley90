import { drawFrame, loadSheets, type SpriteAction } from '../render/sprites';
import { BUMP_FOLLOW_FRAMES, CELEBRATE_FRAMES, SET_FOLLOW_FRAMES, BACK_SET_FOLLOW_FRAMES, DIVE_FLOOR_FRAMES, DIVE_RECOVERY_FRAMES, SPIKE_FOLLOW_AIR_FRAMES, SPIKE_FOLLOW_LANDING_FRAMES, DURATION, locomotionPlaybackScale } from '../render/sprite-figure';
import { GAME_SPEED } from '../core/rules';
import { STANDING_SERVE_SWING_FRAMES, STANDING_SERVE_FOLLOW_FRAMES, STANDING_SERVE_TOSS_RELEASE_FRAMES } from '../render/serve-swing';
import { WALK_RELEASE_FRAMES } from '../render/walk-release';
import { standingTurnPose, STANDING_TURN_REVIEW_POSES, stoppingTurnFrame, STOPPING_TURN_REVIEW_FRAMES } from '../render/turn-playback';
import { JUMP_SERVE_TOSS_FRAMES, JUMP_SERVE_RUNUP_FRAMES, JUMP_SERVE_RISE_FRAMES } from '../render/jump-serve-entry';
import { serveTossPoses } from '../render/serve-charge-release';
import { BLOCK_LANDING_FRAMES } from '../render/block-landing';
import { BLOCK_DESCENT_FRAMES } from '../render/block-descent';
import { BUMP_PREPARATION_FRAMES, RETREAT_BUMP_PREPARATION_FRAMES, LATERAL_BUMP_PREPARATION_FRAMES } from '../render/bump-preparation';
import { BUMP_RELEASE_FRAMES } from '../render/bump-release';
import { READY_RETREAT_FRAMES, READY_LATERAL_FRAMES } from '../render/ready-retreat';
import { APPROACH_RUN_FRAMES, APPROACH_PLANT_FRAMES } from '../render/approach-steps';
import { RUN_STRIDE_FRAMES } from '../render/run-stride';
import { DIVE_TURN_SEQUENCE } from '../render/dive-turn';

const labels: Record<SpriteAction, string> = {
  spike: 'Schiacciata',
  spikeFollow: 'Schiacciata · seguito e atterraggio',
  jumpServeFollow: 'Battuta in salto · seguito e atterraggio',
  turnStop: 'Giro e arresto difensivo · 28 disegni',
  runTurn: 'Giro in movimento',
  runBrake: 'Frenata difensiva · due appoggi, 12 disegni ciascuno',
  backpedal: 'Arretramento difensivo',
  walk: 'Camminata', shuffle: 'Passi difensivi', turn: 'Cambio di direzione', run: 'Corsa', idle: 'Attesa', approach: 'Rincorsa',
  set: 'Palleggio', backSet: 'Palleggio all’indietro', bump: 'Ricezione', block: 'Muro',
  dive: 'Tuffo', serve: 'Battuta', jumpServe: 'Battuta in salto', celebrate: 'Esultanza',
};
const grid = document.querySelector<HTMLElement>('#grid')!;
const play = document.querySelector<HTMLButtonElement>('#play')!;
const slider = document.querySelector<HTMLInputElement>('#frame')!;
const speed = document.querySelector<HTMLSelectElement>('#speed')!;
const background = document.querySelector<HTMLSelectElement>('#background')!;
const approachReviewFrames = [...APPROACH_RUN_FRAMES, ...APPROACH_PLANT_FRAMES.slice(1)];
slider.max = '59';
let playing = true;
let scrubbing = false;
let time = 0;
let previous = performance.now();
play.onclick = () => { playing = !playing; scrubbing = false; play.textContent = playing ? 'Pausa' : 'Riprendi'; };
slider.oninput = () => { playing = false; scrubbing = true; play.textContent = 'Riprendi'; };
let loaded = 0;
const sheets = await loadSheets('sprites', () => {
  loaded++;
  document.querySelector<HTMLElement>('#status')!.textContent = `Caricamento delle illustrazioni: ${loaded} / ${Object.keys(labels).length}`;
}, (action, reason) => {
  document.querySelector<HTMLElement>('#status')!.textContent = `Errore in ${action}: ${reason}`;
});
function makeCard(action: SpriteAction, gather = false, release = false, retreat = false, lateral = false, sideStart = false) {
  const card = document.createElement('article');
  const title = document.createElement('h2');
  title.textContent = sideStart ? 'Attesa → passo laterale · ispezione rallentata' : lateral ? 'Appoggio laterale → bagher · ispezione rallentata' : retreat ? 'Arretramento → bagher · ispezione rallentata' : release ? 'Bagher → passi difensivi · ispezione rallentata' : gather ? action === 'walk' ? 'Difesa → camminata · ispezione rallentata'
    : action === 'serve' ? 'Carica → lancio in salto · ispezione rallentata'
    : action === 'block' ? 'Muro · assorbimento e risalita · ispezione rallentata'
    : action === 'dive' ? 'Torsione → tuffo · ispezione rallentata'
    : action === 'idle' ? 'Attesa → primo passo indietro · ispezione rallentata'
    : action === 'bump' ? 'Bagher · preparazione e rinuncia · ispezione rallentata'
    : action === 'spikeFollow' ? 'Atterraggio → primo passo indietro · ispezione rallentata'
    : 'Raccordo arresto → palleggio · ispezione rallentata' : labels[action];
  const canvas = document.createElement('canvas');
  canvas.width = 560; canvas.height = 660;
  const output = document.createElement('output');
  card.append(title, canvas, output); grid.append(card);
  return { action, gather, release, retreat, lateral, sideStart, ctx: canvas.getContext('2d')!, output, visible: false, lastPaintKey: '', lastIndex: -1, lastFacing: 0, lastBackground: '', lastSheetAction: action };
}
const cards = (Object.keys(labels) as SpriteAction[]).map(action => makeCard(action));
cards.push(makeCard('idle', true));
cards.push(makeCard('idle', true, false, false, false, true));
cards.push(makeCard('set', true));
cards.push(makeCard('spikeFollow', true));
cards.push(makeCard('walk', true));
cards.push(makeCard('serve', true));
cards.push(makeCard('block', true));
cards.push(makeCard('dive', true));
cards.push(makeCard('bump', true));
cards.push(makeCard('bump', true, true));
cards.push(makeCard('bump', true, false, true));
cards.push(makeCard('bump', true, false, false, true));
// The gallery can remain open alongside the match. Painting all 32 large
// previews even below the fold competes with live gameplay for the same GPU.
// Keep their playheads current, but paint only artwork actually on screen.
const cardsByCanvas = new Map(cards.map(card => [card.ctx.canvas, card]));
const visibility = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const card = cardsByCanvas.get(entry.target as HTMLCanvasElement);
    if (card) card.visible = entry.isIntersecting;
  }
});
for (const card of cards) visibility.observe(card.ctx.canvas);
document.addEventListener('visibilitychange', () => { previous = performance.now(); });
document.querySelector<HTMLElement>('#status')!.textContent =
  `${Object.keys(sheets).length} sequenze principali da 24 disegni, più 4 raccordi per l’arrivo al palleggio, 4 per la rialzata dal tuffo, 4 per il bagher, 4 per l’esultanza, 8 per il salto della schiacciata e 3 per il richiamo delle gambe in discesa; un quarto bozzetto è stato scartato perché faceva arretrare nuovamente le gambe. La ricaduta della schiacciata segue una sola compressione e risalita. Nel palleggio quattro nuovi disegni accompagnano il rilassamento dei polsi e la discesa delle braccia: non si riproduce più la spinta al contrario. Questa galleria mostra i fotogrammi in ordine; in partita passi, appoggio, volo e rialzata seguono gli stati reali. La battuta attende il tasto e il lancio precede la rincorsa. In partita sono integrati pubblico illustrato, arbitro seduto e nuovo parquet disegnato. Restano da rifinire i raccordi fra azioni e la coerenza complessiva della scena. I controlli tecnici non equivalgono all’approvazione visiva o a una garanzia di fluidità su ogni dispositivo.`;
document.querySelector<HTMLElement>('#status')!.textContent += ' Quattro nuovi disegni raccordano la fine dell’atterraggio della schiacciata al primo passo indietro; non si ripetono dentro il ciclo dei passi.';
document.querySelector<HTMLElement>('#status')!.textContent += ' La battuta da fermo include otto nuovi disegni del braccio prima e dopo l’impatto; in partita l’estensione finale attende la discesa del pallone.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Otto nuovi disegni accompagnano la risalita e il rilassamento delle braccia dalla postura difensiva alla camminata, dopo il completamento dell’appoggio. Sono raccordi singoli: il ciclo della camminata conserva i suoi 24 disegni originali.';
document.body.dataset.ready = 'true';
document.querySelector<HTMLElement>('#status')!.textContent += ' Quattro nuovi disegni accompagnano le braccia nello stacco della schiacciata, con appoggi coerenti. La vecchia posa 21 è conservata nel foglio ma esclusa dalla sequenza perché faceva oscillare avanti e indietro i piedi. Il salto mantiene il suo tempo fisico.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Il giro da fermo riutilizza i quattro disegni di flessione laterale già presenti: abbassa gradualmente il busto prima di ruotare. Non sono nuove illustrazioni; il difensore già basso entra direttamente nel giro e la durata resta invariata.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Quattro nuovi disegni raccordano il giro in movimento all’arresto: la gamba incrociata si apre e il busto ruota e si abbassa gradualmente. La scelta di frenare resta a metà giro e la durata complessiva non cambia.';
document.querySelector<HTMLElement>('#status')!.textContent += ' In partita anche l’arrivo dalla corsa e dalla frenata usa i quattro disegni di raccolta già presenti: non inserisce più la preparazione eretta fra corsa e bagher. Non sono nuove illustrazioni.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Quattro nuovi disegni accompagnano l’assorbimento del tuffo sulle mani; la vecchia posa 12 è conservata ma non riprodotta perché interrompeva la discesa del busto. Scivolata e recupero mantengono le loro durate fisiche.';
document.querySelector<HTMLElement>('#status')!.textContent += ' La salita della battuta in salto include quattro nuovi disegni per il caricamento delle spalle: il braccio del lancio scende mentre quello del colpo si raccoglie sopra il capo. Il contatto reale mantiene la priorità sulla sequenza.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Quattro disegni dedicati alla partenza laterale accompagnano la flessione delle ginocchia prima del primo passo; un cambio in corsa o un contatto interrompe subito questo ingresso.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Quattro nuovi disegni trasferiscono il peso dall’attesa al primo appoggio indietro: un ingresso singolo, non un’animazione da ripetere mentre si aspetta la battuta.';
document.querySelector<HTMLElement>('#status')!.textContent += ' La battuta in salto aggiunge otto disegni per il lancio e il primo passo; il ginocchio completa il sollevamento prima della falcata e il pallone resta collegato al palmo durante il lancio.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Il tuffo include altri otto disegni: quattro per la spinta delle mani dal pavimento e quattro per la risalita dalla posizione accovacciata; le durate fisiche del recupero restano invariate.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Quattro nuovi disegni collegano la carica al lancio: i primi due sono condivisi con la battuta da fermo. Il raccordo completo è visibile nella scheda dedicata.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Il muro aggiunge quattro disegni per assorbire l’atterraggio: una sola compressione e risalita, senza spostare la durata del recupero o il contatto con il pavimento.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Il bagher aggiunge quattro disegni nella preparazione e corregge una posa fuori ordine che rialzava il busto durante la flessione. La rinuncia ripercorre la preparazione senza simulare un contatto.';
document.querySelector<HTMLElement>('#status')!.textContent += ' La ripartenza laterale dopo una ricezione abbandonata ha otto disegni dedicati per separare le mani e trasferire il peso ai passi; non fa parte del colpo sulla palla.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Quattro disegni raccordano l’arretramento al bagher senza rialzare il busto: l’ingresso basso è scelto dalla postura effettiva, non dalla pressione anticipata del tasto.';
document.querySelector<HTMLElement>('#status')!.textContent += ' Dall’appoggio laterale le braccia si chiudono sugli otto disegni del rilascio, ripercorsi in senso inverso. Sono illustrazioni già presenti, collegate ora anche all’ingresso in ricezione; non nuovi disegni.';
// Keep the detailed drawing history available without pushing every preview
// several screens below the fold (especially on a narrow window).
const status = document.querySelector<HTMLElement>('#status')!;
document.querySelector<HTMLElement>('#art-notes')!.textContent = status.textContent;
document.querySelector<HTMLElement>('#art-details')!.hidden = false;
const missing = Object.keys(labels).filter(action => !sheets[action as SpriteAction]);
status.textContent = missing.length
  ? `Illustrazioni mancanti: ${missing.join(', ')}.`
  : `${Object.keys(sheets).length} sequenze manga caricate. Pausa per ispezionare le pose; apri la partita per valutarle durante il gioco.`;

function animate(now: number): void {
  // A background tab must neither repaint nor accumulate a catch-up jump.
  if (document.hidden) { previous = now; requestAnimationFrame(animate); return; }
  if (playing) time += Math.min(.08, (now - previous) / 1000) * Number(speed.value);
  previous = now;
  for (const card of cards) {
    const { action, ctx, output } = card;
    let sheet = sheets[action];
    let sheetAction = action;
    if (!sheet) { output.textContent = 'Illustrazione mancante'; continue; }
    const cadence = action === 'shuffle' ? locomotionPlaybackScale(action, 1.1)
      : action === 'walk' ? locomotionPlaybackScale(action, 1.25)
      : action === 'run' ? locomotionPlaybackScale(action, 3.7) : 1;
    let index = playing ? Math.floor(time * GAME_SPEED * cadence / DURATION[action] * 24) % 24
      : scrubbing ? Math.min(23, Number(slider.value)) : Math.max(0, card.lastIndex);
    if ((action === 'approach' || action === 'block' || action === 'dive' || action === 'bump' || action === 'set' || action === 'backSet' || action === 'celebrate' || action === 'spike' || action === 'spikeFollow' || action === 'serve' || action === 'jumpServe') && !card.gather && (playing || scrubbing)) {
      const order = action === 'approach' ? approachReviewFrames
        : action === 'dive' ? [...Array.from({ length: 12 }, (_, i) => i), ...DIVE_FLOOR_FRAMES, ...DIVE_RECOVERY_FRAMES]
        : action === 'block' ? [...Array.from({length:17},(_,i)=>i),...BLOCK_DESCENT_FRAMES.slice(0,-1),...BLOCK_LANDING_FRAMES]
        : action === 'jumpServe' ? [0, ...JUMP_SERVE_TOSS_FRAMES.slice(0,-1), ...JUMP_SERVE_RUNUP_FRAMES, 10,11,12,...JUMP_SERVE_RISE_FRAMES,18,19,20,21,22,23]
        : action === 'celebrate' ? CELEBRATE_FRAMES
        : action === 'bump' ? [...BUMP_PREPARATION_FRAMES,...BUMP_FOLLOW_FRAMES]
        : action === 'backSet' ? [...Array.from({length:9},(_,i)=>i),...BACK_SET_FOLLOW_FRAMES]
        : action === 'serve' ? [0,1,2,3,32,33,...Array.from({length:5},(_,i)=>i+4),...STANDING_SERVE_TOSS_RELEASE_FRAMES,10,11,...STANDING_SERVE_SWING_FRAMES,...STANDING_SERVE_FOLLOW_FRAMES]
        : action === 'spikeFollow' ? [...SPIKE_FOLLOW_AIR_FRAMES,...SPIKE_FOLLOW_LANDING_FRAMES]
        : action === 'spike' ? [0,1,2,3,4,5,6,7,8,9,10,11,13,24,25,12,14,28,29,30,15,31,16,26,27,17,18,19,20,21,22,23]
        : [...Array.from({ length: 9 }, (_, i) => i), ...(action === 'set' ? SET_FOLLOW_FRAMES : BUMP_FOLLOW_FRAMES)];
      const at = playing ? Math.floor(time * GAME_SPEED / DURATION[action] * order.length) % order.length
        : Math.min(order.length - 1, Number(slider.value));
      index = order[at];
    }
    // Match the game's planted waiting stance; manual scrubbing still exposes
    // every source drawing for honest inspection of the original atlas.
    if (playing && action === 'idle') index = 0;
    if (action === 'run') index = playing
      ? RUN_STRIDE_FRAMES[Math.floor(time * GAME_SPEED * cadence / DURATION.run * RUN_STRIDE_FRAMES.length) % RUN_STRIDE_FRAMES.length]
      : scrubbing ? RUN_STRIDE_FRAMES[Math.min(RUN_STRIDE_FRAMES.length-1,Number(slider.value))] : Math.max(0,card.lastIndex);
    if (action === 'turn') {
      const pose = playing ? standingTurnPose(time * GAME_SPEED / DURATION.turn % 1)
        : scrubbing ? STANDING_TURN_REVIEW_POSES[Math.min(STANDING_TURN_REVIEW_POSES.length - 1, Number(slider.value))]
        : { action: card.lastSheetAction, frame: card.lastIndex };
      index = pose.frame; sheetAction = pose.action; sheet = sheets[sheetAction]!;
    }
    if (action === 'turnStop') {
      if (playing) index = stoppingTurnFrame(time * GAME_SPEED / DURATION.turnStop % 1);
      else if (scrubbing) index = STOPPING_TURN_REVIEW_FRAMES[Math.min(STOPPING_TURN_REVIEW_FRAMES.length - 1, Number(slider.value))];
    }
    if (card.gather) {
      const step = playing ? Math.min(4, Math.floor((time * GAME_SPEED % 1) / .1))
        : scrubbing ? Math.min(4, Math.floor(Number(slider.value) / 28 * 5)) : card.lastIndex === 0 ? 4 : Math.max(0, card.lastIndex - 24);
      index = step < 4 ? 24 + step : 0;
      if (action === 'idle') {
        const order = [0,...(card.sideStart ? READY_LATERAL_FRAMES : READY_RETREAT_FRAMES),0];
        const at = playing ? Math.min(5,Math.floor((time*GAME_SPEED%2)/.16))
          : scrubbing ? Math.min(5,Math.floor(Number(slider.value)/36*6)) : -1;
        index = at < 0 ? card.lastIndex : order[at];
        sheetAction = at < 0 ? card.lastSheetAction : at === 5 ? card.sideStart ? 'shuffle' : 'backpedal' : 'idle';
        sheet = sheets[sheetAction]!;
      }
      if (action === 'bump') {
        const order = card.lateral ? [...LATERAL_BUMP_PREPARATION_FRAMES] : card.retreat ? [...RETREAT_BUMP_PREPARATION_FRAMES] : card.release ? [6,...BUMP_RELEASE_FRAMES,0] : [...BUMP_PREPARATION_FRAMES,...BUMP_PREPARATION_FRAMES.slice(0,-1).reverse()];
        const at = playing ? Math.min(order.length-1,Math.floor((time*GAME_SPEED%4.5)/.16))
          : scrubbing ? Math.min(order.length-1,Math.floor(Number(slider.value)/36*order.length)) : -1;
        index = at < 0 ? card.lastIndex : order[at];
        if (card.release && index === 0) { sheetAction = 'shuffle'; sheet = sheets.shuffle!; }
      }
      if (action === 'block') {
        const at = playing ? Math.min(BLOCK_LANDING_FRAMES.length - 1, Math.floor((time * GAME_SPEED % 3) / .16))
          : scrubbing ? Math.min(BLOCK_LANDING_FRAMES.length - 1, Math.floor(Number(slider.value) / Number(slider.max) * BLOCK_LANDING_FRAMES.length)) : -1;
        index = at < 0 ? card.lastIndex : BLOCK_LANDING_FRAMES[at];
      }
      if (action === 'serve') {
        const poses = serveTossPoses(true, 3);
        const at = playing ? Math.min(poses.length - 1, Math.floor((time * GAME_SPEED % 2.5) / .16))
          : scrubbing ? Math.min(poses.length - 1, Math.floor(Number(slider.value) / 36 * poses.length)) : -1;
        const pose = at < 0 ? { action: card.lastSheetAction, frame: card.lastIndex } : poses[at];
        index = pose.frame; sheetAction = pose.action; sheet = sheets[sheetAction]!;
      }
      if (action === 'spikeFollow') {
        const order = [22,28,29,30,31,0];
        const at = playing ? Math.min(5, Math.floor((time * GAME_SPEED % 1.5) / .16))
          : scrubbing ? Math.min(5, Math.floor(Number(slider.value) / 32 * 6)) : -1;
        index = at < 0 ? card.lastIndex : order[at];
        if (index === 0) sheet = sheets.backpedal!;
      }
      if (action === 'walk') {
        const order = [15,...WALK_RELEASE_FRAMES,0];
        const at = playing ? Math.min(9, Math.floor((time * GAME_SPEED % 2) / .16))
          : scrubbing ? Math.min(9, Math.floor(Number(slider.value) / 32 * 10)) : -1;
        index = at < 0 ? card.lastIndex : order[at];
        if (index === 15) sheet = sheets.shuffle!;
      }
      if (action === 'dive') {
        const order = DIVE_TURN_SEQUENCE;
        const at = playing ? Math.min(order.length-1,Math.floor((time*GAME_SPEED%1.8)/.15))
          : scrubbing ? Math.min(order.length-1,Number(slider.value)) : -1;
        index = at < 0 ? card.lastIndex : order[at];
      }
    }
    // Separate braking variants, with a hold between demonstrations; never
    // present frame11 -> frame12 as continuous volleyball movement.
    if (playing && action === 'runBrake') {
      const cycle = time * GAME_SPEED / (DURATION.runBrake / 2 + .5);
      index = (Math.floor(cycle) % 2) * 12 + Math.min(11, Math.floor((cycle % 1) * (DURATION.runBrake / 2 + .5) / (DURATION.runBrake / 2) * 12));
    }
    // A half-turn ends on the opposite side. Alternate its direction on the
    // next demonstration cycle instead of snapping left -> right at frame0.
    const facing = card.gather && action === 'dive' ? index>=40 ? 1 : -1
      : !playing && !scrubbing ? card.lastFacing || 1
      : (action === 'turn' || action === 'runTurn' || action === 'turnStop') && playing && Math.floor(time * GAME_SPEED / DURATION[action]) % 2 ? -1 : 1;
    // Sampling is cheap and preserves pause/scrub state for offscreen cards.
    // The last *painted* key is separate: a card becoming visible must catch
    // up with that sampled pose even when playback was paused meanwhile.
    const paintKey = `${sheetAction}/${index}/${facing}/${background.value}`;
    card.lastIndex = index; card.lastSheetAction = sheetAction; card.lastFacing = facing; card.lastBackground = background.value;
    if (!card.visible || card.lastPaintKey === paintKey) continue;
    card.lastPaintKey = paintKey;
    ctx.save(); ctx.scale(2, 2);
    ctx.fillStyle = background.value; ctx.fillRect(0, 0, 280, 330);
    ctx.strokeStyle = '#70877d'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(12, 305); ctx.lineTo(268, 305); ctx.stroke();
    // Magnified inspection preview, not the court's physical 1.9m scale.
    drawFrame(ctx, sheet, index, 140, 304, 200, facing);
    ctx.restore();
    output.textContent = card.gather ? action === 'walk'
      ? index === 15 ? 'Appoggio difensivo completato' : index === 0 ? 'Primo appoggio della camminata' : `Risalita ${WALK_RELEASE_FRAMES.indexOf(index as typeof WALK_RELEASE_FRAMES[number]) + 1} / 8`
      : action === 'serve' ? `${sheetAction === 'serve' ? index === 3 ? 'Carica mantenuta' : `Raccordo ${index - 31} / 4` : 'Lancio'} · ${sheetAction}/${index}`
      : action === 'block' ? `Assorbimento → risalita · block/${index}`
      : action === 'dive' ? `Torsione → tuffo · dive/${index}`
      : action === 'idle' ? `Attesa → ${card.sideStart ? 'passo laterale' : 'arretramento'} · ${sheetAction}/${index}`
      : action === 'bump' ? card.lateral ? `Appoggio laterale → bagher · bump/${index}` : card.retreat ? `Arretramento → bagher · bump/${index}` : card.release ? `Rilascio → passi · ${sheetAction}/${index}` : `Preparazione → rinuncia · bump/${index}`
      : action === 'spikeFollow'
      ? index === 22 ? 'Ultima posa di atterraggio' : index === 0 ? 'Primo appoggio del ciclo di arretramento' : `Raccordo ${index - 27} / 4`
      : index >= 24 ? `Raccordo ${index - 23} / 4` : 'Ingresso nella preparazione del palleggio'
      : action === 'runBrake'
      ? `Appoggio ${index < 12 ? 'vicino' : 'lontano'} · fotogramma ${index % 12 + 1} / 12`
      : action === 'run' ? `Passo ${RUN_STRIDE_FRAMES.indexOf(index as typeof RUN_STRIDE_FRAMES[number])+1} / 26 · disegno ${index+1}`
      : action === 'dive' ? `Disegno ${index + 1} / 40 · assorbimento, spinta e rialzata`
      : action === 'block' ? `Disegno ${index + 1} / ${sheet.frames.length} · discesa e atterraggio illustrati`
      : action === 'bump' ? `Disegno ${index + 1} / 44 · preparazione, seguito e ripartenza`
      : action === 'set' ? `Disegno ${index + 1} / ${sheet.frames.length} · recupero delle braccia illustrato`
      : action === 'celebrate' ? `Disegno ${index + 1} / 28 · esultanza estesa`
      : action === 'spike' ? `Disegno ${index + 1} / 32 · salto e braccio estesi`
      : action === 'serve' ? `Disegno ${index + 1} / ${sheet.frames.length} · carica, lancio e seguito del braccio`
      : action === 'jumpServe' ? `Disegno ${index + 1} / 36 · lancio, primo passo e caricamento in volo`
      : action === 'spikeFollow' ? `Disegno ${index + 1} · 27 pose in sequenza, un bozzetto scartato`
      : action === 'approach'
        ? `Passo ${approachReviewFrames.indexOf(index as typeof approachReviewFrames[number]) + 1} / ${approachReviewFrames.length} · disegno ${index + 1}`
        : `Fotogramma ${index + 1} / ${sheet.frames.length}`;
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
