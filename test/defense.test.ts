import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestDefense, CombatError, npcCombatant, type Combat, type DefenseOption, type TurnAction } from '../src/index.js';
import { FENRIR, fenrir, hp, newCombat, play, RURIK, rurik, scripted } from './fixtures.js';

// Rurik: Dodge 9, Block 10 (Shield 14), axe parry 9 ("0U": unbalanced), punch skill 12.
// Fenrir: Dodge 12, no weapons, so a bare-handed parry: 3 + Brawling 14 / 2 = 10. Punch skill 14.
// Fenrir (Speed 6.5) acts before Rurik (Speed 6).

/** The defenses on offer right now, by label, with the number each would roll against. */
const offered = (combat: Combat): Record<string, number | null> =>
  Object.fromEntries(combat.legalDefenses().map((option) => [option.label, option.target]));

const punch = (targetId: string): TurnAction => ({ maneuver: 'attack', attackId: 'punch', targetId });
const axe = (targetId: string): TurnAction => ({ maneuver: 'attack', attackId: 'Machado#1', targetId });
const pass: TurnAction = { maneuver: 'do-nothing' };

test('a hit on a fighter who can defend waits for the defender\'s choice', () => {
  const combat = newCombat(scripted(3, 3, 3, 2, 2, 2));
  const step = combat.takeTurn(punch(RURIK)); // 9 vs 14: a hit, not critical
  assert.equal(step.status, 'awaiting-defense');

  const view = combat.view();
  assert.equal(view.status, 'awaiting-defense');
  assert.equal(view.currentId, FENRIR, 'still Fenrir\'s turn');
  assert.equal(view.awaitingId, RURIK, 'but Rurik must decide');
  assert.equal(view.pending?.attackRoll.roll.total, 9);
  assert.deepEqual(combat.legalActions(), [], 'nobody takes a turn while a defense is pending');
  assert.throws(() => combat.takeTurn(pass), /Waiting for Rurik Bjornsson to choose a defense/);

  const result = combat.defend({ kind: 'block', retreat: false }); // 2+2+2 = 6 vs Block 10
  assert.equal(result.attack?.outcome, 'defended');
  assert.deepEqual(result.attack?.defense?.choice, { kind: 'block', retreat: false });
  assert.equal(result.attack?.defense?.roll?.effectiveSkill, 10);
  assert.equal(combat.view().status, 'in-progress');
  assert.equal(combat.view().currentId, RURIK);
  assert.deepEqual(combat.snapshot().history.map((h) => h.event.type), ['AWAIT_DEFENSE', 'RESOLVE_TURN']);
  assert.doesNotThrow(() => JSON.stringify(combat.snapshot().history));
});

test('the defender is offered every defense it has, with the number it would roll against', () => {
  const combat = newCombat(scripted(3, 3, 3));
  combat.takeTurn(punch(RURIK));
  assert.deepEqual(offered(combat), {
    Dodge: 9,
    'Parry (Machado)': 9,
    Block: 10,
    // Retreat: +3 Dodge, +1 Parry, +1 Block (p.377).
    'Dodge + retreat': 12,
    'Parry (Machado) + retreat': 10,
    'Block + retreat': 11,
    'No defense': null,
  });
});

test('choosing no defense takes the hit', () => {
  const combat = newCombat(scripted(3, 3, 3, 6, 6));
  combat.takeTurn(punch(RURIK));
  const result = combat.defend({ kind: 'none' });
  assert.equal(result.attack?.outcome, 'hit');
  assert.deepEqual(result.attack?.defense, { choice: { kind: 'none' }, roll: null });
  assert.equal(hp(combat, RURIK), 15 - 6, 'damage 6+6-2 = 10, DR 4 -> 6');
});

/** Rurik against two Fenrirs, who both act before him: the two attacks land in one of Rurik's turns. */
function twoOnOne(...faces: number[]) {
  // Opening roll-off between the two identical Fenrirs: 5 vs 2, so "fenrir" goes first, then "wolf".
  return newCombat(scripted(5, 2, ...faces), [rurik(), fenrir(), fenrir({ id: 'wolf' })]);
}

test('Block works once per turn, and comes back on the defender\'s next turn (p.375)', () => {
  const combat = twoOnOne(3, 3, 3, 2, 2, 2, /* wolf */ 3, 3, 3, 2, 2, 2, /* round 2, fenrir */ 3, 3, 3);
  combat.takeTurn(punch(RURIK));
  combat.defend({ kind: 'block', retreat: false });

  combat.takeTurn(punch(RURIK)); // the wolf
  assert.ok(!Object.keys(offered(combat)).some((label) => label.startsWith('Block')), 'no second block this turn');
  assert.throws(() => combat.defend({ kind: 'block', retreat: false }), CombatError);
  combat.defend({ kind: 'dodge', retreat: false });

  play(combat, pass); // Rurik's own turn: his defenses come back
  combat.takeTurn(punch(RURIK));
  assert.ok('Block' in offered(combat));
});

test('a retreat works once per turn', () => {
  const combat = twoOnOne(3, 3, 3, 2, 2, 2, 3, 3, 3);
  combat.takeTurn(punch(RURIK));
  combat.defend({ kind: 'dodge', retreat: true });
  combat.takeTurn(punch(RURIK));
  assert.ok(!Object.keys(offered(combat)).some((label) => label.endsWith('retreat')));
});

test('each further parry with the same weapon in a turn is -4, and other weapons are unaffected (p.376)', () => {
  // The knight: Broadsword parry 3 + 16/2 = 11, Dagger 3 + 13/2 - 1 = 8. His lance can't parry ("No").
  const knight = npcCombatant('fantasy-mercenary-knight', { side: 'a' }).combatant;
  const combat = newCombat(scripted(5, 2, 3, 3, 3, 2, 2, 2, 3, 3, 3), [knight, fenrir(), fenrir({ id: 'wolf' })]);
  combat.takeTurn(punch(knight.id));
  assert.equal(offered(combat)['Parry (Broadsword)'], 11);
  assert.ok(!('Parry (Lance)' in offered(combat)));
  combat.defend({ kind: 'parry', parryId: 'Broadsword', retreat: false });

  combat.takeTurn(punch(knight.id));
  assert.equal(offered(combat)['Parry (Broadsword)'], 11 - 4);
  assert.equal(offered(combat)['Parry (Dagger)'], 8);
});

test('a fencing weapon pays only -2 per extra parry, and gets +3 for a retreat (pp.376-377)', () => {
  // The musketeer's rapier ("0F"): parry 3 + 17/2 = 11.
  const musketeer = npcCombatant('swashbuckling-musketeer', { side: 'a' }).combatant;
  const combat = newCombat(scripted(5, 2, 3, 3, 3, 2, 2, 2, 3, 3, 3), [musketeer, fenrir(), fenrir({ id: 'wolf' })]);
  combat.takeTurn(punch(musketeer.id));
  assert.equal(offered(combat)['Parry (Rapier)'], 11);
  assert.equal(offered(combat)['Parry (Rapier) + retreat'], 14);
  combat.defend({ kind: 'parry', parryId: 'Rapier', retreat: false });

  combat.takeTurn(punch(musketeer.id));
  assert.equal(offered(combat)['Parry (Rapier)'], 11 - 2);
});

test('an unbalanced weapon can\'t parry until its owner\'s next turn once it has attacked (p.376)', () => {
  // Rurik swings his axe ("0U") at Fenrir and misses (18); Fenrir then punches him.
  const swung = newCombat(scripted(6, 6, 6, 3, 3, 3));
  play(swung, pass);
  play(swung, axe(FENRIR));
  swung.takeTurn(punch(RURIK));
  assert.ok(!('Parry (Machado)' in offered(swung)));

  // Had he punched instead, the axe would still be ready to parry.
  const punched = newCombat(scripted(6, 6, 6, 3, 3, 3));
  play(punched, pass);
  play(punched, punch(FENRIR));
  punched.takeTurn(punch(RURIK));
  assert.equal(offered(punched)['Parry (Machado)'], 9);
});

test('All-Out Defense raises only the defense it chose, by +2 (p.366)', () => {
  const combat = newCombat(scripted(3, 3, 3));
  play(combat, pass);
  play(combat, { maneuver: 'all-out-defense', increase: 'parry' });
  combat.takeTurn(punch(RURIK));
  assert.equal(offered(combat)['Parry (Machado)'], 11);
  assert.equal(offered(combat).Dodge, 9);
  assert.equal(offered(combat).Block, 10);
});

test('a bare-handed parry is -3 against a swung weapon, but not against a punch (p.377)', () => {
  const vsAxe = newCombat(scripted(3, 3, 3));
  play(vsAxe, pass);
  vsAxe.takeTurn(axe(FENRIR));
  assert.equal(offered(vsAxe)['Parry (Bare hands)'], 10 - 3);
  assert.equal(offered(vsAxe)['Parry (Bare hands) + retreat'], 10 - 3 + 1);

  const vsPunch = newCombat(scripted(3, 3, 3));
  play(vsPunch, pass);
  vsPunch.takeTurn(punch(FENRIR));
  assert.equal(offered(vsPunch)['Parry (Bare hands)'], 10);
});

test('modifiers tagged for one defense change only that defense; "defense" changes all of them', () => {
  const combat = newCombat(scripted(3, 3, 3));
  combat.addModifier(RURIK, { label: 'Bad footing', value: -2, appliesTo: ['parry'] });
  combat.takeTurn(punch(RURIK));
  assert.equal(offered(combat)['Parry (Machado)'], 7);
  assert.equal(offered(combat).Dodge, 9);

  // Modifiers can change while the defense is pending, and the offer follows.
  combat.addModifier(RURIK, { label: 'Distracted', value: -1, appliesTo: ['defense'] });
  assert.deepEqual([offered(combat).Dodge, offered(combat)['Parry (Machado)'], offered(combat).Block], [8, 6, 9]);
});

test('defend refuses choices that aren\'t on offer, and calls with nothing pending', () => {
  const combat = newCombat(scripted(3, 3, 3, 2, 2, 2));
  assert.throws(() => combat.defend({ kind: 'dodge', retreat: false }), /No attack is waiting/);
  combat.takeTurn(punch(RURIK));
  assert.throws(() => combat.defend({ kind: 'parry', parryId: 'Spoon', retreat: false }), CombatError);
  assert.equal(combat.view().status, 'awaiting-defense', 'a refused choice changes nothing');
  assert.doesNotThrow(() => combat.defend({ kind: 'dodge', retreat: false }));
});

test('reset during a pending defense starts the fight over', () => {
  const combat = newCombat(scripted(3, 3, 3));
  combat.takeTurn(punch(RURIK));
  combat.reset();
  const view = combat.view();
  assert.equal(view.status, 'in-progress');
  assert.equal(view.pending, null);
  assert.deepEqual(combat.snapshot().history, []);
});

test('bestDefense takes the highest number, keeps the retreat for later on a tie, and takes the hit only as a last resort', () => {
  const option = (label: string, target: number | null, choice: DefenseOption['choice']): DefenseOption => ({ label, target, choice });
  const view = newCombat(scripted()).view();
  const none = option('No defense', null, { kind: 'none' });
  assert.deepEqual(
    bestDefense(view, [option('Dodge', 9, { kind: 'dodge', retreat: false }), option('Block + retreat', 11, { kind: 'block', retreat: true }), none]),
    { kind: 'block', retreat: true },
  );
  assert.deepEqual(
    bestDefense(view, [option('Block + retreat', 10, { kind: 'block', retreat: true }), option('Block', 10, { kind: 'block', retreat: false }), none]),
    { kind: 'block', retreat: false },
  );
  assert.deepEqual(bestDefense(view, [none]), { kind: 'none' });
});
