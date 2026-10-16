"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LocalWorkspace from "../chat/local-workspace";
import { useAuth } from "@/lib/auth-context";
import {
  LOCAL_WORKSPACE_CHAT_DRAFT_KEY,
  LOCAL_WORKSPACE_COMMAND_KEY,
} from "@/lib/local-workspace-client";

export default function ProjectWorkspacePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    const command = sessionStorage.getItem(LOCAL_WORKSPACE_COMMAND_KEY);
    if (command) setPendingCommand(command);
  }, []);

  const handleAttachToChat = useCallback((text: string) => {
    sessionStorage.setItem(LOCAL_WORKSPACE_CHAT_DRAFT_KEY, text);
    router.push("/chat");
  }, [router]);

  const handlePendingCommandHandled = useCallback(() => {
    sessionStorage.removeItem(LOCAL_WORKSPACE_COMMAND_KEY);
    setPendingCommand(null);
  }, []);

  const handleConnectionChange = useCallback(() => {}, []);

  if (loading || !user) {
    return (
      <div className="workspace-page-loading">
        <strong>DEEP REVERSE</strong>
        <span>Opening your project workspace…</span>
      </div>
    );
  }

  return (
    <LocalWorkspace
      open
      standalone
      onClose={() => router.push("/chat")}
      onAttach={handleAttachToChat}
      onConnectionChange={handleConnectionChange}
      pendingCommand={pendingCommand}
      onPendingCommandHandled={handlePendingCommandHandled}
    />
  );
}
