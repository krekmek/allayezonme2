import { supabase } from "./supabase";

export type Staff = {
  id: number;
  fio: string;
  role: string;
  specialization: string | null;
  telegram_id: number | null;
};

/**
 * Подобрать кандидатов на замену отсутствующего учителя.
 * Повторяет логику backend/logic.py::find_substitution.
 *
 * Правила:
 *  1. Кандидат — staff с ролью 'teacher' и той же specialization, что у отсутствующего.
 *  2. Сам отсутствующий не включается.
 *  3. У кандидата нет своего урока на `lesson_number`
 *     (и, если передан `day_of_week`, — именно в этот день).
 */
export async function findSubstitution(
  absentTeacherId: number,
  lessonNumber: number,
  dayOfWeek?: number
): Promise<Staff[]> {
  // 1. Отсутствующий учитель
  const { data: absentRows, error: absentErr } = await supabase
    .from("staff")
    .select("id, fio, role, specialization")
    .eq("id", absentTeacherId)
    .limit(1);
  if (absentErr) throw absentErr;
  const absent = absentRows?.[0];
  if (!absent || !absent.specialization) return [];

  // 2. Кандидаты с той же специализацией
  const { data: candidates, error: candErr } = await supabase
    .from("staff")
    .select("id, fio, telegram_id, role, specialization")
    .eq("role", "teacher")
    .eq("specialization", absent.specialization)
    .neq("id", absentTeacherId);
  if (candErr) throw candErr;
  if (!candidates || candidates.length === 0) return [];

  // 3. Занятые учителя на этом уроке
  let busyQuery = supabase
    .from("schedules")
    .select("teacher_id")
    .eq("lesson_number", lessonNumber);
  if (dayOfWeek !== undefined && dayOfWeek !== null) {
    busyQuery = busyQuery.eq("day_of_week", dayOfWeek);
  }
  const { data: busyRows, error: busyErr } = await busyQuery;
  if (busyErr) throw busyErr;

  const busyIds = new Set<number>(
    (busyRows || [])
      .map((r) => r.teacher_id)
      .filter((x): x is number => x !== null && x !== undefined)
  );

  return (candidates as Staff[]).filter((c) => !busyIds.has(c.id));
}
