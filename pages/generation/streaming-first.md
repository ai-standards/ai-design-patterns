# Pattern: Streaming First

**Intent**: Prefer incremental output over monolithic completions.

---

## Introduction

In traditional software, users expect responsiveness. In AI systems, free-form completions often arrive as one large block after long latency. This breaks user experience, hides partial results, and increases the risk of wasted work if something fails mid-generation.

The **Streaming First** pattern changes this by designing systems around incremental outputs. Instead of waiting for a final answer, the model streams tokens or chunks, which are processed and displayed in real time.

---

## Problem

- Users wait in silence during long completions.  
- Latency feels worse than it is.  
- Failures waste entire runs.  
- Systems cannot act on partial progress.  

---

## Forces

- **Responsiveness vs complexity** — streaming improves experience but requires pipeline support.  
- **Control vs flexibility** — streaming outputs must be handled gracefully.  
- **Cost vs usability** — incremental processing adds overhead but increases trust.  

---

## Solution

- Stream outputs by default.  
- Render or act on partial results as they arrive.  
- Design views and controllers to handle incomplete state.  
- Treat streaming as the baseline, not an afterthought.  

---

## Consequences

**Pros**  
- Improved user experience and trust.  
- Lower perceived latency.  
- Systems can act early on partial outputs.  
- Failures waste less work.  

**Cons**  
- Adds pipeline complexity.  
- Partial results may need reassembly or correction.  
