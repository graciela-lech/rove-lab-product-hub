import { NextResponse } from "next/server";
import { notion, DB_PRODUCT_DATABASE } from "@/lib/notion";

function getTitle(props: any, name: string) {
  return props?.[name]?.title?.[0]?.plain_text ?? null;
}

function getRichText(props: any, name: string) {
  return props?.[name]?.rich_text?.[0]?.plain_text ?? null;
}

async function getDatabaseTitleProp(databaseId: string) {
  const db = await notion.databases.retrieve({ database_id: databaseId });
  const key = Object.keys(db.properties).find((k) => {
    // @ts-ignore
    return db.properties[k]?.type === "title";
  });

  if (!key) {
    throw new Error(
      `Could not find a title property for database ${databaseId}`
    );
  }

  return key;
}

async function resolveRelationTitles(rel: any[] | undefined): Promise<string[]> {
  if (!rel || rel.length === 0) return [];

  const titles = await Promise.all(
    rel.map(async (r) => {
      const page: any = await notion.pages.retrieve({ page_id: r.id });
      const props = page.properties;
      const titleKey = Object.keys(props).find(
        (k) => props[k]?.type === "title"
      );
      if (!titleKey) return null;
      return props[titleKey]?.title?.[0]?.plain_text ?? null;
    })
  );

  return titles.filter((t): t is string => !!t);
}

function computeScore(name: string | null, query: string | null): number {
  if (!name || !query) return 0;

  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();

  let score = 1;

  if (n === q) {
    // match exato
    score += 3;
  } else if (n.startsWith(q)) {
    // começa igual
    score += 2;
  } else if (n.includes(q)) {
    // contém
    score += 1;
  }

  const isMini = n.includes("mini");
  const queryMentionsMini = q.includes("mini");

  // se o usuário NÃO falou Mini, prioriza o standard
  if (isMini && !queryMentionsMini) {
    score -= 1;
  }

  // se o usuário falou Mini, prioriza Mini
  if (!isMini && queryMentionsMini) {
    score -= 1;
  }

  return score;
}

export async function GET(request: Request) {
  try {
    if (!DB_PRODUCT_DATABASE) {
      throw new Error("Product Database ID is not configured");
    }

    const titlePropKey = await getDatabaseTitleProp(DB_PRODUCT_DATABASE);

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
        property: titlePropKey,
        title: {
          contains: name,
        },
      });
    }

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

    const itemsWithScore = await Promise.all(
      results.map(async (page) => {
        const props = page.properties;

        const resolvedName = getTitle(props, titlePropKey);
        const skuValue = getRichText(props, "SKU");

        const colorNames = await resolveRelationTitles(
          props?.Color?.relation ?? []
        );
        const fabricNames = await resolveRelationTitles(
          props?.Fabric?.relation ?? []
        );

        const size =
          resolvedName?.toLowerCase().includes("mini") === true
            ? "mini"
            : "standard";

        const score = computeScore(resolvedName, name);

        return {
          id: page.id,
          sku: skuValue,
          name: resolvedName,
          color: colorNames[0] ?? null,
          fabric: fabricNames[0] ?? null,
          size,
          _score: score,
        };
      })
    );

    // ordenar por relevância quando houver name
    let sorted = itemsWithScore;
    if (name) {
      sorted = [...itemsWithScore].sort(
        (a, b) => (b._score ?? 0) - (a._score ?? 0)
      );
    }

    const publicItems = sorted.map(({ _score, ...rest }) => rest);

    return NextResponse.json({
      ok: true,
      count: publicItems.length,
      items: publicItems,
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
