# AGENT_RUNTIME.md

## Run state machine

`idle → planning → running ⇄ paused → completed | failed | cancelled`
Interruption recovery marks mid-flight runs `interrupted`; destructive actions
are never silently repeated on resume.

## Agent loop

```
run(goal):
  plan = planFn(goal)                     # deterministic default or model-driven
  graph = TaskGraph(plan)                 # DAG with dependencies
  while step = graph.nextRunnable():
    waitWhilePaused(); breakIfCancelled()
    enforce maxSteps budget               # else TOOL_TIMEOUT
    records = executeStep(step)           # linked-retry attempt loop per call
    failed? -> step FAILED -> run FAILED (structured error)
    else step COMPLETED
  final review -> run_completed
```

## Tool call lifecycle

```
tool_requested(toolCallId, attempt, retriesOf?)
  -> validate input schema            INVALID_TOOL_ARGUMENT stops
  -> permission decide                deny=PERMISSION_DENIED / ask=approval
  -> approval_requested/resolved      user denial is NEVER auto-retried
  -> execute with per-tool timeout    TOOL_TIMEOUT is retryable
  -> retry => NEW ToolCall, retriesOf=<original id>, bounded MAX_TOOL_ATTEMPTS=2
  -> tool_completed | tool_failed
Cancellation (TOOL_CANCELLED) aborts execution and is never retried.
```

## Safeguards

- max steps budget (default 100, configurable)
- repeated identical-action detection (same run+tool+input hash >2 breaks loop)
- per-tool timeouts with cleared timers
- cancellation tokens threaded through every tool (`ctx.signal`)
- pause gates between steps; resume continues the same durable state

## Multi-agent roles (design)

MANAGER delegates; PLANNER owns the task graph; CODER mutates files; RESEARCHER
is read-only; REVIEWER inspects diffs before completion; MEDIA routes image/video.
Concurrency, depth and self-spawn are bounded. Delegations persist as events.
