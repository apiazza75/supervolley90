import type { TeamConfig } from '../core/team';
import { DEFAULT_MATCH_FORMAT, matchFormatLabel, type MatchFormat } from '../core/match-format';
import { SKILLS } from '../core/skills';
import { buildStamp } from './build-info';
import { InputManager } from './input';
import { loadProgression, isUnlocked, unlockLabel } from './progression';
import { availableKits, BALL_STYLES, configureTeam, COURT_STYLES, NATIONAL_TEAMS, TEAM_KITS } from './teams';
import { drawFrame, type Sheet } from '../render/sprites';
import './menu.css';

export type MatchMode = 'solo' | 'versus' | 'demo';

export interface MatchSetup {
  home: TeamConfig;
  away: TeamConfig;
  difficulty: number;
  seed: number;
  mode: MatchMode;
  humanControlsAway: boolean;
  format: MatchFormat;
  ballId: string;
  courtId: string;
}

type MenuTab = 'match' | 'teams' | 'collection';
type Unlock = Parameters<typeof isUnlocked>[0];
const GOLD = '#ffd35c';
const TEXT = '#f4f7ff';
const MUTED = 'rgba(210,225,248,0.58)';

/** Real form controls keep the arcade lobby usable with fingers, keyboard and a controller. */
export class Menu {
  private homeId = 'ITA';
  private awayId = 'BRA';
  private homeKitId = 'ita-home';
  private awayKitId = 'bra-home';
  private homeSkillId = 'meteor';
  private awaySkillId = 'meteor';
  private ballId = 'classic';
  private courtId = 'maple';
  private difficulty = 1;
  private mode: MatchMode = 'solo';
  private format: MatchFormat = { ...DEFAULT_MATCH_FORMAT };
  private tab: MenuTab = 'match';
  private cooldown = 0;
  private blink = 0;
  private portrait?: Sheet;
  private previewsDirty = true;
  private root?: HTMLElement;
  private profile = loadProgression();
  private gamepad = false;

  /** Set once the player confirms; the application reads and clears it. */
  ready: MatchSetup | null = null;

  update(input: InputManager, dt: number): void {
    this.blink += dt;
    if (this.gamepad !== input.hasGamepad) {
      this.gamepad = input.hasGamepad;
      if (this.root) this.render();
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.root || this.root.hidden || this.cooldown > 0) return;
    const dir = input.direction();
    if (Math.abs(dir.y) > 0.5) {
      this.moveFocus(dir.y > 0 ? -1 : 1);
      this.cooldown = 0.18;
    } else if (Math.abs(dir.x) > 0.5) {
      this.adjustFocused(dir.x > 0 ? 1 : -1);
      this.cooldown = 0.18;
    }
    if (input.actionPressed) {
      if (!this.root.contains(document.activeElement)) this.confirm();
      else {
        const focused = this.focusedControl();
        if (focused instanceof HTMLButtonElement) focused.click();
        else this.moveFocus(1);
      }
      this.cooldown = 0.22;
    }
    if (input.jumpPressed && this.tab !== 'match') {
      this.tab = 'match';
      this.render();
      this.root.querySelector<HTMLButtonElement>('#menu-tab-match')?.focus();
      this.cooldown = 0.22;
    }
  }

  hide(): void {
    if (this.root) this.root.hidden = true;
  }

  /** Hide now; the next menu draw refreshes local unlocks and shows the lobby. */
  reset(): void {
    this.ready = null;
    this.cooldown = 0.3;
    this.profile = loadProgression();
    this.hide();
    if (this.root) this.render();
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, gamepad: boolean, portrait?: Sheet): void {
    this.drawBackdrop(ctx, width, height);
    const assetsChanged = this.portrait !== portrait;
    if (assetsChanged) this.previewsDirty = true;
    this.portrait = portrait;
    if (assetsChanged && this.root) this.render();
    this.gamepad = gamepad;
    this.mount();
    if (this.root?.hidden) {
      this.profile = loadProgression();
      this.render();
      this.root.hidden = false;
    }
    this.drawPreviews();
  }

  private mount(): void {
    if (this.root || typeof document === 'undefined') return;
    this.root = document.createElement('section');
    this.root.id = 'match-menu';
    this.root.className = 'sv-menu';
    this.root.setAttribute('aria-label', 'Prepara la partita');
    this.root.lang = 'it';
    this.root.addEventListener('change', event => this.change(event));
    this.root.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      if (!button) return;
      if (button.dataset.tab) {
        this.tab = button.dataset.tab as MenuTab;
        this.render();
      } else if (button.id === 'menu-start') this.confirm();
    });
    this.root.addEventListener('keydown', event => {
      const target = event.target;
      // Arrow selection is handled here as well as by the controller. This
      // avoids the platform popup consuming a key without committing a value.
      // Touch/click and Alt+Down still open the native option picker.
      if (target instanceof HTMLSelectElement) {
        if (!event.altKey && ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
          event.preventDefault();
          this.adjustFocused(event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1);
        }
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.moveFocus(1);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        this.moveFocus(-1);
      }
    });
    document.body.append(this.root);
    this.render();
  }

  private controls(): (HTMLSelectElement | HTMLButtonElement)[] {
    return [...(this.root?.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('[data-menu-control]:not(:disabled)') ?? [])];
  }

  private focusedControl(): HTMLSelectElement | HTMLButtonElement | undefined {
    const controls = this.controls();
    return controls.find(control => control === document.activeElement) ?? controls[0];
  }

  private moveFocus(delta: number): void {
    const controls = this.controls();
    if (!controls.length) return;
    const current = controls.indexOf(document.activeElement as HTMLButtonElement);
    const index = current < 0 ? (delta > 0 ? 0 : controls.length - 1) : (current + delta + controls.length) % controls.length;
    const next = controls[index];
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  }

  private adjustFocused(delta: number): void {
    const focused = this.focusedControl();
    if (!(focused instanceof HTMLSelectElement)) {
      this.moveFocus(delta);
      return;
    }
    const options = [...focused.options].filter(option => !option.disabled);
    const current = options.findIndex(option => option.value === focused.value);
    focused.value = options[(current + delta + options.length) % options.length].value;
    focused.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private baseTeam(side: 'home' | 'away'): TeamConfig {
    return (NATIONAL_TEAMS.find(entry => entry.id === (side === 'home' ? this.homeId : this.awayId)) ?? NATIONAL_TEAMS[0]).team;
  }

  private selectedTeam(side: 'home' | 'away'): TeamConfig {
    return configureTeam(this.baseTeam(side), {
      kitId: side === 'home' ? this.homeKitId : this.awayKitId,
      skillId: SKILLS.find(skill => skill.id === (side === 'home' ? this.homeSkillId : this.awaySkillId))?.id,
    });
  }

  private validateSelections(): void {
    const unlocked = NATIONAL_TEAMS.filter(entry => isUnlocked(entry.unlock, this.profile));
    if (!unlocked.some(entry => entry.id === this.homeId)) this.homeId = unlocked[0].id;
    if (!unlocked.some(entry => entry.id === this.awayId) || this.awayId === this.homeId) {
      this.awayId = (unlocked.find(entry => entry.id !== this.homeId) ?? unlocked[0]).id;
    }
    for (const side of ['home', 'away'] as const) {
      const id = side === 'home' ? this.homeId : this.awayId;
      const kitKey = side === 'home' ? 'homeKitId' : 'awayKitId';
      const skillKey = side === 'home' ? 'homeSkillId' : 'awaySkillId';
      const kits = availableKits(id, this.profile);
      if (!kits.some(kit => kit.id === this[kitKey])) this[kitKey] = kits[0]?.id ?? 'national';
      const skill = SKILLS.find(item => item.id === this[skillKey]);
      if (!skill || !isUnlocked(skill.unlock, this.profile)) {
        this[skillKey] = SKILLS.find(item => isUnlocked(item.unlock, this.profile))?.id ?? '';
      }
    }
    if (!BALL_STYLES.some(item => item.id === this.ballId && isUnlocked(item.unlock, this.profile))) this.ballId = 'classic';
    if (!COURT_STYLES.some(item => item.id === this.courtId && isUnlocked(item.unlock, this.profile))) this.courtId = 'maple';
  }

  private change(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    const value = select.value;
    switch (select.id) {
      case 'menu-mode': this.mode = value as MatchMode; break;
      case 'menu-difficulty': this.difficulty = Number(value); break;
      case 'menu-length': this.format = { ...this.format, bestOf: Number(value) as 3 | 5 }; break;
      case 'menu-scoring': this.format = { ...this.format, scoring: value as MatchFormat['scoring'] }; break;
      case 'menu-home':
        if (value === this.awayId) this.awayId = this.homeId;
        this.homeId = value;
        break;
      case 'menu-away':
        if (value === this.homeId) this.homeId = this.awayId;
        this.awayId = value;
        break;
      case 'menu-home-kit': this.homeKitId = value; break;
      case 'menu-away-kit': this.awayKitId = value; break;
      case 'menu-home-skill': this.homeSkillId = value; break;
      case 'menu-away-skill': this.awaySkillId = value; break;
      case 'menu-ball': this.ballId = value; break;
      case 'menu-court': this.courtId = value; break;
    }
    this.render();
  }

  private confirm(): void {
    if (!this.portrait) return;
    this.validateSelections();
    this.ready = {
      home: this.selectedTeam('home'),
      away: this.selectedTeam('away'),
      difficulty: this.difficulty,
      seed: (Date.now() & 0x7fffffff) >>> 0,
      mode: this.mode,
      humanControlsAway: this.mode === 'versus',
      format: { ...this.format },
      ballId: this.ballId,
      courtId: this.courtId,
    };
    this.hide();
  }

  private render(): void {
    if (!this.root) return;
    this.validateSelections();
    const focusId = this.root.contains(document.activeElement) ? document.activeElement?.id : undefined;
    const scrollTop = this.root.scrollTop;
    const tabs: [MenuTab, string][] = [['match', 'Partita'], ['teams', 'Squadre e skills'], ['collection', 'Collezione']];
    this.root.innerHTML = `
      <div class="sv-menu-shell">
        <header class="sv-menu-header">
          <div><p class="sv-kicker">ARCADE EVOLVED // ENTRA IN CAMPO</p><h1>SUPER VOLLEY <span>90</span></h1></div>
          <div class="sv-profile" aria-label="Progressi salvati su questo dispositivo"><strong>${this.profile.xp} XP</strong><span>${this.profile.matchesPlayed} partite · ${this.profile.wins} vittorie</span></div>
        </header>
        <nav class="sv-menu-tabs" aria-label="Preparazione partita">${tabs.map(([id, label]) => `<button type="button" id="menu-tab-${id}" data-tab="${id}" data-menu-control aria-current="${this.tab === id ? 'page' : 'false'}">${label}</button>`).join('')}</nav>
        <div class="sv-menu-content">${this.tab === 'match' ? this.matchPanel() : this.tab === 'teams' ? this.teamsPanel() : this.collectionPanel()}</div>
        <footer class="sv-menu-footer">
          <div><strong>${escapeHtml(this.baseTeam('home').shortName)} <span>VS</span> ${escapeHtml(this.baseTeam('away').shortName)}</strong><p>${matchFormatLabel(this.format)} · 2 punti di vantaggio</p></div>
          <button type="button" id="menu-start" data-menu-control class="sv-start"${this.portrait ? '' : ' disabled aria-busy="true"'}>${!this.portrait ? 'CARICAMENTO ATLETI…' : this.mode === 'demo' ? 'GUARDA LA PARTITA' : this.mode === 'versus' ? 'SFIDA 1 VS 1' : 'SCENDI IN CAMPO'} <span aria-hidden="true">▶</span></button>
        </footer>
        <div class="sv-menu-footnote"><span>${this.gamepad ? 'Controller: ↑↓ naviga · ←→ cambia · A conferma · B torna' : 'Tocca o clicca per scegliere · Tab naviga · Frecce cambiano · Invio conferma'}</span><span>${escapeHtml(buildStamp())}</span></div>
      </div>`;
    this.previewsDirty = true;
    if (focusId) this.root.querySelector<HTMLElement>(`#${focusId}`)?.focus({ preventScroll: true });
    this.root.scrollTop = scrollTop;
  }

  private matchPanel(): string {
    const scoreHelp = this.format.scoring === 'sideout15'
      ? 'Tutti i set a 15. Il punto vale solo quando servi: vincendo in ricezione conquisti la battuta.'
      : this.format.scoring === 'rally15'
        ? 'Tutti i set a 15. Ogni scambio assegna un punto, come nel tie-break.'
        : `Set a 25. Il ${this.format.bestOf === 3 ? 'terzo' : 'quinto'} set decisivo si gioca a 15. Ogni scambio assegna un punto.`;
    return `<div class="sv-match-grid"><section class="sv-panel"><p class="sv-kicker">LA TUA SFIDA</p><h2>Come vuoi giocare?</h2>
      <div class="sv-form-grid">
        ${field('menu-mode', 'Modalità', [['solo', 'Singolo · CPU'], ['versus', '1 vs 1 · Locale'], ['demo', 'Demo · CPU']], this.mode)}
        ${field('menu-difficulty', 'Livello CPU', [['0', 'Rookie · Facile'], ['1', 'Arcade · Normale'], ['2', 'Pro · Difficile']], String(this.difficulty))}
        ${field('menu-length', 'Set per vincere', [['3', '2 su 3'], ['5', '3 su 5']], String(this.format.bestOf))}
        ${field('menu-scoring', 'Punteggio', [['sideout15', '15 · Cambio palla'], ['rally25', '25 · Rally point'], ['rally15', '15 · Tie-break']], this.format.scoring)}
      </div><p class="sv-rule-note">${scoreHelp} Servono sempre 2 punti di vantaggio.</p>
      <div class="sv-control-note"><strong>${this.mode === 'versus' ? 'DUE GIOCATORI, UNA RIVALITÀ' : this.mode === 'demo' ? 'OSSERVA LE TATTICHE' : 'DUE TASTI, TUTTA LA PALLAVOLO'}</strong><p>${this.controlInstructions()}</p></div>
      </section><section class="sv-panel sv-matchup"><p class="sv-kicker">LE NAZIONALI</p><h2>Scegli chi portare in campo</h2>${this.teamSelect('home')}${this.teamSelect('away')}<p class="sv-muted">Divise alternative e abilità in <strong>Squadre e skills</strong>. Sblocca altre nazionali giocando partite complete.</p></section></div>`;
  }

  private controlInstructions(): string {
    if (this.mode === 'demo') return 'Entrambe le squadre giocano da sole. Prova i formati e osserva combinazioni, skills e attacchi. La demo non assegna progressi.';
    if (this.mode === 'versus') return 'P1: WASD + F colpisci / G salta. P2: frecce + K colpisci / L salta. Puoi usare due controller, oppure un controller e la tastiera. Controller: A/X colpisci, B/Y salta, Start pausa.';
    return 'Frecce o WASD per muoverti. Spazio/J colpisce, Shift/K salta. Controller: A/X colpisce, B/Y salta, Start pausa. Su smartphone compaiono i comandi touch in partita. Colpisci sul rosso per il bonus!';
  }

  private teamSelect(side: 'home' | 'away'): string {
    const team = this.selectedTeam(side);
    const label = side === 'home' ? (this.mode === 'demo' ? 'Squadra di casa' : 'Giocatore 1') : this.mode === 'versus' ? 'Giocatore 2' : 'Avversario';
    const options = NATIONAL_TEAMS.map(entry => this.option(entry.id, `${entry.team.shortName} · ${entry.team.name}`, entry.unlock));
    return `<div class="sv-team-mini" style="--team-color:${escapeHtml(team.colors[0])}"><div class="sv-team-badge" aria-hidden="true">${escapeHtml(team.shortName)}</div>${field(`menu-${side}`, label, options, side === 'home' ? this.homeId : this.awayId)}</div>`;
  }

  private teamsPanel(): string {
    return `<div class="sv-teams-grid">${(['home', 'away'] as const).map(side => {
      const id = side === 'home' ? this.homeId : this.awayId;
      const kitId = side === 'home' ? this.homeKitId : this.awayKitId;
      const skillId = side === 'home' ? this.homeSkillId : this.awaySkillId;
      const skill = SKILLS.find(item => item.id === skillId);
      const kit = availableKits(id).find(item => item.id === kitId);
      return `<section class="sv-panel">${this.teamSelect(side)}<canvas id="menu-preview-${side}" class="sv-team-preview" width="380" height="246" aria-label="Anteprima divisa ${escapeHtml(this.baseTeam(side).name)}"></canvas>
        ${field(`menu-${side}-kit`, 'Divisa', availableKits(id).map(item => this.option(item.id, item.name, item.unlock)), kitId)}<p class="sv-item-detail">${escapeHtml(kit?.description ?? 'I colori della tua nazionale.')}</p>
        ${field(`menu-${side}-skill`, 'Skill della squadra', SKILLS.map(item => this.option(item.id, item.name, item.unlock)), skillId)}
        <div class="sv-skill-detail"><strong>${escapeHtml(skill?.name ?? '')}</strong><p>${escapeHtml(skill?.description ?? '')}</p><span>Energia ${skill?.cost ?? 0} · Recupero ${skill?.cooldown ?? 0} s</span></div>
      </section>`;
    }).join('')}</div><p class="sv-rule-note sv-skill-note">Le skills hanno effetti sul gioco. La skill scelta si attiva sull’azione adatta quando la barra energia è pronta; si ricarica giocando. Puoi scegliere la stessa skill per una sfida alla pari.</p>`;
  }

  private collectionPanel(): string {
    const groups = [
      ['Nazionali', NATIONAL_TEAMS.map(item => ({ name: `${item.team.shortName} · ${item.team.name}`, unlock: item.unlock, color: item.team.colors[0] }))],
      ['Divise e classiche', TEAM_KITS.map(item => ({ name: item.name, unlock: item.unlock, color: item.colors[0] }))],
      ['Skills', SKILLS.map(item => ({ name: item.name, unlock: item.unlock, color: '#49dcff' }))],
      ['Palloni', BALL_STYLES.map(item => ({ name: item.name, unlock: item.unlock, color: item.colors[0] }))],
      ['Parquet', COURT_STYLES.map(item => ({ name: item.name, unlock: item.unlock, color: item.woodTint ?? '#c39261' }))],
    ] as const;
    return `<section class="sv-panel sv-collection-intro"><div><p class="sv-kicker">GIOCA. CRESCI. SBLOCCA.</p><h2>La tua collezione</h2><p class="sv-muted">I progressi si salvano su questo dispositivo dopo le partite. ${this.profile.pointsWon} punti vinti · ${this.profile.skillUses} skills usate.</p></div><div class="sv-form-grid">${field('menu-ball', 'Pallone', BALL_STYLES.map(item => this.option(item.id, item.name, item.unlock)), this.ballId)}${field('menu-court', 'Parquet', COURT_STYLES.map(item => this.option(item.id, item.name, item.unlock)), this.courtId)}</div></section>
      <div class="sv-unlock-groups">${groups.map(([title, items]) => `<section><h3>${title}</h3><div class="sv-unlock-grid">${items.map(item => {
        const unlocked = isUnlocked(item.unlock, this.profile);
        return `<article class="sv-unlock ${unlocked ? 'is-unlocked' : 'is-locked'}"><span class="sv-unlock-swatch" style="--item-color:${escapeHtml(item.color)}" aria-hidden="true"></span><div><strong>${escapeHtml(item.name)}</strong><span>${unlocked ? 'Disponibile' : escapeHtml(unlockLabel(item.unlock))}</span></div><b aria-label="${unlocked ? 'Sbloccato' : 'Da sbloccare'}">${unlocked ? '✓' : '◇'}</b></article>`;
      }).join('')}</div></section>`).join('')}</div>`;
  }

  private option(id: string, name: string, unlock: Unlock): [string, string, boolean] {
    const unlocked = isUnlocked(unlock, this.profile);
    return [id, unlocked ? name : `${name} · ${unlockLabel(unlock)}`, !unlocked];
  }

  private drawPreviews(): void {
    if (!this.previewsDirty || !this.root || this.tab !== 'teams') return;
    for (const side of ['home', 'away'] as const) {
      const canvas = this.root.querySelector<HTMLCanvasElement>(`#menu-preview-${side}`);
      const context = canvas?.getContext('2d');
      if (!canvas || !context) continue;
      context.clearRect(0, 0, canvas.width, canvas.height);
      this.drawTeamCard(context, this.selectedTeam(side), 12, 10, 356, 226, side === 'home' ? 'SQUADRA 1' : 'SQUADRA 2', false, side === 'away');
    }
    this.previewsDirty = false;
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#02050d');
    bg.addColorStop(0.48, '#0a1530');
    bg.addColorStop(1, '#030610');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Arena-tunnel vanishing geometry.
    const cx = width / 2;
    const horizon = height * 0.42;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = -8; i <= 8; i++) {
      const endX = cx + i * width * 0.12;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(73,220,255,0.085)' : 'rgba(255,95,90,0.055)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, horizon);
      ctx.lineTo(endX, height);
      ctx.stroke();
    }
    for (let y = horizon; y < height; y += Math.max(28, (y - horizon) * 0.17)) {
      ctx.strokeStyle = 'rgba(98,156,224,0.075)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    // Moving light columns and centre glow.
    for (let i = 0; i < 5; i++) {
      const x = (width * (i + 0.5)) / 5 + Math.sin(this.blink * 0.35 + i) * 12;
      const beam = ctx.createLinearGradient(x - 100, 0, x + 100, 0);
      beam.addColorStop(0, 'rgba(73,220,255,0)');
      beam.addColorStop(0.5, i % 2 ? 'rgba(255,211,92,0.045)' : 'rgba(73,220,255,0.055)');
      beam.addColorStop(1, 'rgba(73,220,255,0)');
      ctx.fillStyle = beam;
      ctx.fillRect(x - 100, 0, 200, height);
    }
    const glow = ctx.createRadialGradient(cx, horizon, 8, cx, horizon, width * 0.42);
    glow.addColorStop(0, 'rgba(58,142,255,0.16)');
    glow.addColorStop(0.5, 'rgba(41,87,164,0.06)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Fine scanlines keep the coin-op heritage without pixelating the UI.
    ctx.fillStyle = 'rgba(0,0,0,0.09)';
    for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1);
  }

  private drawTeamCard(
    ctx: CanvasRenderingContext2D,
    team: TeamConfig,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    selected: boolean,
    mirrored: boolean,
  ): void {
    const cut = 18;
    ctx.save();
    ctx.shadowColor = selected ? team.colors[0] : 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = selected ? 22 + Math.sin(this.blink * 8) * 4 : 14;
    ctx.shadowOffsetY = 8;
    cutPanel(ctx, x, y, w, h, cut);
    const bg = ctx.createLinearGradient(x, y, x + w, y + h);
    bg.addColorStop(0, 'rgba(18,29,52,0.97)');
    bg.addColorStop(0.58, 'rgba(8,14,31,0.96)');
    bg.addColorStop(1, 'rgba(3,7,17,0.99)');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = selected ? team.colors[0] : 'rgba(130,166,215,0.25)';
    ctx.lineWidth = selected ? 2.4 : 1.2;
    ctx.stroke();

    // Team-colour diagonal field.
    ctx.save();
    cutPanel(ctx, x, y, w, h, cut);
    ctx.clip();
    const wash = ctx.createLinearGradient(mirrored ? x + w : x, y, mirrored ? x : x + w, y + h);
    wash.addColorStop(0, withAlpha(team.colors[0], 0.36));
    wash.addColorStop(0.48, withAlpha(team.colors[1], 0.09));
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = team.colors[0];
    for (let i = -2; i < 7; i++) {
      const sx = x + i * 74 + (mirrored ? 18 : 0);
      ctx.beginPath();
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + 32, y + h);
      ctx.lineTo(sx + 138, y);
      ctx.lineTo(sx + 106, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.textBaseline = 'middle';
    ctx.textAlign = mirrored ? 'right' : 'left';
    const tx = mirrored ? x + w - 24 : x + 24;
    ctx.font = '900 10px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = selected ? GOLD : MUTED;
    ctx.fillText(`${label}  //  PRONTA`, tx, y + 22);

    ctx.font = `950 ${Math.min(56, h * 0.25)}px "Arial Black", "Inter", system-ui, sans-serif`;
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#050914';
    ctx.strokeText(team.shortName, tx, y + 67);
    ctx.fillStyle = TEXT;
    ctx.fillText(team.shortName, tx, y + 67);
    ctx.font = '900 16px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = team.colors[0];
    ctx.fillText(team.name.toUpperCase(), tx, y + 100);

    // The same authored manga characters used on court, never schematic people.
    const formationX = mirrored ? x + 58 : x + w - 126;
    const formationY = y + 92;
    this.drawFormation(ctx, formationX, formationY, team.colors, mirrored, h > 205 ? 1 : 0.84);

    // Rating rail and roster summary.
    const railX = mirrored ? x + w - 184 : x + 24;
    const railY = y + h - 48;
    const railW = 160;
    ctx.textAlign = mirrored ? 'right' : 'left';
    ctx.font = '800 9px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText(`VALORE SQUADRA  ${Math.round(team.rating * 100)}`, mirrored ? railX + railW : railX, railY - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(railX, railY, railW, 8);
    const ratingW = railW * team.rating;
    ctx.fillStyle = team.colors[0];
    ctx.fillRect(mirrored ? railX + railW - ratingW : railX, railY, ratingW, 8);
    ctx.fillStyle = team.colors[1];
    ctx.fillRect(mirrored ? railX : railX + railW - 5, railY, 5, 8);

    const names = (team.players ?? []).slice(0, 3).map((p) => p.name.toUpperCase()).join('  ·  ');
    ctx.textAlign = mirrored ? 'right' : 'left';
    ctx.fillStyle = 'rgba(218,229,248,0.43)';
    ctx.font = '700 8px "Arial Narrow", "Inter", system-ui, sans-serif';
    ctx.fillText(names, mirrored ? x + w - 24 : x + 24, y + h - 19);

    if (selected) {
      const arrowY = y + h / 2;
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      if (mirrored) {
        ctx.moveTo(x + w + 17, arrowY);
        ctx.lineTo(x + w + 31, arrowY - 11);
        ctx.lineTo(x + w + 31, arrowY + 11);
      } else {
        ctx.moveTo(x - 17, arrowY);
        ctx.lineTo(x - 31, arrowY - 11);
        ctx.lineTo(x - 31, arrowY + 11);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFormation(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    colors: [string, string],
    mirrored: boolean,
    scale: number,
  ): void {
    if (!this.portrait) return;
    const poses = [
      [-42, 28, 0.88],
      [0, 18, 1],
      [42, 28, 0.9],
      [-31, -22, 0.78],
      [9, -32, 0.86],
      [47, -18, 0.8],
    ] as const;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(mirrored ? -scale : scale, scale);
    poses.forEach(([px, py, k], i) => {
      const primary = i === 2 ? colors[1] : colors[0];
      ctx.globalAlpha = 0.56 + i * 0.045;
      drawFrame(ctx, this.portrait!, i * 4, px, py + 16 * k, 46 * k, 1,
        { primary, secondary: colors[1] });
    });
    ctx.restore();
  }

}

function cutPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function field(id: string, label: string, options: readonly (readonly [string, string, boolean?])[], value: string): string {
  return `<label class="sv-field" for="${id}"><span>${escapeHtml(label)}</span><select id="${id}" aria-label="${escapeHtml(label)}" data-menu-control>${options.map(([id, text, disabled]) => `<option value="${escapeHtml(id)}"${id === value ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(text)}</option>`).join('')}</select></label>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
