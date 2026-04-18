-- ============================================================
-- Таблицы для настроек школы
-- ============================================================

-- Учебный план: сколько часов каждого предмета у каждого класса
CREATE TABLE IF NOT EXISTS public.curriculum (
  id SERIAL PRIMARY KEY,
  class_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  hours_per_week INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curriculum_class ON public.curriculum(class_name);
CREATE INDEX IF NOT EXISTS idx_curriculum_subject ON public.curriculum(subject);

-- Общие настройки школы
CREATE TABLE IF NOT EXISTS public.school_settings (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Типы кабинетов
CREATE TABLE IF NOT EXISTS public.room_types (
  id SERIAL PRIMARY KEY,
  type_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
