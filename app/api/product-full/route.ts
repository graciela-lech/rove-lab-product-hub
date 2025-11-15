import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  notion,
  DB_PRODUCT_DATABASE,
  DB_PRODUCT_HUB,
  DB_PRODUCT_POSITIONING,
} from "@/lib/notion";

// Garante que a rota é sempre dinâmica (não estática)
export const dynamic = "force-dynamic";

// Tipagem frouxa pra não travar o build caso algo mude no Notion
type NotionProperty = any;

/**
 * Helpers para extrair valores das propriedades do Notion
 */
function getTitle(props: NotionProperty, key: string): string | null {
  const field = props?.[key];
  if (!field || !Array.isArray(field.title) || field.title.length === 0) return null;
  return field.title[0]?.plain_text ?? null;
}

function getRichText(props: NotionProperty, key: string): string | null {
  const field = props?.[key];
  if (!field || !Array.isArray(field.rich_text) || field.rich_text.length === 0) return null;
  return field.rich_text[0]?.plain_text ?? null;
}

function getSelect(props: NotionProperty, key: string): string | null {
  const field = props?.[key];
  if (!field || !field.select) return null;
  return field.select?.name ?? null;
}

function getMultiSelect(props: NotionProperty, key: string): string[] {
  const field = props?.[key];
  if (!field || !Array.isArray(field.multi_select)) return [];
  return field.multi_select.map((opt: any) => opt?.name).filter(Boolean);
}

/**
 * Mapeia propriedades extras genéricas para um dicionário "attributes"
 * Ignora chaves que já estão sendo tratadas diretamente.
 */
function extractAttributes(
  props: NotionProperty,
  ignoreKeys: string[] = []
): Record<string, any> {
  const attributes: Record<string, any> = {};
  for (const key of Object.keys(props ?? {})) {
    if (ignoreKeys.includes(key)) continue;
    const prop = props[key];
    if (!prop) continue;

    try {
      switch (prop.type) {
        case "select":
          attributes[key] = prop.select?.name ?? null;
          break;
        case "multi_select":
          attributes[key] = (prop.multi_select ?? []).map((m: any) => m.name).filter(Boolean);
          break;
        case "rich_text":
          attributes[key] = (prop.rich_text ?? [])
            .map((r: any) => r.plain_text)
            .filter(Boolean)
            .join(" ");
          break;
        case "title":
          attributes[key] = (prop.title ?? [])
            .map((t: any) => t.plain_text)
            .filter(Boolean)
            .join(" ");
          break;
        case "checkbox":
          attributes[key] = !!prop.checkbox;
          break;
        case "number":
          attributes[key] = prop.number;
          break;
        case "url":
          attributes[key] = prop.url;
          break;
        case "date":
          attributes[key] = prop.date?.start ?? null;
          break;
        default:
          // Ignora tipos mais complexos (relation, rollup, etc.) por enquanto
          break;
      }
    } catch {
      // Se der qualquer erro ao extrair, simplesmente ignora a chave
      continue;
    }
  }
  return attributes;
}

export async function GET(request: NextRequest) {
  try {
    if (!DB_PRODUCT_DATABASE) {
      throw new Error("Product database ID is not configured");
    }

    const url = request.nextUrl;
    const sku = url.searchParams.get("sku");
    const name = url.searchParams.get("name");
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam
      ? Math.min(Math.max(parseInt(limitParam, 10) || 10, 1), 100)
      : 10;

    if (!sku && !name) {
      return NextResponse.json(
        {
          ok: false,
          error: "You must provide at least one query parameter: sku or name",
        },
        { status: 400 }
      );
    }

    /**
     * 1) Consulta principal na Product Database
     */
    const filters: any[] = [];

    if (sku) {
      filters.push({
        property: "SKU",
        rich_text: { equals: sku },
      });
    }

    if (name) {
      filters.push({
        property: "Name",
        title: { contains: name },
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

    /**
     * 2) Para cada item, buscar complementos no Product Hub e Product Positioning
     */
    const consolidated = await Promise.all(
      mainItems.map(async (page) => {
        const props = page.properties;

        const baseSku = getRichText(props, "SKU");
        const baseName = getTitle(props, "Name");

        const collection =
          getSelect(props, "Collection") ??
          getSelect(props, "Collection / Category") ??
          getSelect(props, "Collection / Category / Family");

        const category =
          getSelect(props, "Category") ??
          getSelect(props, "Product Category");

        const productType =
          getSelect(props, "Type") ??
          getSelect(props, "Product Type") ??
          getSelect(props, "Configuration");

        const status =
          getSelect(props, "Status") ??
          getSelect(props, "Lifecycle Status");

        const slug =
          getRichText(props, "Slug") ??
          getRichText(props, "Handle") ??
          getRichText(props, "URL Handle");

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
            headline: null as string | null,
            subheadline: null as string | null,
            elevatorPitch: null as string | null,
            keyBenefits: [] as string[],
            targetAudience: null as string | null,
            useCases: [] as string[],
            toneOfVoice: null as string | null,
            differentiators: [] as string[],
            objectionsAndAnswers: [] as string[],
            proofPoints: [] as string[],
          },
        };

        /**
         * 2a) Product Hub
         */
        let hubData: any = null;
        if (DB_PRODUCT_HUB) {
          const hubFilters: any[] = [];

          if (baseSku) {
            hubFilters.push({
              property: "SKU",
              rich_text: { equals: baseSku },
            });
          }
          if (baseName) {
            hubFilters.push({
              property: "Name",
              title: { contains: baseName },
            });
          }

          if (hubFilters.length > 0) {
            const hubResponse = await notion.databases.query({
              database_id: DB_PRODUCT_HUB,
              filter:
                hubFilters.length === 1
                  ? hubFilters[0]
                  : { or: hubFilters },
              page_size: 1,
            });

            hubData = hubResponse.results?.[0] ?? null;
          }
        }

        if (hubData) {
          const hubProps = hubData.properties;

          // Exemplo de markets / countries – ajuste o nome se sua coluna tiver outro nome
          const markets =
            getMultiSelect(hubProps, "Markets") ||
            getMultiSelect(hubProps, "Countries") ||
            getMultiSelect(hubProps, "Stores");

          if (markets.length > 0) {
            baseProduct.countries = markets.map((m) => ({
              countryCode: m,
              active: true,
              notes: null,
            }));
          }

          // Por enquanto, não mapeamos variants explicitamente; isso pode ser refinado depois
          const hubAttributes = extractAttributes(hubProps, [
            "Name",
            "SKU",
            "Markets",
            "Countries",
            "Stores",
          ]);

          baseProduct.attributes = {
            ...baseProduct.attributes,
            ...hubAttributes,
          };
        }

        /**
         * 2b) Product Positioning
         */
        if (DB_PRODUCT_POSITIONING) {
          const posFilters: any[] = [];

          if (baseSku) {
            posFilters.push({
              property: "SKU",
              rich_text: { equals: baseSku },
            });
          }
          if (baseName) {
            posFilters.push({
              property: "Product Name",
              title: { contains: baseName },
            });
          }

          if (posFilters.length > 0) {
            const posResponse = await notion.databases.query({
              database_id: DB_PRODUCT_POSITIONING,
              filter:
                posFilters.length === 1
                  ? posFilters[0]
                  : { or: posFilters },
              page_size: 1,
            });

            const posData: any = posResponse.results?.[0] ?? null;

            if (posData) {
              const posProps = posData.properties;

              baseProduct.positioning.headline =
                getTitle(posProps, "Headline") ??
                getRichText(posProps, "Headline");

              baseProduct.positioning.subheadline =
                getRichText(posProps, "Subheadline") ??
                getRichText(posProps, "Subheadline / Intro");

              baseProduct.positioning.elevatorPitch =
                getRichText(posProps, "Elevator Pitch") ??
                getRichText(posProps, "Pitch");

              const benefits = getMultiSelect(posProps, "Key Benefits");
              const useCases = getMultiSelect(posProps, "Use Cases");
              const differentiators = getMultiSelect(
                posProps,
                "Differentiators"
              );
              const proofPoints = getMultiSelect(posProps, "Proof Points");

              if (benefits.length > 0) {
                baseProduct.positioning.keyBenefits = benefits;
              }
              if (useCases.length > 0) {
                baseProduct.positioning.useCases = useCases;
              }
              if (differentiators.length > 0) {
                baseProduct.positioning.differentiators = differentiators;
              }
              if (proofPoints.length > 0) {
                baseProduct.positioning.proofPoints = proofPoints;
              }

              const targetAudienceText =
                getRichText(posProps, "Target Audience") ??
                getRichText(posProps, "Audience");

              if (targetAudienceText) {
                baseProduct.positioning.targetAudience = targetAudienceText;
              }

              const tone = getRichText(posProps, "Tone of Voice");
              if (tone) {
                baseProduct.positioning.toneOfVoice = tone;
              }

              const objections =
                getRichText(posProps, "Objections & Answers") ??
                getRichText(posProps, "Objections and Answers");

              if (objections) {
                baseProduct.positioning.objectionsAndAnswers = [objections];
              }

              const posAttributes = extractAttributes(posProps, [
                "SKU",
                "Product Name",
                "Headline",
                "Subheadline",
                "Subheadline / Intro",
                "Elevator Pitch",
                "Pitch",
                "Key Benefits",
                "Use Cases",
                "Differentiators",
                "Proof Points",
                "Target Audience",
                "Audience",
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
