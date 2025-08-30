# Automation Strategies

Automation strategies describe how agentic systems execute real work under constraints.  
They answer the question: *how do we let agents act—at the right time, with the right permissions, and the right oversight—without creating chaos?*

These patterns cover autonomy levels, approval gates, planning vs execution roles, skill routing, and when to run automation.

---

## Catalog

### [Autonomy Levels](../patterns/automation-strategies/autonomy-levels/)  
Define graduated permission tiers for agents, from read-only to fully autonomous, tied to risk and context.

### [Approval Gates](../patterns/automation-strategies/approval-gates/)  
Insert lightweight human checkpoints at high-risk steps, with clear SLAs and fallback behavior.

### [Planner–Worker Decomposition](../patterns/automation-strategies/planner-worker-decomposition/)  
Split problem solving (plans) from action taking (workers) so you can audit intent separately from execution.

### [Skill Router](../patterns/automation-strategies/skill-router/)  
Route tasks to the best tool or specialist agent via explicit criteria, not guesswork.

### [Batch & Schedule Windows](../patterns/automation-strategies/batch-and-schedule-windows/)  
Run automations at the right cadence and time windows to reduce cost, load, and disruption.

---

## Why Automation Strategies Matter

Architecture gives structure and Operations keep production safe, but day-to-day execution still fails without clear automation rules.  
These strategies ensure agents act with appropriate permission, the right human touchpoints, and predictable timing—so automation compounds, rather than amplifies risk.
