# Pattern: Eval as Contract

**Intent**: Define evaluation criteria up front so merges are based on evidence, not opinion.

---

## Introduction

In AI development, it’s easy to argue endlessly about whether an approach “works.” Without clear evaluation criteria, decisions become subjective and political.

The **Eval as Contract** pattern solves this by requiring teams to agree on evaluation metrics before work begins. Paths are judged against these metrics, and merges are made on evidence, not persuasion.

---

## Problem

- Merges are based on gut feeling.  
- Endless debate over what “good enough” means.  
- Criteria shift after results are known.  

---

## Forces

- **Flexibility vs consistency** — different tasks need different metrics, but fairness requires consistency.  
- **Speed vs rigor** — detailed evaluations take time, but save debate later.  

---

## Solution

- Define success criteria before work starts.  
- Evaluate each path against those criteria.  
- Make passing criteria a requirement for merge.  
- Document results for transparency.  

---

## Consequences

**Pros**  
- Objective, evidence-based merges.  
- Less debate and fewer shifting goalposts.  
- Clear record of why a path was merged.  

**Cons**  
- Requires upfront agreement on metrics.  
- Overly rigid criteria may miss qualitative insights.  
