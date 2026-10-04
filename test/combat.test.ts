import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestExpectedInjury,
  CombatError,
  isAttackAction,
  combatantFromCharacter,
  createCombat,
  createDiceManager,
  runToCompletion,
  seededSource,
  type Combatant,
  type TurnAction,
} from '../src/index.js';
import { FENRIR, FIXED_TIME, fenrir, hp, loadExample, newCombat, play, RURIK, rurik, scripted } from './fixtures.js';

// Fenrir (Speed 6.5) acts before Rurik (Speed 6). See `fighter()` in fixtures.ts for their stats.
const fenrirPunchesRurik: TurnAction = { maneuver: 'attack', attackId: 'punch', targetId: RURIK };
const rurikAxesFenrir = (maneuver: 'attack' | 'all-out-attack'): TurnAction => ({ maneuver, attackId: 'Machado#1', targetId: FENRIR });
const pass: TurnAction = { maneuver: 'do-nothing' };

test('a new combat starts at round 1 with the faster fighter up and everyone at full HP', () => {
  const view = newCombat(scripted()).view();
  assert.equal(view.status, 'in-progress');
  assert.equal(view.round, 1);
  assert.equal(view.currentId, FENRIR);
  assert.deepEqual(view.fighters.map((f) => f.id), [FENRIR, RURIK]);
  assert.deepEqual(view.fighters.map((f) => f.hp), [{ current: 24, max: 24 }, { current: 15, max: 15 }]);
  assert.deepEqual(view.fighters.map((f) => [f.dodge, f.dr]), [[12, 0], [9, 4]]);
  assert.ok(view.fighters.every((f) => f.maneuver === 'do-nothing' && !f.defeated));
});

test('a hit: attack roll, failed dodge, then damage reduced by DR (p.369, p.374, p.378)', () => {
  // Fenrir's attack 3+3+3=9 vs 14: hits. Rurik's Dodge 9 vs 18: fails. Damage 3+4-2=5, DR 4 -> 1 penetrating, x1 cr -> 1 HP.
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 3, 4));
  const result = play(combat, fenrirPunchesRurik);

  assert.equal(result.attack?.outcome, 'hit');
  assert.equal(result.attack?.attackRoll.roll.total, 9);
  assert.equal(result.attack?.defense?.roll?.effectiveSkill, 9);
  assert.equal(result.attack?.defense?.roll?.success, false);
  assert.equal(result.attack?.damage?.injury.penetrating, 1);
  assert.equal(result.attack?.damage?.injury.injury, 1);
  assert.equal(hp(combat, RURIK), 14);
  // Punching DR 4 armor: 5 basic damage / 5 = 1 HP back at the puncher (p.379).
  assert.equal(result.attack?.selfInjury?.injury, 1);
  assert.equal(hp(combat, FENRIR), 23);
});

test('a successful dodge stops the attack and no damage is rolled', () => {
  const dice = scripted(3, 3, 3, 2, 2, 2); // defense 6 <= 9; no damage faces scripted: rolling them would throw
  const combat = newCombat(dice);
  const result = play(combat, fenrirPunchesRurik);
  assert.equal(result.attack?.outcome, 'defended');
  assert.equal(result.attack?.damage, null);
  assert.equal(result.attack?.selfInjury, null);
  assert.equal(hp(combat, RURIK), 15);
  assert.equal(hp(combat, FENRIR), 24);
});

test('a missed attack costs the target no defense roll', () => {
  const combat = newCombat(scripted(6, 6, 6)); // 18 always misses; only 3 faces scripted
  const result = play(combat, fenrirPunchesRurik);
  assert.equal(result.attack?.outcome, 'miss');
  assert.equal(result.attack?.defense, null);
  assert.equal(hp(combat, RURIK), 15);
});

test('a critical hit can\'t be defended against, even by a fighter who could dodge (p.374)', () => {
  // 1+1+2=4 is a critical hit. Damage 3+3-2=4 is stopped by Rurik's DR 4, so no injury - but no defense roll either.
  const combat = newCombat(scripted(1, 1, 2, 3, 3));
  const result = play(combat, fenrirPunchesRurik);
  assert.equal(result.attack?.criticalHit, true);
  assert.equal(result.attack?.defense, null);
  assert.equal(result.attack?.outcome, 'hit');
  assert.equal(result.attack?.damage?.injury.injury, 0);
  assert.equal(hp(combat, RURIK), 15);
  assert.equal(hp(combat, FENRIR), 24, '4 basic damage / 5 = nothing back');
});

test('Hurting Yourself: only unarmed hits on DR 3+ cost the attacker (p.379)', () => {
  // Rurik's axe hits armored Fenrir: armed, so nothing back. Axe damage 3+3+1=7.
  const armored = [rurik(), { ...fenrir(), dr: 4 }];
  const axe = newCombat(scripted(3, 3, 3, 6, 6, 6, 3, 3), armored);
  play(axe, pass);
  assert.equal(play(axe, rurikAxesFenrir('attack')).attack?.selfInjury, null);
  assert.equal(hp(axe, RURIK), 15);

  // Rurik punches the same armor. His punch is 1d-1, so a 6 is 5 basic damage: 5 / 5 = 1 HP back.
  const punch = newCombat(scripted(3, 3, 3, 6, 6, 6, 6), armored);
  play(punch, pass);
  const result = play(punch, { maneuver: 'attack', attackId: 'punch', targetId: FENRIR });
  assert.equal(result.attack?.damage?.injury.basic, 5);
  assert.equal(result.attack?.selfInjury?.injury, 1);
  assert.equal(hp(punch, RURIK), 14);

  // Unarmored target (DR 0): the rule doesn't apply at all.
  const bare = newCombat(scripted(3, 3, 3, 6, 6, 6, 6));
  play(bare, pass);
  assert.equal(play(bare, { maneuver: 'attack', attackId: 'punch', targetId: FENRIR }).attack?.selfInjury, null);
});

test('self-injury is capped at the target\'s DR and can defeat the puncher', () => {
  // Both at 1 HP. Fenrir hits Rurik for 10 basic (DR 4 -> 6 injury) and is hurt for min(10/5, DR 4) = 2: they fall together.
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 6, 6), [rurik({ damage: 14 }), fenrir({ damage: 23 })]);
  play(combat, fenrirPunchesRurik);
  assert.equal(hp(combat, RURIK), -5);
  assert.equal(hp(combat, FENRIR), -1);
  const view = combat.view();
  assert.equal(view.status, 'finished');
  assert.equal(view.winner, null, 'nobody is left standing');
});

test('All-Out Attack (Determined) gives +4 to hit (p.365)', () => {
  // Rurik's axe is skill 13. A 16 misses a plain Attack but hits at 13+4=17.
  const plain = newCombat(scripted(6, 5, 5));
  play(plain, pass);
  assert.equal(play(plain, rurikAxesFenrir('attack')).attack?.outcome, 'miss');

  // Hit; Fenrir's Dodge 12 vs 18 fails; damage 3+3+1=7, no DR, cut x1.5 = 10.5 -> 10 HP.
  const allOut = newCombat(scripted(6, 5, 5, 6, 6, 6, 3, 3));
  play(allOut, pass);
  const result = play(allOut, rurikAxesFenrir('all-out-attack'));
  assert.equal(result.attack?.attackRoll.effectiveSkill, 17);
  assert.equal(result.attack?.attackRoll.modifier, 4);
  assert.equal(result.attack?.outcome, 'hit');
  assert.equal(result.attack?.damage?.injury.injury, 10);
  assert.equal(hp(allOut, FENRIR), 14);
});

test('someone who made an All-Out Attack has no defense until their next turn (p.365)', () => {
  // Fenrir all-out attacks: Rurik's defense roll fails (18), damage 6+6-2=10, DR 4 -> 6 HP (and 2 back at Fenrir).
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 6, 6, /* Rurik's turn: */ 3, 3, 3, 3, 3));
  play(combat, { ...fenrirPunchesRurik, maneuver: 'all-out-attack' });
  assert.equal(hp(combat, RURIK), 9);
  assert.equal(hp(combat, FENRIR), 22);

  // Rurik's axe hits (9 vs 13) and Fenrir gets no dodge: only attack + damage faces are scripted.
  const result = play(combat, rurikAxesFenrir('attack'));
  assert.equal(result.attack?.defense, null);
  assert.equal(result.attack?.outcome, 'hit');
  assert.equal(hp(combat, FENRIR), 22 - 10, 'damage 3+3+1=7, cut x1.5 -> 10');
});

test('All-Out Defense (Increased Dodge) gives +2 to Dodge (p.366)', () => {
  const combat = newCombat(scripted(3, 3, 3, 4, 4, 4));
  play(combat, { maneuver: 'all-out-defense', increase: 'dodge' });
  const result = play(combat, rurikAxesFenrir('attack'));
  assert.equal(result.attack?.defense?.roll?.effectiveSkill, 14, 'Dodge 12 + 2');
  assert.equal(result.attack?.defense?.roll?.modifier, 2);
  assert.equal(result.attack?.outcome, 'defended');
});

test('a hit that leaves the target at 0 or less defeats them and ends the fight', () => {
  // Rurik starts at 1 HP. Fenrir hits for 6 (damage 6+6-2=10, DR 4).
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 6, 6), [rurik({ damage: 14 }), fenrir()]);
  play(combat, fenrirPunchesRurik);

  const view = combat.view();
  assert.equal(hp(combat, RURIK), -5);
  assert.equal(view.status, 'finished');
  assert.equal(view.winner, 'b');
  assert.equal(view.currentId, null);
  assert.equal(view.fighters.find((f) => f.id === RURIK)?.defeated, true);
  assert.equal(combat.snapshot().state, 'finished');
  assert.deepEqual(combat.legalActions(), []);
  assert.throws(() => combat.takeTurn(pass), CombatError);
});

test('once the fight is over, every request is refused with a CombatError', () => {
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 6, 6), [rurik({ damage: 14 }), fenrir()]);
  const modifier = combat.addModifier(FENRIR, { label: 'early', value: 1 });
  play(combat, fenrirPunchesRurik);
  assert.equal(combat.view().status, 'finished');

  assert.throws(() => combat.addModifier(FENRIR, { label: 'late', value: 1 }), CombatError);
  assert.throws(() => combat.updateModifier(FENRIR, modifier.id, { value: 2 }), CombatError);
  assert.throws(() => combat.removeModifier(FENRIR, modifier.id), CombatError);
});

test('the round counter advances once everyone has acted', () => {
  const combat = newCombat(scripted());
  play(combat, pass);
  assert.deepEqual([combat.view().round, combat.view().currentId], [1, RURIK]);
  play(combat, pass);
  assert.deepEqual([combat.view().round, combat.view().currentId], [2, FENRIR]);
});

test('turns skip defeated fighters', () => {
  // Three fighters; rurik-b is defeated by Fenrir. Then only the first Rurik is left on side a.
  const second = rurik({ id: 'rurik-b', damage: 14 });
  // Order: Fenrir, then the two Ruriks tie (roll-off 5 vs 2): rurik first, rurik-b second.
  const combat = newCombat(scripted(5, 2, 3, 3, 3, 6, 6, 6, 6, 6), [rurik(), second, fenrir()]);
  assert.deepEqual(combat.view().fighters.map((f) => f.id), [FENRIR, RURIK, 'rurik-b']);

  play(combat, { maneuver: 'attack', attackId: 'punch', targetId: 'rurik-b' });
  assert.equal(combat.view().fighters.find((f) => f.id === 'rurik-b')?.defeated, true);
  assert.equal(combat.view().status, 'in-progress');

  play(combat, pass); // rurik
  assert.deepEqual([combat.view().round, combat.view().currentId], [2, FENRIR], 'rurik-b is skipped');
});

test('illegal actions are refused without rolling dice or changing anything', () => {
  const dice = scripted(5, 2); // the roll-off between the two Ruriks
  const combat = newCombat(dice, [rurik(), rurik({ id: 'rurik-2' }), fenrir()]);
  const before = combat.snapshot().history.length;
  play(combat, pass); // Fenrir
  const afterPass = combat.snapshot().history.length;
  assert.equal(afterPass, before + 1);

  const attempts: Array<[TurnAction, RegExp]> = [
    [{ maneuver: 'attack', attackId: 'nope', targetId: FENRIR }, /no attack "nope"/],
    [{ maneuver: 'attack', attackId: 'punch', targetId: 'nobody' }, /Unknown target/],
    [{ maneuver: 'attack', attackId: 'punch', targetId: 'rurik-2' }, /same side/],
    [{ maneuver: 'dance' } as unknown as TurnAction, /Unknown maneuver/],
  ];
  for (const [action, message] of attempts) assert.throws(() => combat.takeTurn(action), message);

  assert.equal(combat.snapshot().history.length, afterPass);
  assert.equal(dice.history().length, 2, 'only the opening roll-off between the two Ruriks was rolled');
});

test('takeTurn accepts exactly the legal actions: legalActions is the single source of legality', () => {
  const fresh = () => newCombat(createDiceManager({ source: seededSource(5) }), [rurik(), fenrir()]);
  for (const action of fresh().legalActions()) {
    assert.doesNotThrow(() => fresh().takeTurn(action), JSON.stringify(action));
  }
  // The same action with a target nobody legally has, or an attack from the wrong fighter, is refused.
  const combat = fresh();
  assert.throws(() => combat.takeTurn({ maneuver: 'attack', attackId: 'Machado#1', targetId: RURIK }), CombatError);
  assert.throws(() => combat.takeTurn({ maneuver: 'attack', attackId: 'punch', targetId: FENRIR }), /same side/);
});

test('legalActions lists the passive maneuvers and attacks on every standing enemy', () => {
  const combat = newCombat(scripted(5, 2), [rurik(), rurik({ id: 'rurik-2' }), fenrir()]);
  const actions = combat.legalActions();
  assert.equal(actions.length, 3 + 2 * 2, 'Do Nothing + All-Out Defense (Dodge, Parry); one attack x two enemies x Attack/All-Out Attack');
  assert.ok(actions.every((a) => !('targetId' in a) || a.targetId !== FENRIR));
  assert.deepEqual(actions.slice(0, 3), [
    { maneuver: 'do-nothing' },
    { maneuver: 'all-out-defense', increase: 'dodge' },
    { maneuver: 'all-out-defense', increase: 'parry' },
  ]);
});

test('modifiers added during the fight change the roll, and removing them restores it', () => {
  // Fenrir's punch is skill 14. A -3 situational penalty makes a 12 miss; without it a 12 hits.
  const penalised = newCombat(scripted(4, 4, 4));
  penalised.addModifier(FENRIR, { label: 'Dim light', value: -3, appliesTo: ['attack'] });
  const miss = play(penalised, fenrirPunchesRurik);
  assert.equal(miss.attack?.attackRoll.effectiveSkill, 11);
  assert.equal(miss.attack?.outcome, 'miss');

  const cleared = newCombat(scripted(4, 4, 4, 6, 6, 6, 3, 3));
  const modifier = cleared.addModifier(FENRIR, { label: 'Dim light', value: -3, appliesTo: ['attack'] });
  cleared.removeModifier(FENRIR, modifier.id);
  assert.equal(play(cleared, fenrirPunchesRurik).attack?.attackRoll.effectiveSkill, 14);
});

test('modifiers can be edited, are tagged per roll, and show up in the view and history', () => {
  const combat = newCombat(scripted(5, 5, 4));
  const penalty = combat.addModifier(FENRIR, { label: 'Slippery', value: -3, appliesTo: ['attack'] });
  combat.addModifier(FENRIR, { label: 'Bless', value: 1, appliesTo: ['defense'] });
  combat.updateModifier(FENRIR, penalty.id, { value: -1 });

  assert.deepEqual(combat.view().fighters[0]?.modifiers.map((m) => [m.label, m.value]), [['Slippery', -1], ['Bless', 1]]);
  const attack = play(combat, fenrirPunchesRurik);
  assert.equal(attack.attack?.attackRoll.effectiveSkill, 13, 'the defense-only modifier does not touch the attack');
  assert.equal(attack.attack?.attackRoll.roll.total, 14, '5+5+4 misses skill 13');
  assert.deepEqual(
    combat.snapshot().history.map((h) => h.event.type),
    ['ADD_MODIFIER', 'ADD_MODIFIER', 'UPDATE_MODIFIER', 'RESOLVE_TURN'],
  );
});

test('unknown fighters and modifiers are refused, including names that exist on every object', () => {
  const combat = newCombat(scripted());
  for (const id of ['ghost', 'toString', 'constructor', '__proto__']) {
    assert.throws(() => combat.addModifier(id, { label: 'x', value: 1 }), /Unknown combatant/, id);
  }
  assert.throws(() => combat.removeModifier(FENRIR, 'mod-99'), /Unknown modifier/);
  assert.equal(combat.snapshot().history.length, 0, 'nothing was recorded');
});

test('the history is plain data: it survives JSON, modifiers and all', () => {
  const combat = newCombat(scripted(6, 6, 6));
  const modifier = combat.addModifier(FENRIR, { label: 'Dim light', value: -3, appliesTo: ['attack'] });
  combat.updateModifier(FENRIR, modifier.id, { value: -2 });
  play(combat, fenrirPunchesRurik);

  const log = JSON.parse(JSON.stringify(combat.snapshot().history));
  assert.deepEqual(log[0].event, { type: 'ADD_MODIFIER', fighterId: FENRIR, modifier: { label: 'Dim light', value: -3, appliesTo: ['attack'] } });
  assert.deepEqual(log[1].event, { type: 'UPDATE_MODIFIER', fighterId: FENRIR, modifierId: modifier.id, patch: { value: -2 } });
  assert.equal(log[2].event.result.attack.outcome, 'miss');

  const stored = JSON.parse(JSON.stringify(combat.snapshot().context.fighters[FENRIR]!.modifiers));
  assert.deepEqual(stored.items.map((m: { label: string; value: number }) => [m.label, m.value]), [['Dim light', -2]]);
});

test('reset restarts the fight: HP back from the starting sheets, round 1, no modifiers, empty history', () => {
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 3, 4));
  combat.addModifier(RURIK, { label: 'Blessed', value: 1 });
  play(combat, fenrirPunchesRurik);
  play(combat, { maneuver: 'all-out-defense', increase: 'dodge' });
  assert.equal(hp(combat, RURIK), 14);

  combat.reset();
  const view = combat.view();
  assert.equal(view.round, 1);
  assert.equal(view.currentId, FENRIR);
  assert.equal(hp(combat, RURIK), 15);
  assert.equal(hp(combat, FENRIR), 24);
  assert.ok(view.fighters.every((f) => f.maneuver === 'do-nothing' && f.modifiers.length === 0));
  assert.deepEqual(combat.snapshot().history, []);
});

test('reset restores a fighter to the HP its sheet started with, which may not be full', () => {
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 3, 4), [rurik({ damage: 10 }), fenrir()]);
  assert.equal(hp(combat, RURIK), 5);
  play(combat, fenrirPunchesRurik);
  assert.equal(hp(combat, RURIK), 4);
  combat.reset();
  assert.equal(hp(combat, RURIK), 5, 'not 15');
});

test('the roster is copied: changing the caller\'s array afterwards changes nothing', () => {
  const roster: Combatant[] = [rurik(), fenrir()];
  const combat = createCombat(roster, { dice: scripted(), clock: () => FIXED_TIME });
  roster.push(rurik({ id: 'latecomer' }));
  assert.equal(combat.legalActions().length, 5, 'Fenrir: Do Nothing, All-Out Defense x2, and Attack/All-Out Attack on Rurik');
  assert.deepEqual(combat.view().fighters.map((f) => f.id), [FENRIR, RURIK]);
  combat.reset();
  assert.deepEqual(combat.view().fighters.map((f) => f.id), [FENRIR, RURIK]);
});

test('a combat needs two sides with someone able to fight, and unique ids', () => {
  const dice = scripted(); // any dice roll would throw: invalid fights must be refused before rolling
  const make = (...c: Parameters<typeof createCombat>[0]) => () => createCombat(c, { dice });
  assert.throws(make(rurik(), rurik({ id: 'other' })), /two sides/);
  assert.throws(make(rurik(), fenrir({ damage: 24 })), /two sides/);
  assert.throws(make(rurik(), rurik()), /unique/);
  assert.equal(dice.history().length, 0);
});

// ---- the automated policy ----

/** A Rurik whose Brawling is 14, so his punch (skill 14) out-skills his axe (13) but hurts far less. */
function brawlerRurik(): Combatant {
  const sheet = loadExample('rurik.json');
  sheet.skills.find((skill) => skill.name === 'Briga')!.level = 14;
  return combatantFromCharacter(sheet, { side: 'a' }).combatant;
}

/** The policy's choice for Rurik, once everyone ahead of him in the turn order has passed. */
function rurikChoice(enemies: Combatant[], rurikFighter: Combatant = rurik()) {
  // Faces for the opening roll-off if two enemies are identical (they tie on Speed and DX).
  const combat = newCombat(scripted(5, 2), [rurikFighter, ...enemies]);
  while (combat.view().currentId !== RURIK) combat.takeTurn(pass);
  return bestExpectedInjury(combat.view(), combat.legalActions());
}

test('the policy ranks attacks by expected injury, not by skill: it picks the axe over a higher-skill punch', () => {
  const choice = rurikChoice([fenrir()], brawlerRurik());
  assert.equal(choice.maneuver === 'attack' || choice.maneuver === 'all-out-attack', true);
  assert.equal('attackId' in choice && choice.attackId, 'Machado#1');
});

test('the policy goes for the enemy it can actually hurt', () => {
  const choice = rurikChoice([{ ...fenrir({ id: 'tin-man' }), dr: 100 }, fenrir()]);
  assert.equal('targetId' in choice && choice.targetId, FENRIR);
});

test('the policy takes an All-Out Attack when giving up its defense costs nothing', () => {
  // Rurik can't be hurt (DR 100), so there is nothing to lose by dropping his Dodge, and +4 to hit gains something.
  assert.equal(rurikChoice([fenrir()], { ...rurik(), dr: 100 }).maneuver, 'all-out-attack');
});

test('the policy keeps its defense when All-Out Attack would add nothing', () => {
  // Skill 30 hits as often as skill 34 does, so +4 gains nothing and a plain Attack is right.
  const sure = rurik();
  const choice = rurikChoice([fenrir()], { ...sure, attacks: sure.attacks.map((attack) => ({ ...attack, skill: 30 })) });
  assert.equal(choice.maneuver, 'attack');
});

test('with nothing to attack the policy takes All-Out Defense, raising its best defense', () => {
  const combat = newCombat(scripted());
  const passive = combat.legalActions().filter((action) => !isAttackAction(action));
  // Fenrir: Dodge 12 beats his bare-handed parry (3 + 14/2 = 10).
  assert.deepEqual(bestExpectedInjury(combat.view(), passive), { maneuver: 'all-out-defense', increase: 'dodge' });
});

test('runToCompletion plays an automated fight to the end, reproducibly from a seed', () => {
  const play = (seed: number) => {
    const combat = createCombat([rurik(), fenrir()], { dice: createDiceManager({ source: seededSource(seed) }), clock: () => FIXED_TIME });
    const { results, finished } = runToCompletion(combat, bestExpectedInjury);
    return { results, finished, view: combat.view() };
  };

  const first = play(2026);
  assert.equal(first.finished, true);
  assert.ok(first.view.winner === 'a' || first.view.winner === 'b' || first.view.winner === null);
  assert.ok(first.view.fighters.some((f) => f.hp.current <= 0), 'someone is down');
  assert.deepEqual(play(2026), first, 'same seed, same fight');
  assert.notDeepEqual(play(7).results, first.results, 'a different seed plays differently');
});

test('every action the automated policy chooses is legal, over many seeded fights', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const combat = createCombat([rurik(), fenrir()], { dice: createDiceManager({ source: seededSource(seed) }), clock: () => FIXED_TIME });
    // takeTurn throws CombatError on anything illegal, so a clean finish proves it.
    assert.equal(runToCompletion(combat, bestExpectedInjury).finished, true, `seed ${seed}`);
  }
});

test('runToCompletion stops at maxTurns when nobody can hurt anybody', () => {
  const armored = [rurik(), fenrir()].map((c) => ({ ...c, dr: 100 }));
  const combat = createCombat(armored, { dice: createDiceManager({ source: seededSource(1) }), clock: () => FIXED_TIME });
  const { results, finished } = runToCompletion(combat, bestExpectedInjury, { maxTurns: 6 });
  assert.equal(results.length, 6);
  assert.equal(finished, false);
  assert.equal(combat.view().status, 'in-progress');
});
