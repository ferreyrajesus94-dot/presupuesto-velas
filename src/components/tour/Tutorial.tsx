"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * PR4 tutorial overlay — 5-step first-visit tour.
 *
 * - Auto-start on first visit (when `localStorage["pv-tour-done"]` is absent).
 * - Persist completion/skip back to `localStorage` so the tour never reopens.
 * - Spotlight the active target via a `position: fixed` rectangle that
 *   re-measures on two `requestAnimationFrame` ticks after a scrollIntoView,
 *   so the highlight is positioned after the target's first paint.
 * - Honor `prefers-reduced-motion: reduce`: skip the pulse animation and
 *   use instant transitions.
 * - Manual trigger via a floating "?" button rendered by the layout.
 * - Keyboard accessible: Esc closes, Tab walks the focus trap, Enter activates.
 */

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
      "🧮 Calculadora de cotizaciones",
    ],
    tip: "Podés saltar el tour en cualquier momento. Después lo abrís con el botón ❓ del menú.",
    targetSelector: "nav",
  },
  {
    id: "insumos",
    emoji: "📦",
    title: "Insumos y precios",
    description:
      "Cargá cada material con su unidad de compra y precio. Calculamos el costo por unidad base para usarlo en plantillas y cotizaciones.",
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
      "Página de inicio con tu resumen general: totales, cotizaciones recientes y atajos para arrancar.",
    bullets: [
      "📊 Resumen de actividad",
      "📝 Cotizaciones recientes",
      "⬆️ Atajos a todas las secciones",
    ],
    tip: "Tip: la calculadora con plantillas vive en Cotizaciones → Nueva cotización.",
    targetSelector: "[data-tour-target='config']",
  },
  {
    id: "plantillas",
    emoji: "📋",
    title: "Plantillas",
    description:
      "Armá recetas reutilizables: cada plantilla define materiales y un costo unitario que alimenta las cotizaciones.",
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
      "Elegí una plantilla, indicá cantidad y armá la cotización con seña, ganancia y descuento por mayoreo inline.",
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

function readTourDone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeTourDone(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    // localStorage may be disabled — tour still completes in-memory.
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const step = TUTORIAL_STEPS[stepIndex];
  const isLast = stepIndex === TUTORIAL_STEPS.length - 1;

  // Read storage + reduced motion on mount.
  useEffect(() => {
    setReducedMotion(readReducedMotion());
    if (!readTourDone()) {
      setOpen(true);
    }
    const mq = window.matchMedia(reducedMotionQuery);
    const onChange = (): void => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    writeTourDone();
    // Return focus to the toolbar "?" button so keyboard users don't lose
    // their place.
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  const startTour = useCallback(() => {
    setStepIndex(0);
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
    if (!open || !step) {
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
  }, [open, step, reducedMotion, stepIndex]);

  // Escape closes; focus the first button when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    // Move focus to the dialog so screen readers announce it.
    window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={startTour}
        aria-label="Iniciar tour guiado"
        title="¿Cómo funciona? Iniciá el tour"
        data-testid="tour-trigger"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-surface text-ink transition-transform hover:-translate-y-1"
      >
        <span aria-hidden="true">❓</span>
      </button>
      {open && step ? (
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
        <rect
          width="100%"
          height="100%"
          fill="rgba(43, 13, 24, 0.55)"
          mask="url(#tour-mask)"
        />
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
        className={
          reducedMotion
            ? "absolute left-1/2 right-4 max-w-md -translate-x-1/2 rounded-2xl border border-border bg-surface p-6 shadow-xl"
            : "absolute left-1/2 right-4 max-w-md -translate-x-1/2 rounded-2xl border border-border bg-surface p-6 shadow-xl transition-all"
        }
        style={{
          pointerEvents: "auto",
          top: spotlight ? (cardBelow ? spotlight.top + spotlight.height + 24 : Math.max(24, spotlight.top - 320)) : "20%",
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
        <h2 id="tour-title" className="mt-2 flex items-center gap-2 text-2xl font-semibold text-ink">
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
        <p className="mt-3 rounded-lg bg-surface-soft p-3 text-xs text-ink-muted">
          💡 {step.tip}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:text-ink"
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
