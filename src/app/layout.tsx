import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pleiades Rasa UI",
    template: "%s · Pleiades Rasa UI"
  },
  description:
    "Open-source authoring, operations and storefront widgets for Rasa.",
  robots: {
    index: false,
    follow: false,
    nocache: true
  }
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
