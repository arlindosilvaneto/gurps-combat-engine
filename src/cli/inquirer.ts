import { checkbox, confirm, input, number, select } from '@inquirer/prompts';
import type { CliIO, Choice, Prompter } from './io.js';

const toInquirer = <T>(choices: readonly Choice<T>[]) =>
  choices.map((choice) => ({
    name: choice.name,
    value: choice.value,
    ...(choice.description === undefined ? {} : { description: choice.description }),
    ...(choice.disabled === undefined ? {} : { disabled: choice.disabled }),
  }));

/** The terminal prompter: arrow-key menus from @inquirer/prompts. */
export const inquirerPrompter: Prompter = {
  select: (message, choices) => select({ message, choices: toInquirer(choices), pageSize: 15, loop: false }),
  checkbox: (message, choices) => checkbox({ message, choices: toInquirer(choices) }),
  input: (message, options = {}) =>
    input({
      message,
      ...(options.default === undefined ? {} : { default: options.default }),
      ...(options.validate === undefined ? {} : { validate: options.validate }),
    }),
  number: (message, options = {}) =>
    number({
      message,
      required: true,
      ...(options.default === undefined ? {} : { default: options.default }),
      ...(options.min === undefined ? {} : { min: options.min }),
      ...(options.max === undefined ? {} : { max: options.max }),
    }),
  confirm: (message, defaultValue) => confirm({ message, ...(defaultValue === undefined ? {} : { default: defaultValue }) }),
};

export const terminalIO: CliIO = {
  prompt: inquirerPrompter,
  print: (text) => console.log(text),
};
