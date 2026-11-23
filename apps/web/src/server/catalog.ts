import { listJobs, runCounts } from "@/lib/jobs";
import { applyRunCounts, attachTrack, getCatalog, type CatalogItem } from "@/lib/marketplace";

export async function loadCatalog(): Promise<CatalogItem[]> {
  const [items, counts, jobs] = await Promise.all([getCatalog(), runCounts(), listJobs()]);
  return attachTrack(applyRunCounts(items, counts), jobs);
}
