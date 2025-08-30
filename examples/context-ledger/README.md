# Context Ledger Example

Minimal TypeScript implementation of the Context Ledger pattern.

## What it does

- **Logs context** before every AI generation (prompt + sources)
- **Logs results** after every generation (output + metadata)
- **Enables reproduction** of any previous generation
- **Provides audit trail** for debugging and evaluation

## Key insight

Instead of just calling the AI directly:
```ts
const response = await ai.generate(prompt);
```

We log everything:
```ts
const contextEntry = ledger.logContext(sessionId, prompt, sources);
const response = await ai.generate(prompt);
ledger.logGeneration(contextEntry.id, response, latencyMs);
```

## Run it

```bash
npm install
npm run dev
```

## Test it

```bash
npm test
```

## Output

The demo shows:
1. Context being logged before generation
2. Generation results being logged after
3. Complete ledger contents
4. How to reproduce any previous context

This makes every AI interaction auditable and reproducible.