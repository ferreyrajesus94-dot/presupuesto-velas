import { NextResponse } from "next/server";
import { requireOwner } from "@/server/auth/requireOwner";

export async function GET() {
  const owner = await requireOwner();
  return NextResponse.json({ id: owner.id, email: owner.email });
}
