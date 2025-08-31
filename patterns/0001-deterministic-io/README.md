# Pattern: Deterministic IO

**Intent**: Ensure AI outputs are consistent and trustworthy by enforcing schemas and validating results before they are used.

---

## Introduction

Large language models are powerful, but they are not predictable. The same input can yield different answers, and free-form text is fragile when you try to parse it into structured data. Early prototypes often tolerate this unpredictability, but in production it quickly becomes a source of hidden errors and brittle integrations. Debugging becomes time-consuming, and trust in the system erodes.

- AI outputs vary even with identical inputs  
- Free-form text is unreliable for structured use  
- Fragility increases as systems scale  

---

## Problem

When outputs are left unstructured, small inconsistencies cascade into major failures. Parsing becomes unreliable, downstream systems encounter random errors, and debugging turns into guesswork because problems cannot be consistently reproduced. What feels like flexibility at first becomes a liability in practice.

- Unpredictable outputs break downstream processes  
- Parsing is error-prone and costly  
- Failures are difficult to trace and reproduce  

---

## Forces

Teams face a recurring tension between speed and reliability. Allowing free-form outputs feels fast and flexible, but it opens the door to instability. Enforcing schemas imposes discipline, which initially slows development but pays dividends in robustness. The challenge lies in knowing when to tolerate loose outputs and when determinism is non-negotiable.

- Flexibility vs reliability  
- Speed vs structure  
- Tolerance vs determinism  

---

## Solution

The answer is to make validation the default. Every output should be checked against a schema or contract that defines what success looks like. If a response fails validation, it is retried or rejected outright. Compliance with the schema becomes a first-class success criterion. To maintain transparency, systems should preserve both the raw output and the validated result, ensuring a clear record for auditing and analysis.

- Define schemas for every output  
- Reject or retry invalid results  
- Treat compliance as a core requirement  
- Store raw and validated outputs for auditing  

---

## Consequences

Applying this pattern transforms unpredictable model behavior into a reliable, testable process. Systems downstream gain stability, and developers gain confidence knowing results can be trusted. Automated evaluation and replay become possible. The trade-offs are real: implementing schemas takes effort, certain creative tasks may feel constrained, and retries add cost. But the payoff is a production-ready system that doesn’t leave correctness up to chance.

- Pros: reliable, debuggable, integrable, replayable  
- Cons: extra implementation, constrained creativity, added cost  

---

**Key Insight**: The difference between fragile prototypes and robust production systems is whether you rely on hope or on guarantees. By enforcing schemas, you stop guessing about what the model will produce and start ensuring it only delivers valid, structured results.  
