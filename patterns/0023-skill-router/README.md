# Skill Router

Route tasks to the best tool or specialist agent via explicit criteria, not guesswork.

## Intent

Different tasks require different tools and expertise. Rather than having one agent try to do everything poorly, route each task to the most appropriate specialist based on explicit criteria.

## Problem

Monolithic agents and random tool selection create poor outcomes:
- **Jack-of-all-trades**: One agent trying to handle everything
- **Random selection**: Picking tools without clear criteria
- **Capability mismatch**: Wrong tool for the job
- **No specialization**: Agents can't develop deep expertise
- **Inefficient resource use**: Expensive models used for simple tasks

## Solution

Intelligent routing system that matches tasks to optimal handlers:

```
Incoming Task
    ↓
TASK ANALYSIS
- Extract task type, complexity, constraints
- Identify required capabilities
- Assess resource requirements
    ↓
CAPABILITY MATCHING
- Compare against available agents/tools
- Score compatibility and efficiency
- Consider current load and availability
    ↓
ROUTING DECISION
- Select best-match handler
- Provide task context and parameters
- Set up monitoring and fallbacks
    ↓
EXECUTION + FEEDBACK
- Monitor task execution
- Collect performance data
- Update routing intelligence
```

Key components:
- **Task Classification**: Automatic categorization of incoming work
- **Capability Registry**: Database of agent/tool capabilities
- **Routing Logic**: Rules and ML models for optimal matching
- **Load Balancing**: Consider current capacity and performance
- **Feedback Loop**: Learn from routing decisions over time

## When to Use

- Multiple agents or tools with different strengths
- Tasks with varying complexity and resource requirements
- Need to optimize for cost, speed, or quality
- Want to develop specialized agents for specific domains
- High task volume requiring efficient distribution

## Implementation

1. **Capability Modeling**: Define how to describe agent/tool capabilities
2. **Task Classification**: Build system to analyze incoming tasks
3. **Routing Engine**: Create logic to match tasks to handlers
4. **Registry Management**: Maintain up-to-date capability information
5. **Performance Tracking**: Monitor routing effectiveness
6. **Feedback Integration**: Improve routing based on outcomes

## Benefits

- **Optimal Matching**: Right tool for each job
- **Cost Efficiency**: Use expensive resources only when needed
- **Performance**: Specialists outperform generalists
- **Scalability**: Add new capabilities without changing routing logic
- **Learning**: Routing improves over time with feedback

## Example

**Customer Support Routing System:**

*Available Handlers:*
```yaml
handlers:
  - id: "simple-qa-bot"
    type: "agent"
    capabilities: ["faq", "basic_info", "account_lookup"]
    cost: "low"
    response_time: "instant"
    max_concurrent: 100
    
  - id: "technical-support-agent"
    type: "agent" 
    capabilities: ["troubleshooting", "technical_analysis", "bug_diagnosis"]
    cost: "medium"
    response_time: "2-5 minutes"
    max_concurrent: 20
    
  - id: "human-specialist"
    type: "human"
    capabilities: ["complex_issues", "escalations", "account_modifications"]
    cost: "high"
    response_time: "15-30 minutes"
    max_concurrent: 5
    
  - id: "knowledge-search"
    type: "tool"
    capabilities: ["document_search", "policy_lookup"]
    cost: "very_low"
    response_time: "instant"
    max_concurrent: 1000
```

*Routing Examples:*

```
Task: "What are your business hours?"
Analysis: Simple FAQ, low complexity
Routing: simple-qa-bot (perfect match, instant, cheap)

Task: "My API calls are returning 500 errors"
Analysis: Technical troubleshooting required
Routing: technical-support-agent (specialized capability)

Task: "I need to delete my account and get refund"
Analysis: Complex policy, account modification
Routing: human-specialist (requires human judgment)

Task: "Find documentation about rate limiting"
Analysis: Information retrieval
Routing: knowledge-search + simple-qa-bot (search + summarize)
```

*Routing Logic:*
```python
def route_task(task):
    # Analyze task requirements
    requirements = analyze_task(task)
    
    # Find capable handlers
    candidates = find_capable_handlers(requirements)
    
    # Score by multiple criteria
    scores = []
    for handler in candidates:
        score = calculate_score(
            capability_match=handler.capability_score(requirements),
            cost_efficiency=handler.cost_score(requirements),
            availability=handler.current_availability(),
            historical_performance=handler.past_performance(requirements)
        )
        scores.append((handler, score))
    
    # Select best match
    best_handler = max(scores, key=lambda x: x[1])[0]
    
    # Route with fallback
    return route_with_fallback(task, best_handler, candidates[1:])
```

The router continuously learns from task outcomes to improve future routing decisions, ensuring that each task gets handled by the most appropriate resource while optimizing for cost, speed, and quality.
