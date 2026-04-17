-- 006_seed_demo.sql
-- Демо-данные: несколько учителей и расписание на понедельник-пятницу для 5А, 6Б, 7В.
-- Идемпотентно: повторный запуск не создаст дубликатов.

-- ============================================================
-- Учителя (role='teacher'), фейковые — без telegram_id
-- ============================================================
insert into staff (fio, role, specialization)
select v.fio, 'teacher', v.spec
from (values
    ('Иванова Мария Петровна',    'математика'),
    ('Петров Сергей Николаевич',  'математика'),
    ('Сидорова Анна Ивановна',    'русский язык'),
    ('Кузнецов Алексей Викторович','русский язык'),
    ('Смирнова Ольга Андреевна',  'физика'),
    ('Фёдоров Дмитрий Олегович',  'информатика'),
    ('Николаева Екатерина Павловна','биология'),
    ('Орлов Павел Геннадьевич',   'история'),
    ('Зайцева Татьяна Викторовна','английский язык'),
    ('Морозов Игорь Станиславович','физкультура')
) as v(fio, spec)
where not exists (
    select 1 from staff s where s.fio = v.fio
);

-- Директор (если нет) — пригодится для /login_as
insert into staff (fio, role, specialization)
select 'Директоров Директор Директорович', 'director', null
where not exists (
    select 1 from staff where role = 'director'
);

-- ============================================================
-- Расписание: 5А, 6Б, 7В × 5 дней × 5 уроков
-- ============================================================

-- Чистим только демо-записи (по class_name), чтобы можно было перезалить
delete from schedules where class_name in ('5А', '6Б', '7В');

with t as (
    select
        (select id from staff where fio = 'Иванова Мария Петровна')    as math1,
        (select id from staff where fio = 'Петров Сергей Николаевич')  as math2,
        (select id from staff where fio = 'Сидорова Анна Ивановна')    as rus1,
        (select id from staff where fio = 'Кузнецов Алексей Викторович') as rus2,
        (select id from staff where fio = 'Смирнова Ольга Андреевна')  as phys,
        (select id from staff where fio = 'Фёдоров Дмитрий Олегович')  as inf,
        (select id from staff where fio = 'Николаева Екатерина Павловна') as bio,
        (select id from staff where fio = 'Орлов Павел Геннадьевич')   as hist,
        (select id from staff where fio = 'Зайцева Татьяна Викторовна')as eng,
        (select id from staff where fio = 'Морозов Игорь Станиславович')as pe
)
insert into schedules (class_name, lesson_number, teacher_id, room, subject, day_of_week)
select class_name, lesson_number, teacher_id, room, subject, day_of_week from t, (values
    -- ========== Понедельник (1) ==========
    ('5А', 1, (select math1 from t), '201', 'Математика',     1),
    ('5А', 2, (select rus1  from t), '105', 'Русский язык',   1),
    ('5А', 3, (select eng   from t), '310', 'Английский',     1),
    ('5А', 4, (select bio   from t), '212', 'Биология',       1),
    ('5А', 5, (select pe    from t), 'зал', 'Физкультура',    1),

    ('6Б', 1, (select rus2  from t), '106', 'Русский язык',   1),
    ('6Б', 2, (select math2 from t), '202', 'Математика',     1),
    ('6Б', 3, (select hist  from t), '308', 'История',        1),
    ('6Б', 4, (select inf   from t), '401', 'Информатика',    1),
    ('6Б', 5, (select eng   from t), '310', 'Английский',     1),

    ('7В', 1, (select phys  from t), '215', 'Физика',         1),
    ('7В', 2, (select math1 from t), '201', 'Математика',     1),
    ('7В', 3, (select rus1  from t), '105', 'Русский язык',   1),
    ('7В', 4, (select hist  from t), '308', 'История',        1),
    ('7В', 5, (select pe    from t), 'зал', 'Физкультура',    1),

    -- ========== Вторник (2) ==========
    ('5А', 1, (select eng   from t), '310', 'Английский',     2),
    ('5А', 2, (select math1 from t), '201', 'Математика',     2),
    ('5А', 3, (select rus1  from t), '105', 'Русский язык',   2),
    ('5А', 4, (select inf   from t), '401', 'Информатика',    2),
    ('5А', 5, (select hist  from t), '308', 'История',        2),

    ('6Б', 1, (select math2 from t), '202', 'Математика',     2),
    ('6Б', 2, (select rus2  from t), '106', 'Русский язык',   2),
    ('6Б', 3, (select bio   from t), '212', 'Биология',       2),
    ('6Б', 4, (select phys  from t), '215', 'Физика',         2),
    ('6Б', 5, (select pe    from t), 'зал', 'Физкультура',    2),

    ('7В', 1, (select rus1  from t), '105', 'Русский язык',   2),
    ('7В', 2, (select phys  from t), '215', 'Физика',         2),
    ('7В', 3, (select math1 from t), '201', 'Математика',     2),
    ('7В', 4, (select eng   from t), '310', 'Английский',     2),
    ('7В', 5, (select inf   from t), '401', 'Информатика',    2),

    -- ========== Среда (3) ==========
    ('5А', 1, (select math1 from t), '201', 'Математика',     3),
    ('5А', 2, (select bio   from t), '212', 'Биология',       3),
    ('5А', 3, (select rus1  from t), '105', 'Русский язык',   3),
    ('5А', 4, (select pe    from t), 'зал', 'Физкультура',    3),

    ('6Б', 1, (select eng   from t), '310', 'Английский',     3),
    ('6Б', 2, (select math2 from t), '202', 'Математика',     3),
    ('6Б', 3, (select inf   from t), '401', 'Информатика',    3),
    ('6Б', 4, (select hist  from t), '308', 'История',        3),

    ('7В', 1, (select phys  from t), '215', 'Физика',         3),
    ('7В', 2, (select rus1  from t), '105', 'Русский язык',   3),
    ('7В', 3, (select math1 from t), '201', 'Математика',     3),
    ('7В', 4, (select bio   from t), '212', 'Биология',       3),

    -- ========== Четверг (4) ==========
    ('5А', 1, (select rus1  from t), '105', 'Русский язык',   4),
    ('5А', 2, (select math1 from t), '201', 'Математика',     4),
    ('5А', 3, (select eng   from t), '310', 'Английский',     4),
    ('5А', 4, (select hist  from t), '308', 'История',        4),
    ('5А', 5, (select inf   from t), '401', 'Информатика',    4),

    ('6Б', 1, (select math2 from t), '202', 'Математика',     4),
    ('6Б', 2, (select rus2  from t), '106', 'Русский язык',   4),
    ('6Б', 3, (select phys  from t), '215', 'Физика',         4),
    ('6Б', 4, (select pe    from t), 'зал', 'Физкультура',    4),

    ('7В', 1, (select eng   from t), '310', 'Английский',     4),
    ('7В', 2, (select math1 from t), '201', 'Математика',     4),
    ('7В', 3, (select rus1  from t), '105', 'Русский язык',   4),
    ('7В', 4, (select hist  from t), '308', 'История',        4),

    -- ========== Пятница (5) ==========
    ('5А', 1, (select eng   from t), '310', 'Английский',     5),
    ('5А', 2, (select math1 from t), '201', 'Математика',     5),
    ('5А', 3, (select bio   from t), '212', 'Биология',       5),
    ('5А', 4, (select pe    from t), 'зал', 'Физкультура',    5),

    ('6Б', 1, (select rus2  from t), '106', 'Русский язык',   5),
    ('6Б', 2, (select math2 from t), '202', 'Математика',     5),
    ('6Б', 3, (select eng   from t), '310', 'Английский',     5),
    ('6Б', 4, (select inf   from t), '401', 'Информатика',    5),

    ('7В', 1, (select math1 from t), '201', 'Математика',     5),
    ('7В', 2, (select phys  from t), '215', 'Физика',         5),
    ('7В', 3, (select rus1  from t), '105', 'Русский язык',   5),
    ('7В', 4, (select pe    from t), 'зал', 'Физкультура',    5)
) as rows(class_name, lesson_number, teacher_id, room, subject, day_of_week);
