export function laneForCategory(category: string): "replies" | "books" | "plans" | null {
  if (category === "support") return "replies";
  if (category === "operations") return "books";
  if (category === "engineering" || category === "writing") return "plans";
  return null;
}

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter((part) => part.length > 0);
  const letters = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  return letters || "•";
}

export function JobMark({ lane, size = "md" }: { lane: "replies" | "books" | "plans"; size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-7 rounded-full" : "size-12 rounded-2xl";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center border border-line bg-surface text-accent ${box}`} aria-hidden="true">
      {lane === "replies" ? <ChatIcon /> : lane === "books" ? <BookIcon /> : <PlanIcon />}
    </span>
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 16.5V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 16H9l-4 3.5Z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 5.5h11.5A1.5 1.5 0 0 1 19 7v12H7.5A1.5 1.5 0 0 0 6 20.5Z" />
      <path d="M6 5.5A1.5 1.5 0 0 1 7.5 4H19" />
    </svg>
  );
}

function PlanIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 4.5h8A2.5 2.5 0 0 1 18.5 7v12.5H8A2.5 2.5 0 0 1 5.5 17V7A2.5 2.5 0 0 1 8 4.5Z" />
      <path d="M9 9.5h6M9 13h6M9 16.5h3" />
    </svg>
  );
}
