# Supabase database types

`src/index.ts` is a generated-compatible subset checked into the repository so the worker can build without a running local Supabase stack. After applying migrations, refresh it with:

```bash
pnpm dlx supabase gen types typescript --local > packages/database-types/src/database.generated.ts
```

The checked-in interfaces must be updated alongside migrations when the CLI is unavailable.
