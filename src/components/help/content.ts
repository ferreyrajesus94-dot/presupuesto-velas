/**
 * PR4 help modal — per-tab content map.
 *
 * Keys are the `data-help` attribute values used on the panel-header help
 * buttons. Keep this in plain TypeScript so the keys are exhaustively typed
 * and the Server-rendered buttons can be wired against the same strings.
 */

export type HelpTabKey =
  | "materials"
  | "config"
  | "templates"
  | "calculator"
  | "quotes";

export type HelpContent = {
  emoji: string;
  title: string;
  intro: string;
  bullets: readonly string[];
  tip: string;
};

export const HELP_CONTENT: Record<HelpTabKey, HelpContent> = {
  materials: {
    emoji: "📦",
    title: "Ayuda: Insumos",
    intro:
      "Cargá cada material con su unidad de compra y precio. Calculamos el costo por unidad base para usarlo en plantillas y cotizaciones.",
    bullets: [
      "✨ + Agregar insumo: crea un nuevo material activo.",
      "🗂️ Filtro Activas / Archivadas: cambia la vista sin perder filtros.",
      "✏️ Editar: actualiza precio y unidades — el historial de cotizaciones conserva sus montos.",
      "🗑️ Archivar: oculta el insumo de futuros formularios sin eliminarlo.",
    ],
    tip: "Tip: revisá el `Costo por unidad base` antes de archivar — es el valor que usan tus plantillas.",
  },
  config: {
    emoji: "⚙️",
    title: "Ayuda: Inicio",
    intro:
      "Tu página principal con un resumen rápido de la actividad: materiales cargados, plantillas activas y cotizaciones recientes.",
    bullets: [
      "📊 Resumen: contadores por sección.",
      "📝 Cotizaciones recientes: atajo a las últimas 5.",
      "⬆️ Atajos: navegando a la sección que querés trabajar.",
    ],
    tip: "Tip: la calculadora con plantillas vive en Cotizaciones → Nueva cotización.",
  },
  templates: {
    emoji: "📋",
    title: "Ayuda: Plantillas",
    intro:
      "Armá recetas reutilizables que después vas a usar en la calculadora de cotizaciones.",
    bullets: [
      "✨ + Nueva plantilla: crea un molde vacío para arrancar.",
      "📄 + Crear una copia: duplica la plantilla actual con un sufijo (copia).",
      "✏️ Editar: agregá materiales y cantidades — el costo unitario se recalcula.",
      "🗑️ Eliminar: borra la plantilla de la lista.",
      "📦 + Material: suma una fila de material a la plantilla.",
    ],
    tip: "Tip: usá duplicar para iterar variantes sin tocar la receta original.",
  },
  calculator: {
    emoji: "🧮",
    title: "Ayuda: Calculadora",
    intro:
      "Elegí una plantilla, indicá la cantidad y armá la cotización con ganancia, seña y descuento por mayoreo.",
    bullets: [
      "📐 Plantilla: elegí una de tus plantillas activas.",
      "🧮 Cantidad: unidades a producir.",
      "💰 Ganancia: porcentaje o monto fijo.",
      "🎯 Descuento por mayoreo: porcentaje que se aplica desde cierta cantidad.",
      "💵 Seña: porcentaje sugerido para cubrir materiales.",
    ],
    tip: "Tip: el descuento por mayoreo se aplica sólo si la cantidad alcanza el mínimo configurado.",
  },
  quotes: {
    emoji: "💬",
    title: "Ayuda: Cotizaciones",
    intro:
      "Lista de cotizaciones existentes y ciclo de vida (borrador → enviada → aceptada/rechazada).",
    bullets: [
      "📝 Nueva cotización: arranca un borrador con la calculadora.",
      "👁️ Ver: abre el detalle de la cotización.",
      "✏️ Editar: solo disponible en borrador.",
      "📤 Compartir: links para enviar al cliente.",
    ],
    tip: "Tip: una cotización no-borrador es solo lectura; cualquier cambio se hace desde una nueva versión.",
  },
};
