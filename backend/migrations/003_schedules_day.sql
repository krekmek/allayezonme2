-- 003_schedules_day.sql
-- Добавляем день недели в schedules, чтобы расписание было не "глобальным",
-- а разбитым по дням (1 = понедельник, 7 = воскресенье).

ALTER TABLE schedules
    ADD COLUMN IF NOT EXISTS day_of_week SMALLINT
        CHECK (day_of_week BETWEEN 1 AND 7);

CREATE INDEX IF NOT EXISTS idx_schedules_day_of_week ON schedules (day_of_week);
CREATE INDEX IF NOT EXISTS idx_schedules_day_lesson  ON schedules (day_of_week, lesson_number);
