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
      // only sent when entered: an undefined value would arrive as the text "undefined"
      ...(String(formData.get("code") ?? "").trim() ? { code: String(formData.get("code")).trim() } : {}),
      redirectTo: "/",
    });
    return {};
  } catch (err) {
    // A successful sign-in throws a redirect, which must propagate.
    // (the class may come from another copy of the auth library: go by the code, not by instanceof)
    const code = err instanceof AuthError ? (err as { code?: string }).code : undefined;
    if (code) {
      if (code === "locked") return { error: "Too many failed attempts – this account is locked for 15 minutes." };
      if (code === "code_required") return { error: "Enter the 6-digit code from your authenticator app." };
      if (code === "slow_down") return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
    }
    if (err instanceof AuthError) return { error: "Invalid email or password." };
    throw err;
  }
}

export async function entraLoginAction() {
  await signIn("microsoft-entra-id", { redirectTo: "/" });
}
