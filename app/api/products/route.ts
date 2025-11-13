import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { notion } from "@/lib/notion";

// rota explicitamente dinâmica
export const dynamic = "force-dynamic";

// ID da Product Database direto no código, para teste
const PRODUCT_DATABASE_ID = "1f33fd21592e80f18067000c42e7e655";

export async function GET(request: NextRequest) {
  try {
    if (!PRODUCT_DATABASE_ID) {
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
      database_id: PRODUCT_DATABASE_ID,
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
