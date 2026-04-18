"""Интеллектуальный генератор школьного расписания на CP-SAT (OR-Tools).

Возможности:
    * Строит расписание "с нуля" из матриц:
        - учебный план каждого класса (предметы и количество часов в неделю);
        - учителя с их специализацией, ставкой, недоступными слотами;
        - кабинеты (с возможной привязкой к предметам);
    * Поддержка "лент" (cross-class bands): параллель классов одновременно
      делится на группы по уровню (напр. 3А/3Б/3В → 4 уровня английского).
      Алгоритм блокирует один и тот же (day, period) для всех классов
      и занимает столько учителей/кабинетов, сколько групп в ленте.
    * Минимизация "окон" у учителей (штраф за свободные промежутки между уроками).
    * Отсутствие конфликтов: один учитель / один класс / один кабинет не могут
      находиться в двух местах одновременно.

Интерфейс:
    generate_schedule(classes, teachers, rooms, bands, days, periods_per_day,
                      time_limit_sec) -> SchedulerResult

SchedulerResult:
    status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "TIMEOUT"
    lessons: list[ScheduledLesson]   # плоский список результата
    teacher_stats: {teacher_id: {"lessons": int, "gaps": int}}
    solver_wall_time: float          # время решения в секундах
    objective: int | None            # сумма окон в минимуме
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

try:
    from ortools.sat.python import cp_model  # type: ignore
except ImportError as e:  # pragma: no cover
    raise ImportError(
        "Требуется пакет ortools. Установите: pip install ortools"
    ) from e


# ============================================================
# Типы входных данных
# ============================================================

@dataclass
class ClassPlan:
    """Учебный план одного класса."""
    name: str                            # '5А'
    subjects: dict[str, int]             # {'математика': 5, 'русский': 4, ...}
                                         # часы/неделю (уже БЕЗ тех,
                                         # что покрываются лентой — см. BandSpec)


@dataclass
class TeacherSpec:
    id: int
    name: str
    subjects: list[str]                  # какие предметы может вести
    max_hours: int = 24                  # ставка / неделя
    unavailable: list[tuple[int, int]] = field(default_factory=list)
                                         # [(day, period), ...] — недоступно


@dataclass
class RoomSpec:
    name: str                            # '201' | 'спортзал' | 'лингафонный'
    suitable_for: list[str] | None = None   # None = подходит любому предмету


@dataclass
class BandSpec:
    """Лента — параллель классов, одновременно делящаяся на группы.

    Пример: 3А, 3Б, 3В — английский, 4 уровня, 3 часа в неделю.
        classes = ['3А', '3Б', '3В']
        subject = 'английский'
        hours_per_week = 3
        teachers = [t1_id, t2_id, t3_id, t4_id]  # 4 учителя (= 4 группы)
        rooms = ['310', '311', '312', '313']    # 4 разных кабинета

    Алгоритм для каждого из `hours_per_week` слотов ленты выбирает единый
    (day, period) и занимает ВСЕ 3 класса, ВСЕХ 4 учителей, ВСЕ 4 кабинета.
    """
    name: str
    classes: list[str]                   # имена классов параллели
    subject: str
    hours_per_week: int
    teachers: list[int]                  # teacher ids, ровно группы ленты
    rooms: list[str]                     # столько же, сколько teachers


@dataclass
class ScheduledLesson:
    class_name: str
    subject: str
    teacher_id: int
    teacher_name: str
    room: str
    day_of_week: int                     # 1..DAYS
    lesson_number: int                   # 1..PERIODS
    band_name: str | None = None         # если часть ленты


@dataclass
class SchedulerResult:
    status: str
    lessons: list[ScheduledLesson]
    teacher_stats: dict[int, dict[str, int]]
    solver_wall_time: float
    objective: int | None
    message: str = ""


# ============================================================
# Сам solver
# ============================================================

def generate_schedule(
    classes: list[ClassPlan],
    teachers: list[TeacherSpec],
    rooms: list[RoomSpec],
    bands: list[BandSpec] | None = None,
    days: int = 5,
    periods_per_day: int = 7,
    time_limit_sec: int = 30,
) -> SchedulerResult:
    bands = bands or []
    t0 = time.monotonic()

    model = cp_model.CpModel()
    D = days
    P = periods_per_day
    SLOTS = D * P

    teacher_idx = {t.id: i for i, t in enumerate(teachers)}

    # -------------------------------------------------------
    # 1. Подготовка "инстансов уроков":
    #    для каждого класса / предмета / часа — одна ячейка
    # -------------------------------------------------------
    lesson_instances: list[dict[str, Any]] = []
    for c in classes:
        for subj, hours in c.subjects.items():
            for _ in range(hours):
                lesson_instances.append({
                    "class": c.name,
                    "subject": subj,
                    "is_band": False,
                    "band": None,
                })

    # Инстансы лент: по одному на час ленты
    band_instances: list[dict[str, Any]] = []
    for b in bands:
        if len(b.teachers) != len(b.rooms):
            return SchedulerResult(
                status="INPUT_ERROR", lessons=[], teacher_stats={},
                solver_wall_time=0.0, objective=None,
                message=f"Лента {b.name}: число учителей ≠ числу кабинетов",
            )
        for _ in range(b.hours_per_week):
            band_instances.append({"band": b})

    # -------------------------------------------------------
    # 2. Переменные
    # -------------------------------------------------------
    # Обычные уроки: для каждого инстанса выбираем (slot, teacher, room)
    # через булевы переменные X[inst, slot, teacher, room].
    # Для масштабируемости ограничиваем teacher кандидатами по предмету
    # и room кандидатами по suitable_for.

    # Кандидаты
    teachers_for_subject: dict[str, list[int]] = {}
    for t in teachers:
        for s in t.subjects:
            teachers_for_subject.setdefault(s, []).append(t.id)

    rooms_for_subject: dict[str, list[str]] = {}
    for r in rooms:
        # None → подходит любому
        if r.suitable_for:
            for s in r.suitable_for:
                rooms_for_subject.setdefault(s, []).append(r.name)
        else:
            rooms_for_subject.setdefault("__any__", []).append(r.name)

    def cand_rooms(subj: str) -> list[str]:
        specific = rooms_for_subject.get(subj, [])
        generic = rooms_for_subject.get("__any__", [])
        return specific + generic if (specific or generic) else [r.name for r in rooms]

    # X[inst_i][slot][teacher_id][room] — BoolVar
    # Формируем сразу compact: dict вместо 4D массива.
    X: list[dict[tuple[int, int, str], Any]] = []
    for i, inst in enumerate(lesson_instances):
        subj = inst["subject"]
        t_cands = teachers_for_subject.get(subj, [])
        if not t_cands:
            return SchedulerResult(
                status="INPUT_ERROR", lessons=[], teacher_stats={},
                solver_wall_time=0.0, objective=None,
                message=f"Нет учителей по предмету '{subj}' (класс {inst['class']})",
            )
        r_cands = cand_rooms(subj)
        if not r_cands:
            return SchedulerResult(
                status="INPUT_ERROR", lessons=[], teacher_stats={},
                solver_wall_time=0.0, objective=None,
                message=f"Нет кабинетов для '{subj}'",
            )
        entry: dict[tuple[int, int, str], Any] = {}
        for s in range(SLOTS):
            for t_id in t_cands:
                # Учёт недоступности учителя
                day = s // P + 1
                per = s % P + 1
                t = teachers[teacher_idx[t_id]]
                if (day, per) in t.unavailable:
                    continue
                for r_name in r_cands:
                    entry[(s, t_id, r_name)] = model.NewBoolVar(
                        f"x_l{i}_s{s}_t{t_id}_r{r_name}"
                    )
        if not entry:
            return SchedulerResult(
                status="INFEASIBLE", lessons=[], teacher_stats={},
                solver_wall_time=0.0, objective=None,
                message=f"Нет допустимых назначений для урока {inst['class']}/{inst['subject']}",
            )
        X.append(entry)

    # Y[band_inst_i][slot] — BoolVar (лента как единое целое)
    Y: list[dict[int, Any]] = []
    for i, bi in enumerate(band_instances):
        band: BandSpec = bi["band"]
        entry: dict[int, Any] = {}
        for s in range(SLOTS):
            day = s // P + 1
            per = s % P + 1
            # Лента доступна только если все её учителя свободны в этот момент
            if any((day, per) in teachers[teacher_idx[t]].unavailable
                   for t in band.teachers if t in teacher_idx):
                continue
            entry[s] = model.NewBoolVar(f"b_{band.name}_i{i}_s{s}")
        if not entry:
            return SchedulerResult(
                status="INFEASIBLE", lessons=[], teacher_stats={},
                solver_wall_time=0.0, objective=None,
                message=f"Лента {band.name}: нет доступных слотов",
            )
        Y.append(entry)

    # -------------------------------------------------------
    # 3. Предварительные индексы (для быстрого построения constraints)
    # -------------------------------------------------------
    # by_class_slot[class_name][slot] = [vars]
    # by_teacher_slot[t_id][slot]     = [vars]
    # by_room_slot[room][slot]        = [vars]
    # by_teacher_all[t_id]            = [vars]  (для недельной нагрузки)
    # by_teacher_day[t_id][day]       = [vars]  (для СанПиН)
    by_class_slot: dict[str, dict[int, list[Any]]] = {c.name: {} for c in classes}
    by_teacher_slot: dict[int, dict[int, list[Any]]] = {t.id: {} for t in teachers}
    by_room_slot: dict[str, dict[int, list[Any]]] = {r.name: {} for r in rooms}
    by_teacher_all: dict[int, list[Any]] = {t.id: [] for t in teachers}
    by_teacher_day: dict[int, dict[int, list[Any]]] = {t.id: {} for t in teachers}

    for i, entry in enumerate(X):
        c_name = lesson_instances[i]["class"]
        for (s, t_id, r_name), v in entry.items():
            by_class_slot[c_name].setdefault(s, []).append(v)
            by_teacher_slot[t_id].setdefault(s, []).append(v)
            by_room_slot[r_name].setdefault(s, []).append(v)
            by_teacher_all[t_id].append(v)
            day = s // P
            by_teacher_day[t_id].setdefault(day, []).append(v)

    # То же для инстансов лент
    for j, bi in enumerate(band_instances):
        band: BandSpec = bi["band"]
        for s, v in Y[j].items():
            for c_name in band.classes:
                by_class_slot.setdefault(c_name, {}).setdefault(s, []).append(v)
            for t_id in band.teachers:
                if t_id in by_teacher_slot:
                    by_teacher_slot[t_id].setdefault(s, []).append(v)
                    by_teacher_all[t_id].append(v)
                    day = s // P
                    by_teacher_day[t_id].setdefault(day, []).append(v)
            for r_name in band.rooms:
                by_room_slot.setdefault(r_name, {}).setdefault(s, []).append(v)

    # -------------------------------------------------------
    # 4. Ограничения
    # -------------------------------------------------------

    # (a) Каждый инстанс обычного урока размещён ровно в одном месте
    for entry in X:
        model.Add(sum(entry.values()) == 1)
    # (b) Каждый инстанс ленты ровно в одном слоте
    for entry in Y:
        model.Add(sum(entry.values()) == 1)

    # (c) Класс не может быть в 2 местах одновременно
    for c_name, slot_map in by_class_slot.items():
        for s, vars_ in slot_map.items():
            if len(vars_) > 1:
                model.Add(sum(vars_) <= 1)

    # (d) Учитель не может быть в 2 местах одновременно
    for t_id, slot_map in by_teacher_slot.items():
        for s, vars_ in slot_map.items():
            if len(vars_) > 1:
                model.Add(sum(vars_) <= 1)

    # (e) Кабинет не может быть занят двумя уроками
    for r_name, slot_map in by_room_slot.items():
        for s, vars_ in slot_map.items():
            if len(vars_) > 1:
                model.Add(sum(vars_) <= 1)

    # (f) Недельная нагрузка учителя ≤ max_hours
    for t in teachers:
        used = by_teacher_all.get(t.id, [])
        if used and t.max_hours > 0:
            model.Add(sum(used) <= t.max_hours)

    # (g) СанПиН: ≤ 6 уроков у учителя в день
    for t_id, day_map in by_teacher_day.items():
        for d, vars_ in day_map.items():
            if len(vars_) > 6:
                model.Add(sum(vars_) <= 6)

    # -------------------------------------------------------
    # 4. Целевая функция: минимизация окон у учителей
    # -------------------------------------------------------
    # busy[t][s] = 1 если учитель t занят в слоте s
    # day_first[t][d], day_last[t][d] — первый и последний занятый слот дня
    # day_count[t][d] — число занятых слотов дня
    # gaps = (day_last - day_first + 1) - day_count
    # (если в этот день нет уроков, gaps = 0 через ограничение)
    gaps_terms: list[Any] = []
    for t in teachers:
        t_id = t.id
        slot_map = by_teacher_slot.get(t_id, {})
        for d in range(D):
            day_slots = list(range(d * P, (d + 1) * P))
            busy_ds: list[Any] = []
            for s in day_slots:
                parts = slot_map.get(s, [])
                if parts:
                    b = model.NewBoolVar(f"busy_t{t_id}_d{d}_s{s}")
                    # constraint (d) гарантирует sum(parts) ≤ 1, значит b = sum(parts).
                    model.Add(b == sum(parts))
                    busy_ds.append(b)
                else:
                    busy_ds.append(None)

            # Если в день всего ≤1 урок — нет окон
            active = [b for b in busy_ds if b is not None]
            if len(active) < 2:
                continue

            # first/last — минимальный/максимальный индекс периода в дне,
            # в котором учитель занят. gap = (last - first + 1) - count.
            first_var = model.NewIntVar(0, P - 1, f"first_t{t_id}_d{d}")
            last_var = model.NewIntVar(0, P - 1, f"last_t{t_id}_d{d}")
            count_var = model.NewIntVar(0, P, f"count_t{t_id}_d{d}")
            model.Add(count_var == sum(active))

            has_any = model.NewBoolVar(f"hasany_t{t_id}_d{d}")
            model.Add(count_var >= 1).OnlyEnforceIf(has_any)
            model.Add(count_var == 0).OnlyEnforceIf(has_any.Not())

            # first ≤ i для всех i, где busy=1; first = min
            for i, b in enumerate(busy_ds):
                if b is None:
                    continue
                # если busy, то first <= i and last >= i
                model.Add(first_var <= i).OnlyEnforceIf(b)
                model.Add(last_var >= i).OnlyEnforceIf(b)
            # существует такой i, где busy=1 И first_var == i
            # реализация через reified равенство — сложно. Вместо этого:
            # first_var ∈ {позиции с busy=1} обеспечим так:
            # для каждого i: (first_var == i) => busy_ds[i] == 1
            eq_first = [model.NewBoolVar(f"ef_t{t_id}_d{d}_i{i}")
                        for i in range(P)]
            eq_last = [model.NewBoolVar(f"el_t{t_id}_d{d}_i{i}")
                       for i in range(P)]
            for i in range(P):
                model.Add(first_var == i).OnlyEnforceIf(eq_first[i])
                model.Add(first_var != i).OnlyEnforceIf(eq_first[i].Not())
                model.Add(last_var == i).OnlyEnforceIf(eq_last[i])
                model.Add(last_var != i).OnlyEnforceIf(eq_last[i].Not())
                if busy_ds[i] is None:
                    # В этом слоте кандидатов нет, значит first/last туда можно
                    # ставить только когда has_any=0.
                    model.AddImplication(eq_first[i], has_any.Not())
                    model.AddImplication(eq_last[i], has_any.Not())
                else:
                    # Условная импликация: (has_any ∧ eq_first[i]) ⇒ busy_ds[i]=1.
                    # При has_any=0 констрейнт неактивен.
                    model.AddBoolOr([eq_first[i].Not(), has_any.Not(), busy_ds[i]])
                    model.AddBoolOr([eq_last[i].Not(), has_any.Not(), busy_ds[i]])
            model.Add(sum(eq_first) == 1)
            model.Add(sum(eq_last) == 1)

            # gap = (last - first + 1) - count
            gap_var = model.NewIntVar(0, P, f"gap_t{t_id}_d{d}")
            model.Add(gap_var == last_var - first_var + 1 - count_var).OnlyEnforceIf(has_any)
            model.Add(gap_var == 0).OnlyEnforceIf(has_any.Not())
            gaps_terms.append(gap_var)

    if gaps_terms:
        model.Minimize(sum(gaps_terms))

    # -------------------------------------------------------
    # 5. Запуск решения
    # -------------------------------------------------------
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(time_limit_sec)
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    status_name = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "TIMEOUT",
    }.get(status, "UNKNOWN")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SchedulerResult(
            status=status_name, lessons=[], teacher_stats={},
            solver_wall_time=time.monotonic() - t0, objective=None,
            message="Решение не найдено. Проверьте матрицы часов/учителей/кабинетов.",
        )

    # -------------------------------------------------------
    # 6. Извлечение результата
    # -------------------------------------------------------
    lessons: list[ScheduledLesson] = []
    for i, entry in enumerate(X):
        inst = lesson_instances[i]
        chosen = None
        for key, v in entry.items():
            if solver.Value(v) == 1:
                chosen = key
                break
        if chosen is None:
            continue
        s, t_id, r_name = chosen
        day = s // P + 1
        per = s % P + 1
        t = teachers[teacher_idx[t_id]]
        lessons.append(ScheduledLesson(
            class_name=inst["class"],
            subject=inst["subject"],
            teacher_id=t_id,
            teacher_name=t.name,
            room=r_name,
            day_of_week=day,
            lesson_number=per,
        ))

    # ленты: для каждого инстанса разворачиваем на все классы × группы
    for j, bi in enumerate(band_instances):
        band: BandSpec = bi["band"]
        chosen_s = None
        for s, v in Y[j].items():
            if solver.Value(v) == 1:
                chosen_s = s
                break
        if chosen_s is None:
            continue
        day = chosen_s // P + 1
        per = chosen_s % P + 1
        # каждый класс параллели — одна запись на каждую группу
        # НО: ученики каждого класса распределяются по группам.
        # Для вывода в schedules делаем по одной записи на (class, teacher, room) пару
        # в порядке band.teachers / band.rooms. Если классов меньше, чем учителей
        # — всё равно сохраняем все пары (группы уровневые, не классовые).
        for c_name in band.classes:
            for t_id, r_name in zip(band.teachers, band.rooms):
                t = teachers[teacher_idx[t_id]]
                lessons.append(ScheduledLesson(
                    class_name=c_name,
                    subject=band.subject,
                    teacher_id=t_id,
                    teacher_name=t.name,
                    room=r_name,
                    day_of_week=day,
                    lesson_number=per,
                    band_name=band.name,
                ))

    # -------------------------------------------------------
    # 7. Статистика по учителям
    # -------------------------------------------------------
    teacher_stats: dict[int, dict[str, int]] = {}
    # Уникализируем по (teacher_id, day, period) чтобы ленты не задвоили
    for t in teachers:
        teacher_stats[t.id] = {"lessons": 0, "gaps": 0, "max_hours": t.max_hours}
    seen: set[tuple[int, int, int]] = set()
    for l in lessons:
        key = (l.teacher_id, l.day_of_week, l.lesson_number)
        if key in seen:
            continue
        seen.add(key)
        teacher_stats.setdefault(l.teacher_id, {"lessons": 0, "gaps": 0, "max_hours": 0})
        teacher_stats[l.teacher_id]["lessons"] += 1

    # Считаем окна в плоском виде из результата
    for t_id, stats in teacher_stats.items():
        for d in range(1, D + 1):
            periods = sorted({
                l.lesson_number for l in lessons
                if l.teacher_id == t_id and l.day_of_week == d
            })
            if len(periods) <= 1:
                continue
            span = periods[-1] - periods[0] + 1
            stats["gaps"] += span - len(periods)

    return SchedulerResult(
        status=status_name,
        lessons=lessons,
        teacher_stats=teacher_stats,
        solver_wall_time=time.monotonic() - t0,
        objective=int(solver.ObjectiveValue()) if gaps_terms else 0,
        message=f"Найдено решение ({status_name}), уроков: {len(lessons)}",
    )
