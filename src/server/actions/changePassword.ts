"use server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getAppBaseUrl } from "../auth/appBaseUrl";
import { getNeonAuthBaseUrl } from "../auth/userEnv";

// `session.ts` is SESSION-PRESERVE byte-identical, so we cannot import its
// private cookie-name constants. The names are duplicated here and must
// match `SESSION_COOKIE = "session"` / `SESSION_UPSTREAM_COOKIE =
// "session-upstream"` exactly. If session.ts ever changes, update here
// too.
const SESSION_COOKIE = "session";
const SESSION_UPSTREAM_COOKIE = "session-upstream";

/**
 * v0.4.4 — `changePasswordAction`.
 *
 * Validates the form (currentPassword + newPassword with a refinement
 * that newPassword === confirmPassword), then POSTs to Better Auth's
 * `/change-password` endpoint with the SESSION's upstream cookie
 * forwarded so Better Auth knows which user is changing the password.
 *
 * Better Auth returns:
 *   - 200 + `{ token }` on success (new session token reflecting the new
 *     password; we forward the new cookie set so the user isn't logged
 *     out as a side effect)
 *   - 400 with `code: "INVALID_PASSWORD"` if the current password is
 *     wrong (mapped to a localized `_form` error)
 *   - 400 with `code: "PASSWORD_TOO_SHORT"` / `PASSWORD_TOO_LONG` for
 *     policy violations (mapped to `password` field error)
 *   - 401 if the session cookie is missing/expired (treated as a form
 *     error — the page-level `requireUser` would have redirected an
 *     unauthenticated visitor, so this is a stale cookie case)
 */
export type ChangePasswordState = {
  errors?: {
    currentPassword?: string[];
    newPassword?: string[];
    confirmPassword?: string[];
    _form?: string[];
  };
  ok?: boolean;
};

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Ingresá tu contraseña actual"),
    newPassword: z.string().min(8, "La nueva contraseña debe tener al menos 8 caracteres"),
    confirmPassword: z.string().min(1, "Confirmá la nueva contraseña"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Las contraseñas nuevas no coinciden",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "La nueva contraseña debe ser distinta de la actual",
    path: ["newPassword"],
  });

function localizedChangePasswordError(upstreamMessage: string | null, status: number): string {
  const lower = upstreamMessage?.toLowerCase() ?? "";
  if (lower.includes("invalid") && lower.includes("password")) {
    return "La contraseña actual es incorrecta.";
  }
  if (status === 401) {
    return "Tu sesión expiró. Volvé a iniciar sesión e intentá de nuevo.";
  }
  if (lower.includes("too short") || lower.includes("too long") || lower.includes("password")) {
    return "La nueva contraseña no cumple los requisitos de seguridad.";
  }
  return "No pudimos cambiar la contraseña. Intentá de nuevo en unos minutos.";
}

function localizedPasswordFieldError(upstreamMessage: string | null): string | null {
  if (!upstreamMessage) return null;
  const lower = upstreamMessage.toLowerCase();
  if (lower.includes("too short")) {
    return "La nueva contraseña debe tener al menos 8 caracteres.";
  }
  if (lower.includes("too long")) {
    return "La nueva contraseña es demasiado larga.";
  }
  if (lower.includes("uppercase") || lower.includes("number") || lower.includes("symbol")) {
    return "La nueva contraseña debe incluir mayúsculas, números y símbolos.";
  }
  return null;
}

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const base = getNeonAuthBaseUrl();
  const appBaseUrl = getAppBaseUrl();

  // Forward our session cookie so Better Auth knows which user is
  // changing the password. The upstream cookie variant letter is in
  // `session-upstream`; we re-construct the cookie header that Better
  // Auth originally set.
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const upstreamVariant = jar.get(SESSION_UPSTREAM_COOKIE)?.value ?? "b";
  const upstreamName = upstreamVariant === "p"
    ? "__Secure-neon-auth.session_token"
    : upstreamVariant === "n"
      ? "neon-auth.session_token"
      : "better-auth.session_token";

  const res = await fetch(`${base}/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: appBaseUrl,
      ...(token ? { Cookie: `${upstreamName}=${token}` } : {}),
    },
    body: JSON.stringify({
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      code?: unknown;
      message?: unknown;
    } | null;
    const upstreamMessage = typeof body?.message === "string" ? body.message : null;
    const code = typeof body?.code === "string" ? body.code : null;
    // Field-level: password policy violations
    const fieldErr = localizedPasswordFieldError(upstreamMessage);
    if (fieldErr) {
      return { errors: { newPassword: [fieldErr] } };
    }
    // Form-level: invalid current password, expired session, generic
    const formErr = localizedChangePasswordError(upstreamMessage, res.status);
    if (code === "INVALID_PASSWORD" || code === "INVALID_CREDENTIALS") {
      return { errors: { currentPassword: [formErr] } };
    }
    return { errors: { _form: [formErr] } };
  }

  return { ok: true };
}