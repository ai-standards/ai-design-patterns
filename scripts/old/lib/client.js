import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const Verbosity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
};

export const ReasoningEffort = {
    MINIMAL: 'minimal',
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high'
};

export const Models = {
    FAST: 'gpt-5-mini',
    SMART: 'gpt-5',
}

export const openai = client;