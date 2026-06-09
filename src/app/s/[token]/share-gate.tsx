"use client";

import { useActionState } from "react";
import { enterShare, type EnterState } from "@/app/s/[token]/actions";

const initialState: EnterState = {};

export function ShareGate({
  token,
  cta = "Accéder au fichier",
}: {
  token: string;
  cta?: string;
}) {
  const [state, formAction, pending] = useActionState(enterShare, initialState);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="email" className="sr-only">
        Adresse e-mail
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="ton.email@exemple.com"
        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-base text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-zinc-100 px-4 py-3 text-base font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-60"
      >
        {pending ? "Vérification…" : cta}
      </button>
      {state.error && (
        <p className="text-sm text-red-400" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
