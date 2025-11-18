import { Client } from "@notionhq/client";

//
// 1. Validate NOTION_SECRET
//
if (!process.env.NOTION_SECRET) {
  throw new Error("NOTION_SECRET is not set in environment variables");
}

//
// 2. Export Notion client
//
export const notion = new Client({
  auth: process.env.NOTION_SECRET,
});

//
// 3. Export Database IDs
//
export const DB_PRODUCT_HUB = process.env.NOTION_DB_PRODUCT_HUB;
export const DB_PRODUCT_DATABASE = process.env.NOTION_DB_PRODUCT_DATABASE;
export const DB_PRODUCT_POSITIONING =
  process.env.NOTION_DB_PRODUCT_POSITIONING;

//
// 4. Warn if they are missing (non-blocking)
//
if (!DB_PRODUCT_DATABASE) {
  console.warn("NOTION_DB_PRODUCT_DATABASE is not set");
}

if (!DB_PRODUCT_HUB) {
  console.warn("NOTION_DB_PRODUCT_HUB is not set");
}

if (!DB_PRODUCT_POSITIONING) {
  console.warn("NOTION_DB_PRODUCT_POSITIONING is not set");
}
