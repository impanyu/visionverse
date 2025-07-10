"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Vision {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  visionDescription: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export default function DebugVisions() {
  const { data: session, status } = useSession();
  const [visions, setVisions] = useState<Vision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVisions = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch("/api/create_vision");
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setVisions(data.visions || []);
      } else {
        setError("Failed to fetch visions");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchVisions();
    }
  }, [session]);

  if (status === "loading") {
    return <div className="p-8">Loading...</div>;
  }

  if (!session) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>Please sign in to view visions</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.href = "/auth/signin"}>
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Debug: Stored Visions</h1>
        <p className="text-gray-600">
          This page shows all visions stored in MongoDB for debugging purposes.
        </p>
        <Button onClick={fetchVisions} className="mt-4">
          Refresh Visions
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 p-4">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
          <span>Loading visions...</span>
        </div>
      )}

      {error && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-red-600">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            Total visions found: {visions.length}
          </div>
          
          {visions.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No Visions Found</CardTitle>
                <CardDescription>
                  No visions have been created yet. Try creating a vision through the main chat interface.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            visions.map((vision) => (
              <Card key={vision.id}>
                <CardHeader>
                  <CardTitle className="text-lg">{vision.visionDescription}</CardTitle>
                  <CardDescription>
                    Created by {vision.userName} ({vision.userEmail})
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <strong>ID:</strong> {vision.id}
                    </div>
                    <div>
                      <strong>File Path:</strong> {vision.filePath}
                    </div>
                    <div>
                      <strong>Created:</strong> {new Date(vision.createdAt).toLocaleString()}
                    </div>
                    <div>
                      <strong>Updated:</strong> {new Date(vision.updatedAt).toLocaleString()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
} 