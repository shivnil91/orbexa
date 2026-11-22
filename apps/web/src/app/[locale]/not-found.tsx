export default function LocaleNotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col gap-3 px-5 py-16">
      <h1 className="text-2xl font-semibold">That locale is not in the catalog</h1>
      <p className="text-zinc-600 dark:text-zinc-300">
        English is the only shipped catalog. The route is ready for another locale when the copy exists.
      </p>
    </main>
  );
}
