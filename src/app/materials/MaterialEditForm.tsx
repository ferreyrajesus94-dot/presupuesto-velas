"use client";

import { updateMaterialAction } from "@/server/actions/materials";
import type { MaterialListItem } from "./MaterialsList";
import { MaterialForm } from "./MaterialCreateForm";

export function MaterialEditForm({ material }: { material: MaterialListItem }) {
  return (
    <MaterialForm
      action={updateMaterialAction}
      defaultValues={{
        name: material.name,
        dimension: material.dimension,
        baseUnit: material.baseUnit,
        purchaseUnit: material.purchaseUnit,
        purchaseQuantity: material.purchaseQuantity,
        purchasePrice: material.purchasePrice,
      }}
      idPrefix={`edit-${material.id}`}
      title={`Editar material: ${material.name}`}
      labelSuffix={` para ${material.name}`}
      hiddenFields={{ id: material.id }}
      submitLabel="Guardar material"
      pendingLabel="Guardando material…"
      successMessage="Material actualizado."
    />
  );
}
