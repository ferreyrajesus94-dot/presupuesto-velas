"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import {
  archiveRecipeAction,
  restoreRecipeAction,
  type RecipeActionState,
} from "@/server/actions/recipes";
import { buildRecipeLifecycleCopy, type RecipeLifecycleOperation } from "./recipeLifecycle";

const IDLE: RecipeActionState = { status: "idle" };
const CONFIRM = (name: string) => `Archive ${name}? You can restore it later.`;

type Props = { recipe: { id: string; name: string; archived: boolean } };

function intentFor(archived: boolean): RecipeLifecycleOperation {
  return archived ? "restore" : "archive";
}

export function RecipeArchiveControl({ recipe }: Props) {
  const action = recipe.archived ? restoreRecipeAction : archiveRecipeAction;
  const [state, formAction, pending] = useActionState(action, IDLE);
  // Capture the user intent at dispatch. The prop's `archived` flag may flip
  // after revalidation, but the verb in the success copy must reflect the
  // operation the user actually performed.
  const intentRef = useRef<RecipeLifecycleOperation>(intentFor(recipe.archived));
  // PR3y slice: the control renders a row-scoped status when the action
  // succeeds. PR3y.next moves the announcement into a parent provider so the
  // status survives the row unmount triggered by revalidation.
  const [rowStatus, setRowStatus] = useState<RecipeLifecycleOperation | null>(null);
  const lastReportedRef = useRef(state);
  useEffect(() => {
    if (lastReportedRef.current === state) return;
    lastReportedRef.current = state;
    if (state.status === "success") {
      setRowStatus(intentRef.current);
    }
  }, [state]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    intentRef.current = intentFor(recipe.archived);
    if (!recipe.archived && !window.confirm(CONFIRM(recipe.name))) return;
    startTransition(() => formAction(new FormData(event.currentTarget)));
  }

  const v = recipe.archived ? "Restore" : "Archive";
  const pv = recipe.archived ? "Restoring" : "Archiving";
  const accessible = pending ? `${pv} ${recipe.name}…` : `${v} ${recipe.name}`;

  return (
    <form onSubmit={handleSubmit} aria-busy={pending} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={recipe.id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={accessible}
        className="self-start rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-sm font-semibold text-rose-900 transition-colors hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? `${pv} ${recipe.name}…` : v}
      </button>
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm text-rose-800">
          {state.message}
        </p>
      ) : null}
      {rowStatus && state.status === "success" ? (
        <p role="status" aria-live="polite" className="text-sm text-emerald-800">
          {buildRecipeLifecycleCopy({ operation: rowStatus, recipeName: recipe.name })}
        </p>
      ) : null}
    </form>
  );
}
