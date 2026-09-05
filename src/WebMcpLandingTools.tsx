"use client";

import { useEffect } from "react";

type WebMcpContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => Promise<Record<string, string>>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

declare global {
  interface Document {
    readonly modelContext?: WebMcpContext;
  }
}

export default function WebMcpLandingTools() {
  useEffect(() => {
    const inviteToken = new URL(window.location.href).searchParams.get("invite");
    if (inviteToken) {
      window.location.replace(`/login?invite=${encodeURIComponent(inviteToken)}`);
      return;
    }
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(context.registerTool({
      name: "start_trip_planning",
      title: "여행 계획 시작",
      description: "Into the Blue의 로그인 및 여행 계획 화면으로 이동합니다.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 0) {
          throw new Error("이 작업은 입력값을 받지 않습니다.");
        }
        window.location.assign("/planner");
        return { destination: "/planner", status: "navigation_started" };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);

    return () => lifecycle.abort();
  }, []);

  return null;
}
