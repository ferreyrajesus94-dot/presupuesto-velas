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
      title={`Edit material: ${material.name}`}
      labelSuffix={` for ${material.name}`}
      hiddenFields={{ id: material.id }}
      submitLabel="Save material"
      pendingLabel="Saving material…"
      successMessage="Material updated."
    />
  );
}
