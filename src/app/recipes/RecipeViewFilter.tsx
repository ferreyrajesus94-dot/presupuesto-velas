import Link from "next/link";

const VIEWS = [
  { key: "active", label: "Active", href: "/recipes" },
  { key: "all", label: "Show archived", href: "/recipes?view=all" },
] as const;

export type RecipeView = (typeof VIEWS)[number]["key"];

export function resolveRecipeView(raw: string | string[] | undefined): RecipeView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "all" ? "all" : "active";
}

export function RecipeViewFilter({ current }: { current: RecipeView }) {
  return (
    <nav aria-label="Recipe view filter" className="flex flex-wrap gap-2">
      {VIEWS.map((view) => {
        const isCurrent = view.key === current;
        return (
          <Link
            key={view.key}
            href={view.href}
            aria-current={isCurrent ? "page" : undefined}
            data-archive-focus={view.key === "all" ? "show-archived" : undefined}
            className={
              isCurrent
                ? "rounded-full bg-rose-900 px-3 py-1.5 text-sm font-semibold text-white"
                : "rounded-full border border-rose-300 bg-white px-3 py-1.5 text-sm font-semibold text-rose-900 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
            }
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
