# Pattern: Rollback Ledger

**Intent**: Make every launch reversible by default.

---

## Introduction

In traditional software, deployments can be rolled back. In AI systems, launches often happen silently — new prompts, model versions, or fine-tunes go live without a clear way to undo them. When something fails, teams scramble to patch instead of reverting.

The **Rollback Ledger** pattern requires that every launch have a documented rollback plan and log. Nothing enters production unless it can also be removed cleanly.

---

## Problem

- Silent changes cause regressions with no way back.  
- Teams hesitate to launch because they fear irreversibility.  
- Debugging is difficult when the “before” state is lost.  

---

## Forces

- **Speed vs safety** — quick launches without rollback save time short-term but risk failure.  
- **Simplicity vs discipline** — rollback requires extra process, but prevents crises.  

---

## Solution

- Require rollback procedures for every launch.  
- Keep a ledger: what changed, when, by whom, and how to undo it.  
- Test rollbacks regularly, not just in theory.  

---

## Consequences

**Pros**  
- Safer launches with less fear.  
- Easier debugging and faster recovery.  
- Institutional memory of what changed and why.  

**Cons**  
- More upfront process.  
- Rollbacks themselves must be tested and maintained.  
