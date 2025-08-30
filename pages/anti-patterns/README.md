# Anti-Patterns

Not every approach to AI engineering is worth repeating.  
Some practices feel fast or clever at first but collapse under real-world use.  
We call these **anti-patterns**: ways of working or building that lead to fragility, wasted effort, and false confidence.  

The purpose of documenting anti-patterns is not to shame experimentation — it’s to make the traps visible. By naming them, we help teams recognize when they’re falling into old mistakes and steer toward better patterns instead.  

---

## Catalog

### [Black-Box Opaqueness](./black-box-opaqueness.md)  
Treating the model as an unknowable oracle. Fast for demos, but impossible to debug, reproduce, or trust in production.  

### [Hero Agent](./hero-agent.md)  
The “one agent to rule them all” — a giant prompt that tries to do everything. Looks magical in demos, but becomes brittle, unscalable, and unmanageable.  

### [Infinite Debate](./infinite-debate.md)  
Endless arguments that block progress. Without a structure for turning disagreement into paths, teams burn time instead of discovering.  

### [Perma-Beta](./perma-beta.md)  
Staying in “beta” forever. Experiments pile up with no merges, leaving systems unstable, users frustrated, and builders demoralized.  

---

## How to use this section

- **As a warning**: if your team sees itself in one of these stories, pause and reconsider.  
- **As a teaching tool**: share anti-patterns with newcomers so they learn the traps as well as the successes.  
- **As a contrast**: every anti-pattern has a corresponding pattern that shows a healthier alternative.  

Anti-patterns remind us: discovery is valuable, but only if it leads somewhere stable, reproducible, and real.  
