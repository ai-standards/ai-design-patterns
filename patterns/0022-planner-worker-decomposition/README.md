# Planner–Worker Decomposition

Split problem solving (plans) from action taking (workers) so you can audit intent separately from execution.

## Intent

Complex automation often fails because planning and execution are tangled together. By separating the "what to do" from the "how to do it," you can audit, modify, and control agent behavior more effectively.

## Problem

Monolithic agent systems create several issues:
- **Black box execution**: Can't see what the agent plans to do before it acts
- **No intervention points**: Once started, hard to modify or stop
- **Mixed responsibilities**: Planning logic mixed with execution code
- **Poor debuggability**: Hard to tell if failure was in planning or execution
- **No plan reuse**: Each execution starts from scratch

## Solution

Separate agents into distinct planning and execution phases:

```
User Request
    ↓
PLANNER AGENT
- Analyzes the request
- Breaks down into steps
- Identifies required tools/resources
- Creates executable plan
    ↓
PLAN REVIEW (optional)
- Human or automated validation
- Plan modification if needed
- Approval for execution
    ↓
WORKER AGENTS
- Execute individual plan steps
- Report progress and results
- Handle step-level errors
    ↓
Results + Plan Outcome
```

Key separation:
- **Planner**: Understands goals, creates strategies, no execution
- **Workers**: Execute specific tasks, no strategic thinking
- **Plan Format**: Structured, inspectable, modifiable
- **Execution Engine**: Orchestrates workers according to plan

## When to Use

- Complex multi-step automation workflows
- High-risk actions that benefit from plan review
- Need to audit or modify agent intentions before execution
- Different agents specialized for planning vs execution
- Regulatory requirements for explainable automation
- Want to reuse plans across different execution contexts

## Implementation

1. **Plan Schema**: Define structured format for plans
2. **Planner Agent**: Build agent focused on strategy and decomposition
3. **Worker Registry**: Create library of execution-focused agents
4. **Plan Validation**: Add review and modification capabilities
5. **Execution Engine**: Orchestrate workers according to plan
6. **Progress Tracking**: Monitor execution against plan

## Benefits

- **Transparency**: See exactly what agent intends to do
- **Control**: Modify or approve plans before execution
- **Debugging**: Separate planning failures from execution failures
- **Reusability**: Plans can be saved, shared, and reused
- **Specialization**: Agents focused on what they do best
- **Safety**: Review high-risk plans before execution

## Example

**Code Deployment Automation:**

*Planner Agent Output:*
```json
{
  "plan_id": "deploy-auth-service-v2.1.4",
  "goal": "Deploy authentication service update to production",
  "steps": [
    {
      "id": "step-1",
      "action": "run_tests",
      "worker": "test-runner",
      "parameters": {
        "test_suite": "full",
        "environment": "staging"
      },
      "success_criteria": "all_tests_pass",
      "failure_action": "abort_deployment"
    },
    {
      "id": "step-2", 
      "action": "backup_database",
      "worker": "db-manager",
      "parameters": {
        "database": "auth_prod",
        "backup_type": "full"
      },
      "depends_on": ["step-1"]
    },
    {
      "id": "step-3",
      "action": "deploy_service",
      "worker": "k8s-deployer", 
      "parameters": {
        "service": "auth-service",
        "version": "v2.1.4",
        "strategy": "blue_green"
      },
      "depends_on": ["step-2"]
    }
  ],
  "rollback_plan": "rollback-auth-service-v2.1.3",
  "estimated_duration": "15 minutes",
  "risk_level": "medium"
}
```

*Human Review:*
- Plan looks good, but let's deploy during maintenance window
- Modify step-3 to schedule for 2AM EST
- Approve modified plan

*Worker Execution:*
- Test Runner: Executes comprehensive test suite
- DB Manager: Creates production backup
- K8s Deployer: Performs blue-green deployment at scheduled time

Each worker is specialized and focused, while the planner handles the strategic thinking. The plan serves as a contract between intention and execution, with clear intervention points for human oversight.
