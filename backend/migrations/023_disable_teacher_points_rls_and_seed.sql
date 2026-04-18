-- 023_disable_teacher_points_rls_and_seed.sql
-- Отключаем RLS на таблице teacher_points и добавляем демо-данные

ALTER TABLE public.teacher_points DISABLE ROW LEVEL SECURITY;

-- Добавляем демо-данные для топа учителей
INSERT INTO public.teacher_points (staff_id, points, reports_before_09_count, last_report_at)
VALUES 
  (1, 25, 18, NOW() - INTERVAL '1 day'),
  (2, 22, 15, NOW() - INTERVAL '2 days'),
  (3, 20, 14, NOW() - INTERVAL '3 days'),
  (4, 18, 12, NOW() - INTERVAL '4 days'),
  (5, 15, 10, NOW() - INTERVAL '5 days')
ON CONFLICT (staff_id) DO NOTHING;
