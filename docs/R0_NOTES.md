# R0 Release Notes

> Historical baseline from 2026-09-16. For the current runnable monorepo,
> setup and verified capabilities, use [README.md](../README.md) and
> [PRODUCT_POLISHING_ROADMAP.md](./PRODUCT_POLISHING_ROADMAP.md).
> Font Awesome is now bundled locally; the old CDN and bundle figures below
> describe that earlier baseline, not the current release.

> Status: G0 passed (2026-09-16). R0 small wrap-up items being closed in this
> round. R1 work (DEV-004 ~ DEV-010) is the next milestone per
> [SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md](./SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md).

## What R0 includes

Per the framework doc §1.3, the R0 ("团队基础版", week 6) must-have list:

- Account, workspace, membership and project permissions
- Projects, logs, timeline (the current `App.tsx` + `components/Timeline.tsx`)
- Data migration (the JSON import/export in `App.tsx`)
- Comments and saved feedback (P2P live collaboration via `hooks/useLiveCollaboration.ts`)

Explicitly **deferred** for R0: AI capabilities, Discovery (insights/opportunities), and complex collaborative rich-text editing.

## Wrap-up items closed in this round

| # | Item | Status | Reference |
|---|---|---|---|
| 1 | Unify version references (was incorrectly labelled "R5"; AI actually lands in R1 / S5) | ✅ | `services/geminiService.ts`, `App.tsx`, `README.md` |
| 2 | Render AI affordances as visibly disabled instead of clickable | ✅ | `components/LogEditor.tsx` "Draft Summary" button + handler |
| 3 | Add `.gitattributes` so future checkouts stay LF; recommend a separate "chore: normalize line endings" commit before bundling functional changes | ✅ | `.gitattributes` |
| 4 | Document non-blocking issues so R1 can pick them up cleanly | ✅ | this file (see below) |

## Non-blocking issues tracked for R1

These are intentionally left open because fixing them is out of scope for R0 and they do not block G0 sign-off.

### NB-1 · Font Awesome still served from a CDN

`index.html` includes

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" crossorigin="anonymous">
```

Implication: the project is **not** fully offline-runnable; a blocked CDN means icon-less UI. The Tailwind CDN was already removed in this round.

Suggested fix in R1: install `@fortawesome/fontawesome-free` (or self-host the subset of icons actually used) and import the CSS through `index.css`. Per the framework doc §4.1: "样式构建进入项目，去掉运行时 Tailwind CDN" — the same principle applies to Font Awesome.

### NB-2 · Production bundle exceeds Vite's default chunk-size warning

Current `npm run build` output:

```
dist/assets/index-DgZZdPDu.css   39.50 kB │ gzip:   6.72 kB
dist/assets/index-Bx24lLVC.js   626.38 kB │ gzip: 176.71 kB
```

Vite emits:

```
(!) Some chunks are larger than 500 kB after minification.
```

Implication: first paint is gated on a single 626 KB JS payload. Acceptable for the internal R0 demo but not for the R1 pilot where BR-03 (no unexpected horizontal overflow at 1280×800) and the §10.1 perf targets start to apply.

Suggested fix in R1 (after TanStack Router + Query land):

1. Code-split per route via `React.lazy` + `Suspense`.
2. Configure `build.rollupOptions.output.manualChunks` to separate `react`, `yjs`, `y-webrtc`, `html2canvas`, and icon-font CSS.
3. Aim for: initial route ≤200 KB gz; secondary routes ≤100 KB gz each.

## R1 (G1) sequence

Per the framework doc §8.1 (S1 = weeks 3–4, G1) and §8.2 (DEV-004 ~ DEV-006), the immediate next slice is:

1. **Identity & user model** (DEV-004) — sessions, invitations, password reset.
2. **Workspace / tenant data model** (DEV-005) — RBAC, project membership, revision, audit.
3. **API skeleton + OpenAPI** (DEV-006) — NestJS + Fastify + Prisma, error/pagination contracts, Outbox scaffolding.
4. **Frontend API client, login state, route guards** (DEV-008 sub-tasks) — TanStack Query, TanStack Router, session cookie handling.
5. **PostgreSQL migrations + seed data** — workspaces, users, memberships, project skeletons.
6. **Acceptance coverage for AC-01 ~ AC-08** — Vitest + integration tests against a real Postgres.

### Open architectural decisions still pending S0 sign-off (per §12.2)

- Backend language & ORM (default: TypeScript / NestJS / Prisma)
- First auto-integration (GitHub vs. Codeup vs. Linear)
- Production storage / region
- AI vendor (deferred until R1 S5)
