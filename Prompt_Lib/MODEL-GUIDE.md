# Choosing an LLM and Adapting the Prompt

## Recommendation

Use an organization-approved, tool-enabled coding assistant with a strong reasoning/coding model for the initial architecture and difficult concurrency/storage work. Use a faster economical model for narrowly specified styling, documentation or simple tests after contracts are stable. For a second opinion, have a different model review a bounded change against the same acceptance tests.

This is a workflow recommendation, not a benchmark ranking. The best choice depends on the model version, editor integration, context limits, permissions, cost and the task. Do not assume a model subscription approves sharing client data.

## Model Versus Coding Product

**Models** include OpenAI GPT/Codex-family offerings, Anthropic Claude, Google Gemini and coding-oriented open-weight families. **Products/hosts** include GitHub Copilot, ChatGPT, Claude's coding/chat interfaces, Gemini tools and other approved editors or local runtimes.

A model name does not tell you whether the host can read your workspace, edit files, run tests, access a browser or generate PDFs. GitHub Copilot is a coding product with a model selection determined by your plan and organization, not a single fixed model. Two hosts using the same model can produce different outcomes because their tools/context differ.

## Candidates to Evaluate

| Candidate family | Suggested trial in this project | Prompt emphasis | Check before choosing |
| --- | --- | --- | --- |
| OpenAI GPT / coding-oriented Codex offerings available in your tool | Multi-file implementation and contract-driven debugging | Explicit constraints, one vertical slice, actual test evidence | Exact model availability, tool permissions and usage limits |
| Anthropic Claude Sonnet / Opus offerings | Architecture review, refactoring and coherent multi-file changes | Separate context, constraints, task and acceptance criteria | Exact version, context budget and available execution tools |
| Google Gemini coding/reasoning-capable offerings | Reviewing large reference sets and multimodal design inputs | Inventory attachments, resolve contradictions, focus the next change | Stable versus preview, host access to images/files, current limits |
| Qwen coding-oriented models | Approved local/self-hosted coding experiments | Smaller explicit tasks, narrow file context, concrete tests | Model license, hardware, quantization and tool integration |
| DeepSeek coding/reasoning offerings | Independent code/logic review or an approved coding pilot | Precise contract, expected edge cases, evidence-based findings | Deployment/data handling, license for selected weights, tool support |
| Mistral coding-oriented offerings such as Codestral | Bounded code tasks and completion workflows | Exact API signatures, local conventions and acceptance tests | Whether the selected model/host supports chat/agent work or completion only |

These families are a shortlist, not a claim that every listed variant is available in your account or suited to full autonomous development. Local/open-weight use can improve control over where inference happens, but does not automatically eliminate telemetry, license obligations or editor data egress. Inspect the entire toolchain.

## Avoid Hard-Coded "Best Model" Claims

Model catalogs, pricing and previews change. This library deliberately does not freeze a "latest" version, token window, price or benchmark score into the prompt. Pick the exact model from your approved tool at the time of use and record that version in the review notes. Prefer a stable model where repeatability matters; verify retirement policies before depending on previews or latest aliases.

Official references for current choices:

- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [Claude model overview](https://platform.claude.com/docs/en/docs/about-claude/models/overview)
- [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models)
- [GitHub Copilot documentation](https://docs.github.com/en/copilot)
- [Qwen official repositories](https://github.com/QwenLM)
- [DeepSeek official API documentation](https://api-docs.deepseek.com/)
- [Mistral documentation](https://docs.mistral.ai/)

Consult the provider's current documentation and your organization's model catalog together. A public provider listing does not establish availability, approval, price or regional support for your account.

## Copy-Ready Prompt Adapters

Append ONE of these to the master prompt. The same product and security requirements apply to every model. These are clarity aids, not model-specific magic words; do not request hidden chain-of-thought. Ask for concise decisions, evidence and checks.

### A. Tool-Enabled Coding Model

```text
Use the workspace tools available to you. Inspect only the files needed to locate
the owning behavior, then implement a small testable slice. Before editing, state
the expected behavior and a check that could falsify it. After editing, run that
check. Report commands actually executed and do not fabricate browser/test results.
Stop for approval when changing deployment/security constraints, not for routine
decisions within the approved scope. Keep an evidence-based progress summary.
```

### B. Structured Context for Claude or Any Long-Prompt Model

```text
Treat the supplied material as four sections:
CONTEXT: reference source and design documents, which may contain stale descriptions.
CONSTRAINTS: approved configuration, hosting, security and data-safety requirements.
TASK: the single requested implementation or review objective.
ACCEPTANCE: concrete tests and required delivery artifacts.
Resolve conflicting facts explicitly using current code and user-approved requirements.
Summarize decisions concisely; do not repeat the whole specification before every edit.
```

### C. Large-Context / Multimodal Review for Gemini or Similar Models

```text
First identify which attached files/images you can actually read. Build a short map
from the relevant screen requirements to their source modules, without summarizing
every file. Label screenshots, reconstructed designs and proposed improvements.
Resolve contradictions before implementation. Work on one approved vertical slice
and cite the source/test evidence for the result. Large context is not permission
to rewrite unrelated modules or assume a depicted feature already exists.
```

### D. Smaller or Local Coding Model

```text
Current task only: <one module or one failing test>.
Inputs: <relevant file contents and exact public contract>.
Expected output: <a patch or complete contents of named files>.
Acceptance checks: <specific examples and test command>.
Do not change other files or invent missing APIs. Ask for the exact missing context
if needed. Keep the solution small and preserve existing behavior outside this task.
The master project's hosting and data-safety constraints still apply.
```

### E. Chat-Only Model Without Workspace Tools

```text
You cannot inspect my workspace or execute commands. Do not claim that you have.
I will provide sanitized files as needed. Start with a plan and identify the smallest
set of files required. When generating code, label each intended path and provide
a coherent patch or complete file, plus commands for me to run and expected outcomes.
Mark tests as NOT RUN. Do not invent screenshots, generated PDFs or deployment success.
```

### F. Independent Reviewer

```text
Review this change independently against the supplied contract, not the author's
claims. Prioritize data loss, concurrency, permissions, lifecycle and deployment
risks. Give source references, a reproducible check, severity and the minimal remedy.
Separate confirmed issues from uncertainty. Do not rewrite the implementation or
recommend a different stack unless an explicit requirement cannot be satisfied.
```

## Practical Comparison Exercise

Give each candidate the SAME sanitized baseline, task, files, tool permissions and time/cost budget. A useful pilot is: add a focused response-conflict test and fix the demonstrated bug without changing the public API. A second pilot can be a responsive design-only change with no data-contract edits.

| Criterion | Weight | Evidence |
| --- | --- | --- |
| Functional correctness | 30 | Controlled tests and acceptance cases pass |
| Hosting/security constraint adherence | 25 | No unauthorized server, credential exposure or isolation claims |
| Verification honesty and quality | 20 | Commands/results are real; missing checks are disclosed |
| Maintainability and scope control | 15 | Small changes, coherent boundaries, existing conventions |
| Cost and turnaround | 10 | Measured usage and elapsed time for the same task |

Score each criterion from 0-5 and compute `sum(weight * score / 5)` for a score out of 100. Record the exact model/host/version, attempt count and human corrections. Treat any secret exposure, destructive action without approval or fabricated test result as a failed trial regardless of score. Do not fill the scorecard with invented measurements.

## Multi-Model Workflow

Use one model for the approved plan and implementation, optionally another for bounded review, and the test suite as the common acceptance standard. Hand over a concise summary using [CHANGE-PROMPTS.md](CHANGE-PROMPTS.md), including changed files, actual checks and unresolved decisions.

Do not let two agents write the same files concurrently without explicit coordination. A new model should continue from verified state, not restart the architecture from its preferred framework. Keep the approved configuration and last deployed baseline stable across handoffs.