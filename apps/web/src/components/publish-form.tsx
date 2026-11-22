"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { inputClass } from "@/components/styles";
type SkillDraft = {
  name: string;
  pitch: string;
  description: string;
  category: string;
  instructions: string;
  exampleTitle: string;
  exampleBody: string;
  priceRaw: string;
  priceMinor: number;
};

export function PublishForm({
  locale,
  skill,
  draft,
  signedIn,
  categories,
  labels,
}: {
  locale: string;
  skill: string;
  draft: SkillDraft;
  signedIn: boolean;
  categories: { code: string; label: string }[];
  labels: {
    previewTitle: string;
    previewNote: string;
    drafted: string;
    turnaround: string;
    sample: string;
    category: string;
    name: string;
    pitch: string;
    instructions: string;
    price: string;
    account: string;
    yourName: string;
    email: string;
    password: string;
    publish: string;
    pending: string;
  };
}) {
  const [name, setName] = useState(draft.name);
  const [pitch, setPitch] = useState(draft.pitch);
  const [instructions, setInstructions] = useState(draft.instructions);
  const [price, setPrice] = useState(draft.priceRaw);
  const [exampleBody, setExampleBody] = useState(draft.exampleBody);
  const [category, setCategory] = useState(draft.category);
  const shownPrice = price.trim() ? `$${price.trim()}` : "$0";

  return (
    <form action="/api/agents" className="grid gap-6" method="post">
      <input name="locale" type="hidden" value={locale} />
      <input name="intent" type="hidden" value="publish" />
      <input name="skill" type="hidden" value={skill} />
      <input name="description" type="hidden" value={draft.description} />
      <input name="exampleTitle" type="hidden" value={draft.exampleTitle} />
      <aside aria-label={labels.previewTitle} className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{labels.previewTitle}</h2>
        <p className="mt-2 text-sm">{labels.previewNote}</p>
        <p className="mt-4 text-3xl font-semibold">{shownPrice}</p>
        <p className="mt-2 text-2xl font-semibold">{name || "Untitled"}</p>
        <p className="mt-1 font-medium">{labels.turnaround}</p>
        <p className="mt-3 text-sm leading-6">{pitch}</p>
        <div className="mt-4 rounded-xl border border-line p-4">
          <h3 className="font-semibold">{labels.sample}</h3>
          <p className="mt-2 text-sm leading-6">{exampleBody}</p>
        </div>
      </aside>
      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">{labels.drafted}</h2>
        <label className="grid gap-2 text-sm font-medium" htmlFor="name">
          {labels.name}
          <input className={inputClass} id="name" name="name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="pitch">
          {labels.pitch}
          <input className={inputClass} id="pitch" name="pitch" required minLength={8} maxLength={180} value={pitch} onChange={(event) => setPitch(event.target.value)} />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="instructions">
          {labels.instructions}
          <textarea className={`${inputClass} min-h-28 py-2`} id="instructions" name="instructions" required minLength={20} maxLength={8000} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="exampleBody">
          {labels.sample}
          <textarea className={`${inputClass} min-h-24 py-2`} id="exampleBody" name="exampleBody" required minLength={8} maxLength={2000} value={exampleBody} onChange={(event) => setExampleBody(event.target.value)} />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="category">
          {labels.category}
          <select className={inputClass} id="category" name="category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((item) => (
              <option key={item.code} value={item.code}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="price">
          {labels.price}
          <input className={inputClass} id="price" inputMode="decimal" name="price" required value={price} onChange={(event) => setPrice(event.target.value)} />
        </label>
      </section>
      {signedIn ? null : (
        <section className="grid gap-4 rounded-2xl border border-line p-5">
          <h2 className="text-xl font-semibold">{labels.account}</h2>
          <input name="role" type="hidden" value="seller" />
          <label className="grid gap-2 text-sm font-medium" htmlFor="accountName">
            {labels.yourName}
            <input className={inputClass} id="accountName" name="accountName" required autoComplete="name" />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="email">
            {labels.email}
            <input className={inputClass} id="email" name="email" type="email" required autoComplete="email" />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="password">
            {labels.password}
            <input className={inputClass} id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </label>
        </section>
      )}
      <SubmitButton label={labels.publish} pendingLabel={labels.pending} />
    </form>
  );
}
