export type MaterialLifecycleOperation = "archive" | "restore";

export type MaterialLifecycleResult = {
  operation: MaterialLifecycleOperation;
  materialName: string;
};

export function buildMaterialLifecycleCopy(result: MaterialLifecycleResult): string {
  // R3-001: copy derives from the operation captured at dispatch, never
  // from a refreshed `material.archived` prop that may flip after
  // revalidation. This guarantees the message verb matches what the user
  // actually performed. U4: visible copy is es-AR.
  const verb = result.operation === "archive" ? "archivado" : "restaurado";
  return `${result.materialName} ${verb}.`;
}
