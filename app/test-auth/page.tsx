"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TestAuth() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Redirect to main sign-in page if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!session) {
    return null; // Will redirect to sign-in
  }

  return (
    <div className="container mx-auto p-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Authentication Debug Page</CardTitle>
          <CardDescription>
            Debug information for authenticated users
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold">Status:</h3>
            <p className="text-sm bg-gray-100 p-2 rounded">{status}</p>
          </div>
          
          <div>
            <h3 className="font-semibold">Session:</h3>
            <pre className="text-sm bg-gray-100 p-2 rounded overflow-auto">
              {JSON.stringify(session, null, 2)}
            </pre>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => signOut({ callbackUrl: "/auth/signin" })}>Sign Out</Button>
            <Button onClick={() => router.push("/")} variant="outline">Go to App</Button>
          </div>

          <div>
            <h3 className="font-semibold">Note:</h3>
            <p className="text-sm text-gray-600">
              This is a debug page. For sign-in, use <code className="bg-gray-200 px-1 rounded">/auth/signin</code>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 