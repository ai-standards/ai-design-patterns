# Approval Gates

Insert lightweight human checkpoints at high-risk steps, with clear SLAs and fallback behavior.

## Intent

Some agent actions are too risky to perform without human approval, but requiring approval for everything kills productivity. Approval gates provide strategic checkpoints that balance safety with efficiency.

## Problem

Traditional approval processes are often:
- **Too broad**: Everything requires approval, creating bottlenecks
- **Too slow**: No SLAs, agents wait indefinitely for human response
- **Unclear criteria**: Humans don't know what they're approving
- **No fallbacks**: System stops when humans are unavailable
- **Context-poor**: Approvers lack information to make good decisions

## Solution

Strategic approval gates with clear criteria, SLAs, and fallback behavior:

```
High-Risk Action Detected
    ↓
Present Approval Request
- Clear action description
- Risk assessment
- Recommended decision
- Context and alternatives
    ↓
Human Response (with SLA)
- Approve: Execute action
- Reject: Log reason, suggest alternatives
- Modify: Adjust parameters, re-submit
- Timeout: Execute fallback behavior
    ↓
Action Execution + Logging
```

Key components:
- **Risk Triggers**: Automatic detection of high-risk scenarios
- **Context Packaging**: All information needed for approval decision
- **SLA Management**: Clear timeouts with escalation paths
- **Fallback Strategies**: What happens when humans don't respond
- **Learning Loop**: Patterns that improve gate placement over time

## When to Use

- Actions have significant business or technical risk
- Regulatory requirements mandate human oversight
- Trust in agent capabilities is still building
- Consequences of errors are expensive or irreversible
- You need audit trails showing human approval for key decisions

## Implementation

1. **Risk Identification**: Define what triggers an approval gate
2. **Context Assembly**: Package all information needed for decision
3. **Approval Interface**: Create clear, actionable approval requests
4. **SLA Definition**: Set response time expectations
5. **Fallback Logic**: Define behavior when approval times out
6. **Monitoring Setup**: Track approval patterns and bottlenecks

## Benefits

- **Risk Mitigation**: Human oversight for dangerous actions
- **Efficiency**: Only high-risk actions require approval
- **Clear SLAs**: Predictable response times
- **Graceful Degradation**: System continues when humans unavailable
- **Learning**: Approval patterns inform future automation

## Example

A deployment agent might have approval gates for:

**High-Risk Deployment** (requires approval):
```
Action: Deploy to production during business hours
Risk: Service disruption during peak usage
Context: 
- Change size: 847 lines modified
- Test coverage: 94%
- Staging results: All tests pass
- Traffic impact: Estimated 50k users affected

Approval Request:
"Deploy customer-auth-service v2.1.4 to production?
- High traffic period (2PM EST)
- Large change set (847 lines)
- All tests passing
- Rollback plan ready

[ Approve ] [ Reject ] [ Schedule for off-hours ]
SLA: Response needed within 15 minutes
Fallback: Auto-schedule for maintenance window"
```

**Low-Risk Deployment** (auto-approved):
```
Action: Deploy documentation update
Risk: Minimal
Result: Automatic execution with notification
```

The gate provides just enough friction to catch dangerous actions while allowing safe automation to flow freely.
