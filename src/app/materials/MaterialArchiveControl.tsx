"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import {
  archiveMaterialAction,
  unarchiveMaterialAction,
  type MaterialActionState,
} from "@/server/actions/materials";
import { useMaterialArchiveFeedback } from "./MaterialsArchiveFeedback";
import type { MaterialLifecycleOperation } from "./materialLifecycle";

const IDLE: MaterialActionState = { status: "idle" };
const CONFIRM = (name: string) => `¿Archivar ${name}? Podés restaurarlo después.`;

type Props = { material: { id: string; name: string; archived: boolean } };

function intentFor(archived: boolean): MaterialLifecycleOperation {
  return archived ? "restore" : "archive";
}

export function MaterialArchiveControl({ material }: Props) {
  const action = material.archived ? unarchiveMaterialAction : archiveMaterialAction;
  const [state, formAction, pending] = useActionState(action, IDLE);

  // R3-001 + R3-003: capture the user intent at dispatch time. The prop's
  // `archived` flag may flip after revalidation, but the verb in the success
  // message must reflect the operation the user actually performed.
  const intentRef = useRef<MaterialLifecycleOperation>(intentFor(material.archived));
  const lastReportedRef = useRef(state);
  const { reportLifecycle } = useMaterialArchiveFeedback();

  useEffect(() => {
    if (lastReportedRef.current === state) return;
    lastReportedRef.current = state;
    if (state.status === "success") {
      reportLifecycle({ operation: intentRef.current, materialName: material.name });
    }
  }, [state, reportLifecycle, material.name]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    intentRef.current = intentFor(material.archived);
    if (!material.archived && !window.confirm(CONFIRM(material.name))) return;
    startTransition(() => formAction(new FormData(event.currentTarget)));
  }

  const v = material.archived ? "Restaurar" : "Archivar";
  const pv = material.archived ? "Restaurando" : "Archivando";
  const accessible = pending ? `${pv} ${material.name}…` : `${v} ${material.name}`;

  return (
    <form onSubmit={handleSubmit} aria-busy={pending} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={material.id} />
      <button
        type="submit"
        disabled={pending}
        data-archive-focus={material.archived ? undefined : "next-row"}
        aria-label={accessible}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-subtle bg-surface-raised px-4 text-sm font-semibold text-brand transition-colors hover:bg-surface-soft disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? `${pv} ${material.name}…` : v}
      </button>
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm text-status-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
