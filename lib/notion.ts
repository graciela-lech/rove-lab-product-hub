import { Client } from "@notionhq/client";

if (!process.env.NOTION_SECRET) {
  throw new Error("NOTION_SECRET is not set in environment variables");
}

export const notion = new Client({
  auth: process.env.NOTION_SECRET,
});

export const DB_PRODUCT_HUB = process.env.NOTION_DB_PRODUCT_HUB;
export const DB_PRODUCT_DATABASE = process.env.NOTION_DB_PRODUCT_DATABASE;
export const DB_PRODUCT_POSITIONING =
  process.env.NOTION_DB_PRODUCT_POSITIONING;

if (!DB_PRODUCT_DATABASE) {
  console.warn("NOTION_DB_PRODUCT_DATABASE is not set");
}
