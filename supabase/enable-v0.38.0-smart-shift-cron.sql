-- 0.38.0 Enable the smart shift reminder worker after the app code is live.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists(select 1 from cron.job where jobname='hadas-smart-shift-reminders-v038') then
    perform cron.unschedule('hadas-smart-shift-reminders-v038');
  end if;
end
$$;

select cron.schedule(
  'hadas-smart-shift-reminders-v038',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://hadas-garden.vercel.app/api/push-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name='hadas_shift_reminder_worker_token'
          limit 1
        )
      ),
      body := jsonb_build_object('source','supabase-pg-cron','requested_at',now()),
      timeout_milliseconds := 10000
    ) as request_id;
  $job$
);
