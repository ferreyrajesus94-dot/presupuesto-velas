"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import {
  archiveTemplateAction,
  restoreTemplateAction,
  type TemplateActionState,
} from "@/server/actions/templates";
import { useTemplateArchiveFeedback } from "./TemplatesArchiveFeedback";
import type { TemplateLifecycleOperation } from "./templateLifecycle";

const IDLE: TemplateActionState = { status: "idle" };
const CONFIRM = (name: string) => `¿Archivar ${name}? Podés restaurarla después.`;

type Props = { template: { id: string; name: string; archived: boolean } };

function intentFor(archived: boolean): TemplateLifecycleOperation {
  return archived ? "restore" : "archive";
}

export function TemplateArchiveControl({ template }: Props) {
  const action = template.archived ? restoreTemplateAction : archiveTemplateAction;
  const [state, formAction, pending] = useActionState(action, IDLE);
  // PR3z R3-001: FIFO queue pushed AFTER confirm; cancellations never enqueue.
  const intentQueueRef = useRef<TemplateLifecycleOperation[]>([]);
  const lastReportedRef = useRef(state);
  const { reportLifecycle } = useTemplateArchiveFeedback();
  useEffect(() => {
    if (lastReportedRef.current === state) return;
    lastReportedRef.current = state;
    if (state.status === "idle") return;
    const intent = intentQueueRef.current.shift();
    if (state.status !== "success" || !intent) return;
    reportLifecycle({ operation: intent, templateId: template.id, templateName: template.name });
  }, [state, reportLifecycle, template.id, template.name]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = intentFor(template.archived);
    if (!template.archived && !window.confirm(CONFIRM(template.name))) return;
    intentQueueRef.current.push(intent);
    startTransition(() => formAction(new FormData(event.currentTarget)));
  }

  const v = template.archived ? "Restaurar" : "Archivar";
  const pv = template.archived ? "Restaurando" : "Archivando";
  const accessible = pending ? `${pv} ${template.name}…` : `${v} ${template.name}`;

  return (
    <form onSubmit={handleSubmit} aria-busy={pending} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={template.id} />
      <button
        type="submit"
        disabled={pending}
        data-archive-focus={template.archived ? undefined : "next-row"}
        data-archive-source={template.id}
        aria-label={accessible}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-brand transition-colors hover:bg-surface-soft disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? `${pv} ${template.name}…` : v}
      </button>
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm text-status-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
