# Deploy v0.18.0

1. Run `supabase/update-v0.18.0.sql` once in Supabase SQL Editor.
2. Do not rerun `schema.sql`.
3. Replace v0.17.1 files with v0.18.0 files.
4. Keep only `api/index.js` in the `api` folder.
5. Commit and push.
6. Wait for Vercel `Ready`.
7. Verify `/health`: site `0.18.0`, database `0.18.0`.
8. On iPhone, close and reopen the site. If needed, open once with `/?v=0180`.
