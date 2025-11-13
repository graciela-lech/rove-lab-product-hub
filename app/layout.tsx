import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rove Lab Product Hub",
  description: "Internal product hub API for Notion integration",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
