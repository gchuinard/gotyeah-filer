"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/actions";

const initialState: LoginState = {};

function ssoErrorMessage(code: string): string {
  switch (code) {
    case "notadmin":
      return "Cette adresse GotYeah n'a pas accès à Filer.";
    case "provider":
      return "Connexion via GotYeah refusée ou annulée.";
    case "unverified":
      return "Adresse email non vérifiée côté fournisseur d'identité.";
    case "noemail":
      return "Le fournisseur d'identité n'a pas transmis d'adresse email.";
    case "disabled":
      return "La connexion via GotYeah est désactivée.";
    default:
      return "Échec de la connexion via GotYeah. Réessaie.";
  }
}

export function LoginForm({
  oidcEnabled = false,
  oidcLabel = "Se connecter avec GotYeah",
  legacyLogin = true,
  ssoError,
}: {
  oidcEnabled?: boolean;
  oidcLabel?: string;
  legacyLogin?: boolean;
  ssoError?: string;
}) {
  const [state, formAction, pending] = useActionState(login, initialState);
  // Fail-safe : on garde la porte email tant que l'OIDC n'est pas confirmé actif.
  const showEmailForm = legacyLogin || !oidcEnabled;
  const error = state.error || (ssoError ? ssoErrorMessage(ssoError) : "");

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      {showEmailForm && (
        <form action={formAction} className="flex w-full flex-col gap-3">
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
            {pending ? "Connexion…" : "Entrer"}
          </button>
        </form>
      )}

      {oidcEnabled && (
        <>
          {showEmailForm && (
            <div className="flex items-center gap-3 text-xs text-zinc-600">
              <span className="h-px flex-1 bg-zinc-800" />
              ou
              <span className="h-px flex-1 bg-zinc-800" />
            </div>
          )}
          <a
            href="/api/auth/oidc/login"
            className={
              showEmailForm
                ? "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-center text-base font-medium text-zinc-100 transition-colors hover:border-zinc-500"
                : "w-full rounded-lg bg-zinc-100 px-4 py-3 text-center text-base font-medium text-zinc-900 transition-colors hover:bg-white"
            }
          >
            {oidcLabel}
          </a>
        </>
      )}

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
