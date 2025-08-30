# Pattern: Decision Ledger

**Intent**: Preserve the rationale behind decisions so teams don’t relitigate them later.

---

## Introduction

In fast-moving AI projects, decisions pile up quickly. Without documentation, history is lost. Months later, teams forget why a path was chosen or a launch was rolled back. Arguments repeat, wasting time.

The **Decision Ledger** pattern solves this by recording every major decision along with its rationale. It’s not about bureaucracy; it’s about memory. A simple log prevents old debates from resurfacing and provides context for future builders.

---

## Problem

- Decisions are forgotten and relitigated.  
- New team members lack context.  
- Institutional knowledge lives only in people’s heads.  

---

## Forces

- **Speed vs clarity** — writing things down takes time, but saves more later.  
- **Detail vs simplicity** — too much record-keeping is ignored, too little is useless.  

---

## Solution

- Record every decision with: date, decision, rationale, and alternatives considered.  
- Store in a simple, accessible ledger.  
- Reference the ledger in future debates.  

---

## Consequences

**Pros**  
- Prevents wasted time on repeated debates.  
- Creates institutional memory.  
- Onboards new members faster.  

**Cons**  
- Requires discipline to keep updated.  
- Can become noise if over-detailed.  
