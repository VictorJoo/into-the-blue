import { NextRequest, NextResponse } from "next/server";
import { importBookmarks, ImportError } from "@/server/importBookmarks";

export const dynamic = "force-dynamic";

async function hasValidSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const authorization = request.headers.get("authorization");
  if (!supabaseUrl || !publishableKey || !authorization?.startsWith("Bearer ")) return false;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!(await hasValidSession(request))) {
    return NextResponse.json({ error: "로그인 정보가 만료되었습니다. 다시 로그인해주세요." }, { status: 401 });
  }

  const target = request.nextUrl.searchParams.get("url")?.trim();
  if (!target) {
    return NextResponse.json({ error: "공유 링크를 입력해주세요." }, { status: 400 });
  }
  if (target.length > 2_048) {
    return NextResponse.json({ error: "공유 링크가 너무 깁니다." }, { status: 400 });
  }

  try {
    return NextResponse.json(await importBookmarks(target));
  } catch (cause) {
    const status = cause instanceof ImportError ? cause.status : 502;
    const message = cause instanceof Error ? cause.message : "즐겨찾기를 가져오지 못했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}
