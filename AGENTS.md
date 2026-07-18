# PulseATX Development Guide

## Repository conventions

- Use pnpm workspace commands from the repository root.
- Keep TypeScript strict and validate external data with Zod.
- Put browser code in `apps/web` and persistent runtime code in `apps/agent`.
- Keep reusable schemas, prompts, database types, and utilities in `packages`.
- Never expose service-role credentials or provider API keys to browser bundles.
- Prefer deterministic rules for deduplication, correlation, and thresholds.
- Add fixture-backed or mocked tests for every external integration.

## Verification

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before completing a phase.
