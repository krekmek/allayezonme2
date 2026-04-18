import { NextResponse } from "next/server";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/api/telegram-messages`, {
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Backend API returned ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data || []);
  } catch (error: any) {
    console.error("Error fetching NLP feed:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch NLP feed" },
      { status: 500 }
    );
  }
}
