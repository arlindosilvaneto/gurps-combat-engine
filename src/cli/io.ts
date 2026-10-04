/**
 * Everything the CLI asks or tells the user goes through these, so the whole app runs
 * against a scripted prompter in tests and against @inquirer/prompts in a terminal.
 */
export interface Choice<T> {
  readonly name: string;
  readonly value: T;
  readonly description?: string;
  /** True, or the reason shown next to it, to show the choice without letting it be picked. */
  readonly disabled?: boolean | string;
}

export interface Prompter {
  select<T>(message: string, choices: readonly Choice<T>[]): Promise<T>;
  checkbox<T>(message: string, choices: readonly Choice<T>[]): Promise<T[]>;
  input(message: string, options?: { readonly default?: string; readonly validate?: (value: string) => true | string }): Promise<string>;
  number(message: string, options?: { readonly default?: number; readonly min?: number; readonly max?: number }): Promise<number>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
}

export interface CliIO {
  readonly prompt: Prompter;
  print(text: string): void;
}
