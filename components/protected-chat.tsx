"use client";

import { useSession } from "next-auth/react";
import { Thread } from "@/components/assistant-ui/thread";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signIn } from "next-auth/react";

export default function ProtectedChat() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">Authentication Required</CardTitle>
            <CardDescription>
              Please sign in to access the chat interface
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => signIn()} 
              className="w-full"
            >
              Sign in to Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <Thread />;
} 