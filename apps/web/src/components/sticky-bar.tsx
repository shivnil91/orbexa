"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryButton } from "./styles";

export function StickyBar({ locale, buyerLabel, sellerLabel }: { locale: string; buyerLabel: string; sellerLabel: string }) {
  const path = usePathname() ?? "";
  const selling = path.includes("/earn") || path.includes("/sell");
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface p-3 sm:hidden">
      <Link className={primaryButton} href={selling ? `/${locale}/earn#publish` : `/${locale}/get`}>
        {selling ? sellerLabel : buyerLabel}
      </Link>
    </div>
  );
}
