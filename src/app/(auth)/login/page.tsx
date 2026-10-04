import { redirect } from "next/navigation";
import { WipeOfflineData } from "@/components/pwa/PwaClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRequestContext } from "@/server/request";
import { entraLoginAction } from "./actions";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getRequestContext()) redirect("/");
  const sso = !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <WipeOfflineData />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">StallionCRM</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LoginForm />
          {sso ? (
            <form action={entraLoginAction}>
              <Button type="submit" variant="outline" className="w-full">
                Sign in with Microsoft
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
