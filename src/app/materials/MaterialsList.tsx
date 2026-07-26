export type MaterialListItem = {
  id: string;
  name: string;
  baseUnit: string;
  unitCost: string;
};

export function MaterialsList({ materials }: { materials: MaterialListItem[] }) {
  if (materials.length === 0) {
    return (
      <section
        aria-labelledby="empty-materials"
        className="rounded-2xl border border-dashed border-rose-300 bg-rose-50 p-6"
      >
        <h2 id="empty-materials" className="text-xl font-semibold text-zinc-900">
          No materials yet
        </h2>
        <a
          href="#new-material"
          className="mt-4 inline-block font-semibold text-rose-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
        >
          Add your first material
        </a>
      </section>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {materials.map((material) => (
        <li key={material.id} className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-zinc-900">{material.name}</h3>
          <p className="mt-1 text-sm text-zinc-700">
            ARS {material.unitCost} per {material.baseUnit}
          </p>
        </li>
      ))}
    </ul>
  );
}
