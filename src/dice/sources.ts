/**
 * A die source supplies the face of one die. It is the only place randomness
 * (or its absence) enters the engine.
 */
export interface DieSource {
  /** A face in `1..sides`. */
  nextInt(sides: number): number;
}

export interface ScriptedDieSource extends DieSource {
  /** Scripted faces not yet played back. */
  readonly remaining: number;
}

/** Real randomness. `rng` must return a float in [0, 1). */
export function randomSource(rng: () => number = Math.random): DieSource {
  return { nextInt: (sides) => Math.floor(rng() * sides) + 1 };
}

/**
 * Deterministic pseudo-random source (mulberry32): the same seed always
 * produces the same sequence of faces.
 */
export function seededSource(seed: number): DieSource {
  let state = seed >>> 0;
  return randomSource(() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

/**
 * Deterministic source that plays back exact die faces, in order. Throws when
 * the script runs out or a face is impossible for the die asked for, so a
 * test never silently drifts from what it scripted.
 */
export function scriptedSource(faces: readonly number[]): ScriptedDieSource {
  let index = 0;
  return {
    get remaining() {
      return faces.length - index;
    },
    nextInt(sides) {
      const face = faces[index];
      if (face === undefined) {
        throw new RangeError(`Scripted dice exhausted after ${faces.length} face(s)`);
      }
      if (!Number.isInteger(face) || face < 1 || face > sides) {
        throw new RangeError(`Scripted face ${face} (position ${index}) is not valid on a d${sides}`);
      }
      index += 1;
      return face;
    },
  };
}
