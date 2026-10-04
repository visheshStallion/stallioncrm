import { itemRoute, updateRoute } from "@/server/modules/inventory/routes";

/** One unit, journal or document – 404 for other brands (and, for sales users, for units that are not theirs to see). */
export const GET = itemRoute;
export const PATCH = updateRoute;
