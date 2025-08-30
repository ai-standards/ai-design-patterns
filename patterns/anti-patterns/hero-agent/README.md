# Anti-Pattern: Hero Agent

**Also known as**: “One Prompt to Rule Them All,” “God Agent”  
**Intent (gone wrong):** Solve every problem with a single, giant, all-knowing agent.

---

## Introduction

Early in AI development, it’s tempting to imagine the perfect “hero agent” — one model prompt or persona that can do *everything*. Just throw the whole problem at it, and trust that with enough tokens and clever wording, it will reason, plan, and execute flawlessly.  

The appeal is obvious: it feels simple, centralized, and powerful. One agent, one brain, one interface to rule them all. In demos, it often looks magical. But the bigger the agent, the bigger the hidden risks.  

Like monolithic apps in early software, the hero agent quickly becomes bloated, fragile, and impossible to evolve. Instead of empowering teams, it traps them: every improvement is tangled, debugging is chaotic, and failures cascade through the whole system.

---

## Why teams use it

- **Prototype pressure** — fastest way to show something flashy is one giant prompt.  
- **Illusion of simplicity** — one agent means fewer moving parts… at first.  
- **Narrative appeal** — investors, executives, or customers love the story of “one AI that does it all.”  
- **Fear of complexity** — splitting agents into roles feels harder without good patterns.  

---

## Pitfalls

- **Brittleness** — small changes in prompts or context cause massive, unpredictable shifts in behavior.  
- **Un-debuggable** — when something goes wrong, you can’t isolate the failure. Was it planning, tool use, or output formatting? All are tangled together.  
- **Unscalable** — adding features just piles on more instructions until the prompt is unmanageable.  
- **Latency & cost explosion** — huge prompts, sprawling context, and sprawling outputs drive up token usage.  
- **Team bottleneck** — improvements depend on one “prompt whisperer” who understands the tangled mega-agent.  
- **False confidence** — because the hero agent sometimes works, teams assume it can do anything if they just “tune the magic.”  

---

## How to avoid it

The solution is to treat agents like software components: **small, composable, specialized**. Instead of a hero, build a *team of agents* with clear boundaries and contracts. This makes failures diagnosable, costs measurable, and improvements incremental.  

Think of it like breaking down a monolith into microservices: each agent does one job well, controllers orchestrate their outputs, and the system grows by composition, not accretion. The shift feels slower at first, but it pays off in stability, scalability, and clarity.  

### Practices
- **Apply ACV (Agent / Controller / View)** — separate reasoning, tool orchestration, and UI.  
- **Use Tool Adapters** — wrap tool calls in strict schemas so agents don’t need to carry every detail.  
- **Compose paths, don’t bloat prompts** — add new specialized agents instead of stacking more onto the hero.  
- **Sandbox & fallback** — isolate risky actions in controlled sub-agents with explicit rollback options.  
- **Evaluate agents independently** — test each role separately before merging into the system.  
