-- Отчёты по посещаемости (для столовой и учёта учеников)
create table if not exists public.attendance_reports (
    id bigserial primary key,
    class_name text,
    present_count integer not null default 0,
    absent_count integer not null default 0,
    absent_list text[] default '{}'::text[],
    portions integer not null default 0,
    raw_text text,
    created_by_tg_id bigint,
    created_at timestamptz not null default now()
);

create index if not exists attendance_reports_created_at_idx
    on public.attendance_reports (created_at desc);

create index if not exists attendance_reports_class_name_idx
    on public.attendance_reports (class_name);

-- Включаем Realtime (идемпотентно)
do $$
begin
    alter publication supabase_realtime add table public.attendance_reports;
exception
    when duplicate_object then null;
end $$;
