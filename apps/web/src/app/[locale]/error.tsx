"use client";

export default function LocaleError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="content" className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="leading-7 text-muted">This page could not be loaded. You can try again.</p>
      <button className="inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-foreground" onClick={() => reset()} type="button">
        Try again
      </button>
    </main>
  );
}
