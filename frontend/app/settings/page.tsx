"use client";

import { useEffect, useState } from "react";
import { Settings, Save, Plus, Trash2, GraduationCap, Users, Building2, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("curriculum");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Settings className="h-6 w-6" />
            Настройки школы
          </h1>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-border pb-4">
          <button
            type="button"
            onClick={() => setActiveTab("curriculum")}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              activeTab === "curriculum"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:border-primary/60"
            }`}
          >
            <GraduationCap className="h-4 w-4 inline mr-2" />
            Учебный план
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("teachers")}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              activeTab === "teachers"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:border-primary/60"
            }`}
          >
            <Users className="h-4 w-4 inline mr-2" />
            Учителя
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("rooms")}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              activeTab === "rooms"
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-muted-foreground hover:border-primary/60"
            }`}
          >
            <Building2 className="h-4 w-4 inline mr-2" />
            Кабинеты
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "curriculum" && <CurriculumSettings />}
        {activeTab === "teachers" && <TeacherSettings />}
        {activeTab === "rooms" && <RoomSettings />}
      </div>
    </div>
  );
}

function CurriculumSettings() {
  const [curriculum, setCurriculum] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCurriculum();
  }, []);

  async function loadCurriculum() {
    try {
      const res = await fetch(`${API_BASE}/api/curriculum`);
      const data = await res.json();
      setCurriculum(data);
    } catch (e) {
      console.error("Failed to load curriculum:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Save all items
      for (const item of curriculum) {
        if (item.id) {
          await fetch(`${API_BASE}/api/curriculum/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          });
        } else {
          await fetch(`${API_BASE}/api/curriculum`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          });
        }
      }
      await loadCurriculum();
      alert("Сохранено!");
    } catch (e) {
      console.error("Failed to save:", e);
      alert("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  function handleAdd() {
    setCurriculum([...curriculum, { class_name: "", subject: "", hours_per_week: 1 }]);
  }

  function handleUpdate(idx: number, field: string, value: any) {
    const updated = [...curriculum];
    updated[idx] = { ...updated[idx], [field]: value };
    setCurriculum(updated);
  }

  function handleDelete(idx: number) {
    const item = curriculum[idx];
    if (item.id) {
      fetch(`${API_BASE}/api/curriculum/${item.id}`, { method: "DELETE" });
    }
    setCurriculum(curriculum.filter((_, i) => i !== idx));
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Учебный план по классам</h2>
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium"
        >
          <Plus className="h-4 w-4" />
          Добавить
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-background/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Класс</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Предмет</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Часов в неделю</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Действия</th>
            </tr>
          </thead>
          <tbody>
            {curriculum.map((item, idx) => (
              <tr key={idx} className="border-t border-border">
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={item.class_name}
                    onChange={(e) => handleUpdate(idx, "class_name", e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={item.subject}
                    onChange={(e) => handleUpdate(idx, "subject", e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={item.hours_per_week}
                    onChange={(e) => handleUpdate(idx, "hours_per_week", parseInt(e.target.value) || 1)}
                    className="w-20 bg-background border border-border rounded px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleDelete(idx)}
                    className="p-2 text-red-500 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить изменения
        </button>
      </div>
    </div>
  );
}

function TeacherSettings() {
  const [maxLoad, setMaxLoad] = useState(40);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await fetch(`${API_BASE}/api/school-settings`);
      const data = await res.json();
      const setting = data.find((s: any) => s.key === "max_teacher_load");
      if (setting) setMaxLoad(parseInt(setting.value) || 40);
    } catch (e) {
      console.error("Failed to load settings:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`${API_BASE}/api/school-settings/max_teacher_load`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "max_teacher_load",
          value: maxLoad.toString(),
          description: "Максимальная нагрузка учителя в неделю",
        }),
      });
      alert("Сохранено!");
    } catch (e) {
      console.error("Failed to save:", e);
      alert("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Настройки учителей</h2>

      <div className="bg-card border border-border rounded-lg p-6">
        <label className="block text-sm font-medium text-foreground mb-2">
          Максимальная нагрузка учителя (часов в неделю)
        </label>
        <input
          type="number"
          value={maxLoad}
          onChange={(e) => setMaxLoad(parseInt(e.target.value) || 40)}
          className="w-full max-w-xs bg-background border border-border rounded px-4 py-2"
        />
        <p className="text-xs text-muted-foreground mt-2">
          Рекомендуемое значение: 35-40 часов в неделю согласно СанПиН
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить изменения
        </button>
      </div>
    </div>
  );
}

function RoomSettings() {
  const [roomTypes, setRoomTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadRoomTypes();
  }, []);

  async function loadRoomTypes() {
    try {
      const res = await fetch(`${API_BASE}/api/room-types`);
      const data = await res.json();
      setRoomTypes(data);
    } catch (e) {
      console.error("Failed to load room types:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      for (const item of roomTypes) {
        if (item.id) {
          await fetch(`${API_BASE}/api/room-types/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          });
        } else {
          await fetch(`${API_BASE}/api/room-types`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          });
        }
      }
      await loadRoomTypes();
      alert("Сохранено!");
    } catch (e) {
      console.error("Failed to save:", e);
      alert("Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  function handleAdd() {
    setRoomTypes([...roomTypes, { type_code: "", name: "", capacity: 30 }]);
  }

  function handleUpdate(idx: number, field: string, value: any) {
    const updated = [...roomTypes];
    updated[idx] = { ...updated[idx], [field]: value };
    setRoomTypes(updated);
  }

  function handleDelete(idx: number) {
    const item = roomTypes[idx];
    if (item.id) {
      fetch(`${API_BASE}/api/room-types/${item.id}`, { method: "DELETE" });
    }
    setRoomTypes(roomTypes.filter((_, i) => i !== idx));
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Типы кабинетов</h2>
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium"
        >
          <Plus className="h-4 w-4" />
          Добавить тип
        </button>
      </div>

      <div className="space-y-3">
        {roomTypes.map((room, idx) => (
          <div key={idx} className="bg-card border border-border rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Тип</label>
                <input
                  type="text"
                  value={room.type_code}
                  onChange={(e) => handleUpdate(idx, "type_code", e.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Название</label>
                <input
                  type="text"
                  value={room.name}
                  onChange={(e) => handleUpdate(idx, "name", e.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Вместимость</label>
                <input
                  type="number"
                  value={room.capacity}
                  onChange={(e) => handleUpdate(idx, "capacity", parseInt(e.target.value) || 30)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить изменения
        </button>
      </div>
    </div>
  );
}
