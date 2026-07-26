import Link from "next/link";

export const metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold">403 — Not the owner</h1>
      <p className="text-zinc-700">This account is not the owner of this workspace.</p>
      <Link href="/sign-in" className="underline">
        Back to sign in
      </Link>
    </main>
  );
}
