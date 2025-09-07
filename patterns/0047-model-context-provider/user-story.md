CedarVale AI is a healthcare SaaS company that builds a clinical documentation copilot used by hospitals and outpatient networks. I lead the platform team responsible for serving dozens of tenants across regions with different privacy policies, formularies, and workflows. Our early prototypes worked well in a single clinic, but as we rolled out to new hospitals the complexity exploded: we maintained a dozen slightly different prompts, redaction rules were embedded ad hoc, and we duplicated retrieval logic to hit each tenant’s knowledge base. When auditors requested evidence of what influenced a note at 2:13 p.m. on a specific patient record, we could not easily reconstruct the prompt lineage. The result was drift in model behavior, rising token costs, and anxiety about compliance.

We chose the Model-Context-Provider pattern because it gave us a way to turn “the prompt” into a set of composable, testable, and governable building blocks. Rather than continuing to fork prompts per tenant or feature, we wanted a predictable way to mix persona, policy, retrieval, tools, and memory—without losing control of precedence. The pattern also mapped cleanly to our organizational reality: separate teams own policy, knowledge management, and clinical UX, and each needed to evolve independently without stepping on one another.

- The need to vary behavior by tenant, locale, and specialty (cardiology vs. pediatrics) made composition essential, not optional.
- Centralizing safety and policy in high-precedence providers aligned with HIPAA and internal governance.
- A/B testing new instruction styles and retrieval strategies on a subset of tenants was only feasible if we could toggle providers, not hand-edit prompts.

Implementation began with a minimal provider contract and a canonical schema for “context fragments.” We designed each provider to accept a shared request context—who the user is, the patient encounter metadata, tenant id, locale, and feature flags—and to return a structured fragment: instructions, examples, retrieved passages, tool definitions, and any run-time parameters. Then we built a small composer that runs providers in a fixed order with explicit override scopes (policy > safety > persona > task > retrieval > few-shot > tools), merges outputs, prunes to a token budget, and logs lineage.

- We started with five providers: Policy, Redaction, Persona, ClinicalKB Retrieval, and Tool Registry. Over time we added Locale, Memory (prior notes for the same patient), and Specialty Guidelines.
- Providers are idempotent and cacheable; retrieval-heavy providers compute a cache key from tenant, specialty, and intent (e.g., “discharge summary”).
- The composer fails closed if a required provider is missing or if a lower-precedence provider attempts to override a policy block.

To make this concrete, here’s a simplified sketch of how we structured the contract and composition, omitting full code and implementation details:

- Provider interface (conceptual)
  - Input: RequestCtx { userId, role, tenantId, locale, specialty, task, featureFlags, encounterId }
  - Output: Fragment { instructions[], examples[], documents[], tools[], params{}, metadata{ providerId, version, sources[], cacheKey } }

- Example fragments (abbreviated)
  - PolicyProvider -> instructions: ["You must not include PHI beyond the fields provided by the redaction layer.", "Cite sources for clinical claims with links to tenant KB."], params: { temperature: 0.2 }, metadata: { providerId: "policy", version: "3.4" }
  - RedactionProvider -> transforms RequestCtx.inputText into redacted form; metadata includes a hash of the applied rules.
  - RetrievalProvider -> documents: [{ text: "...CHF discharge criteria...", source: "tenant-kb://guidelines/chf" }], metadata: { providerId: "kb", version: "1.9" }
  - ToolRegistryProvider -> tools: [{ name: "lookup_medication", schema: {...} }, { name: "schedule_followup", schema: {...} }]

- Composition (pseudo)
  - const fragments = await runInOrder([Policy, Safety, Redaction, Persona, SpecialtyGuidelines, Retrieval, FewShot, Tools], ctx)
  - const merged = mergeWithPrecedence(fragments, { lockedBlocks: ["policy", "safety"] })
  - const pruned = pruneToTokenBudget(merged, { keep: ["policy", "safety", "tools"], dedupe: ["documents"] })
  - logLineage(pruned.metadata)
  - callModel(pruned.instructions, pruned.examples, pruned.documents, pruned.tools, pruned.params)

Rolling this out took three sprints. We first migrated one tenant to the new composition with a “shadow” mode that assembled both the old monolithic prompt and the provider-based context, comparing outputs and token usage. Next, we increased coverage provider by provider, adding snapshot tests for each fragment so upgrades were safe. Finally, we exposed provider toggles to our ops team: they could enable a new Specialty Guidelines provider for cardiology in two pilot hospitals without touching any other flows.

The results were immediate and compounding. We cut the average time to onboard a new hospital from three weeks to four days because tenant-specific policies, glossaries, and retrieval indices were now just providers plugged into a standard composition. Token usage per note dropped by 22% after we introduced pruning and deduplication in the composer, and median latency improved by 18% due to caching of retrieval fragments keyed by task and tenant. Most importantly, we passed an external privacy audit with zero major findings; the auditor could trace every response to a provider lineage, including the exact policy version in effect. Clinician satisfaction also rose, especially after we A/B tested a new persona provider tuned for concise, guideline-backed summaries—rolled out to 20% of sessions via a feature flag with no risk to policy enforcement.

- Operational impact
  - 60% reduction in prompt-related incidents; when behavior drifted, we could pinpoint the provider and roll back its version.
  - Faster experiments: product teams shipped three instruction variants in parallel by swapping persona and few-shot providers, leaving policy and tools untouched.
  - Governance at scale: one high-precedence Policy provider update propagated across all tenants within hours, with snapshots verifying correct inclusion.

Looking back, the Model-Context-Provider pattern gave us a vocabulary and a set of rails for evolving complex model behavior in a regulated domain. Each stakeholder—policy, knowledge, UX—now owns a provider with clear boundaries, while the composer enforces precedence and budgets. We build faster, we break less, and we can explain exactly why the model did what it did—qualities that matter when your users are clinicians and your regulators ask hard questions.