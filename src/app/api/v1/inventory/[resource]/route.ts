import { createRoute, listRoute } from "@/server/modules/inventory/routes";

/**
 * /api/v1/inventory/{items|warehouses|vendors|vehicle-units|stock|journals|purchase-orders|shipments|receives|bills|
 * landed-costs|transfers|inter-brand-transfers|adjustments|stock-counts|vendor-credits|delivery-notes}
 * – the caller's brands only; cost fields only with inventory finance access.
 */
export const GET = listRoute;
export const POST = createRoute;
