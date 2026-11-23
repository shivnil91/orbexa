import { DEMO_ORG_ID } from "./jobs.ts";

export type JobActor = { id: string; admin?: boolean } | null;

export function canReadJob(tenantId: string, user: JobActor): boolean {
  if (tenantId === DEMO_ORG_ID) {
    return true;
  }
  if (!user) {
    return false;
  }
  return user.admin === true || user.id === tenantId;
}

export function canMutateJob(tenantId: string, user: JobActor): boolean {
  if (tenantId === DEMO_ORG_ID) {
    return true;
  }
  return Boolean(user && user.id === tenantId);
}

export function jobReadDecision(tenantId: string, user: JobActor): "allow" | "sign-in" | "hide" {
  if (canReadJob(tenantId, user)) {
    return "allow";
  }
  if (!user) {
    return "sign-in";
  }
  return "hide";
}

export function jobStatusKey(status: string, refunded?: boolean): string {
  return refunded ? "status.refunded" : `status.${status}`;
}

export function buyerOrders<T extends { tenantId: string }>(jobs: T[], userId: string): T[] {
  return jobs.filter((job) => job.tenantId === userId);
}

export function sellerOrders<T extends { sellerId?: string; listingSlug: string }>(
  jobs: T[],
  sellerId: string,
  slugs: string[],
): T[] {
  const owned = new Set(slugs);
  return jobs.filter((job) => job.sellerId === sellerId && owned.has(job.listingSlug));
}

export function canReviewAsSeller(job: { sellerId?: string; serviceLevel?: string }, sellerId: string): boolean {
  return sellerId.length > 0 && job.sellerId === sellerId && job.serviceLevel === "expert_review";
}

export type OrderSummary = {
  id: string;
  title: string;
  status: string;
  priceMinor: number;
  currency: string;
  refunded: boolean;
};

export function orderSummary(job: {
  id: string;
  title: string;
  status: string;
  priceMinor: number;
  currency: string;
  refunded?: boolean;
}): OrderSummary {
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    priceMinor: job.priceMinor,
    currency: job.currency,
    refunded: job.refunded === true,
  };
}
