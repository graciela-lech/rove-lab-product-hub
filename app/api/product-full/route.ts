import { NextResponse } from "next/server";
import {
  notion,
  DB_PRODUCT_DATABASE,
  DB_PRODUCT_HUB,
  DB_PRODUCT_POSITIONING,
} from "@/lib/notion";

// -----------------------------
// Helpers
// -----------------------------
function getTitle(props: any, key: string) {
  return props?.[key]?.title?.[0]?.plain_text ?? null;
}

function getRichText(props: any, key: string) {
  return props?.[key]?.rich_text?.[0]?.plain_text ?? null;
}

function getSelect(props: any, key: string) {
  return props?.[key]?.select?.name ?? null;
}

function getMultiSelect(props: any, key: string) {
  return props?.[key]?.multi_select?.map((x: any) => x.name) ?? [];
}

// Nome — pega de vários campos possíveis
const POSSIBLE_NAME_FIELDS = [
  "Name",
  "Product Name",
  "Variant Name",
  "Product",
  "Title",
  "Produto",
  "Item Name",
];

function getBestName(props: any) {
  for (const field of POSSIBLE_NAME_FIELDS) {
    const t = getTitle(props, field);
    if (t) return t;
  }

  const rt = getRichText(props, "Name");
  if (rt) return rt;

  return null;
}

// -----------------------------
// MAIN ROUTE
// -----------------------------
export async function GET(request: Request) {
  try {
    if (!DB_PRODUCT_DATABASE) {
      throw new Error("Product Database ID is not configured.");
    }

    const { searchParams } = new URL(request.url);
    const sku = searchParams.get("sku");

    if (!sku) {
      return NextResponse.json(
        { ok: false, error: "Missing SKU parameter" },
        { status: 400 }
      );
    }

    // -------------------------------------
    // 1) Buscar item principal no Product Database
    // -------------------------------------
    const dbResponse = await notion.databases.query({
      database_id: DB_PRODUCT_DATABASE,
      filter: {
        property: "SKU",
        rich_text: {
          equals: sku,
        },
      },
    });

    if (!dbResponse.results.length) {
      return NextResponse.json({
        ok: false,
        count: 0,
        items: [],
      });
    }

    const mainItems = dbResponse.results as any[];

    // -------------------------------------
    // 2) Montar dados enriquecidos por item
    // -------------------------------------
    const consolidated = await Promise.all(
      mainItems.map(async (page) => {
        const props = page.properties;

        const baseSku = getRichText(props, "SKU");

        const baseName = getBestName(props);

        const collection =
          getSelect(props, "Collection") ??
          getSelect(props, "Collection / Category") ??
          getSelect(props, "Collection / Category / Family");

        const category =
          getSelect(props, "Category") ??
          getSelect(props, "Product Category");

        const countries =
          getMultiSelect(props, "Countries") ??
          getMultiSelect(props, "Markets") ??
          [];

        // -----------------------------
        // Buscar informações adicionais no Product Hub
        // -----------------------------
        let hubData = null;

        if (DB_PRODUCT_HUB) {
          const hubQuery = await notion.databases.query({
            database_id: DB_PRODUCT_HUB,
            filter: {
              property: "SKU",
              rich_text: { equals: baseSku },
            },
          });

          if (hubQuery.results.length) {
            const hubProps = hubQuery.results[0].properties;

            hubData = {
              slug: getRichText(hubProps, "Slug"),
              status: getSelect(hubProps, "Status"),
              variants: getMultiSelect(hubProps, "Variants"),
              attributes: {
                color: getSelect(hubProps, "Color"),
                fabric: getSelect(hubProps, "Fabric"),
                material: getSelect(hubProps, "Material"),
              },
            };
          }
        }

        // -----------------------------
        // Buscar informações de Positioning
        // -----------------------------
        let positioningData = null;

        if (DB_PRODUCT_POSITIONING) {
          const posQuery = await notion.databases.query({
            database_id: DB_PRODUCT_POSITIONING,
            filter: {
              property: "SKU",
              rich_text: { equals: baseSku },
            },
          });

          if (posQuery.results.length) {
            const posProps = posQuery.results[0].properties;

            positioningData = {
              headline: getRichText(posProps, "Headline"),
              subheadline: getRichText(posProps, "Subheadline"),
              elevatorPitch: getRichText(posProps, "Elevator Pitch"),
              keyBenefits: getMultiSelect(posProps, "Key Benefits"),
              targetAudience: getRichText(posProps, "Target Audience"),
              useCases: getMultiSelect(posProps, "Use Cases"),
              toneOfVoice: getSelect(posProps, "Tone of Voice"),
              differentiators: getMultiSelect(posProps, "Differentiators"),
              objectionsAndAnswers: getMultiSelect(
                posProps,
                "Objections & Answers"
              ),
              proofPoints: getMultiSelect(posProps, "Proof Points"),
            };
          }
        }

        // -----------------------------
        // Retorno final do item
        // -----------------------------
        return {
          id: page.id,
          sku: baseSku,
          name: baseName,
          collection,
          category,
          countries,
          variants: hubData?.variants ?? [],
          slug: hubData?.slug ?? null,
          status: hubData?.status ?? null,
          attributes: hubData?.attributes ?? {},
          positioning: positioningData ?? {
            headline: null,
            subheadline: null,
            elevatorPitch: null,
            keyBenefits: [],
            targetAudience: null,
            useCases: [],
            toneOfVoice: null,
            differentiators: [],
            objectionsAndAnswers: [],
            proofPoints: [],
          },
        };
      })
    );

    return NextResponse.json({
      ok: true,
      count: consolidated.length,
      items: consolidated,
    });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
