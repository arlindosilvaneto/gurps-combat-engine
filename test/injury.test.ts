import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoll, isMajorWound, knockdownOutcome, MAX_SHOCK, shockPenalty, type SuccessRollResult } from '../src/index.js';

test('shock is -1 per HP lost, never more than -4 (p.419)', () => {
  assert.equal(shockPenalty(0, 15), 0);
  assert.equal(shockPenalty(1, 15), 1);
  assert.equal(shockPenalty(3, 10), 3);
  assert.equal(shockPenalty(4, 15), 4);
  assert.equal(shockPenalty(9, 15), MAX_SHOCK, 'capped at 4');
});

test('with 20+ HP, shock is -1 per HP/10 lost, dropping fractions (p.419)', () => {
  // "if you have 20-29 HP, it's -1 per 2 HP lost; if you have 30-39 HP, it's -1 per 3 HP lost"
  assert.equal(shockPenalty(1, 24), 0);
  assert.equal(shockPenalty(5, 24), 2);
  assert.equal(shockPenalty(2, 30), 0);
  assert.equal(shockPenalty(9, 35), 3);
  assert.equal(shockPenalty(30, 24), 4, 'still capped at 4');
  assert.equal(shockPenalty(3, 19), 3, '19 HP is below the threshold');
});

test('a major wound is a single injury of MORE than half the HP (p.420)', () => {
  assert.equal(isMajorWound(7, 15), false);
  assert.equal(isMajorWound(8, 15), true);
  assert.equal(isMajorWound(5, 10), false, 'exactly half is not more than half');
  assert.equal(isMajorWound(6, 10), true);
});

const htRoll = (total: number, ht: number): SuccessRollResult => {
  const { outcome, margin } = classifyRoll(total, ht);
  return {
    roll: { notation: '3d', dice: [], modifier: 0, total },
    baseSkill: ht,
    modifier: 0,
    effectiveSkill: ht,
    outcome,
    margin,
    success: outcome === 'success' || outcome === 'critical-success',
    critical: outcome === 'critical-success' || outcome === 'critical-failure',
  };
};

test('the major-wound HT roll: success nothing, failure stunned, by 5+ or a critical failure unconscious (p.420)', () => {
  assert.equal(knockdownOutcome(htRoll(10, 12)), 'none');
  assert.equal(knockdownOutcome(htRoll(13, 12)), 'stunned', 'failure by 1');
  assert.equal(knockdownOutcome(htRoll(16, 12)), 'stunned', 'failure by 4');
  assert.equal(knockdownOutcome(htRoll(17, 12)), 'unconscious', '17 on HT 12 is a critical failure (and by 5)');
  assert.equal(knockdownOutcome(htRoll(15, 10)), 'unconscious', 'failure by 5');
  assert.equal(knockdownOutcome(htRoll(17, 16)), 'stunned', '17 on HT 16 is an ordinary failure, by 1');
  assert.equal(knockdownOutcome(htRoll(18, 16)), 'unconscious', '18 is always a critical failure');
});
