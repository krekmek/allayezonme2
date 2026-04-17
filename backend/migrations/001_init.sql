-- 001_init.sql
-- Базовая схема: staff, schedules, incidents

-- ============================================================
-- staff: сотрудники школы (учителя, администрация и т.д.)
-- ============================================================
CREATE TABLE IF NOT EXISTS staff (
    id             BIGSERIAL PRIMARY KEY,
    fio            TEXT        NOT NULL,
    role           TEXT        NOT NULL,
    telegram_id    BIGINT      UNIQUE,
    specialization TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_telegram_id ON staff (telegram_id);
CREATE INDEX IF NOT EXISTS idx_staff_role        ON staff (role);

-- ============================================================
-- schedules: расписание уроков
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
    id            BIGSERIAL PRIMARY KEY,
    class_name    TEXT    NOT NULL,
    lesson_number INT     NOT NULL CHECK (lesson_number BETWEEN 1 AND 12),
    teacher_id    BIGINT  REFERENCES staff (id) ON DELETE SET NULL,
    room          TEXT,
    subject       TEXT    NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_class      ON schedules (class_name);
CREATE INDEX IF NOT EXISTS idx_schedules_teacher_id ON schedules (teacher_id);

-- ============================================================
-- incidents: инциденты / заявки
-- ============================================================
CREATE TABLE IF NOT EXISTS incidents (
    id                BIGSERIAL PRIMARY KEY,
    description       TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'in_progress', 'resolved', 'cancelled')),
    created_by_tg_id  BIGINT      NOT NULL,
    location          TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status           ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_incidents_created_by_tg_id ON incidents (created_by_tg_id);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at       ON incidents (created_at DESC);
