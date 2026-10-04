import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRoll,
  createDiceManager,
  ModifierSet,
  rollSuccess,
  scriptedSource,
  type RollOutcome,
} from '../src/index.js';

// [roll, effective skill, expected outcome, why]. Page numbers are Basic Set 4e printed pages.
const cases: Array<[number, number, RollOutcome, string]> = [
  // p.347 worked examples
  [12, 18, 'success', 'skill 18 rolling 12'],
  [12, 9, 'failure', 'skill 9 rolling 12'],
  [9, 9, 'success', 'equal to skill succeeds'],
  [10, 9, 'failure', 'one over skill fails'],

  // p.347 critical success: 3-4 always, 5 at skill 15+, 6 at skill 16+
  [3, 3, 'critical-success', '3 on any skill'],
  [4, 1, 'critical-success', '4 even on a skill it did not beat'],
  [5, 14, 'success', '5 is only ordinary below skill 15'],
  [5, 15, 'critical-success', '5 at skill 15'],
  [5, 4, 'failure', '5 above a skill of 4 is a failure, never critical'],
  [6, 15, 'success', '6 is only ordinary below skill 16'],
  [6, 16, 'critical-success', '6 at skill 16'],

  // p.348 critical failure: 18 always, 17 at skill <=15, any roll 10+ over skill
  [18, 25, 'critical-failure', '18 on any skill'],
  [17, 15, 'critical-failure', '17 at skill 15'],
  [17, 16, 'failure', '17 at skill 16 is ordinary'],
  [17, 25, 'failure', '17 never succeeds, however high the skill'],
  [16, 6, 'critical-failure', 'p.348: 16 on a skill of 6'],
  [15, 5, 'critical-failure', 'p.348: 15 on a skill of 5'],
  [15, 6, 'failure', '9 over is still an ordinary failure'],

  // 3-4 outranks the "10 over skill" critical failure
  [4, -6, 'critical-success', '4 is also 10 over skill -6; critical success wins'],
];

for (const [total, skill, expected, why] of cases) {
  test(`roll ${total} vs skill ${skill} is ${expected} (${why})`, () => {
    assert.equal(classifyRoll(total, skill).outcome, expected);
  });
}

test('margin is effective skill minus the roll', () => {
  assert.equal(classifyRoll(12, 18).margin, 6, 'p.347: margin of success 6');
  assert.equal(classifyRoll(12, 9).margin, -3, 'p.347: margin of failure 3');
});

test('rollSuccess rolls 3d and reports the full breakdown', () => {
  const dice = createDiceManager({ source: scriptedSource([4, 4, 4]) });
  const result = rollSuccess(dice, { skill: 14 });
  assert.equal(result.roll.total, 12);
  assert.equal(result.effectiveSkill, 14);
  assert.equal(result.outcome, 'success');
  assert.equal(result.success, true);
  assert.equal(result.critical, false);
  assert.equal(result.margin, 2);
});

test('only modifiers matching the roll tags (and global ones) adjust the skill', () => {
  let modifiers = new ModifierSet();
  modifiers = modifiers.add({ label: 'Shock', value: -4, appliesTo: ['attack'] }).set;
  modifiers = modifiers.add({ label: 'Poor light', value: -1 }).set;
  modifiers = modifiers.add({ label: 'Dodging', value: 3, appliesTo: ['defense'] }).set;

  const dice = createDiceManager({ source: scriptedSource([4, 4, 4, 4, 4, 4]) });
  const attack = rollSuccess(dice, { skill: 14, modifiers, tags: ['attack'] });
  assert.equal(attack.modifier, -5);
  assert.equal(attack.effectiveSkill, 9);
  assert.equal(attack.outcome, 'failure', 'a 12 now misses');

  const defense = rollSuccess(dice, { skill: 14, modifiers, tags: ['defense'] });
  assert.equal(defense.modifier, 2);
  assert.equal(defense.effectiveSkill, 16);
  assert.equal(defense.outcome, 'success');
});

test('removing a modifier changes later rolls but not recorded ones', () => {
  const { set: withPenalty, modifier } = new ModifierSet().add({ label: 'Shock', value: -4 });
  const dice = createDiceManager({ source: scriptedSource([4, 4, 4, 4, 4, 4]) });

  const before = rollSuccess(dice, { skill: 12, modifiers: withPenalty });
  const after = rollSuccess(dice, { skill: 12, modifiers: withPenalty.remove(modifier.id) });

  assert.equal(before.outcome, 'failure');
  assert.equal(after.outcome, 'success');
  assert.equal(before.effectiveSkill, 8, 'the earlier result is unchanged');
});

test('critical flags follow the outcome', () => {
  const crit = createDiceManager({ source: scriptedSource([1, 1, 1]) });
  assert.deepEqual(
    (({ success, critical }) => ({ success, critical }))(rollSuccess(crit, { skill: 10 })),
    { success: true, critical: true },
  );
  const fumble = createDiceManager({ source: scriptedSource([6, 6, 6]) });
  assert.deepEqual(
    (({ success, critical }) => ({ success, critical }))(rollSuccess(fumble, { skill: 10 })),
    { success: false, critical: true },
  );
});
