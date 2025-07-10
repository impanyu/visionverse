import { CreateVisionRequest, CreateVisionResponse, GetVisionsResponse, Vision } from "@/types/vision";

export async function createVision(data: CreateVisionRequest): Promise<CreateVisionResponse> {
  const response = await fetch("/api/create_vision", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create vision: ${errorText}`);
  }

  return response.json();
}

export async function getVisions(options?: {
  userId?: string;
  limit?: number;
  skip?: number;
}): Promise<GetVisionsResponse> {
  const params = new URLSearchParams();
  
  if (options?.userId) params.append("userId", options.userId);
  if (options?.limit) params.append("limit", options.limit.toString());
  if (options?.skip) params.append("skip", options.skip.toString());

  const response = await fetch(`/api/create_vision?${params.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get visions: ${errorText}`);
  }

  return response.json();
}

// Example usage functions
export async function createVisionExample() {
  try {
    const result = await createVision({
      visionDescription: "A mobile app for tracking fitness goals with AI-powered recommendations",
      filePath: "/uploads/fitness-app-mockup.png"
    });
    
    console.log("Vision created successfully:", result);
    return result;
  } catch (error) {
    console.error("Error creating vision:", error);
    throw error;
  }
}

export async function getVisionsExample() {
  try {
    const result = await getVisions({
      limit: 10,
      skip: 0
    });
    
    console.log("Visions retrieved successfully:", result);
    return result;
  } catch (error) {
    console.error("Error getting visions:", error);
    throw error;
  }
}

export interface SearchVisionsResponse {
  success: boolean;
  results: {
    vision: Vision;
    similarityScore?: number;
    matchedText?: string;
  }[];
  query: string;
  totalFound: number;
}

export async function searchSimilarVisions(
  query: string,
  limit: number = 10
): Promise<SearchVisionsResponse> {
  const response = await fetch('/api/search_visions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, limit }),
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }

  return response.json();
} 