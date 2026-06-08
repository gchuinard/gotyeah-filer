import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/app/login-form";

export default async function Home() {
  const session = await getSession();
  if (session?.role === "admin") {
    redirect("/admin");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">Filer</h1>
          <p className="text-balance text-zinc-400">
            Saisis ton adresse e-mail pour accéder à l&apos;espace.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
