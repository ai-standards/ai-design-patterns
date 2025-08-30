# Pattern: Deterministic IO

**Intent**: Make AI outputs reliable by defining schemas and validating results before use.

---

## Introduction

LLM outputs are inherently variable. The same input can produce different results, and free-form text is difficult to parse reliably. In early prototypes, this is tolerated. In production systems, it quickly becomes a source of fragility and hidden errors.

The **Deterministic IO** pattern solves this by treating model outputs as data, not prose. Every response is validated against a schema or contract. If the output does not match, it is retried or rejected. This shifts responsibility from “hoping the model says the right thing” to “guaranteeing that the system only accepts valid results.”

---

## Problem

- Free-form outputs are unpredictable and brittle.  
- Parsing text into structured data is error-prone.  
- Failures appear randomly in downstream systems.  
- Debugging is difficult because errors cannot be reproduced.  

---

## Forces

- **Flexibility vs reliability** — free text is flexible but unsafe.  
- **Speed vs structure** — adding schemas feels slower but saves debugging time.  
- **Tolerance vs determinism** — some tasks require strict formats, others do not.  

---

## Solution

- Define a schema or contract for every output.  
- Reject or retry outputs that fail validation.  
- Treat schema compliance as a first-class success criterion.  
- Store both raw output and parsed results for auditing.  

---

## Consequences

**Pros**  
- Reliable, testable, and debuggable outputs.  
- Easier integration with downstream systems.  
- Enables automated evaluation and replay.  

**Cons**  
- Additional implementation effort.  
- May constrain some creative use cases.  
- Validation and retries can add cost.  
