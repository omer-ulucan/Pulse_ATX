# Supabase database types

`src/index.ts` is generated from the complete local migration chain and checked in so applications can build without a running Supabase stack. After changing migrations, refresh it with:

```bash
pnpm dlx supabase gen types typescript --local > packages/database-types/src/database.generated.ts
```

Run the command only after `pnpm dlx supabase@2.58.5 db reset` succeeds, then include the generated type changes with the migration.
