import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { storeVisionEmbedding, searchSimilarVisions, getEmbeddingStats, debugAllEmbeddings } from "@/lib/vector-db";

export async function POST(request: NextRequest) {
  try {
    // Check authentication using JWT token
    const token = await getToken({ 
      req: request as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'store':
        const { visionId, description, userId } = body;
        // Ensure user can only store embeddings for their own data
        if (userId !== token.id) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const result = await storeVisionEmbedding(visionId, description, userId);
        return NextResponse.json({ 
          success: true, 
          vectorId: result,
          message: 'Embedding stored successfully'
        });

      case 'search':
        const { query, userId: searchUserId, limit = 5 } = body;
        // Ensure user can only search their own data
        if (searchUserId !== token.id) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const searchResults = await searchSimilarVisions(query, searchUserId, limit);
        return NextResponse.json({ 
          success: true, 
          query,
          results: searchResults,
          totalFound: searchResults.ids[0]?.length || 0
        });

      case 'stats':
        const stats = await getEmbeddingStats();
        return NextResponse.json({ 
          success: true, 
          stats 
        });

      case 'debug':
        const debugData = await debugAllEmbeddings();
        return NextResponse.json({ 
          success: true, 
          debugData 
        });

      default:
        return NextResponse.json({ 
          success: false, 
          error: 'Invalid action' 
        }, { status: 400 });
    }
  } catch (error) {
    console.error('❌ Test vector API error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 