export type PlantillaClientItem = {
  id: string;
  materialId: string;
  quantity: string;
  unit: string;
  unitCost: string;
  name: string;
};

export type PlantillaClientTemplate = {
  id: string;
  name: string;
  unitCost: string;
  archivedAt: Date | null;
  items: PlantillaClientItem[];
  time: string;
  hourlyRate: string;
  overhead: string;
  marginPct: string;
};

export type PlantillaClientMaterial = {
  id: string;
  name: string;
  baseUnit: string;
  unitCost: string;
};

export type PlantillaTemplateInput = {
  id: string;
  name: string;
  unitCost: string;
  archivedAt: Date | null;
  items: Array<{
    id: string;
    materialId: string;
    quantity: string;
    unit: string;
  }>;
  time?: string | null;
  hourlyRate?: string | null;
  overhead?: string | null;
  marginPct?: string | null;
};

export function toClientTemplate(
  template: PlantillaTemplateInput,
  materials: readonly PlantillaClientMaterial[],
): PlantillaClientTemplate {
  return {
    id: template.id,
    name: template.name,
    unitCost: template.unitCost,
    archivedAt: template.archivedAt,
    items: template.items.map((row) => {
      const mat = materials.find((m) => m.id === row.materialId);
      return {
        id: row.id,
        materialId: row.materialId,
        quantity: row.quantity,
        unit: row.unit,
        unitCost: mat?.unitCost ?? "0",
        name: mat?.name ?? "",
      };
    }),
    time: template.time ?? "",
    hourlyRate: template.hourlyRate ?? "",
    overhead: template.overhead ?? "",
    marginPct: template.marginPct ?? "30",
  };
}
