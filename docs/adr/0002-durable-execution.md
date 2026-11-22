# ADR 0002: Temporal, SQS, and LangGraph

- Status: Proposed
- Date: 2026-11-22

## Context

A tender job parses files, drafts, waits for an expert, and must survive a process crash. The founder asked for Temporal, for LangGraph, and for SQS in the AWS design. Using all three as competing workflow engines would leave two sources of truth.

## Decision

- The API writes a row in `job_queue` in the same transaction as the job change.
- A relay publishes that row to SQS. Workers scale on the queue. The dead-letter queue catches poison messages.
- The worker starts or signals a Temporal workflow. Temporal owns retries, timers, and the human wait. The local dev server is in `docker-compose.yml`. Production uses Temporal Cloud. This repository does not contain a self-hosted Temporal cluster.
- LangGraph is the graph inside one activity: extract, matrix, draft, ground. The skeleton in `workers/ai` has those edges and ignores document text when choosing the next node. Graph checkpoints, if stored, are execution-memory rows in Postgres so they stay under row-level security.
- Activities are idempotent on `(run_id, step name)`.

## Alternatives

A Postgres-only state machine is enough for a single short script. It is a poor fit once a person can take days to review and a crash must resume the same step. That option was set aside because the founder made durability a first-class requirement.

Running LangGraph's own checkpointer in Redis was rejected. It would be a second store without tenant policies.

Putting the model loop in the Next.js server was rejected. Request timeouts and untrusted parsers do not belong there.

## Consequences

SQS is the AWS scaling lever. Temporal is the resume log. LangGraph does not replace either. The Milestone 1 skeleton compiles a graph and does not connect to Temporal. Task 15 in the first response wires them.
