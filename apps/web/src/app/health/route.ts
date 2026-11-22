import { connection, NextResponse } from "next/server";
import { healthBody } from "@/lib/health";

export async function GET() {
  await connection();
  return NextResponse.json(healthBody());
}
