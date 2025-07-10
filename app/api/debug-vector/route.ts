import { getToken } from "next-auth/jwt";
import { ChromaClient } from "chromadb";

const chroma = new ChromaClient({
  path: "http://localhost:8000",
});

export async function GET(req: Request) {
  try {
    const token = await getToken({ 
      req: req as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    console.log("🔍 DEBUG: Checking vector database contents");
    console.log("👤 User ID:", token.id);
    console.log("🌐 NOTE: Linking now searches across ALL users");

    // Check vision collection
    let visionCollection;
    try {
      visionCollection = await chroma.getCollection({ name: "vision_descriptions" });
      const visionCount = await visionCollection.count();
      console.log("📊 Vision collection count:", visionCount);
      
      if (visionCount > 0) {
        const allVisions = await visionCollection.get({
          include: ["documents", "metadatas"]
        });
        console.log("📋 All visions in vector DB:", {
          ids: allVisions.ids,
          documents: allVisions.documents,
          userIds: allVisions.metadatas?.map((m: any) => m?.userId),
          uniqueUsers: [...new Set(allVisions.metadatas?.map((m: any) => m?.userId))],
          totalCount: allVisions.ids?.length || 0
        });
      }
    } catch (error) {
      console.log("❌ Vision collection error:", error);
    }

    // Check product collection
    let productCollection;
    try {
      productCollection = await chroma.getCollection({ name: "product_descriptions" });
      const productCount = await productCollection.count();
      console.log("📊 Product collection count:", productCount);
      
      if (productCount > 0) {
        const allProducts = await productCollection.get({
          include: ["documents", "metadatas"]
        });
        console.log("📋 All products in vector DB:", {
          ids: allProducts.ids,
          documents: allProducts.documents,
          userIds: allProducts.metadatas?.map((m: any) => m?.userId),
          uniqueUsers: [...new Set(allProducts.metadatas?.map((m: any) => m?.userId))],
          totalCount: allProducts.ids?.length || 0
        });
      }
    } catch (error) {
      console.log("❌ Product collection error:", error);
    }

    return Response.json({
      success: true,
      message: "Debug info logged to console",
      userId: token.id
    });

  } catch (error) {
    console.error("❌ Debug error:", error);
    return new Response("Internal server error", { status: 500 });
  }
} 