# Pattern: Shadow Agents

**Intent**: Test new agents in parallel without affecting production results.

---

## Introduction

When adding new agents or changing behaviors, testing directly on users is risky. Offline tests often miss the complexity of real usage. The **Shadow Agents** pattern solves this by running new agents alongside production ones, invisibly. Their results are logged and compared, but not shown to users.

---

## Problem

- Offline evals don’t capture full real-world usage.  
- Deploying new agents directly risks user trust.  
- Teams lack safe ways to measure alternative approaches.  

---

## Forces

- **Realism vs risk** — production traffic is the best testbed, but dangerous without safeguards.  
- **Cost vs insight** — shadow runs consume resources but provide valuable data.  

---

## Solution

- Route production inputs to both baseline and shadow agents.  
- Log shadow outputs without exposing them to users.  
- Compare against baseline with agreed metrics.  
- Promote only after evidence supports the change.  

---

## Consequences

**Pros**  
- Realistic evaluation under live conditions.  
- No user impact during testing.  
- Faster iteration with evidence.  

**Cons**  
- Doubles compute costs during shadow runs.  
- Requires careful logging and storage.  
