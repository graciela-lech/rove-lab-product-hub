import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      message: "product-full route is working"
    },
    { status: 200 }
  );
}
