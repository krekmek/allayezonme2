-- 016_seed_staff_full.sql
-- Полные сид-данные: директор, завучи, учителя, техперсонал, столовая,
-- классы с классными руководителями, и заполнение master_schedule из schedules
-- + дежурства для непедагогов.
-- Идемпотентно.

-- ============================================================
-- 1. Администрация: директор + завучи
-- ============================================================
INSERT INTO public.staff (fio, role, specialization, category, max_load)
SELECT v.fio, v.role, v.spec, v.cat, v.ml
FROM (VALUES
    ('Директоров Директор Директорович', 'director',      NULL,                    'admin', 0),
    ('Алматов Ербол Каримович',          'vice_director', 'завуч по учебной части','admin', 0),
    ('Байжанова Гульнара Серикбаевна',   'vice_director', 'завуч по воспитанию',   'admin', 0)
) AS v(fio, role, spec, cat, ml)
WHERE NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.fio = v.fio);

-- Директор-запись из 006_seed_demo тоже должна получить category
UPDATE public.staff SET category = 'admin', max_load = 0
WHERE role IN ('director', 'admin', 'vice_director') AND category IS DISTINCT FROM 'admin';

-- ============================================================
-- 2. Учителя: проставим category и max_load для уже существующих
-- ============================================================
UPDATE public.staff
SET category = 'teacher', max_load = COALESCE(NULLIF(max_load, 0), 24)
WHERE role = 'teacher';

-- ============================================================
-- 3. Техперсонал: завхоз + слесарь
-- ============================================================
INSERT INTO public.staff (fio, role, specialization, category, max_load)
SELECT v.fio, v.role, v.spec, 'maintenance', 40
FROM (VALUES
    ('Хозяинов Василий Петрович',    'maintenance', 'завхоз'),
    ('Слесарев Михаил Александрович', 'maintenance', 'слесарь-сантехник')
) AS v(fio, role, spec)
WHERE NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.fio = v.fio);

-- ============================================================
-- 4. Столовая: повар
-- ============================================================
INSERT INTO public.staff (fio, role, specialization, category, max_load)
SELECT 'Поварова Наталья Сергеевна', 'kitchen', 'шеф-повар', 'kitchen', 40
WHERE NOT EXISTS (SELECT 1 FROM public.staff WHERE fio = 'Поварова Наталья Сергеевна');

-- ============================================================
-- 5. classes: классы с классными руководителями
-- ============================================================
INSERT INTO public.classes (name, homeroom_teacher_id, students_count)
SELECT v.name,
       (SELECT id FROM public.staff WHERE fio = v.homeroom LIMIT 1),
       v.students
FROM (VALUES
    ('5А', 'Иванова Мария Петровна',       28),
    ('6Б', 'Сидорова Анна Ивановна',       26),
    ('7В', 'Смирнова Ольга Андреевна',     25),
    ('8А', 'Фёдоров Дмитрий Олегович',     24),
    ('9Б', 'Орлов Павел Геннадьевич',      22),
    ('10А','Кузнецов Алексей Викторович',  20),
    ('11Б','Зайцева Татьяна Викторовна',   18)
) AS v(name, homeroom, students)
ON CONFLICT (name) DO UPDATE
SET homeroom_teacher_id = EXCLUDED.homeroom_teacher_id,
    students_count      = EXCLUDED.students_count;

-- ============================================================
-- 6. master_schedule: синхронизация с schedules для учителей
--    (каждый урок = слот в master_schedule с task_type='lesson')
-- ============================================================
-- Чистим старые lesson-слоты, чтобы не дублировались
DELETE FROM public.master_schedule WHERE task_type = 'lesson';

INSERT INTO public.master_schedule (
    staff_id, day_of_week, time_slot, location, task_description, task_type, class_name
)
SELECT
    s.teacher_id,
    s.day_of_week,
    s.lesson_number,
    s.room,
    s.subject || ' · ' || s.class_name,
    'lesson',
    s.class_name
FROM public.schedules s
WHERE s.teacher_id IS NOT NULL
  AND s.day_of_week IS NOT NULL
  AND s.lesson_number IS NOT NULL
ON CONFLICT (staff_id, day_of_week, time_slot) DO NOTHING;

-- ============================================================
-- 7. master_schedule: дежурства для непедагогов
-- ============================================================
-- Завхоз: обходы территории Пн-Пт, утро + вечер
INSERT INTO public.master_schedule (staff_id, day_of_week, time_slot, location, task_description, task_type)
SELECT s.id, v.dow, v.slot, v.loc, v.descr, v.typ
FROM public.staff s, (VALUES
    (1, 1, 'территория', 'Утренний обход школы', 'guard'),
    (2, 1, 'территория', 'Утренний обход школы', 'guard'),
    (3, 1, 'территория', 'Утренний обход школы', 'guard'),
    (4, 1, 'территория', 'Утренний обход школы', 'guard'),
    (5, 1, 'территория', 'Утренний обход школы', 'guard'),
    (1, 7, 'территория', 'Вечерний обход + закрытие', 'guard'),
    (2, 7, 'территория', 'Вечерний обход + закрытие', 'guard'),
    (3, 7, 'территория', 'Вечерний обход + закрытие', 'guard'),
    (4, 7, 'территория', 'Вечерний обход + закрытие', 'guard'),
    (5, 7, 'территория', 'Вечерний обход + закрытие', 'guard')
) AS v(dow, slot, loc, descr, typ)
WHERE s.fio = 'Хозяинов Василий Петрович'
ON CONFLICT (staff_id, day_of_week, time_slot) DO NOTHING;

-- Слесарь: плановые проверки систем Пн-Пт
INSERT INTO public.master_schedule (staff_id, day_of_week, time_slot, location, task_description, task_type)
SELECT s.id, v.dow, v.slot, v.loc, v.descr, 'maintenance'
FROM public.staff s, (VALUES
    (1, 2, 'котельная',     'Проверка отопления'),
    (2, 3, 'водоснабжение', 'Обход сантехники'),
    (3, 2, 'котельная',     'Проверка отопления'),
    (4, 3, 'водоснабжение', 'Обход сантехники'),
    (5, 6, 'вся школа',     'Еженедельная проверка систем')
) AS v(dow, slot, loc, descr)
WHERE s.fio = 'Слесарев Михаил Александрович'
ON CONFLICT (staff_id, day_of_week, time_slot) DO NOTHING;

-- Повар: ежедневная смена в столовой
INSERT INTO public.master_schedule (staff_id, day_of_week, time_slot, location, task_description, task_type)
SELECT s.id, v.dow, v.slot, 'столовая', v.descr, 'cafeteria'
FROM public.staff s, (VALUES
    (1, 1, 'Завтрак'),   (1, 3, 'Обед'),
    (2, 1, 'Завтрак'),   (2, 3, 'Обед'),
    (3, 1, 'Завтрак'),   (3, 3, 'Обед'),
    (4, 1, 'Завтрак'),   (4, 3, 'Обед'),
    (5, 1, 'Завтрак'),   (5, 3, 'Обед')
) AS v(dow, slot, descr)
WHERE s.fio = 'Поварова Наталья Сергеевна'
ON CONFLICT (staff_id, day_of_week, time_slot) DO NOTHING;

-- Завучи: приёмные часы + планёрки
INSERT INTO public.master_schedule (staff_id, day_of_week, time_slot, location, task_description, task_type)
SELECT s.id, v.dow, v.slot, v.loc, v.descr, 'admin'
FROM public.staff s, (VALUES
    (1, 2, 'кабинет 105а', 'Планёрка с учителями'),
    (3, 4, 'кабинет 105а', 'Приёмные часы'),
    (5, 2, 'кабинет 105а', 'Отчёт директору')
) AS v(dow, slot, loc, descr)
WHERE s.fio = 'Алматов Ербол Каримович'
ON CONFLICT (staff_id, day_of_week, time_slot) DO NOTHING;

INSERT INTO public.master_schedule (staff_id, day_of_week, time_slot, location, task_description, task_type)
SELECT s.id, v.dow, v.slot, v.loc, v.descr, 'admin'
FROM public.staff s, (VALUES
    (2, 3, 'кабинет 105б', 'Воспитательная работа'),
    (4, 4, 'кабинет 105б', 'Приёмные часы'),
    (5, 3, 'актовый зал',  'Организация внешкольных мероприятий')
) AS v(dow, slot, loc, descr)
WHERE s.fio = 'Байжанова Гульнара Серикбаевна'
ON CONFLICT (staff_id, day_of_week, time_slot) DO NOTHING;

-- ============================================================
-- 8. Пересчёт weekly_load для всех сотрудников
-- ============================================================
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.staff LOOP
        PERFORM public.recalc_weekly_load(r.id);
    END LOOP;
END $$;
