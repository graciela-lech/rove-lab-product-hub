import { NextResponse } from "next/server";
import {
  notion,
  DB_PRODUCT_DATABASE,
  DB_PRODUCT_HUB,
  DB_PRODUCT_POSITIONING,
} from "@/lib/notion";

function getTitle(props: any, name: string) {
  return props?.[name]?.title?.[0]?.plain_text ?? null;
}

function getRichText(props: any, name: string) {
  return props?.[name]?.rich_text?.[0]?.plain_text ?? null;
}

function getSelectName(props: any, name: string) {
  return props?.[name]?.select?.name ?? null;
}

function getMultiSelectNames(props: any, name: string): string[] {
  return props?.[name]?.multi_select?.map((x: any) => x.name) ?? [];
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

export async function GET(request: Request) {
  try {
    if (!DB_PRODUCT_DATABASE) {
      throw new Error("Product Database ID is not configured");
    }

    const { searchParams } = new URL(request.url);
    const sku = searchParams.get("sku");
    const nameQuery = searchParams.get("name");

    if (!sku && !nameQuery) {
      return NextResponse.json(
        {
          ok: false,
          error: "You must provide at least one query parameter: sku or name",
        },
        { status: 400 }
      );
    }

    // 1) Encontrar o produto na Product Database
    const dbTitlePropKey = await getDatabaseTitleProp(DB_PRODUCT_DATABASE);

    const filters: any[] = [];
    if (sku) {
      filters.push({
        property: "SKU",
        rich_text: {
          equals: sku,
        },
      });
    }
    if (nameQuery) {
      filters.push({
        property: dbTitlePropKey,
        title: {
          contains: nameQuery,
        },
      });
    }

    const dbResponse = await notion.databases.query({
      database_id: DB_PRODUCT_DATABASE,
      filter:
        filters.length === 1
          ? filters[0]
          : {
              and: filters,
            },
      page_size: 1,
    });

    if (dbResponse.results.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Product not found in Product Database",
        },
        { status: 404 }
      );
    }

    const mainPage: any = dbResponse.results[0];
    const props = mainPage.properties;

    const resolvedName = getTitle(props, dbTitlePropKey);
    const resolvedSku = getRichText(props, "SKU") ?? sku ?? null;

    // Color / Fabric / Material (relations)
    const colors = await resolveRelationTitles(props?.Color?.relation ?? []);
    const fabrics = await resolveRelationTitles(props?.Fabric?.relation ?? []);
    const materials = await resolveRelationTitles(
      props?.Material?.relation ?? []
    );

    // Dimensões (Product Database)
    const dimensions = {
      width: getRichText(props, "Product Width"),
      depth: getRichText(props, "Product Depth"),
      height: getRichText(props, "Product Height"),
      seatHeight: getRichText(props, "Seat Height"),
      armHeight: getRichText(props, "Arm Height"),
    };

    // Peso
    const weight = {
      productWeight: getRichText(props, "Product Weight"),
      weightCapacity: getRichText(props, "Weight Capacity"),
    };

    // Packaging
    const packaging = {
      numberOfBoxes: getRichText(props, "Number of boxes"),
      packageWidth: getRichText(props, "Package Width"),
      packageDepth: getRichText(props, "Package Depth"),
      packageHeight: getRichText(props, "Package Height"),
      packageWeight: getRichText(props, "Package Weight"),
    };

    // 2) Buscar complementos no Product Hub
    let hubData: any = {
      collection: null as string | null,
      category: [] as string[],
      type: [] as string[],
      details: [] as string[],
      frCa: null as string | null,
    };

    let positioningData: any = {
      designInspirations: null as string | null,
      designSolutions: null as string | null,
      features: null as string | null,
      problemsSolved: null as string | null,
      essenceKeywords: [] as string[],
      mainCompetitors: null as string | null,
      strengthsVsCompetitors: null as string | null,
      targetAudience: null as string | null,
      desiredPerception: null as string | null,
      evokedEmotions: null as string | null,
      symbolicTerritory: null as string | null,
      metaphors: null as string | null,
      headline: null as string | null,
      description: null as string | null,
    };

    let positioningPageId: string | null = null;

    if (DB_PRODUCT_HUB) {
      const hubTitlePropKey = await getDatabaseTitleProp(DB_PRODUCT_HUB);

      const hubQuery = await notion.databases.query({
        database_id: DB_PRODUCT_HUB,
        filter: {
          property: hubTitlePropKey,
          title: {
            contains: resolvedName ?? "",
          },
        },
        page_size: 1,
      });

      if (hubQuery.results.length > 0) {
        const hubPage: any = hubQuery.results[0];
        const hubProps = hubPage.properties;

        hubData.collection = getMultiSelectNames(hubProps, "Collection")[0] ?? null;
        hubData.category = getMultiSelectNames(hubProps, "Category");
        hubData.type = getMultiSelectNames(hubProps, "Type");
        hubData.details = getMultiSelectNames(hubProps, "Details");
        hubData.frCa = getRichText(hubProps, "FR/CA");

        const rel = hubProps?.["Product Positioning"]?.relation ?? [];
        if (rel.length > 0) {
          positioningPageId = rel[0].id;
        }
      }
    }

    // 3) Buscar Product Positioning (via relação do Hub, se existir)
    if (positioningPageId && DB_PRODUCT_POSITIONING) {
      const posPage: any = await notion.pages.retrieve({
        page_id: positioningPageId,
      });
      const pprops = posPage.properties;

      positioningData = {
        designInspirations: getRichText(pprops, "Design Inspirations"),
        designSolutions: getRichText(pprops, "Design Solutions"),
        features: getRichText(pprops, "Features"),
        problemsSolved: getRichText(pprops, "Problems Solved"),
        essenceKeywords: getMultiSelectNames(pprops, "Essence Keywords"),
        mainCompetitors: getRichText(pprops, "Main Competitors"),
        strengthsVsCompetitors: getRichText(
          pprops,
          "Strengths x Competitors"
        ),
        targetAudience: getRichText(pprops, "Target Audience"),
        desiredPerception: getRichText(pprops, "Desired Perception"),
        evokedEmotions: getRichText(pprops, "Evoked Emotions"),
        symbolicTerritory: getRichText(pprops, "Symbolic Territory"),
        metaphors: getRichText(pprops, "Metaphors"),
        headline: getRichText(pprops, "Headline"),
        description: getRichText(pprops, "Description"),
      };
    }

    const item = {
      id: mainPage.id,
      sku: resolvedSku,
      name: resolvedName,
      color: colors[0] ?? null,
      fabric: fabrics[0] ?? null,
      material: materials[0] ?? null,
      dimensions,
      weight,
      packaging,
      collection: hubData.collection,
      category: hubData.category,
      type: hubData.type,
      details: hubData.details,
      frCa: hubData.frCa,
      positioning: positioningData,
    };

    return NextResponse.json({
      ok: true,
      count: 1,
      items: [item],
    });
  } catch (error: any) {
    console.error("❌ Error in /api/product-full:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
