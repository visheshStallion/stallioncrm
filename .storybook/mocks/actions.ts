/** Server actions are not available in Storybook; every action resolves successfully. */
const ok = async () => ({ ok: true as const, data: { message: "Saved (storybook)" } });
export const setPreferenceAction = ok;
export const setFiltersAction = ok;
export const logoutAction = ok;
export const createLeadAction = ok;
export const createDealFormAction = ok;
export const updateDealAction = ok;
export const inlineEditLeadAction = ok;
export const massOwnerAction = ok;
export const massStatusAction = ok;
export const checkDuplicatesAction = async () => ({ ok: true as const, data: { sameBrand: [], existsElsewhere: false, contacts: [] } });
