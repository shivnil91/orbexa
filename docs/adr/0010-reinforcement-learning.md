# ADR 0010: Reinforcement learning and continuous improvement

- Status: Proposed
- Date: 2026-11-22

## Context

A buyer can approve, edit, or reject a deliverable. An expert can rate it. A tender can be won or lost. The judge already scores a rubric. Those are reward signals. Using them to change a model, a prompt, or an agent strategy is a training decision. Buyer documents are confidential. A missed tenant predicate would put one org's edits into another org's policy.

This ADR does not start fine-tuning. It records the gates that have to exist before any later training job is even proposed.

## Decision

Reward signals, all tenant-scoped:

| Signal | Stored as | Not stored |
| --- | --- | --- |
| Buyer approve, edit, or reject | `feedback_events.kind` and a reward in [-1, 1] | The edited document |
| Edit distance | A non-negative integer | Either side of the diff |
| Tender win or loss | The outcome the buyer reports | An inferred result |
| LLM-judge rubric score | The rubric code and the score already produced for a synthetic or licensed case | Customer tender text |
| Expert rating | An integer from 1 to 5 | Free-text commentary |

`training_consents` is one row per org. `granted` defaults to false. Absence and revocation are refusals. The review screen leaves the checkbox off.

`training_authorisations` is a separate table. The application roles cannot insert it. `app.grant_founder_authorisation` raises unless the session user is outside `orbexa_app`, `orbexa_worker`, and `orbexa_finance`. Org consent without that row is not permission to train.

`preference_pairs` stores two sha256 hashes and a source (`buyer`, `expert`, or `judge`). `training_used` is constrained to false. Nothing in this milestone can mark a pair as consumed by a trainer. `app.consider_preference_export` returns the hashes only when the pair's tenant is the session tenant, the org consent is granted and unrevoked, and a founder authorisation exists. It does not start a job, does not call a provider, and does not flip `training_used`.

Offline evaluation is required before a policy change. `policy_candidates.status` moves to `active` only through `app.activate_policy`, and only from `offline_passed` when `offline_score` is at least `baseline_score`. A halted bandit arm on that tenant blocks activation.

Contextual bandits route a prompt, a model, or a strategy. Arms are rows in `bandit_arms` with `tenant_id`. New arms are `shadow`. `app.select_bandit_arm` returns null unless the session sets `app.bandit` and the arm is `active`. The worker calls that path only when `ORBEXA_BANDIT=1`. The default is off, and the gateway keeps `model_routes`. A saturated reward (mean at least 0.99 over 8 pulls) or a mean that beats an offline score by more than 0.4 marks the arm `halted`. Halted arms are not selected. That is the reward-hacking and drift stop. It is not a proof that the reward is honest.

RLAIF and DPO datasets are the preference rows above. They are a store for a later fine-tune. This milestone does not run one.

Hard rules:

- No automatic fine-tuning. No worker, trigger, or API starts a training job.
- Confidential customer data is not a training input unless that org has an explicit unrevoked opt-in and a founder authorisation recorded by the function above.
- Feedback, preferences, consents, authorisations, arms, and decisions are tenant-isolated under row-level security.
- Spans and feedback rows still follow ADR 0005: no prompt text and no document text.

## Alternatives

Training on every approval, with consent implied by use of the product, was rejected. An order is not a training grant.

A global bandit, one set of arms for every tenant, was rejected. A strategy that won on one buyer's tenders is not a strategy for the next tenant.

Storing the edited deliverable beside the original, so a later trainer can compute its own distance, was rejected. The distance is the signal. The text stays in the job's own documents, under the existing document rules, and is not copied into this layer.

## Consequences

A later training proposal has to name the org, show the consent row, show the founder authorisation, and show an offline eval that beat the baseline. Until those exist, the bandit stays off and `training_used` cannot become true. This ADR does not claim a reinforcement-learning system is in production. It claims the gates and the capture path.
