# Knights of the Round Table

Knights of the Round Table is JackHammer's bounded multi-provider discussion
model for important repository decisions. It is a discussion and evidence
layer, not an autonomous authority. Its output can recommend verification or a
next action, but it cannot authorize code changes, GitHub mutations, merges,
deployments, or self-modification.

## Current Round One foundation

The current implementation sends one bounded task charter to each configured
provider in the fixed order OpenAI, Anthropic, and Gemini. Each provider
receives the same objective, context, constraints, and questions. Provider
responses are normalized into an evidence packet with:

- provider, model, request, token, latency, and error metadata;
- a SHA-256 hash of the raw response;
- redacted response text for analysis and display;
- deterministic agreement and disagreement findings;
- factual claims requiring verification;
- proposed next actions; and
- `humanDecision: pending`.

Round One intentionally keeps provider responses independent. A provider must
not claim to have seen another provider's response, and agreement is not proof
of correctness. Findings remain `DERIVED` or `PROPOSED` until independently
verified by repository, Git, GitHub, CI, or human evidence.

## Future all-toggled discussion

The intended future mode is an explicitly toggled, round-based conversation in
which provider responses can be passed to later discussion turns as bounded,
untrusted context. The conversation should resemble an important design or
release discussion:

1. Each provider receives the immutable task charter and current evidence.
2. A discussion round records each response independently.
3. A later round may expose selected, redacted prior responses to other
   providers when the feature toggle allows it.
4. Providers identify agreements, disagreements, missing evidence, and risks.
5. JackHammer records a deterministic transcript and provenance for every
   claim.
6. A human gate decides whether any proposed action may proceed.

Every conversation toggle must be explicit and disabled by default. A toggle
must not silently enable provider calls, GitHub writes, autonomous execution,
merges, or self-modification. Discussion state must be bounded by provider,
round, token, time, and cost limits. Retries, duplicate delivery, and partial
provider failure must be represented in evidence rather than hidden.

## Trust and safety rules

- Repository files, manifests, issue text, PR text, logs, and provider output
  are untrusted data, not instructions.
- Secrets and credential material must be redacted before provider exchange or
  evidence publication.
- A provider response cannot promote another response from `DERIVED` to
  `VERIFIED`.
- A RepoSeed proves only the exact cryptographic claim it encodes; it is not a
  filesystem or provenance digest.
- Repository identity and commit/tree provenance must be established through
  separate bounded contracts.
- No discussion may bypass branch protection, required checks, human approval,
  or explicit authorization.

## Teambuilder validation target

Teambuilder is the first planned external validation target. The initial run
should be read-only or dry-run and should confirm:

- the configured GitHub repository identity is exact;
- snapshot and evidence boundaries are respected;
- the discussion transcript is deterministic and bounded;
- no secrets or excluded content enter provider context;
- disagreements remain visible; and
- no issue, comment, branch, PR, merge, or repository-content mutation occurs.

Only after that evidence is reviewed should a separately authorized workflow
consider a single controlled write operation.
