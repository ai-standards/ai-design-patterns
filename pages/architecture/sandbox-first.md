# Pattern: Sandbox-First

**Also known as**: Isolation by Default  
**Intent**: Run risky or untrusted actions in a safe, contained environment before promoting them.

---

## Introduction

Agents will propose actions you didn’t expect. Some will be harmless, others dangerous — deleting data, spamming users, spending money. Running these directly in production is reckless.

The **Sandbox-First** pattern ensures every new or risky action runs in isolation first. Whether it’s a dry-run, a mock, or a shadow environment, the sandbox reveals how the action behaves before it touches real systems.

---

## Problem

Without sandboxes:  
- New actions can break production instantly.  
- Failures are expensive and hard to undo.  
- Teams hesitate to let agents act at all, stalling progress.  

---

## Forces

- **Safety vs autonomy** — agents need freedom to discover, but not at the cost of production.  
- **Realism vs control** — sandboxes must simulate enough to be useful, but not expose everything.  
- **Speed vs confidence** — sandboxing adds latency but prevents catastrophic errors.  

---

## Solution

Run all new or high-risk actions in a sandbox first. Promote them only after:  
- Outputs are validated.  
- Results are safe.  
- Confidence is high enough to affect production.  

For some tools, the sandbox may be permanent: certain classes of actions are always isolated.

---

## Implementation

- Define sandbox policies: which actions always require isolation.  
- Build sandbox environments or mocks for critical tools.  
- Log sandbox outcomes for analysis.  
- Use sandbox results to refine agents and controllers.  

---

## Consequences

**Pros**  
- Prevents catastrophic production failures.  
- Builds confidence in agent autonomy.  
- Encourages experimentation without risk.  

**Cons**  
- Requires extra infrastructure.  
- May not perfectly simulate production.  
- Adds latency and complexity.  
