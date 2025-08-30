# Pattern: Tool Adapter

**Also known as**: Safety Wrapper, Guarded API  
**Intent**: Make volatile or risky tools reliable by wrapping them in a strict interface.

---

## Introduction

LLMs often need to call external tools — APIs, databases, services. But tools can be unreliable: schemas drift, error messages change, timeouts occur. When the model calls these tools directly, every small failure cascades into the system.

The **Tool Adapter** pattern fixes this by introducing a stable, human-designed interface between the agent and the tool. The adapter translates, validates, retries, and logs. The agent never sees the messy details — only the safe contract.

---

## Problem

Without adapters:  
- Agents must “know” too much about tool syntax.  
- Schema or API changes break the whole system.  
- Unhandled errors leak into user experience.  
- Debugging is impossible when failures come from many different sources.  

---

## Forces

- **Speed vs safety** — direct tool calls are fast to prototype, but fragile.  
- **Transparency vs abstraction** — how much should agents know about tool internals?  
- **Cost vs reliability** — retries and validation use tokens, but save systems from failure.  

---

## Solution

Insert an adapter between agent and tool. The adapter:  
- Defines a strict contract.  
- Validates inputs and outputs.  
- Handles retries, timeouts, and fallback behavior.  
- Logs every call for observability.  

The agent only ever emits high-level intents, which the adapter translates into tool-specific requests.

---

## Implementation

- For each external tool, create a single adapter module.  
- Never expose raw APIs to the agent.  
- Include validation, logging, and error handling in the adapter.  
- Keep adapters composable so controllers can orchestrate them cleanly.  

---

## Consequences

**Pros**  
- Stability: tools can change, but contracts stay the same.  
- Safety: bad inputs/outputs never reach the agent.  
- Debuggability: logs show exactly what happened.  
- Simplicity: agents focus on reasoning, not syntax.  

**Cons**  
- More upfront work than direct tool calls.  
- Adapters must be maintained as tools evolve.  
