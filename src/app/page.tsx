import { requireOwner } from "@/server/auth/requireOwner";

export default async function Home() {
  await requireOwner();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold">Calculadora Flor</h1>
      <p className="text-zinc-700">Owner dashboard (PR #2 placeholder).</p>
    </main>
  );
}
