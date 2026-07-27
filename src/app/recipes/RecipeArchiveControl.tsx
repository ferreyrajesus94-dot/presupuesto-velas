"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import {
  archiveRecipeAction,
  restoreRecipeAction,
  type RecipeActionState,
} from "@/server/actions/recipes";
import { useRecipeArchiveFeedback } from "./RecipesArchiveFeedback";
import type { RecipeLifecycleOperation } from "./recipeLifecycle";

const IDLE: RecipeActionState = { status: "idle" };
const CONFIRM = (name: string) => `Archive ${name}? You can restore it later.`;

type Props = { recipe: { id: string; name: string; archived: boolean } };

function intentFor(archived: boolean): RecipeLifecycleOperation {
  return archived ? "restore" : "archive";
}

export function RecipeArchiveControl({ recipe }: Props) {
  const action = recipe.archived ? restoreRecipeAction : archiveRecipeAction;
  const [state, formAction, pending] = useActionState(action, IDLE);
  // PR3z R3-001: FIFO queue pushed AFTER confirm; cancellations never enqueue.
  const intentQueueRef = useRef<RecipeLifecycleOperation[]>([]);
  const lastReportedRef = useRef(state);
  const { reportLifecycle } = useRecipeArchiveFeedback();
  useEffect(() => {
    if (lastReportedRef.current === state) return;
    lastReportedRef.current = state;
    if (state.status === "idle") return;
    const intent = intentQueueRef.current.shift();
    if (state.status !== "success" || !intent) return;
    reportLifecycle({ operation: intent, recipeId: recipe.id, recipeName: recipe.name });
  }, [state, reportLifecycle, recipe.id, recipe.name]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const intent = intentFor(recipe.archived);
    if (!recipe.archived && !window.confirm(CONFIRM(recipe.name))) return;
    intentQueueRef.current.push(intent);
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
    </form>
  );
}
