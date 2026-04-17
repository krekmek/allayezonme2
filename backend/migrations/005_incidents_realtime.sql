-- Включаем Realtime для incidents (идемпотентно)
do $$
begin
    alter publication supabase_realtime add table public.incidents;
exception
    when duplicate_object then null;
end $$;

-- Для корректных UPDATE/DELETE-payload в Realtime нужен REPLICA IDENTITY FULL
alter table public.incidents replica identity full;
