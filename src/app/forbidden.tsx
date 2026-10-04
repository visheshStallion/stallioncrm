import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-5xl font-bold text-muted-foreground">403</p>
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Your profile does not allow access to this area. Ask your CRM administrator if you need it.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to home</Link>
      </Button>
    </main>
  );
}
