"use server";

import { revalidatePath } from "next/cache";
import { safeAction, type ActionResult } from "@/server/api";
import { requireContext } from "@/server/request";
import * as svc from "./service";

type Secret = { label: string; value: string };
type Outcome = { message?: string; secrets?: Secret[] };
const str = (fd: FormData, k: string) => (fd.get(k) ?? "").toString().trim();

export async function startTwoStepAction(): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    const res = await svc.startTwoStep(await requireContext());
    revalidatePath("/security");
    return { message: "Add the key to your authenticator app, then confirm with a code", secrets: [{ label: "Setup key (type it into the app)", value: res.secret }, { label: "Or open this link on the phone", value: res.uri }] };
  });
}

export async function confirmTwoStepAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.confirmTwoStep(await requireContext(), str(fd, "code"));
    revalidatePath("/security");
    return { message: "Two-step sign-in is on" };
  });
}

export async function disableTwoStepAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.disableTwoStep(await requireContext(), str(fd, "code"));
    revalidatePath("/security");
    return { message: "Two-step sign-in is off" };
  });
}

export async function resetUserSignInAction(_prev: unknown, fd: FormData): Promise<ActionResult<Outcome>> {
  return safeAction(async () => {
    await svc.resetUserSignIn(await requireContext(), str(fd, "userId"));
    revalidatePath("/admin/access-review");
    return { message: "Two-step sign-in reset and lockout cleared" };
  });
}
