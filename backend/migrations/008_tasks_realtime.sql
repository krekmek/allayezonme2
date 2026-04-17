-- Включаем Realtime для tasks, чтобы Kanban получал INSERT/UPDATE/DELETE.
do $$
begin
    alter publication supabase_realtime add table public.tasks;
exception
    when duplicate_object then null;
end $$;

-- Для корректных UPDATE/DELETE payload
alter table public.tasks replica identity full;
