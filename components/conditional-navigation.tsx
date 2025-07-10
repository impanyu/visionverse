"use client";

import { useSession } from "next-auth/react";
import Navigation from "./navigation";

export default function ConditionalNavigation() {
  const { data: session, status } = useSession();

  // Don't show anything during loading to prevent flash
  if (status === "loading") {
    return null;
  }

  // Only show Navigation when not logged in
  // When logged in, the AssistantHeader will handle the navigation
  if (session) {
    return null;
  }

  return <Navigation />;
} 