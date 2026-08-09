"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useFocusTrap } from "@/components/a11y/useFocusTrap";
import { isPublicPath } from "@/lib/publicPrefixes";

/**
 * PR4 tutorial overlay — 5-step first-visit tour.
 *
 * - Auto-start on first visit (when no `pv-tour-disabled` flag is set in
 *   `localStorage`). The dialog now exposes an explicit "Mostrar este tour
 *   al iniciar sesión" checkbox so the user controls persistence; closing
 *   the dialog (skip / ✕ / ¡Listo!) writes that preference to storage.
 * - Legacy `pv-tour-done = "1"` keys are honored on read so users who
 *   completed the old one-shot tour keep their opt-in.
 * - Spotlight the active target via a `position: fixed` rectangle that
 *   re-measures on two `requestAnimationFrame` ticks after a scrollIntoView.
 * - Honor `prefers-reduced-motion: reduce`.
 * - Manual trigger via a floating "?" button rendered by the layout.
 * - Keyboard accessible: Esc closes, Tab walks the focus trap, Enter activates.
 * - Suppressed on public routes (`/sign-in`, `/sign-up`, `/403`, ...) so the
 *   overlay never blocks the unauthenticated UI on first paint.
 */

export const TOUR_DISABLED_KEY = "pv-tour-disabled";
/** @deprecated kept only for migration — see `readTourDisabled`. */
export const TOUR_STORAGE_KEY = "pv-tour-done";

export type TutorialStep = {
  id: string;
  emoji: string;
  title: string;
  description: string;
  bullets: readonly string[];
  tip: string;
  /** CSS selector for the spotlight target. The tour `scrollIntoView`s
   *  this element before measuring its bounding rect. */
  targetSelector: string;
};

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    emoji: "👋",
    title: "¡Bienvenida a Calculadora Flor!",
    description:
      "Te acompañamos en una visita rápida por las cuatro secciones para que organices tus velas en un solo lugar.",
    bullets: [
      "📦 Insumos y precios",
      "⚙️ Configuración general",
      "📋 Plantillas de recetas",
      "🧮 Calculadora de presupuestos",
    ],
    tip: "Podés saltar el tour en cualquier momento. Después lo abrís con el botón ❓ del menú.",
    targetSelector: "nav",
  },
  {
    id: "insumos",
    emoji: "📦",
    title: "Insumos y precios",
    description:
      "Cargá cada material con su unidad de compra y precio. Calculamos el costo por unidad base para usarlo en plantillas y presupuestos.",
    bullets: [
      "✨ + Agregar insumo",
      "🗂️ Filtrá entre activos y archivados",
      "📈 Editá precio sin perder historial",
    ],
    tip: "Tip: archivá los materiales que ya no usás para que no contaminen las sugerencias.",
    targetSelector: "[data-tour-target='materials']",
  },
  {
    id: "configuracion",
    emoji: "⚙️",
    title: "Configuración general",
    description:
      "Página de inicio con tu resumen general: totales, presupuestos recientes y atajos para arrancar.",
    bullets: [
      "📊 Resumen de actividad",
      "📝 Presupuestos recientes",
      "⬆️ Atajos a todas las secciones",
    ],
    tip: "Tip: la calculadora con plantillas vive en Presupuestos → Nuevo presupuesto.",
    targetSelector: "[data-tour-target='config']",
  },
  {
    id: "plantillas",
    emoji: "📋",
    title: "Plantillas",
    description:
      "Armá recetas reutilizables: cada plantilla define materiales y un costo unitario que alimenta las presupuestos.",
    bullets: [
      "✨ + Nueva plantilla",
      "📄 + Crear una copia",
      "✏️ Editar — agrega materiales y guarda",
    ],
    tip: "Tip: duplicá una plantilla existente para iterar rápido sobre variantes.",
    targetSelector: "[data-tour-target='templates']",
  },
  {
    id: "calculadora",
    emoji: "🧮",
    title: "Calculadora",
    description:
      "Elegí una plantilla, indicá cantidad y armá la presupuesto con seña, ganancia y descuento por mayoreo inline.",
    bullets: [
      "📐 Plantilla, cantidad, costo unitario",
      "🎯 Descuento por mayoreo",
      "💰 Ganancia + seña sugerida",
    ],
    tip: "Tip: el descuento por mayoreo se activa desde cierta cantidad — jugá con los valores para ver el total.",
    targetSelector: "[data-tour-target='calculator']",
  },
];

type SpotlightRect = { top: number; left: number; width: number; height: number };

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

/**
 * Read the user's opt-out preference. Treats the absence of the new key
 * AND the legacy one-shot key as "auto-show enabled" (the default for
 * first-time visitors).
 */
function readTourDisabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(TOUR_DISABLED_KEY) === "1") return true;
    // Legacy migration: a one-shot `pv-tour-done = "1"` from before the
    // toggle shipped is honored so returning users keep their opt-out.
    if (window.localStorage.getItem(TOUR_STORAGE_KEY) === "1") return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Persist the user's opt-out preference. Removing the key when the user
 * re-enables the tour keeps `localStorage` clean instead of storing
 * `pv-tour-disabled = "0"`. Either branch also clears the legacy
 * `pv-tour-done` key so the new flag is the single source of truth.
 */
function writeTourDisabled(disabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (disabled) {
      window.localStorage.setItem(TOUR_DISABLED_KEY, "1");
    } else {
      window.localStorage.removeItem(TOUR_DISABLED_KEY);
    }
    // Always clear the legacy one-shot key — once the toggle is in play,
    // a stale `pv-tour-done = "1"` would incorrectly suppress auto-show
    // (it overrides `pv-tour-disabled = null` on read).
    window.localStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    // localStorage may be disabled — the in-memory state still drives the
    // current session's UI.
  }
}

function readReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia(reducedMotionQuery).matches;
  } catch {
    return false;
  }
}

export function Tutorial() {
  // SSR-safe initial state: nothing visible until the first effect reads
  // localStorage. This avoids hydration mismatch and keeps the tutorial
  // gated on client-side state.
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  // User's preference for whether the tour should auto-open on next sign-in.
  // SSR-safe: the lazy initializer runs only on the client mount, where
  // `localStorage` is available. The mount effect re-syncs the value when
  // storage changes (e.g. another tab updates it) without going through
  // a synchronous setState inside the effect.
  const [autoShowEnabled, setAutoShowEnabled] = useState<boolean>(() => !readTourDisabled());
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const pathname = usePathname();
  // Tour is disabled on public routes — the overlay would otherwise cover
  // the sign-in/sign-up form on first paint. Re-evaluated when the
  // pathname changes so navigating into a private page from a public one
  // re-enables the trigger without a full reload.
  const tourAllowed = pathname !== null && !isPublicPath(pathname);

  const step = TUTORIAL_STEPS[stepIndex];
  const isLast = stepIndex === TUTORIAL_STEPS.length - 1;
  // Effective open state: the user can keep `open` true across a
  // navigation into a public route, but the dialog is suppressed via this
  // gate so we don't have to mutate state from an effect (which violates
  // the `react-hooks/set-state-in-effect` lint rule).
  const effectiveOpen = open && tourAllowed;

  // Read storage + reduced motion on mount. `autoShowEnabled` is already
  // initialized lazily from `localStorage` so this effect only opens the
  // dialog (or not) and wires up the reduced-motion media query.
  useEffect(() => {
    setReducedMotion(readReducedMotion());
    if (autoShowEnabled) {
      setOpen(true);
    }
    const mq = window.matchMedia(reducedMotionQuery);
    const onChange = (): void => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [autoShowEnabled]);

  const close = useCallback(() => {
    setOpen(false);
    // Persist the user's opt-out preference. Closing with the toggle on
    // (default) re-enables the tour on next visit; closing with the
    // toggle off writes `pv-tour-disabled = "1"` so the dialog never
    // reopens on its own.
    writeTourDisabled(!autoShowEnabled);
    // Return focus to the toolbar "?" button so keyboard users don't lose
    // their place. Only refocus if the trigger is actually mounted (not
    // on public routes).
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, [autoShowEnabled]);

  const startTour = useCallback(() => {
    setStepIndex(0);
    // When the user manually opens the tour, reset the toggle to ON
    // optimistically. The act of asking for the tour back is itself a
    // signal that they want it to keep showing on next sign-in — they
    // can still uncheck before closing if not.
    setAutoShowEnabled(true);
    setOpen(true);
  }, []);

  const goNext = useCallback(() => {
    if (isLast) {
      close();
      return;
    }
    setStepIndex((i) => i + 1);
  }, [isLast, close]);

  const goPrev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const skip = useCallback(() => {
    close();
  }, [close]);

  // Spotlight measurement: scroll target into view, then schedule the
  // measurement on two consecutive rAF ticks so the target has its final
  // layout before we draw the spotlight.
  useEffect(() => {
    if (!effectiveOpen || !step) {
      setSpotlight(null);
      return;
    }
    let cancelled = false;
    const target = document.querySelector(step.targetSelector);
    if (!target) {
      setSpotlight(null);
      return;
    }
    const behavior: ScrollBehavior = reducedMotion ? "auto" : "smooth";
    target.scrollIntoView({ behavior, block: "center" });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          setSpotlight(null);
          return;
        }
        setSpotlight({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveOpen, step, reducedMotion, stepIndex]);

  // Escape closes; focus is trapped inside the dialog via useFocusTrap so
  // Tab/Shift+Tab cycles between the close button, "Saltar tour", "Atrás",
  // and "Siguiente" — never escapes into the page below.
  useEffect(() => {
    if (!effectiveOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [effectiveOpen, close]);

  // Focus the dialog content while the tour is open so the trap has a
  // container to cycle through.
  useFocusTrap(dialogRef, effectiveOpen);

  return (
    <>
      {tourAllowed ? (
        <div className="fixed bottom-4 right-4 z-[58]">
          <button
            type="button"
            ref={triggerRef}
            onClick={startTour}
            aria-label="Iniciar tour guiado"
            title="¿Cómo funciona? Iniciá el tour"
            data-testid="tour-trigger"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink transition-transform hover:-translate-y-1"
          >
            <span aria-hidden="true" className="text-base leading-none">
              ❓
            </span>
          </button>
        </div>
      ) : null}
      {effectiveOpen && step ? (
        <TutorialDialog
          step={step}
          stepIndex={stepIndex}
          totalSteps={TUTORIAL_STEPS.length}
          isLast={isLast}
          spotlight={spotlight}
          reducedMotion={reducedMotion}
          dialogRef={dialogRef}
          onNext={goNext}
          onPrev={goPrev}
          onSkip={skip}
          autoShowEnabled={autoShowEnabled}
          onAutoShowChange={setAutoShowEnabled}
        />
      ) : null}
    </>
  );
}

type TutorialDialogProps = {
  step: TutorialStep;
  stepIndex: number;
  totalSteps: number;
  isLast: boolean;
  spotlight: SpotlightRect | null;
  reducedMotion: boolean;
  dialogRef: React.RefObject<HTMLDivElement | null>;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  autoShowEnabled: boolean;
  onAutoShowChange: (next: boolean) => void;
};

function TutorialDialog({
  step,
  stepIndex,
  totalSteps,
  isLast,
  spotlight,
  reducedMotion,
  dialogRef,
  onNext,
  onPrev,
  onSkip,
  autoShowEnabled,
  onAutoShowChange,
}: TutorialDialogProps) {
  // Position the dialog card so it stays on-screen regardless of the
  // spotlight's position. If the spotlight is in the top half, place the
  // card below it; otherwise place it above.
  const cardBelow = spotlight ? spotlight.top < window.innerHeight / 2 : false;
  return (
    <div
      role="presentation"
      data-testid="tour-root"
      className="fixed inset-0 z-[60]"
      style={{ pointerEvents: "none" }}
    >
      {/* Backdrop with a hole punched around the spotlight. The "hole" is
          drawn as four boxes around the spotlight; this stays pure CSS / SVG
          and avoids an external layout library. */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "auto" }}
      >
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlight ? (
              <rect
                x={spotlight.left - 8}
                y={spotlight.top - 8}
                width={spotlight.width + 16}
                height={spotlight.height + 16}
                rx="16"
                ry="16"
                fill="black"
              />
            ) : null}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(43, 13, 24, 0.55)" mask="url(#tour-mask)" />
      </svg>
      {spotlight ? (
        <div
          aria-hidden="true"
          data-testid="tour-spotlight"
          className={
            reducedMotion
              ? "pointer-events-none absolute rounded-2xl"
              : "pointer-events-none absolute animate-[tour-pulse_2.4s_ease-in-out_infinite] rounded-2xl"
          }
          style={{
            top: spotlight.top - 8,
            left: spotlight.left - 8,
            width: spotlight.width + 16,
            height: spotlight.height + 16,
            boxShadow: "0 0 0 4px rgba(214, 51, 108, 0.85), 0 0 24px 8px rgba(214, 51, 108, 0.45)",
            border: "2px solid rgba(255, 255, 255, 0.85)",
          }}
        />
      ) : null}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        ref={dialogRef}
        tabIndex={-1}
        // On <md the bottom nav (5 items ≈ 4.5rem + safe-area) is fixed
        // to the viewport edge, so the bottom margin of the modal has to
        // clear it — otherwise the modal eats the nav and the user can't
        // tap "Saltar tour" from the dialog without first reaching over
        // a phantom tab. The 5.5rem is the nav height + a small buffer
        // so the modal's bottom edge sits just above the nav border.
        // `overflow-y-auto` covers the long-content case (e.g. step 1
        // "Bienvenida" runs taller than the available space when the
        // device has a small inner viewport).
        className={
          reducedMotion
            ? "absolute inset-x-4 top-4 overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:inset-auto md:left-1/2 md:right-4 md:max-w-md md:-translate-x-1/2"
            : "absolute inset-x-4 top-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl transition-all md:inset-auto md:left-1/2 md:right-4 md:max-w-md md:-translate-x-1/2"
        }
        style={{
          pointerEvents: "auto",
          top: spotlight
            ? cardBelow
              ? spotlight.top + spotlight.height + 24
              : Math.max(24, spotlight.top - 320)
            : "20%",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Paso {stepIndex + 1} de {totalSteps}
          </span>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Cerrar tour"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-muted hover:text-ink"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <h2
          id="tour-title"
          className="mt-2 flex items-center gap-2 text-2xl font-semibold text-ink"
        >
          <span aria-hidden="true">{step.emoji}</span>
          {step.title}
        </h2>
        <p id="tour-description" className="mt-2 text-sm text-ink-muted">
          {step.description}
        </p>
        <ul className="mt-3 flex flex-col gap-1 text-sm text-ink">
          {step.bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2">
              <span className="text-brand">•</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-lg bg-surface-soft p-3 text-xs text-ink-muted">💡 {step.tip}</p>
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={autoShowEnabled}
            onChange={(e) => onAutoShowChange(e.target.checked)}
            data-testid="tour-auto-show"
            aria-label="Mostrar este tour al iniciar sesión"
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border-subtle text-brand focus:ring-2 focus:ring-brand"
          />
          <span>
            <span className="font-semibold">Mostrar este tour al iniciar sesión</span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              Si lo desactivás, podés abrirlo cuando quieras con el botón ❓.
            </span>
          </span>
        </label>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="font-semibold text-brand-strong underline decoration-brand-strong/40 underline-offset-4 hover:text-ink"
          >
            Saltar tour
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={onPrev}
                className="inline-flex min-h-11 items-center rounded-md border border-border-subtle bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-soft"
              >
                ← Atrás
              </button>
            ) : null}
            <button
              type="button"
              onClick={onNext}
              data-testid="tour-next"
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-on-brand hover:opacity-90"
            >
              {isLast ? "¡Listo! 🎉" : "Siguiente →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
