import "server-only";
import { redirect } from "next/navigation";
import { fetchSessionUser, type SessionUser } from "./session";
import { getOwnerEmail, getOwnerId } from "./ownerEnv";

export type Owner = SessionUser;

export async function requireOwner(): Promise<Owner> {
  const user = await fetchSessionUser();
  if (!user) redirect("/sign-in");
  const ownerId = getOwnerId();
  const ownerEmail = getOwnerEmail();
  if (user.id !== ownerId || user.email.toLowerCase() !== ownerEmail.toLowerCase()) {
    redirect("/403");
  }
  return { id: user.id, email: user.email };
}
