import { runCounts } from "@/lib/jobs";
import { applyRunCounts, getCatalog, type CatalogItem } from "@/lib/marketplace";

export async function loadCatalog(): Promise<CatalogItem[]> {
  return applyRunCounts(await getCatalog(), await runCounts());
}
