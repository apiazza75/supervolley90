import { describe, expect, it } from 'vitest';
import {
  addSkillCharge, createSkillState, peekSkill, SKILLS, skillById, tickSkill, useSkill,
} from '../src/core/skills';
import { Team } from '../src/core/team';
import { Rng } from '../src/core/rng';
import { configureTeam, TEAMS } from '../src/game/teams';
import { createProgression, isUnlocked } from '../src/game/progression';
import { Ball } from '../src/core/ball';
import {
  aimToTarget, canReach, contactPoint, contactRadius, contactWindow,
  performAttack, performBlock, performBump, performSet, type StrikeContext,
} from '../src/core/contact';
import { distXY, v3 } from '../src/core/math3';
import { attackDir, type Side } from '../src/core/rules';

describe('special skill charge and cooldown', () => {
  it('cannot be charged by waiting or by repeatedly checking whether a contact is reachable', () => {
    const state = createSkillState();
    for (let frame = 0; frame < 1200; frame++) {
      tickSkill(state, 1 / 120);
      expect(peekSkill(state, 'ironwall', 'block')).toBeNull();
    }
    expect(state.charge).toBe(25);
    addSkillCharge(state, 20);
    const before = { ...state };
    for (let check = 0; check < 12; check++) expect(peekSkill(state, 'ironwall', 'block')?.effects.reachMultiplier).toBe(1.18);
    expect(state).toEqual(before);
  });

  it.each(SKILLS.map(skill => [skill.id, skill.action] as const))('spends %s energy once on the matching contact and enforces its cooldown', (id, action) => {
    const definition = skillById(id)!, state = createSkillState();
    addSkillCharge(state, 100);
    const activation = useSkill(state, id, action);
    expect(activation?.id).toBe(id);
    expect(activation?.effects).toEqual(definition.effects);
    expect(state.charge).toBe(100 - definition.cost);
    expect(state.activations).toBe(1);
    expect(state.cooldown).toBe(definition.cooldown);
    addSkillCharge(state, 100);
    expect(useSkill(state, id, action)).toBeNull();
    tickSkill(state, definition.cooldown - 0.1);
    expect(useSkill(state, id, action)).toBeNull();
    tickSkill(state, 0.2);
    expect(useSkill(state, id, action)?.id).toBe(id);
    expect(state.activations).toBe(2);
  });

  it('does not spend a skill on the wrong action, an unknown loadout or a disabled loadout', () => {
    const state = createSkillState();
    addSkillCharge(state, 100);
    const before = { ...state };
    expect(useSkill(state, 'meteor', 'set')).toBeNull();
    expect(useSkill(state, 'unknown', 'attack')).toBeNull();
    expect(useSkill(state, undefined, 'attack')).toBeNull();
    expect(state).toEqual(before);
  });

  it('clamps earned energy and ignores invalid deltas', () => {
    const state = createSkillState();
    addSkillCharge(state, -100);
    addSkillCharge(state, Number.NaN);
    addSkillCharge(state, Number.POSITIVE_INFINITY);
    expect(state.charge).toBe(25);
    addSkillCharge(state, 500);
    expect(state.charge).toBe(100);
    useSkill(state, 'meteor', 'attack');
    const cooldown = state.cooldown;
    tickSkill(state, -1);
    tickSkill(state, Number.POSITIVE_INFINITY);
    expect(state.cooldown).toBe(cooldown);
    tickSkill(state, 1000);
    expect(state.cooldown).toBe(0);
  });
});

describe('tactical skill balance and team isolation', () => {
  it('offers all four tactical jobs from the start and makes every skill mechanically distinct', () => {
    const starter = SKILLS.filter(skill => isUnlocked(skill.unlock, createProgression()));
    expect(starter).toHaveLength(4);
    expect(new Set(starter.map(skill => skill.action))).toEqual(new Set(['attack', 'block', 'set', 'defense']));
    expect(new Set(SKILLS.map(skill => JSON.stringify(skill.effects))).size).toBe(SKILLS.length);
    for (const skill of SKILLS) {
      expect(skill.cost).toBeGreaterThan(25);
      expect(skill.cooldown).toBeGreaterThanOrEqual(10);
      expect(Object.values(skill.effects).every(Number.isFinite)).toBe(true);
      expect(skill.effects.powerMultiplier).toBeLessThanOrEqual(1.14);
      expect(skill.effects.reachMultiplier).toBeLessThanOrEqual(1.18);
      expect(skill.effects.errorMultiplier).toBeGreaterThanOrEqual(0.5);
    }
    expect(skillById('sniper')!.effects.powerMultiplier).toBe(1);
    expect(skillById('sniper')!.effects.errorMultiplier).toBeLessThan(skillById('meteor')!.effects.errorMultiplier);
    expect(skillById('comet')!.effects.errorMultiplier).toBeGreaterThan(skillById('maestro')!.effects.errorMultiplier);
  });

  it('keeps legacy teams unchanged and gives both local players independent resources', () => {
    const legacy = new Team('home', TEAMS[0], new Rng(1), 0);
    legacy.addSkillCharge(100);
    expect(legacy.useSkill('attack')).toBeNull();
    const home = new Team('home', configureTeam(TEAMS[0], { skillId: 'meteor' }), new Rng(1), 0);
    const away = new Team('away', configureTeam(TEAMS[0], { skillId: 'meteor' }), new Rng(2), 100);
    home.addSkillCharge(100);
    away.addSkillCharge(100);
    expect(home.useSkill('attack')?.id).toBe('meteor');
    expect(home.skillState.charge).toBe(50);
    expect(away.skillState.charge).toBe(100);
    expect(away.skillState.cooldown).toBe(0);
    expect(away.useSkill('attack')?.id).toBe('meteor');
  });
});

/** Matching seeds and identical poses isolate a real ball-flight effect from art or RNG. */
function strikeContext(side: Side, skillId?: Parameters<typeof skillById>[0]): StrikeContext {
  const team = new Team(side, TEAMS[0], new Rng(17), side === 'home' ? 0 : 100);
  const player = team.players.find(candidate => candidate.role === 'opposite')!;
  const dir = attackDir(side);
  player.pos = v3(0, -dir * 2, 0);
  player.height = 1.1;
  const ball = new Ball();
  ball.pos = v3(0.08, -dir * 2, 3.65);
  ball.vel = v3(0, 0, -2);
  return {
    player, ball, aim: { x: 0.15, depth: 0.1 }, rng: new Rng(902), charge: 0,
    modifiers: skillById(skillId)?.effects,
  };
}

describe('catalog skills change real contacts', () => {
  it.each(['home', 'away'] as const)('Meteora changes actual %s spike velocity at the same aim and timing', side => {
    const regular = strikeContext(side), skilled = strikeContext(side, 'meteor');
    const base = performAttack(regular), boosted = performAttack(skilled);
    expect(base.kind).toBe('spike');
    expect(boosted.kind).toBe('spike');
    expect(boosted.speed / base.speed).toBeCloseTo(1.14);
    expect(boosted.target).toEqual(base.target);
    expect(Math.hypot(skilled.ball.vel.x, skilled.ball.vel.y, skilled.ball.vel.z))
      .toBeGreaterThan(Math.hypot(regular.ball.vel.x, regular.ball.vel.y, regular.ball.vel.z));
  });

  it.each(['home', 'away'] as const)('Ago improves actual %s attack placement without stacking extra power', side => {
    const regular = strikeContext(side), skilled = strikeContext(side, 'sniper');
    const intended = aimToTarget(side, regular.aim);
    const base = performAttack(regular), precise = performAttack(skilled);
    expect(precise.speed).toBeCloseTo(base.speed);
    expect(distXY(precise.target, intended)).toBeLessThan(distXY(base.target, intended) * .5);
  });

  it.each(['home', 'away'] as const)('Regista improves actual %s set placement', side => {
    const regular = strikeContext(side), skilled = strikeContext(side, 'maestro');
    const intended = v3(2.7, -attackDir(side) * 1.6, 3.4);
    for (const ctx of [regular, skilled]) { ctx.attackerTarget = intended; ctx.setPlay = 'high'; }
    const base = performSet(regular), precise = performSet(skilled);
    expect(distXY(precise.target, intended)).toBeLessThan(distXY(base.target, intended) * .6);
    expect(intended).toEqual(v3(2.7, -attackDir(side) * 1.6, 3.4));
  });

  it.each(['home', 'away'] as const)('Cometa makes the actual %s set arrive sooner, not later', side => {
    const regular = strikeContext(side), skilled = strikeContext(side, 'comet');
    const intended = v3(2.7, -attackDir(side) * 1.6, 3.4);
    for (const ctx of [regular, skilled]) {
      ctx.attackerTarget = intended;
      ctx.setPlay = 'high';
      ctx.errorScale = 0;
    }
    const from = contactPoint(regular.player, regular.ball);
    const base = performSet(regular), faster = performSet(skilled);
    const baseFlight = (base.target.x - from.x) / regular.ball.vel.x;
    const skillFlight = (faster.target.x - from.x) / skilled.ball.vel.x;
    expect(faster.target).toEqual(base.target);
    expect(skillFlight).toBeLessThan(baseFlight);
    expect(baseFlight / skillFlight).toBeCloseTo(1.12);
  });

  it.each(['home', 'away'] as const)('Salvataggio improves %s reception placement and saves a ball outside ordinary reach', side => {
    const regular = strikeContext(side), skilled = strikeContext(side, 'guardian');
    const intended = v3(0.9, -attackDir(side) * 1.6, 2.9);
    for (const ctx of [regular, skilled]) {
      ctx.player.height = 0;
      ctx.player.pos.y = -attackDir(side) * 6;
      ctx.ball.pos = v3(0.08, ctx.player.pos.y, 1.2);
      ctx.ball.vel = v3(0, -attackDir(side) * 18, -3);
      ctx.setterTarget = intended;
    }
    const base = performBump(regular), saved = performBump(skilled);
    expect(distXY(saved.target, intended)).toBeLessThan(distXY(base.target, intended));
    expect(distXY(saved.target, intended) / distXY(base.target, intended)).toBeCloseTo(.7);
    const reach = strikeContext(side, 'guardian');
    reach.ball.pos.x = reach.player.pos.x + contactRadius(reach.player, reach.ball) * 1.08;
    expect(canReach(reach.player, reach.ball)).toBe(false);
    expect(canReach(reach.player, reach.ball, skillById('guardian')!.effects.reachMultiplier)).toBe(true);
  });

  it.each(['home', 'away'] as const)('Muro d’acciaio changes a %s deflection into a controlled stuff block and covers more net', side => {
    const regular = strikeContext(side), skilled = strikeContext(side, 'ironwall');
    for (const ctx of [regular, skilled]) {
      ctx.player.pos.y = -attackDir(side) * .65;
      ctx.player.setAnim('block');
      ctx.ball.pos = v3(0, ctx.player.pos.y, contactWindow(ctx.player).hi);
      ctx.ball.vel = v3(0, -attackDir(side) * 18, -2);
      ctx.ball.pos.x = contactRadius(ctx.player, ctx.ball) * .83;
    }
    const base = performBlock(regular), stuffed = performBlock(skilled);
    expect(base.target.y * attackDir(side)).toBeLessThan(0);
    expect(stuffed.target.y * attackDir(side)).toBeGreaterThan(0);
    const reach = strikeContext(side, 'ironwall');
    reach.player.pos.y = -attackDir(side) * .65;
    reach.player.setAnim('block');
    reach.ball.pos.y = reach.player.pos.y;
    reach.ball.pos.x = contactRadius(reach.player, reach.ball) * 1.09;
    expect(canReach(reach.player, reach.ball)).toBe(false);
    expect(canReach(reach.player, reach.ball, skillById('ironwall')!.effects.reachMultiplier)).toBe(true);
  });
});
