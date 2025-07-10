import { getToken } from "next-auth/jwt";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { VisionDocument } from "@/types/vision";
import { ProductDocument } from "@/types/product";
import { findSimilarProductsForVision, findSimilarVisionsForProduct } from "@/lib/vector-db";

export async function GET(req: Request) {
  try {
    // Check authentication using JWT token
    const token = await getToken({ 
      req: req as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(req.url);
    const testQuery = url.searchParams.get('testQuery') || "moon rover";

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const visionCollection = db.collection<VisionDocument>("visions");
    const productCollection = db.collection<ProductDocument>("products");

    // Get user's products and visions
    const userProducts = await productCollection.find({ userId: token.id as string }).toArray();
    const userVisions = await visionCollection.find({ userId: token.id as string }).toArray();

    console.log(`🔍 Debug linking for user: ${token.id}`);
    console.log(`📊 User has ${userProducts.length} products and ${userVisions.length} visions`);

    // Test vector search from vision to products
    let visionToProductSearch = null;
    try {
      const vectorResults = await findSimilarProductsForVision(
        testQuery,
        token.id as string,
        5
      );
      visionToProductSearch = {
        foundResults: vectorResults.ids[0]?.length || 0,
        ids: vectorResults.ids[0],
        distances: vectorResults.distances?.[0],
        documents: vectorResults.documents?.[0],
        metadatas: vectorResults.metadatas?.[0]
      };
    } catch (error) {
      visionToProductSearch = { error: error instanceof Error ? error.message : String(error) };
    }

    // Test vector search from product to visions
    let productToVisionSearch = null;
    try {
      const vectorResults = await findSimilarVisionsForProduct(
        testQuery,
        token.id as string,
        5
      );
      productToVisionSearch = {
        foundResults: vectorResults.ids[0]?.length || 0,
        ids: vectorResults.ids[0],
        distances: vectorResults.distances?.[0],
        documents: vectorResults.documents?.[0],
        metadatas: vectorResults.metadatas?.[0]
      };
    } catch (error) {
      productToVisionSearch = { error: error instanceof Error ? error.message : String(error) };
    }

    const debugInfo = {
      userId: token.id,
      testQuery,
      mongoData: {
        products: userProducts.map(p => ({
          id: p._id?.toString(),
          description: p.productDescription,
          vectorId: p.vectorId,
          linkedVision: p.linkedVision,
          hasVectorId: !!p.vectorId
        })),
        visions: userVisions.map(v => ({
          id: v._id?.toString(),
          description: v.visionDescription,
          vectorId: v.vectorId,
          linkedProducts: v.linkedProducts,
          hasVectorId: !!v.vectorId
        }))
      },
      vectorSearches: {
        visionToProducts: visionToProductSearch,
        productToVisions: productToVisionSearch
      }
    };

    return Response.json(debugInfo);

  } catch (error) {
    console.error("Error in debug-linking:", error);
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
  }
} 