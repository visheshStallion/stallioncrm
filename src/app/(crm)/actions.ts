"use server";

import { cookies } from "next/headers";
import { safeAction } from "@/server/api";
import { signOut } from "@/server/auth";
import { FILTER_COOKIES, getUiFilters, requireContext } from "@/server/request";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };

/** Brand switcher / region filter. Values outside the user's access are discarded. */
export async function setFiltersAction(input: { brandId: string | null; regionId: string | null }) {
  return safeAction(async () => {
    const ctx = await requireContext();
    const c = await cookies();
    for (const [key, name] of [
      ["brandId", FILTER_COOKIES.brand],
      ["regionId", FILTER_COOKIES.region],
    ] as const) {
      if (input[key]) c.set(name, input[key]!, COOKIE_OPTS);
      else c.delete(name);
    }
    return getUiFilters(ctx);
  });
}

export async function logoutAction() {
  const c = await cookies();
  c.delete(FILTER_COOKIES.brand);
  c.delete(FILTER_COOKIES.region);
  await signOut({ redirectTo: "/login" });
}
