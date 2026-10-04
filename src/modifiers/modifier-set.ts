/**
 * A modifier is data, not part of a roll result: a roll resolves against the
 * modifiers active at that moment, so removing or editing one changes later
 * rolls without rewriting history.
 */
export interface Modifier {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** Roll tags this modifier affects (e.g. "attack", "defense"); empty means every roll. */
  readonly appliesTo: readonly string[];
}

export type NewModifier = Pick<Modifier, 'label' | 'value'> & Partial<Pick<Modifier, 'appliesTo'>>;
export type ModifierPatch = Partial<Pick<Modifier, 'label' | 'value' | 'appliesTo'>>;

function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${what} needs a finite value`);
}

/** Immutable: every change returns a new set, so state snapshots stay valid. */
export class ModifierSet {
  readonly #items: readonly Modifier[];
  readonly #nextId: number;

  constructor(items: readonly Modifier[] = [], nextId = 1) {
    this.#items = items;
    this.#nextId = nextId;
  }

  add({ label, value, appliesTo = [] }: NewModifier): { set: ModifierSet; modifier: Modifier } {
    assertFinite(value, `Modifier "${label}"`);
    const modifier = Object.freeze({ id: `mod-${this.#nextId}`, label, value, appliesTo: Object.freeze([...appliesTo]) });
    return { set: new ModifierSet([...this.#items, modifier], this.#nextId + 1), modifier };
  }

  remove(id: string): ModifierSet {
    this.#require(id);
    return new ModifierSet(
      this.#items.filter((modifier) => modifier.id !== id),
      this.#nextId,
    );
  }

  update(id: string, patch: ModifierPatch): ModifierSet {
    const current = this.#require(id);
    if (patch.value !== undefined) assertFinite(patch.value, `Modifier "${id}"`);
    const next = Object.freeze({
      id,
      label: patch.label ?? current.label,
      value: patch.value ?? current.value,
      appliesTo: Object.freeze([...(patch.appliesTo ?? current.appliesTo)]),
    });
    return new ModifierSet(
      this.#items.map((modifier) => (modifier.id === id ? next : modifier)),
      this.#nextId,
    );
  }

  get(id: string): Modifier | undefined {
    return this.#items.find((modifier) => modifier.id === id);
  }

  list(): readonly Modifier[] {
    return this.#items;
  }

  /**
   * Sum of the modifiers that apply to a roll carrying these tags. Global
   * modifiers (empty `appliesTo`) always count.
   */
  total(tags: readonly string[] = []): number {
    return this.#items
      .filter((modifier) => modifier.appliesTo.length === 0 || modifier.appliesTo.some((tag) => tags.includes(tag)))
      .reduce((sum, modifier) => sum + modifier.value, 0);
  }

  #require(id: string): Modifier {
    const found = this.get(id);
    if (!found) throw new RangeError(`Unknown modifier "${id}"`);
    return found;
  }
}
