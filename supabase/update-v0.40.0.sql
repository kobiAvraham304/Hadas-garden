-- Additive library migration; existing scheduling tables are unchanged.
create table if not exists public.hadas_library_items (
 id uuid primary key default gen_random_uuid(), created_by uuid not null references public.hadas_employees(id),
 title text not null check(char_length(title) between 1 and 140), category text not null check(category in ('meeting','craft','video','music','idea','document')),
 description text not null default '' check(char_length(description)<=6000), tags text[] not null default '{}', link_url text,
 age_range text not null default '', duration_minutes integer check(duration_minutes between 1 and 240), materials text not null default '', adaptations text not null default '',
 status text not null default 'draft' check(status in ('draft','published','deleted')), is_pinned boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz
);
create table if not exists public.hadas_library_files (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.hadas_library_items(id) on delete cascade,
 name text not null, mime_type text not null, size_bytes bigint not null check(size_bytes between 1 and 52428800), storage_path text not null unique,
 uploaded boolean not null default false, is_thumbnail boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.hadas_library_reactions (
 item_id uuid not null references public.hadas_library_items(id) on delete cascade, employee_id uuid not null references public.hadas_employees(id) on delete cascade,
 kind text not null check(kind in ('like','tried')), created_at timestamptz not null default now(), primary key(item_id,employee_id,kind)
);
create table if not exists public.hadas_library_bookmarks (
 item_id uuid not null references public.hadas_library_items(id) on delete cascade, employee_id uuid not null references public.hadas_employees(id) on delete cascade,
 collection text not null default 'השמורים שלי' check(char_length(collection) between 1 and 60), created_at timestamptz not null default now(), primary key(item_id,employee_id)
);
create table if not exists public.hadas_library_comments (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.hadas_library_items(id) on delete cascade,
 employee_id uuid not null references public.hadas_employees(id), content text not null check(char_length(content) between 1 and 2000), created_at timestamptz not null default now()
);
create index if not exists hadas_library_published_idx on public.hadas_library_items(published_at desc) where status='published';
create index if not exists hadas_library_owner_idx on public.hadas_library_items(created_by,status);
create index if not exists hadas_library_files_item_idx on public.hadas_library_files(item_id);
create index if not exists hadas_library_bookmarks_employee_idx on public.hadas_library_bookmarks(employee_id,collection);
create index if not exists hadas_library_comments_item_idx on public.hadas_library_comments(item_id,created_at);
create index if not exists hadas_library_comments_employee_idx on public.hadas_library_comments(employee_id);
create index if not exists hadas_library_reactions_employee_idx on public.hadas_library_reactions(employee_id);
do $$ declare t text; begin
 foreach t in array array['hadas_library_items','hadas_library_files','hadas_library_reactions','hadas_library_bookmarks','hadas_library_comments'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
drop trigger if exists hadas_library_updated on public.hadas_library_items;
create trigger hadas_library_updated before update on public.hadas_library_items for each row execute function public.hadas_set_updated_at();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hadas-library','hadas-library',false,52428800,array[
 'image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif',
 'video/mp4','video/quicktime','video/webm','audio/mpeg','audio/wav','audio/ogg','audio/mp4','audio/aac','audio/flac',
 'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'text/csv','text/plain','application/rtf','application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet','application/vnd.oasis.opendocument.presentation',
 'application/zip','application/vnd.rar','application/x-7z-compressed']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.hadas_library_list(p_employee uuid,p_query text default '',p_category text default '',p_view text default 'all',p_collection text default '',p_sort text default 'new',p_offset integer default 0,p_id uuid default null)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
 with enriched as (
  select i.*, e.full_name as author_name,
   coalesce((select jsonb_agg(to_jsonb(f)-'storage_path' order by f.is_thumbnail desc,f.created_at) from public.hadas_library_files f where f.item_id=i.id and f.uploaded),'[]'::jsonb) as files,
   (select count(*) from public.hadas_library_reactions r where r.item_id=i.id and r.kind='like') as likes_count,
   (select count(*) from public.hadas_library_reactions r where r.item_id=i.id and r.kind='tried') as tried_count,
   (select count(*) from public.hadas_library_comments c where c.item_id=i.id) as comments_count,
   exists(select 1 from public.hadas_library_reactions r where r.item_id=i.id and r.employee_id=p_employee and r.kind='like') as liked,
   exists(select 1 from public.hadas_library_reactions r where r.item_id=i.id and r.employee_id=p_employee and r.kind='tried') as tried,
   b.collection as saved_collection
  from public.hadas_library_items i join public.hadas_employees e on e.id=i.created_by
  left join public.hadas_library_bookmarks b on b.item_id=i.id and b.employee_id=p_employee
  where i.status='published' and (p_id is null or i.id=p_id)
   and (p_category='' or i.category=p_category)
   and (p_view<>'mine' or i.created_by=p_employee)
   and (p_view<>'saved' or b.item_id is not null)
   and (p_collection='' or b.collection=p_collection)
   and (p_query='' or position(lower(p_query) in lower(i.title||' '||i.description||' '||array_to_string(i.tags,' ')||' '||e.full_name))>0)
 ), page as (
  select * from enriched order by is_pinned desc,
   case when p_sort='popular' then likes_count end desc,
   case when p_sort='tried' then tried_count end desc,published_at desc,id
  limit 24 offset greatest(0,p_offset)
 ) select jsonb_build_object(
  'items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),
  'total',(select count(*) from enriched),
  'collections',coalesce((select jsonb_agg(collection order by collection) from (select distinct b.collection from public.hadas_library_bookmarks b join public.hadas_library_items i on i.id=b.item_id and i.status='published' where b.employee_id=p_employee) x),'[]'::jsonb)
 );
$$;
revoke all on function public.hadas_library_list(uuid,text,text,text,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.hadas_library_list(uuid,text,text,text,text,text,integer,uuid) to service_role;

create or replace function public.hadas_library_reserve_file(p_employee uuid,p_item uuid,p_file uuid,p_name text,p_mime text,p_size bigint,p_path text,p_thumbnail boolean default false)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare i public.hadas_library_items; f public.hadas_library_files; begin
 select * into i from public.hadas_library_items where id=p_item for update;
 if i.id is null or i.created_by<>p_employee or i.status<>'draft' then raise exception 'library_draft_unavailable'; end if;
 select * into f from public.hadas_library_files where id=p_file and item_id=p_item;
 if f.id is not null then return to_jsonb(f); end if;
 if p_thumbnail then
  if p_mime<>'image/jpeg' or p_size>524288 or exists(select 1 from public.hadas_library_files where item_id=p_item and is_thumbnail) then raise exception 'library_thumbnail_limit'; end if;
 else
  if (select count(*) from public.hadas_library_files where item_id=p_item and not is_thumbnail)>=10 then raise exception 'library_file_limit'; end if;
 end if;
 insert into public.hadas_library_files(id,item_id,name,mime_type,size_bytes,storage_path,is_thumbnail) values(p_file,p_item,p_name,p_mime,p_size,p_path,p_thumbnail) returning * into f;
 return to_jsonb(f);
end $$;
create or replace function public.hadas_library_publish(p_employee uuid,p_item uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare i public.hadas_library_items; begin
 select * into i from public.hadas_library_items where id=p_item for update;
 if i.id is null or i.created_by<>p_employee or i.status='deleted' then raise exception 'library_draft_unavailable'; end if;
 if i.status='published' then return to_jsonb(i); end if;
 if exists(select 1 from public.hadas_library_files where item_id=p_item and not uploaded) then raise exception 'library_upload_incomplete'; end if;
 if i.description='' and i.link_url is null and not exists(select 1 from public.hadas_library_files where item_id=p_item and uploaded and not is_thumbnail) then raise exception 'library_content_required'; end if;
 update public.hadas_library_items set status='published',published_at=now() where id=p_item returning * into i;
 return to_jsonb(i);
end $$;
revoke all on function public.hadas_library_reserve_file(uuid,uuid,uuid,text,text,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.hadas_library_reserve_file(uuid,uuid,uuid,text,text,bigint,text,boolean) to service_role;
revoke all on function public.hadas_library_publish(uuid,uuid) from public,anon,authenticated;
grant execute on function public.hadas_library_publish(uuid,uuid) to service_role;

update public.hadas_app_meta set schema_version='0.40.0',app_version='0.40.0',updated_at=now() where id=1;
