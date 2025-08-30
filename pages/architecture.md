# Architecture Patterns

Architecture patterns describe **how AI systems are structured**.  
They answer the question: *how do we organize agents, tools, and views so that discovery doesn't collapse into chaos?*  

These patterns are about **boundaries, contracts, and composition**.  
They ensure that reasoning, orchestration, and presentation stay separate, tools are safe to call, risky actions are isolated, and failures degrade gracefully instead of breaking everything.

---

## Catalog

### [ACV (Agent / Controller / View)](../patterns/architecture/acv/)  
Separate reasoning, orchestration, and presentation to avoid brittle, tangled systems. Agents propose, controllers execute, views render.  

### [Tool Adapter](../patterns/architecture/tool-adapter/)  
Wrap volatile or risky tools in strict contracts. Adapters validate, retry, and log so agents only see safe, stable interfaces.  

### [Sandbox-First](../patterns/architecture/sandbox-first/)  
Run risky or untrusted actions in isolation before touching production. Dry-runs and mocks protect systems from catastrophic errors.  

### [Fallback Chain](../patterns/architecture/fallback-chain/)  
Define ordered alternatives when actions fail. If the primary path breaks, fallbacks ensure the system still delivers results.  

### [Agentic Redux](../patterns/architecture/agentic-redux/)  
Apply Redux-style discipline to AI systems. Agents propose state updates, reducers validate and apply them, and the canonical store remains compact, deterministic, and auditable. This keeps global state lean while allowing agents to explore safely.  

---

## Why Architecture Matters

Without clear architecture, AI projects tend to sprawl into **monolithic hero agents** or **fragile black boxes**.  
These patterns provide the structure to scale: each piece does one job well, is testable on its own, and composes cleanly with the rest.  

Architecture is what makes discovery sustainable.  
