import { NextRequest, NextResponse } from "next/server";
import { storeVisionEmbedding, searchSimilarVisions, getEmbeddingStats, debugAllEmbeddings } from "@/lib/vector-db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'store':
        const { visionId, description, userId } = body;
        const result = await storeVisionEmbedding(visionId, description, userId);
        return NextResponse.json({ 
          success: true, 
          vectorId: result,
          message: 'Embedding stored successfully'
        });

      case 'search':
        const { query, userId: searchUserId, limit = 5 } = body;
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