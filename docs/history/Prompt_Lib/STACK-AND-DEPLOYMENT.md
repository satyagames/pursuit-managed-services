# Stack, Database and Hosting Choices

Use this as a decision guide alongside [PROJECT-CONFIG.json](PROJECT-CONFIG.json). The alternatives below are **not approved deployments** for the current organization. Only the SharePoint-static baseline matches the known hosting constraint.

## 1. Coherent Profiles

| Profile | Frontend | Production data/API | Hosting | Appropriate when |
| --- | --- | --- | --- | --- |
| A: sharepoint-static | Vanilla ES modules; optional compiled static SPA | Browser -> same-origin SharePoint REST -> Lists | Approved SharePoint document library | No separate server/SPFx permitted |
| B: node-postgres | React + TypeScript + Vite, or vanilla/Vue | Node + Express -> PostgreSQL | Approved Linux/Windows server or container host | Server-side authorization and normalized responses are needed |
| C: python-postgres | React/Vue/static frontend | FastAPI + SQLAlchemy + Alembic -> PostgreSQL | Approved Python service/container host | Team prefers Python backend ownership |
| D: dotnet-postgres | React/Vue/static frontend | ASP.NET Core + EF Core -> PostgreSQL | Approved IIS/Kestrel or container host | Team operates a .NET service stack |
| E: local-sqlite | Any static frontend | One approved API process -> SQLite | Single machine with durable disk | Small controlled deployment with deliberate single-instance limits |

ASP.NET Core plus SQL Server is another coherent .NET variant if supported by the team. Choose one actual provider and migration strategy; do not scaffold multiple databases merely to demonstrate flexibility.

### Recommended Selection

- **Recreate today's approved deployment:** Profile A.
- **Change only frontend maintainability:** consider React/Vue/TypeScript compiled to static assets while keeping Profile A's REST adapter and permissions. A framework is optional, not necessary for this app.
- **Need genuine participant-level isolation and enforceable admin roles:** assess Profile B, C or D after server/identity approval. A frontend rewrite alone cannot supply those guarantees.
- **Small offline local demonstration:** existing JSON may be sufficient. SQLite adds constraints/transactions but does not itself create a production deployment or offline browser sync.

## 2. Frontend Swap Boundaries

| Change | Retain | Rework and verify |
| --- | --- | --- |
| Vanilla JS -> TypeScript | Domain behavior, HTTP/list schema, CSS | Types, build pipeline, deployment output; types are not runtime validation |
| Vanilla -> React/Vue | Data contracts, aggregation, API adapter | Screen lifecycles, routing, state ownership, event cleanup, accessible controls |
| Existing CSS -> new design system | Save/resume/authorization rules | Tokens, components, responsive states, contrast and bundle dependencies |
| Hash -> history routing | Domain operations | Host rewrite support and nested URL handling; not the default for SharePoint files |
| Static SPA -> SSR framework | Selected domain contracts | A server runtime, auth/caching boundaries and hosting approval |

For a SharePoint-hosted compiled SPA, set the correct asset base, preserve relative URLs and hash navigation, and ensure all chunks are uploaded. Hashed filenames mean the changed entry HTML and every newly referenced chunk must ship together. Retain old chunks until old browser sessions have been considered. A static export cannot provide server actions or API routes.

## 3. Database Comparison

| Storage | Strengths | Constraints / security | Suggested response representation |
| --- | --- | --- | --- |
| Local JSON files | Transparent fixtures, no database setup | Single-process queue; no production auth, cross-file transactions or relational constraints | Baseline per-session blob |
| SharePoint Lists | Fits approved tenant and browser identity | List thresholds, ETag conflicts, text limits; shared blob lacks participant isolation | Baseline blob for compatibility; redesign requires migration |
| SQLite | Transactions, relational constraints, simple file deployment | Durable local volume, write contention, deliberate single-instance topology | One response row per track/question |
| PostgreSQL | Constraints, transactions, indexes, mature operations | Requires approved API/database hosting, roles, migrations, backups | Normalized response rows; join tables for ordered relationships |
| SQL Server | Relational transactions and enterprise tooling | Hosting/licensing/operations decisions; provider-specific migration details | Normalized response rows |
| Document database | Flexible records and some partition-local operations | Partition design, item limits, transaction scope and conditional writes vary by provider | Per-track/per-response records based on access pattern |

Managed databases and backend-as-a-service products can reduce operations but add external hosting, identity and data-governance decisions. Never place a database connection string or privileged service key in browser JavaScript. Direct browser SDK access requires reviewed row/document-level security, not a hidden URL.

### Relational Migration Outline

1. Preserve string application IDs and original ownership. Map session/section/question ordering to explicit ordered relationship tables where needed.
2. Normalize each response to sessionId, trackId, questionId, answer payload and timestamp; constrain the current track-owned response key uniquely.
3. Define legacy client-owned/anonymous response treatment before migration. Do not drop or fabricate ownership.
4. Use a transactional token claim and track creation where feasible, with unique/conditional constraints, not an unguarded read-then-write.
5. Validate answer IDs/types, indexes, foreign keys and permitted deletion behavior. Match current result semantics through contract tests.
6. Dry-run on an approved sanitized export; compare entity counts, answer counts, ordering and chart/export totals. Plan maintenance freeze, cutover and rollback.

The existing starter-seed export excludes participant history and is not a complete migration or backup tool.

## 4. Production Server Topology

### Profile A: No Separate Production Server

```text
Signed-in browser
  -> SharePoint document library: HTML/CSS/JS/assets
  -> Same site's REST endpoints: list items and logo library
```

Node runs only on the developer's machine for local API/tests/build/export. SharePoint does not execute Express, FastAPI, .NET, SSR or a SQL connection from an uploaded folder. Hosted admin content edits write lists directly. Uploading code does not synchronize local seed JSON.

### Profiles B-D: Approved Server Required

```text
Browser -> HTTPS reverse proxy -> static frontend
                             -> authenticated application API
Application API -> private database
Application API -> approved asset storage
Identity provider -> browser/API authentication and verified authorization
```

Prefer a same-origin frontend/API deployment when practical; otherwise configure exact CORS origins and the appropriate credential/CSRF protections. CORS is not authorization. Use least-privilege runtime identities and keep database ports private.

Required production deliverables: dependency/runtime versions; service/container process definition; secret injection; TLS and renewal; health/readiness endpoints; logs/metrics; durable volumes or managed database; migration procedure; backup/restore drill; controlled rollout and rollback. Browser polling is sufficient unless event scale warrants a different approved transport.

## 5. Configuration Recipes

Edit the indicated fields in the full JSON, not just the profile name. The example values are design inputs; the LLM must reconcile all related fields and propose a coherent configuration diff before coding.

### React on SharePoint, Same Backend

```text
architecture.profile = sharepoint-static
architecture.frontend = react
architecture.language = typescript
architecture.frontendBuild = vite-static
architecture.contracts = typescript-and-runtime-validation
architecture.routing = hash
Keep productionBackend, productionDatabase, productionServer, identity and
deployment restrictions unchanged. Verify asset-base/chunk deployment.
```

### Node API and PostgreSQL, Only After Approval

```text
architecture.profile = node-postgres
architecture.frontend = react
architecture.language = typescript
architecture.frontendBuild = vite-static
architecture.productionBackend = node-express
architecture.productionDatabase = postgresql
architecture.responseStorage = normalized-response-rows
architecture.productionServer = approved-node-service
architecture.localDatabase = postgresql
deployment.target = approved-server
deployment.separateProductionServerAllowed = true
identity.participant = approved-identity-design-required
identity.authorization = server-enforced-roles-and-response-ownership
features.sharePointSetupAndSeedImport = false
Keep approval before deployment. Choose whether to retain a PIN as a cosmetic
gate; it cannot replace server roles. Replace SharePoint-specific release steps
with server/database steps while retaining an exact artifact/migration manifest.
```

For Python, change the local and production API runtimes together and select Python dependencies/migrations. For .NET, choose a supported SDK/runtime and EF provider. These changes require corresponding local commands/tests; do not leave Express launch scripts behind accidentally.

## 6. Combinations to Reject

| Request | Why it conflicts | Correct next step |
| --- | --- | --- |
| PostgreSQL directly from a SharePoint HTML page | Exposes privileged access and lacks an approved API boundary | Approve a server or stay on Lists |
| Anonymous participants with current browser SharePoint REST | Existing identity and permissions are required | Approve a different access architecture |
| Strong per-participant privacy with editable shared response blobs | List-level access can expose/change other answers | Redesign security/storage before claiming isolation |
| WebSockets with no server or approved messaging service | Static hosting supplies no application socket runtime | Retain polling or approve hosting |
| SSR/server actions uploaded as static files | Requires a runtime absent from the library | Static-only build or approved server |
| Multi-instance deployment with local JSON/SQLite on ephemeral disks | Durability and concurrency model do not match | Use an appropriate shared database/topology |
| Turn on offline mode with only a feature flag | Requires durable queue, identity expiry and conflict reconciliation | Separate feature design and tests |

## 7. Exact Release Manifest

Each change must distinguish **artifact**, **schema**, **records**, **configuration**, and **operations**. For manual SharePoint upload, group changed build files by existing destination subfolder. Do not claim a complete delta without a known deployed baseline or content hashes. Never use recreated build timestamps alone.

Record prerequisites, upload order, active-session implications, cache reload, validation and rollback. Content edited in hosted Admin normally needs no artifact upload. Documentation-only changes need neither app build nor SharePoint list changes.