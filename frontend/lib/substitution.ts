import { supabase } from "./supabase";

export type Staff = {
  id: number;
  fio: string;
  role: string;
  specialization: string | null;
  telegram_id: number | null;
  warnings?: string[];
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
 *  4. Проверка кабинета: если у кандидата есть урок на соседнее время в другом кабинете -
 *     добавляется предупреждение о нарушении СанПиН.
 *  5. Проверка нагрузки: если у кандидата больше 6 уроков в день -
 *     добавляется предупреждение о нарушении СанПиН.
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

  // Получаем кабинет отсутствующего учителя на этот урок
  let absentRoom: string | null = null;
  if (dayOfWeek !== undefined && dayOfWeek !== null) {
    const { data: absentLesson } = await supabase
      .from("schedules")
      .select("room")
      .eq("teacher_id", absentTeacherId)
      .eq("lesson_number", lessonNumber)
      .eq("day_of_week", dayOfWeek)
      .limit(1);
    if (absentLesson && absentLesson.length > 0) {
      absentRoom = absentLesson[0].room;
    }
  }

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

  // 4. Фильтрация и проверка предупреждений
  const result: Staff[] = [];
  for (const candidate of candidates as Staff[]) {
    if (busyIds.has(candidate.id)) {
      continue; // Учитель занят на этом уроке
    }

    const warnings: string[] = [];

    // Проверка кабинета на соседних уроках
    if (dayOfWeek !== undefined && dayOfWeek !== null && absentRoom) {
      for (const adjacentLesson of [lessonNumber - 1, lessonNumber + 1]) {
        if (adjacentLesson >= 1 && adjacentLesson <= 12) {
          const { data: adjacentSchedule } = await supabase
            .from("schedules")
            .select("room")
            .eq("teacher_id", candidate.id)
            .eq("lesson_number", adjacentLesson)
            .eq("day_of_week", dayOfWeek)
            .limit(1);
          
          if (adjacentSchedule && adjacentSchedule.length > 0) {
            const adjacentRoom = adjacentSchedule[0].room;
            if (adjacentRoom && adjacentRoom !== absentRoom) {
              warnings.push("Нарушение санпина: разные кабинеты");
              break;
            }
          }
        }
      }
    }

    // Проверка нагрузки в день
    if (dayOfWeek !== undefined && dayOfWeek !== null) {
      const { data: dailyLessons } = await supabase
        .from("schedules")
        .select("id")
        .eq("teacher_id", candidate.id)
        .eq("day_of_week", dayOfWeek);
      
      const lessonCount = dailyLessons?.length || 0;
      if (lessonCount >= 6) {
        warnings.push("Нарушение санпина: более 6 уроков в день");
      }
    }

    result.push({ ...candidate, warnings });
  }

  return result;
}
