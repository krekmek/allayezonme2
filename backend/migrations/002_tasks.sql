-- 002_tasks.sql
-- Таблица задач (например, надиктованные директором голосом)

CREATE TABLE IF NOT EXISTS tasks (
    id               BIGSERIAL PRIMARY KEY,
    description      TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'in_progress', 'done', 'cancelled')),
    created_by_tg_id BIGINT      NOT NULL,
    assignee         TEXT,        -- кому поручено (ФИО или роль, текстом)
    due_date         DATE,        -- срок (если распознан)
    source           TEXT         NOT NULL DEFAULT 'text'
                     CHECK (source IN ('text', 'voice')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status           ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by_tg_id ON tasks (created_by_tg_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date         ON tasks (due_date);
