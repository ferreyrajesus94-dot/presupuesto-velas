import { redirect } from "next/navigation";
import { fetchSessionUser } from "@/server/auth/session";
import { ResendVerificationForm } from "./ResendVerificationForm";
import { VerifyOtpForm } from "./VerifyOtpForm";

export const metadata = { title: "Verificá tu email" };

/**
 * PR3.auth-ui (Task 3.7) + v0.4.0 hotfix — `/verify-email` page.
 *
 * Server component. Renders mode-agnostic "Check your inbox" copy and
 * embeds BOTH the OTP input form (NEW in v0.4.1 hotfix — see
 * VerifyOtpForm) and the resend form. Unsigned visitors are redirected
 * to `/sign-in`.
 *
 * History:
 *  - PR3.2 (task 3.7) shipped only the resend form, leaving users with
 *    no way to submit the OTP. Discovered in production by user testing
 *    on 2026-08-09 after `verify_email_on_sign_up` was finally flipped to
 *    `true`. Hotfix added `verifyEmailOtpAction` + `VerifyOtpForm` and
 *    surfaces both forms here.
 *
 * SPEC amendment 2026-08-07: the copy is INTENTIONALLY mode-agnostic.
 * Whether Neon Auth is configured for `link` or `otp` verification,
 * the user reads the email itself for the action to take (click the
 * link, or copy-paste the code). Hard-coding "click the link" would
 * lie to OTP-mode users.
 */
export default async function VerifyEmailPage() {
  const session = await fetchSessionUser();
  if (!session) {
    redirect("/sign-in");
  }
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-6 bg-canvas px-4 py-10 text-ink">
      <header className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Calculadora Flor
        </p>
        <h1 className="text-2xl font-semibold text-wrap-balance">Revisá tu casilla</h1>
        <p className="text-sm text-ink-muted text-wrap-balance">
          Te enviamos un mensaje para verificar tu cuenta. Si no lo ves, revisá spam o usá el botón
          de abajo para reenviar.
        </p>
      </header>
      <div className="w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm">
        <VerifyOtpForm defaultEmail={session.email} />
      </div>
      <div className="w-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm">
        <ResendVerificationForm />
      </div>
    </div>
  );
}