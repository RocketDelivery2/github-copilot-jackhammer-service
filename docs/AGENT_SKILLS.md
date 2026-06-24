# JackHammer Agent Skills (Progressive Procedural Memory)

## Overview

This PR adds a **model-only Agent Skills layer** that stores repeatable procedures as repo-owned skills. A skill is a folder containing `skill.md` with YAML front matter and detailed instructions.

Skills are procedural memory: they encode *how* to perform recurring tasks safely and deterministically.

## Memory Model

- **Semantic memory**: factual knowledge (APIs, docs, architecture facts).
- **Episodic memory**: what happened in recent runs (logs, event journals, session traces).
- **Procedural memory (skills)**: repeatable workflows with ordering, constraints, and judgment.

JackHammer now has explicit procedural memory primitives in `src/skills/`.

## Skills vs MCP, RAG, and Fine-Tuning

- **MCP** provides tool access and external capability boundaries.
- **RAG** provides retrieved reference knowledge.
- **Skills** provide procedural execution patterns (inspect -> decide -> patch -> validate).
- **Fine-tuning** adjusts model behavior statistically; skills provide explicit deterministic instructions.

They are complementary, not interchangeable.

## Progressive Disclosure Tiers

The design follows progressive disclosure to reduce token cost and repeated loops:

1. **Tier 1 (startup): metadata only**  
   Load `name`, `description`, `version`, `risk`, `allowedTools`, `resourceHints`, `keywords`.
2. **Tier 2 (on match): full `skill.md` body**  
   Load full procedural instructions only when a task matches.
3. **Tier 3 (on demand): references/assets/scripts**  
   Load optional files only when needed for the selected skill.

This avoids eagerly loading large instructions or assets for irrelevant tasks.

## Trust Model

`src/skills/trust-policy.ts` classifies resources:

- `skill.md` markdown instructions: allowed for read
- references/assets: allowed for read-only loading
- scripts: require explicit human approval and are not auto-executable

No automatic script execution is introduced in this PR.

## Why This Reduces Looping and API Cost

Recent runs showed repeated rediscovery loops (re-inspecting files, quoting mistakes, retrying failed patch forms). Skills reduce this by:

- giving deterministic inspection guardrails (bounded reads)
- encoding preferred patch/validation sequences
- providing recovery strategy for failures with one next repair command

Result: fewer exploratory turns, fewer repeated command retries, lower token/API spend.

## Included Skills

- `skills/repo-inspection/skill.md`
  - bounded repository inspection
  - blocks full-file dumps by default
  - enforces inspect-then-act decision point after 2-3 probes
- `skills/typescript-patch/skill.md`
  - small, reviewable TypeScript edits
  - bounded inspection before patching
  - deterministic validation sequence
- `skills/validation/skill.md`
  - standard `npm.cmd test`, `npm.cmd run build`, `npm.cmd run lint`
  - concise failure and next-step reporting
- `skills/error-recovery/skill.md`
  - classify failure category
  - emit exactly one next repair command
  - avoid repeating broken command forms
  - prefer here-string/temp-file strategies over fragile multiline `node -e`

## Current Scope

This is **model-only**:

- no runtime orchestration wiring yet
- no production scheduling changes
- no new runtime dependencies
- no secrets/auth/deployment changes

> Update (preview-only): adaptive preview journaling now records **skill-selection metadata** and **dry-run skill execution plans** (planned step summaries, selection reason/rank, trust-policy decisions) when `ADAPTIVE_QUEUE_ENABLED=true`. Script execution remains blocked: no skill scripts are loaded or executed.

## Future Wiring (Recommended)

Next PRs can wire this into preview-only flows:

1. Feed metadata index + deterministic selector into ChatOps bridge planning.
2. Persist selected skill names into adaptive preview journals.
3. Add explicit human-approval checkpoints before any script execution path.
4. Integrate skill selection with adaptive queue preview without affecting production scheduling.
