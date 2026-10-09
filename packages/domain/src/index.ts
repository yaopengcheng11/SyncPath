// @syncpath/domain — pure business rules.
//
// Hard rule: this package must not import from
//   - @nestjs/* / NestJS DI / decorators
//   - @prisma/client / Prisma runtime
//   - node:fs / node:net / any Node-only API
//   - DOM globals (window, document, localStorage)
//
// Rationale: per docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md §4.3
// ("依赖方向：Web → api-client / ui；API 和 Worker → backend → domain"),
// the domain layer is the only shared truth between API, Worker, and any
// future client. Keeping it dependency-free makes that possible.

export * from './roles';
export * from './permissions';
export * from './ids';
