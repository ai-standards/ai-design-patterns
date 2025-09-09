# Pattern: Cost Guardrails

**Intent**: Control token and compute spend by setting explicit budgets and thresholds.

---

## Introduction

AI systems can silently run up costs. Longer prompts, larger models, and retries accumulate until invoices arrive with surprises. Without guardrails, teams discover cost issues too late.

The **Cost Guardrails** pattern sets explicit budgets for tokens and compute. Requests are capped, monitored, and rejected when limits are exceeded.

---

## Problem

- Token spend grows invisibly until bills arrive.  
- Experiments consume excessive resources.  
- Cost overruns create friction with stakeholders.  

---

## Forces

- **Flexibility vs control** — letting agents run freely vs enforcing hard limits.  
- **Accuracy vs cost** — bigger models may be better but more expensive.  

---

## Solution

- Define budgets per feature, agent, or experiment.  
- Monitor token usage in real time.  
- Reject or scale back requests when limits are hit.  
- Make cost metrics visible to teams.  

---

## Consequences

**Pros**  
- Prevents runaway costs.  
- Encourages efficiency in design.  
- Makes trade-offs explicit.  

**Cons**  
- May block valid but expensive requests.  
- Requires careful budget setting and monitoring.  
