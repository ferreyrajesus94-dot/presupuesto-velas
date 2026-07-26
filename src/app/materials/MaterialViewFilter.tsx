import Link from "next/link";

const VIEWS = [
  { key: "active", label: "Active", href: "/materials" },
  { key: "all", label: "Show archived", href: "/materials?view=all" },
] as const;

export type MaterialView = (typeof VIEWS)[number]["key"];

export function resolveMaterialView(raw: string | string[] | undefined): MaterialView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "all" ? "all" : "active";
}

export function MaterialViewFilter({ current }: { current: MaterialView }) {
  return (
    <nav aria-label="Material view filter" className="flex flex-wrap gap-2">
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
