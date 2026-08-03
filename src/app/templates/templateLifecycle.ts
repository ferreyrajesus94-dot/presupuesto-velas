export type TemplateLifecycleOperation = "archive" | "restore";

export type TemplateLifecycleResult = {
  operation: TemplateLifecycleOperation;
  templateName: string;
};

export function buildTemplateLifecycleCopy(result: TemplateLifecycleResult): string {
  // The copy derives from the operation captured at dispatch, never from a
  // refreshed `template.archivedAt` prop that may flip after revalidation.
  // This guarantees the message verb matches what the user actually performed.
  const verb = result.operation === "archive" ? "archivada" : "restaurada";
  return `${result.templateName} ${verb}.`;
}
