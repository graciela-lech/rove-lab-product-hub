import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { notion, DB_PRODUCT_DATABASE } from "@/lib/notion";

// Explicitly mark this route as dynamic so Next/Vercel don't try to pre-render it
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    if (!DB_PRODUCT_DATABASE) {
      throw new Error("Product database ID is not configured");
    }

    const sku = request.nextUrl.searchParams.get("sku");
    const name = request.nextUrl.searchParams.get("name");

    if (!sku && !name) {
      return NextResponse.json(
        {
          ok: false,
          error: "You must provide at least one query parameter: sku or name",
        },
        { status: 400 }
      );
    }

    const filters: any[] = [];

    if (sku) {
      filters.push({
        property: "SKU",
        rich_text: {
          equals: sku,
        },
      });
    }

    if (name) {
      filters.push({
        property: "Name",
        title: {
          contains: name,
        },
      });
    }

    const response = await notion.databases.query({
      database_id: DB_PRODUCT_DATABASE,
      filter:
        filters.length === 1
          ? filters[0]
          : {
              and: filters,
            },
    });

    const items = response.results.map((page: any) => {
      const props = page.properties;

      return {
        id: page.id,
        name: props?.Name?.title?.[0]?.plain_text ?? null,
        sku: props?.SKU?.rich_text?.[0]?.plain_text ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      count: items.length,
      items,
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
