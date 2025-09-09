# Pattern: PathScore

**Intent**: Evaluate candidate paths with a single metric that balances impact against cost.

## Introduction

AI teams often struggle with choosing which path to merge. Some candidates deliver higher accuracy, others run faster, while still others reduce cost. In the absence of a shared yardstick, debates can drag on, decisions get politicized, and projects stall.  

The **PathScore** pattern addresses this by offering a simple, comparative measure. By blending *relative value* (impact) with *relative cost* (tokens, time, or evaluation effort), it creates a single number that teams can rally around. Anything above baseline is better; anything below is worse. This turns subjective debates into clear, data-backed decisions.

## Problem

Without PathScore, teams face familiar frustrations:

- There is no single, trusted metric to compare candidate paths.  
- Conversations quickly devolve into opinion wars.  
- Cost and value are often considered in isolation, leading to skewed priorities.  
- Unclear criteria delay merges, creating bottlenecks and frustration.  

## Forces

The challenge isn’t just about metrics — it’s about trade-offs:

- **Simplicity vs nuance** — a single score makes comparison easy, but risks hiding complexity.  
- **Impact vs efficiency** — the most accurate model might also be the most expensive to run.  
- **Safety vs speed** — evaluations must be thorough enough to prevent regressions, even if they slow decision-making.  

These tensions are unavoidable. The goal of PathScore is not to erase them, but to channel them into a consistent, transparent process.

## Solution

PathScore provides that process. It works by:

1. Defining clear baselines for both *value* (accuracy, quality) and *cost* (latency, tokens, dollars).  
2. Calculating relative impact against relative cost.  
3. Enforcing hard floors — no candidate may regress on critical measures like safety or minimum accuracy.  
4. Using the resulting score as a guide for merge-or-kill decisions.  

In practice, this means every candidate can be compared apples-to-apples. Instead of arguing, teams look at the number.

## Consequences

Adopting PathScore reshapes team behavior in predictable ways.

**Benefits**  
- Creates a clear and defensible decision-making tool.  
- Cuts down on unproductive debate.  
- Encourages cost-conscious experimentation.  
- Holds experiments accountable to shared baselines.  

**Drawbacks**  
- Inevitably over-simplifies complex trade-offs.  
- Requires thoughtful design of metrics and weights.  
- Can be gamed if applied mechanically or without judgment.  

The trade-off is worthwhile: PathScore is not perfect, but it is consistent — and consistency is often what teams lack most.
