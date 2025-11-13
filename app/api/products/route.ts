import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  notion,
  DB_PRODUCT_DATABASE,
  DB_PRODUCT_HUB,
  DB_PRODUCT_POSITIONING,
} from "@/lib/notion";

// Sempre dinâmico (não estático)
export const dynamic = "force-dynamic";

type NotionProperty = any;

// Utilitário para extrair texto de título
function getTitle(props: NotionProperty, key: string): string | null {
  const field = props?.[key];
  if (!field || !Array.isArray(field.title) || field.title.length === 0) return null;
  return field.title[0]?.plain_text ?? null;
}

// Utilitário para extrair rich_text
function getRichText(props: NotionProperty, key: string): string | null {
  const field = props?.[key];
  if (!field || !Array.isArray(field.rich_text) || field.rich_text.length === 0) return null;
  return field.rich_text[0]?.plain_text ?? null;
}

// Utilitário para extrair select
function getSelect(props: NotionProperty, key: string): string | null {
  const field = props?.[key];
  if (!field || !field.select) return null;
  return field.select?.name ?? null;
}

// Utilitário para extrair multi-select
function getMultiSelect(props: NotionProperty, key: string): string[] {
  const field = props?.[key];
  if (!field || !Array.isArray(field.multi_select)) return [];
  return field.multi_select.map((opt: any) => opt?.name).filter(Boolean);
}

// Utilitário genérico para mapear propriedades extras em attributes
function extractAttributes(props: NotionProperty, ignoreKeys: string[] = []): Record<string, any> {
  const attributes: Record<string, any> = {};
  for (const key of Object.keys(props ?? {})) {
    if (ignoreKeys.includes(key)) continue;
    const prop = props[key];
    if (!prop) continue;

    // Tentativa simples de extrair um valor “legível”
    if (prop.type === "select" && prop.select) {
      attributes[key] = prop.select.name;
    } else if (prop.type === "multi_select" && Array.isArray(prop.multi_select)) {
      attributes[key] = prop.multi_select.map((m: any) => m.name);
    } else if (prop.type === "rich_text" && Array.isArray(prop.rich_text) && prop.rich_text.length > 0) {
      attributes[key] = prop.rich_text.map((r: any) => r.plain_text).join(" ");
    } else if (prop.type === "title" && Array.isArray(prop.title) && prop.title.length > 0) {
      attributes[key] = prop.title.map((t: any) => t.plain_text).join(" ");
    } else if (prop.type === "checkbox") {
      attributes[key] = !!prop.checkbox;
    } else if (prop.type === "number") {
      attributes[key] = prop.number;
    } else if (prop.type === "url") {
      attributes[key] = prop.url;
    } else if (prop.type === "date") {
      attributes[key] = prop.date?.start ?? null;
    }
  }
  return attributes;
}

export async function GET(request: NextRequest) {
  try {
    if (!DB_PRODUCT_DATABASE) {
      throw new Error("Product database ID is not configured");
    }

    const sku = request.nextUrl.searchParams.get("sku");
    const name = request.nextUrl.searchParams.get("name");
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100) : 10;

    if (!sku && !name) {
      return NextResponse.json(
        {
          ok: false,
          error: "You must provide at least one query parameter: sku or name",
        },
        { status: 400 }
      );
    }

    // 1) Buscar na Product Database (principal)
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

    const mainFilter =
      filters.length === 1
        ? filters[0]
        : {
            and: filters,
          };

    const dbResponse = await notion.databases.query({
      database_id: DB_PRODUCT_DATABASE,
      filter: mainFilter,
      page_size: limit,
    });

    const mainItems = dbResponse.results as any[];

    // 2) Para cada item da Product Database, buscar complementos no Product Hub e Product Positioning
    const consolidated = await Promise.all(
      mainItems.map(async (page) => {
        const props = page.properties;

        const baseSku = getRichText(props, "SKU");
        const baseName = getTitle(props, "Name");
        const collection = getSelect(props, "Collection") ?? getSelect(props, "Collection / Category");
        const category = getSelect(props, "Category");
        const productType = getSelect(props, "Type") ?? getSelect(props, "Product Type");
        const status = getSelect(props, "Status");
        const slug = getRichText(props, "Slug") ?? getRichText(props, "Handle");

        // Dados mínimos do item principal
        const baseProduct: any = {
          id: page.id,
          sku: baseSku,
          name: baseName,
          slug: slug,
          status: status,
          collection: collection,
          category: category,
          productType: productType,
          countries: [] as any[],
          variants: [] as any[],
          attributes: {} as Record<string, any>,
          positioning: {
            headline: null,
            subheadline: null,
            elevatorPitch: null,
            keyBenefits: [] as string[],
            targetAudience: null,
            useCases: [] as string[],
            toneOfVoice: null,
            differentiators: [] as string[],
            objectionsAndAnswers: [] as string[],
            proofPoints: [] as string[],
          },
        };

        // 2a) Product Hub – procurar pelo mesmo SKU ou nome
        let hubData: any = null;
        if (DB_PRODUCT_HUB) {
          const hubFilter: any[] = [];

          if (baseSku) {
            hubFilter.push({
              property: "SKU",
              rich_text: { equals: baseSku },
            });
          }
          if (baseName) {
            hubFilter.push({
              property: "Name",
              title: { contains: baseName },
            });
          }

          if (hubFilter.length > 0) {
            const hubResponse = await notion.databases.query({
              database_id: DB_PRODUCT_HUB,
              filter:
                hubFilter.length === 1
                  ? hubFilter[0]
                  : {
                      or: hubFilter,
                    },
              page_size: 1,
            });

            hubData = hubResponse.results[0] ?? null;
          }
        }

        if (hubData) {
          const hubProps = hubData.properties;

          // Exemplo de markets/countries genérico: ajuste para o nome real da propriedade, se tiver
          const markets = getMultiSelect(hubProps, "Markets");
          if (markets.length > 0) {
            baseProduct.countries = markets.map((m) => ({
              countryCode: m,
              active: true,
              notes: null,
            }));
          }

          // Exemplo de variants: aqui deixamos genérico; você pode mapear colunas específicas depois
          // Por enquanto, apenas jogamos atributos extras em "attributes"
          const hubAttributes = extractAttributes(hubProps, ["Name", "SKU", "Markets"]);
          baseProduct.attributes = {
            ...baseProduct.attributes,
            ...hubAttributes,
          };
        }

        // 2b) Product Positioning – procurar pelo mesmo SKU ou nome
        if (DB_PRODUCT_POSITIONING) {
          const posFilter: any[] = [];

          if (baseSku) {
            posFilter.push({
              property: "SKU",
              rich_text: { equals: baseSku },
            });
          }
          if (baseName) {
            posFilter.push({
              property: "Product Name",
              title: { contains: baseName },
            });
          }

          if (posFilter.length > 0) {
            const posResponse = await notion.databases.query({
              database_id: DB_PRODUCT_POSITIONING,
              filter:
                posFilter.length === 1
                  ? posFilter[0]
                  : {
                      or: posFilter,
                    },
              page_size: 1,
            });

            const posData: any = posResponse.results[0] ?? null;

            if (posData) {
              const posProps = posData.properties;

              baseProduct.positioning.headline =
                getTitle(posProps, "Headline") ?? getRichText(posProps, "Headline");
              baseProduct.positioning.subheadline =
                getRichText(posProps, "Subheadline") ?? getRichText(posProps, "Subheadline / Intro");
              baseProduct.positioning.elevatorPitch =
                getRichText(posProps, "Elevator Pitch") ?? getRichText(posProps, "Pitch");
              const benefits = getMultiSelect(posProps, "Key Benefits");
              const useCases = getMultiSelect(posProps, "Use Cases");
              const differentiators = getMultiSelect(posProps, "Differentiators");
              const proofPoints = getMultiSelect(posProps, "Proof Points");

              if (benefits.length > 0) baseProduct.positioning.keyBenefits = benefits;
              if (useCases.length > 0) baseProduct.positioning.useCases = useCases;
              if (differentiators.length > 0)
                baseProduct.positioning.differentiators = differentiators;
              if (proofPoints.length > 0) baseProduct.positioning.proofPoints = proofPoints;

              const targetAudienceText =
                getRichText(posProps, "Target Audience") ?? getRichText(posProps, "Audience");
              if (targetAudienceText) baseProduct.positioning.targetAudience = targetAudienceText;

              const tone = getRichText(posProps, "Tone of Voice");
              if (tone) baseProduct.positioning.toneOfVoice = tone;

              const objectionsAndAnswersText =
                getRichText(posProps, "Objections & Answers") ??
                getRichText(posProps, "Objections and Answers");
              if (objectionsAndAnswersText) {
                baseProduct.positioning.objectionsAndAnswers = [
                  objectionsAndAnswersText,
                ];
              }

              // Você pode ainda extrair mais atributos de posicionamento e jogar em attributes
              const posAttributes = extractAttributes(posProps, [
                "SKU",
                "Product Name",
                "Headline",
                "Subheadline",
                "Elevator Pitch",
                "Key Benefits",
                "Use Cases",
                "Differentiators",
                "Proof Points",
                "Target Audience",
                "Tone of Voice",
                "Objections & Answers",
                "Objections and Answers",
              ]);
              baseProduct.attributes = {
                ...baseProduct.attributes,
                ...posAttributes,
              };
            }
          }
        }

        return baseProduct;
      })
    );

    return NextResponse.json(
      {
        ok: true,
        count: consolidated.length,
        items: consolidated,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[product-full] Error", error);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
