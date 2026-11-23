# Positioning

Orbexa is a marketplace where a specialist's know-how becomes AI a buyer can check. A buyer names a job and pays a listed price. A seller turns a skill they can explain into a listing that does that job. The agent is the listing, not a product the buyer has to configure.

A buyer should not have to wonder whether a listing is a prompt someone typed into a general model. Every agent has to do three things:

1. Prove it beats plain AI on realistic tasks for its category.
2. Be backed by a named person who stands behind it.
3. Carry a track record from paid jobs, once those jobs exist.

Hiring stays three steps: say the job, pick a match, pay and read the draft.

## What the homepage promises

**Buyers:** Get expert work done by AI agents built by real experts, from $15, in minutes.

**The product:** Expert know-how, packaged as AI you can trust. Every agent is tested against plain AI, backed by a named expert, and guaranteed.

**Sellers:** Turn what you know into an agent that earns while you sleep.

The $15 is the starting price of the cheapest example job on the shelf (a customer reply). A finished draft in this demo appears after the buyer confirms payment. With no model key, the draft is written on this server from the listing. With a key, the paid draft is written by that model, with the buyer's text fenced as data. It is not a certified professional service. Example listings and example ratings are labelled as examples.

Sellers keep 80% of the starting price when a buyer accepts the draft. Orbexa keeps 20%. This demo does not send a bank payout.

## Who it is for

**Buyer ICP.** A person in the United States who runs or operates a small firm and already pays for one-off knowledge work: a reply, a checklist, a scope note. They will pay $15 to $60 if the price, a sample, and the time are on the screen before they commit. They are not shopping for a platform, an agent framework, or a tender system.

**Seller ICP.** A person in the United States who can describe a repeatable skill in a paragraph and wants that skill to earn when they are not at a desk. The first sellers are practitioners, not software engineers. A bookkeeper, a retired engineer, and a rideshare driver with a real hobby are the shape of the supply. They need to see the price, the buyer preview, and the 80% share before they publish.

## What a buyer can check

**Knowledge, without seeing the files.** The seller adds templates, checklists, past examples, and rules of thumb, and answers five to seven "how I'd do it" questions. The listing shows the counts and the types. It does not show the text. At run time the worker retrieves from that seller's material only. The material is fenced as untrusted data, the same way a buyer document is fenced. It is not used for training unless the seller turns that on. The default is off.

**Orbexa Proof.** On publish, and when the seller's material changes, the harness builds 10 held-out tasks for the category and also grades the seller's own examples. Each task is run twice on the same model: once with the seller's instructions and private material, once with neither. A separate judge scores the two drafts without being told which is which, and the order is randomised. The listing shows the win rate, the rubric scores, two side-by-side drafts, the test date, and the version. A win rate of 60% or below is labelled **Not proven** and sorts below agents that beat the baseline. With no model key, the harness uses a deterministic stand-in and says a live model was not called. That result is not a customer statistic.

**A named expert.** The profile shows a name, a photo or initials, an experience statement, links, and credentials. A credential is **Self-declared** until an operator runs the manual check. The check writes an audit log. Nothing in the product says **Verified** without that check. Example listings say they are example data.

**A guarantee.** If the buyer rejects a draft and gives a reason, they get one free revision. If they reject that revision with a reason, the refund goes through the reviewed refund path: an operator approves it, and the approval is idempotent. An optional expert-review tier lets the seller edit the draft before delivery, at a higher price, with an SLA the seller sets. The price is clamped so a seller cannot set a review fee below the floor or above the cap.

**A track record from paid jobs only.** Completed jobs, acceptance, revisions, repeat buyers, median delivery time, and reviews tied to a paid accepted order. Empty means no paid jobs yet. Seed listings stay labelled as example data.

Search rank is relevance, times the proof win rate, times the paid-job track record. Proven agents sort above the rest. The match shows the Proof badge, how many of the held-out tests the agent won, and the expert's name.

## Jobs a buyer can hire today

These are the three categories where a listing can deliver a useful draft today, because the work is text in and text out. No filing, no stamp, no live system. They are the shelf on the homepage.

1. **Customer replies for small businesses.** A buyer pastes the situation. The listing drafts a calm reply that restates the issue and the next step, and does not invent an order number. A bakery owner and an HVAC ops manager both buy this. Starting price on the shelf: $15. The draft is ready in this demo as soon as they pay.

2. **Bookkeeping close checklists.** A bookkeeper lists the questions they already ask: which expenses need a receipt, what the owner should confirm. The buyer gets a checklist, not a filed return and not a connection to accounting software. Starting price suggested from the skill: $35.

3. **Practical checks and plans from a trade or a hobby.** A retired engineer publishes a drawing check that flags missing dimensions and does not invent a measurement. A parent-coach publishes a one-hour youth soccer plan. The buyer gets a plan or a list of gaps. Suggested prices: $45 for the drawing check, $20 for the practice plan.

## Where a specialist still beats a plain model

The same difference shows up in work where a plain model is likely to fill a gap the file does not support, and where a specialist already has a checklist for that failure. These are reasons, not market statistics. No size, share, or win-rate claim is made here. Tender writing stays in the catalog as a labelled example (hospital beds). It is not on the homepage shelf, and it is not how we introduce the product.

### US government and state bid responses

A usable response follows the solicitation's form and evaluation factors. When the supplier file does not contain a certificate, a price, or a signer, the row has to stay open. A general model is pulled toward a smooth narrative and will often supply the missing fact. A specialist's matrix, a past response, and an explicit rule against inventing a certificate change the draft. Tender writing is already a pack in this repo, and the hospital-bed fixture is an example of that shape: a supported dimension can be cited, and a missing certificate stays missing. That fixture is example data.

### Insurance claim appeals

An appeal is the denial reason, the policy language that is actually in the file, and the records that are not. A persuasive letter that cites an exclusion or a benefit the file does not contain is worse than a short list of gaps. A specialist checklist — denial code, cited page, missing record — is what makes the draft safe to hand to a person. The listing is not a law firm and the draft is not legal advice.

### Local permit and code checklists

Completeness is local: which sheet, which calculation, which stamp line, which dimension is absent. A general model does not have that city's checklist, and it will guess a number rather than leave the line blank. The specialist's checklist and the rule "never invent a measurement" produce the missing items. That is the work product.

## What this does not claim

No certification, no invented customer count, no logo, and no statement that a stand-in proof is a live-model result. A credential is not verified until the operator check is in the audit log. A new agent has no paid-job track record until someone pays and the job finishes.
