"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createVision, getVisions } from "@/lib/api/visions";
import { Vision } from "@/types/vision";

export default function TestVisionAPI() {
  const { data: session, status } = useSession();
  const [visionDescription, setVisionDescription] = useState("");
  const [filePath, setFilePath] = useState("");
  const [price, setPrice] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [visions, setVisions] = useState<Vision[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleCreateVision = async () => {
    if (!visionDescription.trim() || !filePath.trim()) {
      setError("Please fill in both vision description and file path");
      return;
    }

    setIsCreating(true);
    setError(null);
    
    try {
      const priceInCents = price ? Math.round(parseFloat(price) * 100) : undefined;
      const response = await createVision({
        visionDescription: visionDescription.trim(),
        filePath: filePath.trim(),
        price: priceInCents,
      });
      
      setResult(response);
      setVisionDescription("");
      setFilePath("");
      setPrice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsCreating(false);
    }
  };

  const handleGetVisions = async () => {
    setIsFetching(true);
    setError(null);
    
    try {
      const response = await getVisions({ limit: 10, skip: 0 });
      setVisions(response.visions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsFetching(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-[400px]">
          <CardHeader className="text-center">
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>
              Please sign in to test the Vision API
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => window.location.href = "/auth/signin"}>
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Vision API Test Page</h1>
      
      <div className="grid gap-6 md:grid-cols-2">
        {/* Create Vision Form */}
        <Card>
          <CardHeader>
            <CardTitle>Create Vision</CardTitle>
            <CardDescription>
              Test the POST /api/create_vision endpoint
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="visionDescription" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Vision Description
              </label>
              <Textarea
                id="visionDescription"
                placeholder="Describe your vision..."
                value={visionDescription}
                onChange={(e) => setVisionDescription(e.target.value)}
                rows={3}
                className="mt-1"
              />
            </div>
            
            <div>
              <label htmlFor="filePath" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                File Path
              </label>
              <Input
                id="filePath"
                placeholder="/path/to/your/file.jpg"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                className="mt-1"
              />
            </div>
            
            <div>
              <label htmlFor="price" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Price
              </label>
              <Input
                id="price"
                placeholder="Enter price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="mt-1"
              />
            </div>
            
            <Button 
              onClick={handleCreateVision} 
              disabled={isCreating}
              className="w-full"
            >
              {isCreating ? "Creating..." : "Create Vision"}
            </Button>
          </CardContent>
        </Card>

        {/* Get Visions */}
        <Card>
          <CardHeader>
            <CardTitle>Get Visions</CardTitle>
            <CardDescription>
              Test the GET /api/create_vision endpoint
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={handleGetVisions} 
              disabled={isFetching}
              className="w-full"
            >
              {isFetching ? "Fetching..." : "Get My Visions"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Error Display */}
      {error && (
        <Card className="mt-6 border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-600">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-700">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Create Vision Result */}
      {result && (
        <Card className="mt-6 border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-600">Vision Created Successfully</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-white p-4 rounded border overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Visions List */}
      {visions.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Your Visions</CardTitle>
            <CardDescription>
              {visions.length} vision(s) found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {visions.map((vision) => (
                <div key={vision.id} className="p-4 border rounded-lg">
                  <h3 className="font-semibold mb-2">Vision #{vision.id.slice(-8)}</h3>
                  <p className="text-sm text-gray-600 mb-2">
                    <strong>Description:</strong> {vision.visionDescription}
                  </p>
                  <p className="text-sm text-gray-600 mb-2">
                    <strong>File Path:</strong> {vision.filePath}
                  </p>
                  {vision.onSale && vision.price && (
                    <p>
                      <strong>Price:</strong> ${(vision.price / 100).toFixed(2)}
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    Created: {new Date(vision.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Usage Instructions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Usage Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>1. Fill in the vision description and file path</p>
          <p>2. Click "Create Vision" to test the POST endpoint</p>
          <p>3. Click "Get My Visions" to test the GET endpoint</p>
          <p>4. Check the results below to see the API responses</p>
          <p className="text-sm text-gray-600 mt-4">
            <strong>Note:</strong> You need to have MongoDB running and properly configured 
            with the MONGODB_URI environment variable for this to work.
          </p>
        </CardContent>
      </Card>
    </div>
  );
} 