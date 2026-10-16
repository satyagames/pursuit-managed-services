# Prompt Library / Pursuits CEC

Reusable instructions for rebuilding or evolving the application with a different coding LLM. **Created 24 September 2026.** This library does not change the running app, install a new stack or deploy anything.

## Start Here

1. Choose an organization-approved coding assistant and open a **new workspace** for a rebuild. A different model can also work in the existing workspace, but tell it explicitly whether this is a rebuild or an incremental change.
2. Edit [PROJECT-CONFIG.json](PROJECT-CONFIG.json). Defaults match the current SharePoint-only deployment with local Express/JSON development. Replace the site placeholder privately; do not paste confidential addresses into an unapproved service.
3. Read [STACK-AND-DEPLOYMENT.md](STACK-AND-DEPLOYMENT.md) before changing frontend, database or hosting choices. A stack switch requires implementation and migration work, not just a configuration edit.
4. Paste the text between BEGIN PROMPT and END PROMPT in [MASTER-PROMPT.md](MASTER-PROMPT.md). Attach the edited configuration as readable text.
5. Add relevant, sanitized source/design references if available. A model cannot read local links unless its host tool has access to those files.
6. Ask for the compatibility check and plan first. Approve the approach before implementation, provisioning or migration.
7. Use a focused template from [CHANGE-PROMPTS.md](CHANGE-PROMPTS.md) for each later change. Keep the approved product contract and configuration in context.

## File Guide

| File | Purpose |
| --- | --- |
| [MASTER-PROMPT.md](MASTER-PROMPT.md) | Self-contained rebuild specification: product, stack, domain, data contracts, security, tests and delivery |
| [PROJECT-CONFIG.json](PROJECT-CONFIG.json) | Editable technology, features, behavior, design and deployment choices |
| [STACK-AND-DEPLOYMENT.md](STACK-AND-DEPLOYMENT.md) | Stack profiles, database trade-offs, server topology and compatibility rules |
| [CHANGE-PROMPTS.md](CHANGE-PROMPTS.md) | Copy-ready follow-up prompts for implementation, migration, features, design, review and release |
| [MODEL-GUIDE.md](MODEL-GUIDE.md) | Model-family suggestions, host/tool differences, prompt adapters and evaluation scorecard |

## Smallest Useful First Message

```text
I want to recreate Pursuits CEC in a new workspace. Read the attached master
prompt and edited PROJECT-CONFIG.json. Start with requirements, compatibility
checks, blocking questions and an implementation plan. Do not write code yet.
Preserve SharePoint-only hosting unless I explicitly approve another profile.
Do not add AI features to the application. Use synthetic data only.
```

After approval:

```text
Implement the approved plan one tested vertical slice at a time. Start with
configuration, the data boundary and a working join/answer/resume journey.
After each change, report verification and the exact manual SharePoint upload
list, plus any list/schema changes. Do not deploy or modify production data.
```

## What to Change Where

| Desired change | Edit these configuration areas | Then use |
| --- | --- | --- |
| JavaScript to TypeScript; vanilla to React/Vue | architecture.frontend, language, frontendBuild, contracts | Stack migration prompt |
| SharePoint to PostgreSQL | architecture database/backend/server fields AND deployment/identity | Database + hosting prompts; requires approval |
| Add/remove a question type or feature | features and behavior | Feature-change prompt; check dependencies |
| Colors, typography, layout | design; attach relevant screenshots/tokens | Design-only prompt |
| Hosting or server | architecture.profile, productionServer, deployment, identity, operations | Deployment planning prompt |
| Switch coding model | No application configuration change needed | Model adapter and handoff prompt |

The JSON is a **request specification**, not a universal application configuration. Setting a feature to false instructs the LLM to design the appropriate implementation. It does not automatically hide a button in the current app. Removing required capabilities such as independent tracks can conflict with the baseline; require a reviewed contract change, not an incidental omission.

## Context to Share Safely

- [Project README](../README.md) for workflows, behavior and operational constraints.
- [Architecture](../ARCHITECTURE.md) for contracts and implementation ownership; verify exact behavior against current code if documents differ.
- The design package (wireframes and style guidance) was `Design-Docs/`, which left the branch in Phase 10f; it is in git history at `7347c72`. Designs are reconstructed samples, not screenshots proving runtime behavior.
- [QA checklist](../QA-TESTING.md) for acceptance tests.
- [Provisioning guide](../PROVISIONING.md) for complete SharePoint columns when reproducing the current adapter.
- [Deployment guide](../SHAREPOINT-DEPLOYMENT.md) for the active SharePoint-only workflow. Ignore its explicitly archived separate-server proposal unless a new architecture is approved.

Do not attach the private seed export, actual response records, PIN hashes, browser cookies, access tokens or production credentials. Use synthetic fixtures. Confirm the coding service's retention, training and data-residency terms through your organization; a paid plan is not automatically approved for confidential data.

## Version and Scope Notes

The reference implementation currently specifies Node >=22, Express ^5.2.1, Chart.js ^4.5.1, jsPDF ^4.2.1, lean-qr ^2.7.4 and PptxGenJS ^4.0.1 in [package.json](../package.json). These are reference ranges, not recommendations to ignore security updates or compatibility checks. The new project should choose supported compatible versions, pin a lockfile and record the decision.

This folder is ordinary documentation, not auto-loaded editor instructions. To use it, attach/paste the relevant files or explicitly ask the assistant to read them. The master prompt works without the old repository; exact fidelity requires the relevant reference assets and source.

**Deployment impact of this library:** no build required, no SharePoint file uploads, no list changes.