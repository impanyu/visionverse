"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TestAuth() {
  const { data: session, status } = useSession();

  return (
    <div className="container mx-auto p-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Authentication Test Page</CardTitle>
          <CardDescription>
            Debug information for authentication setup
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

          <div>
            <h3 className="font-semibold">Environment Check:</h3>
            <ul className="text-sm space-y-1">
              <li>GOOGLE_CLIENT_ID: {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? "✅ Set" : "❌ Not set"}</li>
              <li>NEXTAUTH_URL: {process.env.NEXT_PUBLIC_NEXTAUTH_URL ? "✅ Set" : "❌ Not set"}</li>
            </ul>
          </div>

          <div className="flex gap-2">
            {session ? (
              <Button onClick={() => signOut()}>Sign Out</Button>
            ) : (
              <Button onClick={() => signIn("google")}>Sign In with Google</Button>
            )}
          </div>

          <div>
            <h3 className="font-semibold">Instructions:</h3>
            <ol className="text-sm space-y-1 list-decimal list-inside">
              <li>If you see "❌ Not set" above, you need to set up Google OAuth credentials</li>
              <li>Go to <a href="https://console.cloud.google.com/" target="_blank" className="text-blue-600 underline">Google Cloud Console</a></li>
              <li>Create OAuth 2.0 credentials</li>
              <li>Set redirect URI to: <code className="bg-gray-200 px-1 rounded">http://localhost:3000/api/auth/callback/google</code></li>
              <li>Update your .env file with the real credentials</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 