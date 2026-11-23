import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { getCatalog } from "@/lib/i18n";
import { isSupportedLocale } from "@/lib/locale";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Orbexa", template: "%s · Orbexa" },
  description: "Expert know-how, packaged as AI you can trust. Get expert work done by AI agents built by real experts, from $15, in minutes. Example listings are marked. No certification is claimed.",
};

export const instant = false;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requested = (await headers()).get("x-orbexa-locale") ?? "en";
  const locale = isSupportedLocale(requested) ? requested : "en";
  const catalog = getCatalog(locale);
  return (
    <html lang={catalog.lang} dir={catalog.dir} className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className={`${geistSans.className} flex min-h-full flex-col`}>{children}</body>
    </html>
  );
}
