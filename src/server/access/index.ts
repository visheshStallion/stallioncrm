// Access engine – the ONLY place access rules live. See docs/ARCHITECTURE.md.
export * from "./types";
export * from "./modules";
export * from "./errors";
export { brandScopeWhere, isVisible, canWriteTo, hasTerritoryAccess, isManagerOf } from "./visibility";
export { can, assertCan, hasPermission } from "./can";
export { fieldMask, fieldMaskMany, fieldAccess, maskPhone, maskEmail } from "./field-mask";
export { sanitizeFilters, filterWhere, visibleRegionIds, type UiFilters } from "./filters";
export { getAccessContext, loadAccessContext, buildAccessContext } from "./context";
export { resolveTerritory, ensureBrandTerritories, ensureRegionTerritories } from "./territory";
