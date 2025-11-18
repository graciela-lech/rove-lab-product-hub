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

    // 1) Discover the title property of Product Database
    const db = await notion.databases.retrieve({
      database_id: DB_PRODUCT_DATABASE,
    });

    const titlePropKey = Object.keys(db.properties).find((key) => {
      // @ts-ignore – Notion types are dynamic
      return db.properties[key]?.type === "title";
    });

    if (!titlePropKey) {
      throw new Error(
        "Could not find a title property in Product Database. Please check the schema."
      );
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

    // 2) Optional SKU filter
    if (sku) {
      filters.push({
        property: "SKU",
        rich_text: {
          equals: sku,
        },
      });
    }

    // 3) Name filter using the REAL title property of the DB
    if (name) {
      filters.push({
        property: titlePropKey,
        title: {
          contains: name,
        },
      });
    }

    // 4) Run query on Product Database
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

      const nameFromTitle = getTitle(props, titlePropKey);

      return {
        id: page.id,
        sku: getRichText(props, "SKU"),
        name: nameFromTitle,
      };
    });

    return NextResponse.json({
      ok: true,
      count: items.length,
      items,
    });
  } catch (error: any) {
    console.error("❌ Error in /api/product-search:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
