// Public surface of the db layer. The unscoped client is deliberately NOT exported.
export { scopedDb, type ScopedDb } from "./scoped";
export { audit, type AuditEntry } from "./audit";
