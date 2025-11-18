import { NextResponse } from "next/server";
import { notion, DB_PRODUCT_DATABASE } from "@/lib/notion";

function getTitle(props: any, name: string) {
  return props?.[name]?.title?.[0]?.plain_text ?? null;
}

function getRichText(props: any, name: string) {
  return props?.[name]?.rich_text?.[0]?.plain_text ?? null;
}

export async function GET(request: Request) {
  try {
    if (!DB_PRODUCT_DATABASE) {
      throw new Error("Product Database ID is not configured");
    }

    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");
    const sku = searchParams.get("sku");

    if (!name && !sku) {
      return NextResponse.json(
        {
          ok: false,
          error: "You must provide at least one query parameter: name or sku",
        },
        { status: 400 }
      );
    }

    const filters: any[] = [];

    // SKU search
    if (sku) {
      filters.push({
        property: "SKU",
        rich_text: {
          equals: sku,
        },
      });
    }

    // Name search (multi-field)
    if (name) {
      filters.push({
        or: [
          {
            property: "Name",
            title: {
              contains: name,
            },
          },
          {
            property: "Product Name",
            title: {
              contains: name,
            },
          },
          {
            property: "Variant Name",
            title: {
              contains: name,
            },
          },
        ],
      });
    }

    // Execute query
    const queryResponse = await notion.databases.query({
      database_id: DB_PRODUCT_DATABASE,
      filter:
        filters.length === 1
          ? filters[0]
          : {
              and: filters,
            },
    });

    const results = queryResponse.results as any[];

    const items = results.map((page) => {
      const props = page.properties;

      return {
        id: page.id,
        sku: getRichText(props, "SKU"),
        name:
          getTitle(props, "Name") ??
          getTitle(props, "Product Name") ??
          getTitle(props, "Variant Name") ??
          null,
      };
    });

    return NextResponse.json({
      ok: true,
      count: items.length,
      items,
    });
  } catch (error: any) {
    console.error("❌ Error in /product-search:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
