alter table if exists public.in_app_notifications
  add column if not exists thread_id uuid;

alter table if exists public.in_app_notifications
  add column if not exists parent_notification_id uuid;

update public.in_app_notifications
   set thread_id = id
 where thread_id is null;

alter table if exists public.in_app_notifications
  alter column thread_id set not null;

create index if not exists in_app_notifications_thread_id_idx on public.in_app_notifications(thread_id);
