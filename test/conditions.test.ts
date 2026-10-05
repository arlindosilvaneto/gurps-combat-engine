import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatError, type Combat, type TurnAction } from '../src/index.js';
import { FENRIR, fenrir, hp, newCombat, play, RURIK, rurik, scripted } from './fixtures.js';

// Rurik: 15 HP, HT 12, Dodge 9, axe skill 13 (2d+1 cut), torso DR 4.
// Fenrir: 24 HP, HT 13, Dodge 12, bare-handed parry 10, punch skill 14 (2d-2 cr), no DR. Acts first.

const punch = (targetId: string): TurnAction => ({ maneuver: 'attack', attackId: 'punch', targetId });
const axe = (targetId: string): TurnAction => ({ maneuver: 'attack', attackId: 'Machado#1', targetId });
const pass: TurnAction = { maneuver: 'do-nothing' };
const conditionsOf = (combat: Combat, id: string) => combat.view().fighters.find((f) => f.id === id)!.conditions;
const offered = (combat: Combat): Record<string, number | null> =>
  Object.fromEntries(combat.legalDefenses().map((option) => [option.label, option.target]));

test('shock: the injury\'s penalty applies to the victim\'s next attack, and only that one (p.419)', () => {
  // Fenrir hits Rurik for 1 HP (5 basic, DR 4): shock -1. Rurik's next two axe swings both miss on 18.
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 3, 4, /* Rurik */ 6, 6, 6, /* round 2, Rurik */ 6, 6, 6));
  const hit = play(combat, punch(RURIK));
  assert.equal(hit.attack?.targetEffects?.shock, 1);
  assert.equal(conditionsOf(combat, RURIK).shock, 1);
  // Fenrir has 24 HP, so the 1 HP he took punching the armor is too little for shock (-1 per 2 HP).
  assert.equal(hit.attack?.attackerEffects?.shock, 0);

  const shaken = play(combat, axe(FENRIR));
  assert.equal(shaken.attack?.attackRoll.modifier, -1);
  assert.equal(shaken.attack?.attackRoll.effectiveSkill, 12);
  assert.equal(conditionsOf(combat, RURIK).shock, 0, 'spent on that turn');

  play(combat, pass); // Fenrir
  assert.equal(play(combat, axe(FENRIR)).attack?.attackRoll.effectiveSkill, 13, 'gone by the following turn');
});

/** Rurik against two Fenrirs, who both act before him. */
function twoOnOne(...faces: number[]) {
  return newCombat(scripted(5, 2, ...faces), [rurik(), fenrir(), fenrir({ id: 'wolf' })]);
}

test('shock never touches active defenses (p.374)', () => {
  const combat = twoOnOne(3, 3, 3, 6, 6, 6, 3, 4, /* wolf */ 3, 3, 3);
  play(combat, punch(RURIK));
  assert.equal(conditionsOf(combat, RURIK).shock, 1);
  combat.takeTurn(punch(RURIK)); // the wolf
  assert.equal(offered(combat).Dodge, 9);
});

test('shock from several injuries adds up, to at most -4 (p.419)', () => {
  // 1 HP from Fenrir (5 basic), then 2 HP from the wolf (6 basic): -3 in all.
  const combat = twoOnOne(3, 3, 3, 6, 6, 6, 3, 4, /* wolf */ 3, 3, 3, 6, 6, 6, 4, 4);
  play(combat, punch(RURIK));
  play(combat, punch(RURIK));
  assert.equal(conditionsOf(combat, RURIK).shock, 3);

  // A single 6 HP injury (10 basic) is -6 of shock, capped at -4.
  const big = newCombat(scripted(3, 3, 3, 6, 6, 6, 6, 6));
  play(big, punch(RURIK));
  assert.equal(conditionsOf(big, RURIK).shock, 4);
});

test('a major wound stuns: the victim must Do Nothing, defends at -4 without retreating, and rolls HT to recover (pp.364, 420)', () => {
  const combat = newCombat(
    scripted(
      /* Rurik's axe: hit, Fenrir's Dodge fails, 6+5+1 = 12 cut x1.5 = 18 HP (more than half of 24): HT 13 roll 15 fails by 2 */
      3, 3, 3, 6, 6, 6, 6, 5, 5, 5, 5,
      /* round 2: Fenrir, stunned, rolls 15 to recover and fails */
      5, 5, 5,
      /* Rurik hits again; Fenrir dodges at -4 and fails; 1+1+1 = 3 cut x1.5 = 4 HP */
      3, 3, 3, 6, 6, 6, 1, 1,
      /* round 3: Fenrir rolls 9 to recover and succeeds */
      3, 3, 3,
      /* Rurik hits; Fenrir, recovering, dodges with a retreat: 6 vs 12 - 4 + 3 = 11 */
      3, 3, 3, 2, 2, 2,
    ),
  );
  play(combat, pass); // Fenrir
  const wound = play(combat, axe(FENRIR));
  assert.equal(wound.attack?.damage?.injury.injury, 18);
  assert.deepEqual(
    { ...wound.attack?.targetEffects, knockdownRoll: wound.attack?.targetEffects?.knockdownRoll?.roll.total },
    { shock: 4, majorWound: true, knockdownRoll: 15, knockdown: 'stunned' },
  );
  assert.equal(conditionsOf(combat, FENRIR).stun, 'stunned');

  // His turn: Do Nothing is the only legal action.
  assert.deepEqual(combat.legalActions(), [{ maneuver: 'do-nothing' }]);
  assert.throws(() => combat.takeTurn(punch(RURIK)), /Fenrir is stunned and can only Do Nothing/);
  const stuck = play(combat, pass);
  assert.equal(stuck.recovery?.roll.total, 15);
  assert.equal(stuck.recovery?.success, false);
  assert.equal(conditionsOf(combat, FENRIR).stun, 'stunned');
  assert.equal(conditionsOf(combat, FENRIR).shock, 0, 'his shock was spent on the turn he lost');

  // Attacked while stunned: every defense at -4, and no retreat.
  combat.takeTurn(axe(FENRIR));
  assert.deepEqual(offered(combat), { Dodge: 8, 'Parry (Bare hands)': 10 - 3 - 4, 'No defense': null });
  combat.defend({ kind: 'dodge', retreat: false });

  // Round 3: he recovers at the end of his turn, but still defends at -4 until his next turn; he may retreat again.
  const recovered = play(combat, pass);
  assert.equal(recovered.recovery?.success, true);
  assert.equal(conditionsOf(combat, FENRIR).stun, 'recovering');
  combat.takeTurn(axe(FENRIR));
  assert.equal(offered(combat).Dodge, 8);
  assert.equal(offered(combat)['Dodge + retreat'], 11);
  assert.equal(combat.defend({ kind: 'dodge', retreat: true }).attack?.outcome, 'defended');

  // Round 4: his own turn again, and he can act normally.
  assert.ok(combat.legalActions().some((action) => action.maneuver === 'attack'));
  play(combat, pass);
  assert.equal(conditionsOf(combat, FENRIR).stun, 'none');
});

test('a knockdown roll failed by 5+, or critically, knocks the victim out: the fight can end with HP to spare (p.420)', () => {
  // 18 HP wound as above, then HT 13 roll 17: a critical failure.
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 6, 5, 6, 6, 5));
  play(combat, pass);
  const result = play(combat, axe(FENRIR));
  assert.equal(result.attack?.targetEffects?.knockdown, 'unconscious');

  const view = combat.view();
  const knockedOut = view.fighters.find((f) => f.id === FENRIR)!;
  assert.equal(knockedOut.hp.current, 6);
  assert.equal(knockedOut.conditions.unconscious, true);
  assert.equal(knockedOut.defeated, true);
  assert.equal(view.status, 'finished');
  assert.equal(view.winner, 'a');
});

test('no knockdown roll for a wound that already takes the victim to 0 HP or below', () => {
  // Fenrir starts at 4 HP; the 18 HP wound is major but leaves him at -14, so no HT roll is made
  // (none is scripted: rolling one would throw).
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 6, 5), [rurik(), fenrir({ damage: 20 })]);
  play(combat, pass);
  const result = play(combat, axe(FENRIR));
  assert.equal(result.attack?.targetEffects?.majorWound, true);
  assert.equal(result.attack?.targetEffects?.knockdownRoll, null);
  assert.equal(hp(combat, FENRIR), -14);
});

test('the turn result and history stay plain data with the new effects', () => {
  const combat = newCombat(scripted(3, 3, 3, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 5));
  play(combat, pass);
  play(combat, axe(FENRIR));
  play(combat, pass); // stunned Fenrir, failed recovery
  const log = JSON.parse(JSON.stringify(combat.snapshot().history));
  const last = log.at(-1).event.result;
  assert.equal(last.recovery.roll.total, 15);
  assert.equal(log.at(-2).event.result.attack.targetEffects.knockdown, 'stunned');
  assert.throws(() => combat.addModifier('ghost', { label: 'x', value: 1 }), CombatError);
});
