import { seedAuditSnapshot } from "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The browser keeps the chain. These routes never need a writable disk. */
export async function GET() {
  return Response.json(seedAuditSnapshot());
}

export async function POST() {
  return Response.json(seedAuditSnapshot());
}
