# העלאת גרסה 0.4.0 ל־Vercel

1. הרץ פעם אחת ב־Supabase את `supabase/schema.sql` של גרסה 0.4.0.
2. ב־Vercel ודא שקיימים רק:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
3. העלה ל־GitHub את כל תוכן התיקייה של גרסה 0.4.0.
4. המתן ל־Vercel עד שהפריסה תופיע כ־Ready.
5. פתח `/health` ובדוק שכל השורות ירוקות.
6. התחבר עם המספר של אילנית או לינור והסיסמה `hadas`.
