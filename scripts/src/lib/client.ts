import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const Verbosity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
} as const;

export const ReasoningEffort = {
  MINIMAL: 'minimal',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
} as const;

export const Models = {
  FAST: 'gpt-5-mini',
  SMART: 'gpt-5',
} as const;

export type VerbosityLevel = typeof Verbosity[keyof typeof Verbosity];
export type ReasoningEffortLevel = typeof ReasoningEffort[keyof typeof ReasoningEffort];
export type ModelType = typeof Models[keyof typeof Models];

export const openai = client;
