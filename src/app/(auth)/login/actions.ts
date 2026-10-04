"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/server/auth";

export async function loginAction(
  _prev: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string }> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
    return {};
  } catch (err) {
    // A successful sign-in throws a redirect, which must propagate.
    if (err instanceof AuthError) return { error: "Invalid email or password." };
    throw err;
  }
}

export async function entraLoginAction() {
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}
