import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  notion,
  DB_PRODUCT_DATABASE,
  DB_PRODUCT_HUB,
  DB_PRODUCT_POSITIONING,
} from "@/lib/notion";

// Garante que a rota é sempre dinâmica (evita erro de build)
export const dynamic = "force-dynamic";

// -----------------------------
// Helpers básicos
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

// Lista de possíveis campos que podem ter o nome do produto
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
// Rota principal
// -----------------------------
export async function GET(request: NextRequest) {
  try {
    if (!DB_PRODUCT_DATABASE) {
      throw new Error("Product Database ID is not configured.");
    }

    const url = request.nextUrl;
    const sku = url.searchParams.get("sku");

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
        ok: true,
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
        // 2a) Informações adicionais no Product Hub (com try/catch)
        // -----------------------------
        let hubData: {
          slug: string | null;
          status: string | null;
          variants: string[];
          attributes: Record<string, any>;
        } | null = null;

        if (DB_PRODUCT_HUB) {
          try {
            const hubQuery = await notion.databases.query({
              database_id: DB_PRODUCT_HUB,
              filter: {
                property: "SKU", // se não existir, cairá no catch
                rich_text: { equals: baseSku },
              },
            });

            if (hubQuery.results.length) {
              const hubProps = (hubQuery.results[0] as any).properties;

              hubData = {
                slug:
                  getRichText(hubProps, "Slug") ??
                  getRichText(hubProps, "Handle") ??
                  null,
                status:
                  getSelect(hubProps, "Status") ??
                  getSelect(hubProps, "Lifecycle Status") ??
                  null,
                variants:
                  getMultiSelect(hubProps, "Variants") ??
                  getMultiSelect(hubProps, "Configurations") ??
                  [],
                attributes: {
                  color:
                    getSelect(hubProps, "Color") ??
                    getSelect(hubProps, "Color Family") ??
                    null,
                  fabric:
                    getSelect(hubProps, "Fabric") ??
                    getSelect(hubProps, "Fabric Family") ??
                    null,
                  material:
                    getSelect(hubProps, "Material") ??
                    getSelect(hubProps, "Material Family") ??
                    null,
                },
              };
            }
          } catch (err) {
            console.error("[product-full] Product Hub query error", err);
            // segue sem quebrar a API
          }
        }

        // -----------------------------
        // 2b) Informações de Product Positioning (também com try/catch)
        // -----------------------------
        let positioningData:
          | {
              headline: string | null;
              subheadline: string | null;
              elevatorPitch: string | null;
              keyBenefits: string[];
              targetAudience: string | null;
              useCases: string[];
              toneOfVoice: string | null;
              differentiators: string[];
              objectionsAndAnswers: string[];
              proofPoints: string[];
            }
          | null = null;

        if (DB_PRODUCT_POSITIONING) {
          try {
            const posQuery = await notion.databases.query({
              database_id: DB_PRODUCT_POSITIONING,
              filter: {
                property: "SKU", // idem: se não existir, cai no catch
                rich_text: { equals: baseSku },
              },
            });

            if (posQuery.results.length) {
              const posProps = (posQuery.results[0] as any).properties;

              positioningData = {
                headline:
                  getRichText(posProps, "Headline") ??
                  getTitle(posProps, "Headline") ??
                  null,
                subheadline:
                  getRichText(posProps, "Subheadline") ??
                  getRichText(posProps, "Subheadline / Intro") ??
                  null,
                elevatorPitch:
                  getRichText(posProps, "Elevator Pitch") ??
                  getRichText(posProps, "Pitch") ??
                  null,
                keyBenefits:
                  getMultiSelect(posProps, "Key Benefits") ?? [],
                targetAudience:
                  getRichText(posProps, "Target Audience") ??
                  getRichText(posProps, "Audience") ??
                  null,
                useCases: getMultiSelect(posProps, "Use Cases") ?? [],
                toneOfVoice:
                  getSelect(posProps, "Tone of Voice") ?? null,
                differentiators:
                  getMultiSelect(posProps, "Differentiators") ?? [],
                objectionsAndAnswers:
                  getMultiSelect(
                    posProps,
                    "Objections & Answers"
                  ) ??
                  getMultiSelect(
                    posProps,
                    "Objections and Answers"
                  ) ??
                  [],
                proofPoints:
                  getMultiSelect(posProps, "Proof Points") ?? [],
              };
            }
          } catch (err) {
            console.error(
              "[product-full] Product Positioning query error",
              err
            );
            // não derruba a resposta
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
          positioning:
            positioningData ?? {
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
    console.error("[product-full] Error", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
