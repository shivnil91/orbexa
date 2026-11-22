# Architecture decisions

| ADR | Decision |
| --- | --- |
| [0001](0001-architecture.md) | Modular monolith, one Python worker, Postgres, global money fields |
| [0002](0002-durable-execution.md) | Temporal for durability, SQS for dispatch, LangGraph inside an activity |
| [0003](0003-agent-memory.md) | Four memory domains and tenant-scoped retrieval |
| [0004](0004-payments.md) | Ledger first, Stripe plus a second payout rail, no use of the live ThirdRoc account |
| [0005](0005-residency-privacy-i18n.md) | Regional cells, privacy hooks, locale and time zone |
| [0006](0006-deployment.md) | ECS Fargate cell, Cognito for identity, Postgres for authorization |
| [0007](0007-service-levels.md) | Autonomous, Expert Verified, Expert Led |

These records are proposed. The founder accepts them by the actions in [first-response.md](../first-response.md).
