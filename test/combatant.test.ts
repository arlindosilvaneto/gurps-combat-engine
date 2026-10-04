import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combatantFromCharacter } from '../src/index.js';
import { loadExample } from './fixtures.js';

test('Rurik: the axe matches "Machado/Maça" and swing damage adds up', () => {
  const { combatant, warnings } = combatantFromCharacter(loadExample('rurik.json'), { side: 'a' });
  assert.deepEqual(warnings, []);
  assert.equal(combatant.id, 'rurik-bjornsson');
  assert.equal(combatant.basicSpeed, 6);
  assert.equal(combatant.dx, 12);
  assert.equal(combatant.dodge, 9);
  assert.equal(combatant.dr, 4, 'torso DR');
  assert.deepEqual(combatant.attacks, [
    // swing is 2d-1 for his ST, and the axe adds +2
    { id: 'Machado#1', name: 'Machado', skill: 13, damage: { notation: '2d+1', type: 'cut' }, unarmed: false, weapon: 'Machado', strike: 'swing' },
    // thrust 1d, punch is -1; Brawling 12 is below DX+2, so no bonus
    { id: 'punch', name: 'Punch', skill: 12, damage: { notation: '1d-1', type: 'cr' }, unarmed: true, weapon: null, strike: 'thrust' },
  ]);
});

test('a character with no weapons still punches if they know Brawling', () => {
  const { combatant } = combatantFromCharacter(loadExample('jotun.json'), { side: 'b', id: 'wolf' });
  assert.equal(combatant.id, 'wolf');
  assert.equal(combatant.dr, 0, 'no DR entries means 0');
  assert.deepEqual(combatant.attacks, [{ id: 'punch', name: 'Punch', skill: 14, damage: { notation: '2d-2', type: 'cr' }, unarmed: true, weapon: null, strike: 'thrust' }]);
});

test('Brawling at DX+2 or better adds +1 per die to the punch (Basic Set p.182)', () => {
  const sheet = loadExample('jotun.json');
  sheet.skills.find((skill) => skill.name === 'Briga')!.level = sheet.attributes.dx.value + 2;
  const { combatant } = combatantFromCharacter(sheet, { side: 'b' });
  // thrust 2d-1, punch -1, Brawling +1 per die (+2): 2d+0
  assert.equal(combatant.attacks[0]?.damage.notation, '2d');
});

test('a weapon with no matching skill is skipped with a warning, unless mapped', () => {
  const sheet = loadExample('rurik.json');
  sheet.weapons!.melee![0]!.name = 'Foice';

  const unmapped = combatantFromCharacter(sheet, { side: 'a' });
  assert.deepEqual(unmapped.warnings, ['No skill found for weapon "Foice"; pass weaponSkills to map it']);
  assert.deepEqual(unmapped.combatant.attacks.map((a) => a.id), ['punch']);

  const mapped = combatantFromCharacter(sheet, { side: 'a', weaponSkills: { Foice: 'Machado/Maça' } });
  assert.deepEqual(mapped.warnings, []);
  assert.equal(mapped.combatant.attacks[0]?.skill, 13);
});

test('damage types the engine doesn\'t model are skipped with a warning', () => {
  const sheet = loadExample('rurik.json');
  sheet.weapons!.melee![0]!.damage![0]!.type = 'tox';
  const { combatant, warnings } = combatantFromCharacter(sheet, { side: 'a' });
  assert.match(warnings[0] ?? '', /"Machado" mode 1 has damage type "tox"/);
  assert.deepEqual(combatant.attacks.map((a) => a.id), ['punch']);
});

test('a character with nothing it can attack with gets a warning', () => {
  const sheet = loadExample('jotun.json');
  sheet.skills = sheet.skills.filter((skill) => skill.name !== 'Briga');
  const { combatant, warnings } = combatantFromCharacter(sheet, { side: 'b' });
  assert.deepEqual(combatant.attacks, []);
  assert.match(warnings.join(), /no melee attack/);
});

test('a longer, more exact skill is never shadowed by a shorter one that comes first', () => {
  const sheet = loadExample('rurik.json');
  const template = sheet.skills.find((skill) => skill.name === 'Briga')!;
  sheet.weapons!.melee![0]!.name = 'Espada Larga';
  // "Espada" is listed first and is a prefix of the weapon's name, but "Espada Larga" is the real match.
  sheet.skills.unshift({ ...template, name: 'Espada', level: 10 }, { ...template, name: 'Espada Larga', level: 15 });
  const { combatant, warnings } = combatantFromCharacter(sheet, { side: 'a' });
  assert.deepEqual(warnings, []);
  assert.equal(combatant.attacks[0]?.skill, 15);
});

test('a skill whose name starts the weapon\'s is used only when nothing matches better', () => {
  const sheet = loadExample('rurik.json');
  const template = sheet.skills.find((skill) => skill.name === 'Briga')!;
  sheet.weapons!.melee![0]!.name = 'Espada curta';
  sheet.skills.unshift({ ...template, name: 'Espada', level: 11 });
  assert.equal(combatantFromCharacter(sheet, { side: 'a' }).combatant.attacks[0]?.skill, 11);
});

test('DR entries with no torso are reported, not silently treated as unarmored', () => {
  const sheet = loadExample('rurik.json');
  delete sheet.damageResistance!.find((entry) => entry.location === 'Tronco')!.locationId;
  const { combatant, warnings } = combatantFromCharacter(sheet, { side: 'a' });
  assert.equal(combatant.dr, 0);
  assert.match(warnings.join(), /DR entries with no locationId \("Tronco"\) and none is the torso/);
});

test('a sheet with no DR entries at all is simply unarmored, without a warning', () => {
  const { warnings } = combatantFromCharacter(loadExample('jotun.json'), { side: 'b' });
  assert.deepEqual(warnings, []);
});

test('flat damage (no dice) is skipped with a warning instead of failing later in a fight', () => {
  const sheet = loadExample('rurik.json');
  sheet.weapons!.melee![0]!.damage = [{ notation: '3 cut', base: 'fixed', dice: 0, adds: 3, type: 'cut' }];
  const { combatant, warnings } = combatantFromCharacter(sheet, { side: 'a' });
  assert.match(warnings[0] ?? '', /flat damage/);
  assert.deepEqual(combatant.attacks.map((a) => a.id), ['punch']);
});

test('weapon names that exist on every object are just names', () => {
  const sheet = loadExample('rurik.json');
  sheet.weapons!.melee![0]!.name = 'constructor';
  const { warnings } = combatantFromCharacter(sheet, { side: 'a', weaponSkills: {} });
  assert.match(warnings[0] ?? '', /No skill found for weapon "constructor"/);
});

test('damage the sheet gives only as text is reported as such, not as an unknown type', () => {
  const sheet = loadExample('rurik.json');
  const mode = sheet.weapons!.melee![0]!.damage![0]!;
  delete mode.type;
  delete mode.base;
  mode.notation = 'thr(0.5) imp';
  const { warnings } = combatantFromCharacter(sheet, { side: 'a' });
  assert.match(warnings[0] ?? '', /only as text \(thr\(0\.5\) imp\)/);
});

test('DR on other locations only is fine; only an unclassified entry is worth a warning', () => {
  const sheet = loadExample('rurik.json');
  sheet.damageResistance = [{ location: 'Pés', locationId: 'feet', dr: 2 }];
  const { combatant, warnings } = combatantFromCharacter(sheet, { side: 'a' });
  assert.equal(combatant.dr, 0);
  assert.deepEqual(warnings, []);
});

test('a weapon mapped to a skill the sheet lacks says so', () => {
  const { warnings } = combatantFromCharacter(loadExample('rurik.json'), { side: 'a', weaponSkills: { Machado: 'Foice' } });
  assert.match(warnings[0] ?? '', /mapped to skill "Foice", which Rurik Bjornsson doesn't have/);
});

test('parries and block come from the sheet: one parry per weapon, with its parry modifier (p.376)', () => {
  const { combatant } = combatantFromCharacter(loadExample('rurik.json'), { side: 'a' });
  // Axe skill 13: 3 + 13/2 = 9, parry "0U" (unbalanced). The sheet's own Parry is 9 too.
  assert.deepEqual(combatant.parries, [
    { id: 'Machado', name: 'Machado', value: 9, unbalanced: true, fencing: false, unarmed: false, retreatBonus: 1 },
  ]);
  assert.equal(combatant.block, 10, 'Block from the sheet (Shield 14)');
});

test('a fighter without weapons parries bare-handed with the better of its unarmed skill and DX (p.376)', () => {
  const { combatant } = combatantFromCharacter(loadExample('jotun.json'), { side: 'b' });
  // Brawling 14 beats DX 13: 3 + 14/2 = 10. Brawling isn't a "mobile" skill, so a retreat is only +1.
  assert.deepEqual(combatant.parries, [
    { id: 'bare-hands', name: 'Bare hands', value: 10, unbalanced: false, fencing: false, unarmed: true, retreatBonus: 1 },
  ]);
  assert.equal(combatant.block, null);
});

test('a weapon whose parry is "No" can\'t parry, and one with no parry on the sheet says so', () => {
  const sheet = loadExample('rurik.json');
  sheet.weapons!.melee![0]!.parry = { notation: 'No', modifier: null };
  assert.deepEqual(combatantFromCharacter(sheet, { side: 'a' }).combatant.parries, []);

  delete sheet.weapons!.melee![0]!.parry;
  const { combatant, warnings } = combatantFromCharacter(sheet, { side: 'a' });
  assert.deepEqual(combatant.parries, []);
  assert.match(warnings.join(), /"Machado" has no parry on the sheet/);
});
