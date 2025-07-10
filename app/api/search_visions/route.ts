import { getToken } from "next-auth/jwt";
import { searchSimilarVisions } from "@/lib/vector-db";
import clientPromise from "@/lib/mongodb";
import { VisionDocument } from "@/types/vision";
import { ObjectId } from "mongodb";

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    // Check authentication using JWT token
    const token = await getToken({ 
      req: req as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { query, limit = 10 } = await req.json();

    if (!query || typeof query !== 'string') {
      return new Response("Search query is required", { status: 400 });
    }

    // Search for similar visions in vector database
    const vectorResults = await searchSimilarVisions(
      query,
      token.id as string,
      limit
    );

    // Get full vision documents from MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const collection = db.collection<VisionDocument>("visions");

    // Extract vision IDs from vector results
    const visionIds = vectorResults.ids[0]?.map(id => new ObjectId(id)) || [];
    
    if (visionIds.length === 0) {
      return Response.json({
        success: true,
        results: [],
        query,
        totalFound: 0,
      });
    }

    // Get vision documents
    const visions = await collection
      .find({ _id: { $in: visionIds } })
      .toArray();

    // Map results with similarity scores
    const resultsWithScores = visionIds.map((id, index) => {
      const vision = visions.find(v => v._id?.toString() === id.toString());
      const score = vectorResults.distances?.[0]?.[index];
      const document = vectorResults.documents?.[0]?.[index];
      
      if (vision) {
        return {
          vision: {
            id: vision._id?.toString(),
            ...vision,
            _id: undefined,
          },
          similarityScore: score,
          matchedText: document,
        };
      }
      return null;
    }).filter(Boolean);

    return Response.json({
      success: true,
      results: resultsWithScores,
      query,
      totalFound: resultsWithScores.length,
    });

  } catch (error) {
    console.error("Error in search_visions:", error);
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
  }
} 