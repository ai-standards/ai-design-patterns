# Pattern: Canary Tokens

**Intent**: Roll out AI changes gradually by allocating small budgets first.

---

## Introduction

AI changes are unpredictable. A new prompt, tool, or model might look good in testing but behave differently at scale. Releasing it to 100% of traffic risks widespread failures.

The **Canary Tokens** pattern launches changes to a limited budget first — a slice of users, a fixed number of requests, or a capped token spend. Only after success in the canary phase does the rollout expand.

---

## Problem

- Full launches magnify hidden issues.  
- Failures damage user trust and burn cost.  
- Teams lack visibility into how changes behave in production.  

---

## Forces

- **Speed vs confidence** — rolling out slowly delays full impact but catches problems early.  
- **Cost vs coverage** — small canaries cost less but may miss edge cases.  

---

## Solution

- Define a canary slice (users, traffic, or token budget).  
- Monitor results closely during the canary phase.  
- Expand only after success is proven.  
- Roll back quickly if failures appear.  

---

## Consequences

**Pros**  
- Reduces risk of catastrophic rollout.  
- Builds confidence in changes.  
- Provides real-world evaluation before scale.  

**Cons**  
- Slower time to full impact.  
- Canary slices may not represent all users.  
