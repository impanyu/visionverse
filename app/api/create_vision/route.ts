import { getToken } from "next-auth/jwt";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { VisionDocument, CreateVisionRequest, CreateVisionResponse, GetVisionsResponse } from "@/types/vision";
import { ProductDocument } from "@/types/product";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { storeVisionEmbedding, deleteVisionEmbedding, findSimilarProductsForVision } from "@/lib/vector-db";
import { searchSimilarVisions } from "@/lib/vector-db"; // Added import for searchSimilarVisions

// Removed edge runtime since MongoDB requires Node.js modules
export const maxDuration = 30;

export async function POST(req: Request) {
  console.log("🚀 VISION CREATION STARTED - POST endpoint called");
  try {
    // Check authentication using JWT token
    const token = await getToken({ 
      req: req as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    console.log("🔐 Token check result:", token ? "AUTHENTICATED" : "NOT AUTHENTICATED");
    
    if (!token) {
      console.log("❌ STOPPING - No authentication token");
      return new Response("Unauthorized", { status: 401 });
    }

    console.log("👤 User authenticated:", { id: token.id, name: token.name, email: token.email });

    // Check if request is FormData (file upload) or JSON (direct creation)
    const contentType = req.headers.get("content-type");
    console.log("📝 Content type:", contentType);
    let visionDescription: string;
    let filePath: string = "/no-file";
    let price: number | undefined;

    if (contentType?.includes("multipart/form-data")) {
      // Handle file upload from form
      const formData = await req.formData();
      visionDescription = formData.get("visionDescription") as string;
      const priceString = formData.get("price") as string;
      price = priceString ? parseFloat(priceString) * 100 : undefined; // Convert dollars to cents
      const file = formData.get("imageFile") as File | null;

      if (file && file.size > 0) {
        // Create user directory
        const userId = token.id as string;
        const userDataDir = path.join(process.cwd(), "data", userId);
        
        // Create directory if it doesn't exist
        if (!existsSync(userDataDir)) {
          await mkdir(userDataDir, { recursive: true });
        }

        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const originalName = file.name;
        const extension = path.extname(originalName);
        const nameWithoutExt = path.basename(originalName, extension);
        const uniqueFileName = `${nameWithoutExt}_${timestamp}${extension}`;
        
        // Save file to disk
        const fileSavePath = path.join(userDataDir, uniqueFileName);
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        await writeFile(fileSavePath, buffer);
        
        // Store relative path from project root
        filePath = `/data/${userId}/${uniqueFileName}`;
        console.log("File uploaded successfully:", filePath);
      }
    } else {
      // Handle JSON request (direct creation)
      const jsonData: CreateVisionRequest = await req.json();
      visionDescription = jsonData.visionDescription;
      filePath = jsonData.filePath || "/no-file";
      price = jsonData.price;
    }
    
    console.log("Received visionDescription:", JSON.stringify(visionDescription));
    console.log("File path:", filePath);
    console.log("Price:", price);
    console.log("✅ REQUEST PARSING COMPLETED");

    // Validate required fields
    if (!visionDescription || typeof visionDescription !== 'string') {
      console.log("❌ STOPPING - Invalid vision description");
      return new Response("Vision description is required and must be a string", { status: 400 });
    }

    // Validate price if provided
    if (price !== undefined && (typeof price !== 'number' || price < 0)) {
      console.log("❌ STOPPING - Invalid price");
      return new Response("Price must be a non-negative number", { status: 400 });
    }

    console.log("✅ VALIDATION COMPLETED");

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const collection = db.collection<VisionDocument>("visions");

    console.log("✅ MONGODB CONNECTION ESTABLISHED");

    // DUPLICATION DETECTION: Search for similar visions first
    console.log("🔍 STARTING DUPLICATION DETECTION");
    let duplicateVision = null;
    let similarityScore = 0;
    
    try {
      // Search for similar visions using vector database
      const vectorResults = await searchSimilarVisions(
        visionDescription.trim(),
        token.id as string,
        5 // Get top 5 similar visions
      );

      // Check if we found any similar visions
      if (vectorResults.ids[0] && vectorResults.ids[0].length > 0 && vectorResults.distances && vectorResults.distances[0]) {
        // Get the most similar vision (first result)
        const mostSimilarId = vectorResults.ids[0][0];
        const distance = vectorResults.distances[0][0];
        
        // Convert ChromaDB's squared L2 distance to cosine similarity
        // For normalized embeddings: squared_L2 = 2 * (1 - cosine_similarity)
        // So: cosine_similarity = 1 - (squared_L2 / 2)
        similarityScore = 1 - (distance / 2);
        
        console.log(`Most similar vision found: ${mostSimilarId}, similarity: ${similarityScore.toFixed(3)}`);
        
        // If similarity is > 0.6, consider it a duplicate
        if (similarityScore > 0.6) {
          // Get the full vision document from MongoDB
          const existingVision = await collection.findOne({ 
            _id: new ObjectId(mostSimilarId),
            userId: token.id as string 
          });
          
          if (existingVision) {
            duplicateVision = existingVision;
            console.log(`Duplicate vision detected! Similarity: ${similarityScore.toFixed(3)}`);
          }
        }
      }
    } catch (searchError) {
      console.error("Error during duplication detection:", searchError);
      // Continue with creation if search fails
    }

    // If duplicate found, return it instead of creating new vision
    if (duplicateVision) {
      const { _id, ...visionWithoutId } = duplicateVision;
      
      const response: CreateVisionResponse = {
        success: true,
        message: `Identical vision found (similarity: ${(similarityScore * 100).toFixed(1)}%). Creation prevented to avoid duplicates.`,
        vision: {
          id: _id?.toString() || "",
          ...visionWithoutId,
        },
        isDuplicate: true,
        similarityScore: similarityScore,
        duplicateReason: "A very similar vision already exists in your collection."
      };
      
      return Response.json(response);
    }

    // Check for existing vision with the same description to prevent duplicates
    const existingVision = await collection.findOne({
      userId: token.id as string,
      visionDescription: visionDescription.trim()
    });

    if (existingVision) {
      console.log("Duplicate vision detected, returning existing vision:", existingVision._id);
      
      const { _id, ...visionWithoutId } = existingVision;
      
      const response: CreateVisionResponse = {
        success: true,
        message: "Vision already exists",
        vision: {
          id: _id?.toString() || "",
          ...visionWithoutId,
        },
      };
      
      return Response.json(response);
    }

    // Insert vision into MongoDB first to get the ID
    const visionData: Omit<VisionDocument, '_id'> = {
      userId: token.id as string,
      userName: token.name || "Unknown User",
      userEmail: token.email || "unknown@example.com",
      visionDescription: visionDescription.trim(),
      filePath: filePath,
      price: price,
      onSale: false, // Default to false
      supportedBy: [], // Initialize empty support array
      supportCount: 0, // Initialize support count to 0
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    console.log("About to save visionData:", JSON.stringify(visionData.visionDescription));

    // Insert vision into MongoDB
    const result = await collection.insertOne(visionData);
    const visionId = result.insertedId.toString();
    
    console.log("✅ VISION SAVED TO MONGODB with ID:", visionId);

    // Store embedding in vector database
    let vectorId: string | undefined;
    try {
      console.log("🤖 STORING VISION EMBEDDING");
      vectorId = await storeVisionEmbedding(
        visionId,
        visionDescription.trim(),
        token.id as string
      );
      
      // Update the vision document with vectorId
      await collection.updateOne(
        { _id: result.insertedId },
        { $set: { vectorId: vectorId } }
      );
      
      console.log("✅ STORED EMBEDDING with vector ID:", vectorId);
    } catch (error) {
      console.error("❌ ERROR STORING EMBEDDING:", error);
      // Continue without vector storage if it fails
    }

    // PRODUCT LINKING: Find the top 3 most similar products for this vision
    console.log("🔗 STARTING PRODUCT LINKING PHASE");
    let linkedProducts: { [productId: string]: number } = {};
    let linkedProductsInfo: { id: string; productDescription: string; similarityScore: number }[] = [];
    
    console.log(`🔍 Searching for similar products for vision: "${visionDescription.trim()}"`);
    console.log(`🔍 User ID: ${token.id} (searching across ALL users)`);
    
    // Debug: Check how many products this user has in MongoDB vs all products
    const productCollection = db.collection<ProductDocument>("products");
    const userProductsInMongo = await productCollection.countDocuments({ userId: token.id as string });
    const totalProductsInMongo = await productCollection.countDocuments({});
    console.log(`📊 User has ${userProductsInMongo} products in MongoDB`);
    console.log(`📊 Total products in MongoDB: ${totalProductsInMongo}`);
    
    // Debug: Get a sample of user's products to see what we're working with
    const sampleProducts = await productCollection.find({ userId: token.id as string }).limit(5).toArray();
    console.log(`📋 Sample products for user:`, sampleProducts.map(p => ({ 
      id: p._id?.toString(), 
      description: p.productDescription,
      vectorId: p.vectorId,
      hasVectorId: !!p.vectorId
    })));
    
    try {
      // Pre-check: Verify that products exist in vector database (across all users)
      console.log(`🔍 Pre-check: Verifying products exist in vector database (all users)...`);
      
      // Import the vector database functions we need
      const { ChromaClient } = await import("chromadb");
      const chroma = new ChromaClient({ path: "http://localhost:8000" });
      
      try {
        const productCollection = await chroma.getCollection({ name: "product_descriptions" });
        const allProducts = await productCollection.get({ include: ["metadatas"] });
        const totalProducts = allProducts.metadatas?.length || 0;
        console.log(`🔍 Pre-check: Found ${totalProducts} total products in vector DB`);
        
        if (totalProducts === 0) {
          console.log(`⚠️ No products found in vector DB - skipping product linking`);
          // Skip the search entirely if no products exist
          throw new Error("No products in vector database");
        }
      } catch (preCheckError) {
        console.log(`⚠️ Pre-check failed:`, preCheckError);
        // Continue with the search anyway
      }

      // Search for similar products using vector database with retry logic
      // to handle potential ChromaDB indexing delays
      let vectorResults: Awaited<ReturnType<typeof findSimilarProductsForVision>> | null = null;
      let attempt = 0;
      const maxAttempts = 5; // Increased from 3 to 5
      
      while (attempt < maxAttempts) {
        attempt++;
        console.log(`🔍 Vector search attempt ${attempt}/${maxAttempts}`);
        
        vectorResults = await findSimilarProductsForVision(
          visionDescription.trim(),
          token.id as string,
          5 // Get top 5 similar products
        );

        // If we found results or this is the last attempt, break
        if ((vectorResults.ids[0] && vectorResults.ids[0].length > 0) || attempt === maxAttempts) {
          console.log(`🔍 Attempt ${attempt}: Found ${vectorResults.ids[0]?.length || 0} results`);
          break;
        }
        
        // Wait longer before retrying (only if we have more attempts)
        if (attempt < maxAttempts) {
          const waitTime = attempt * 2000; // Progressive delay: 2s, 4s, 6s, 8s
          console.log(`⏳ No results found, waiting ${waitTime/1000} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      if (!vectorResults) {
        console.log(`❌ No vector results obtained after ${maxAttempts} attempts`);
        console.log(`⚠️ Continuing with vision creation without product linking`);
      } else {
        console.log(`🔍 Final vector search results after ${attempt} attempts:`, {
          foundResults: vectorResults.ids[0]?.length || 0,
          ids: vectorResults.ids[0],
          distances: vectorResults.distances?.[0],
          documents: vectorResults.documents?.[0],
          metadatas: vectorResults.metadatas?.[0]
        });
      }

      // Check if we found any similar products
      if (vectorResults && vectorResults.ids[0] && vectorResults.ids[0].length > 0 && vectorResults.distances && vectorResults.distances[0]) {
        console.log(`✅ Found ${vectorResults.ids[0].length} similar products in vector search`);
        
        // Process all results and filter by similarity threshold
        for (let i = 0; i < vectorResults.ids[0].length && Object.keys(linkedProducts).length < 3; i++) {
          const productId = vectorResults.ids[0][i];
          const distance = vectorResults.distances[0][i];
          
          // Convert ChromaDB's squared L2 distance to cosine similarity
          // For normalized embeddings: squared_L2 = 2 * (1 - cosine_similarity)
          // So: cosine_similarity = 1 - (squared_L2 / 2)
          const similarityScore = 1 - (distance / 2);
          
          console.log(`📦 Product ${productId}: distance: ${distance}, similarity: ${similarityScore.toFixed(3)}`);
          
          // Only link if similarity score is 0.5 or higher
          if (similarityScore >= 0.5) {
            // Get the full product document from MongoDB (across all users)
            const existingProduct = await productCollection.findOne({ 
              _id: new ObjectId(productId)
              // Removed userId filter to allow cross-user linking
            });
            
            console.log(`📄 Product document found in MongoDB:`, existingProduct ? 'YES' : 'NO');
            if (existingProduct) {
              console.log(`📄 Product details:`, {
                id: existingProduct._id?.toString(),
                description: existingProduct.productDescription,
                vectorId: existingProduct.vectorId
              });
            }
            
            if (existingProduct) {
              linkedProducts[productId] = similarityScore;
              linkedProductsInfo.push({
                id: productId,
                productDescription: existingProduct.productDescription,
                similarityScore: similarityScore
              });
              console.log(`🔗 Vision will be linked to product: ${productId} (similarity: ${similarityScore.toFixed(3)})`);
            }
          } else {
            console.log(`❌ Similarity score ${similarityScore.toFixed(3)} is below threshold 0.5 - not linking vision to product ${productId}`);
          }
        }
      } else {
        console.log(`❌ No similar products found for vision in vector search`);
        console.log(`❌ Search query was: "${visionDescription.trim()}" (searched across all users)`);
      }
    } catch (searchError) {
      console.error("❌ Error during product linking:", searchError);
      // Continue with creation if search fails
    }

    // Update the vision document with linked products
    if (Object.keys(linkedProducts).length > 0) {
      try {
        // Initialize clicks dictionary for all linked products
        const clicks: { [productId: string]: number } = {};
        for (const productId in linkedProducts) {
          clicks[productId] = 0; // Initialize with 0 clicks
        }
        
        await collection.updateOne(
          { _id: result.insertedId },
          { $set: { 
            linkedProducts: linkedProducts,
            clicks: clicks
          } }
        );
        console.log(`Added ${Object.keys(linkedProducts).length} linked products to vision ${visionId}`);
        console.log(`Initialized clicks tracking for ${Object.keys(clicks).length} products`);
      } catch (error) {
        console.error("Error updating vision's linkedProducts:", error);
        // Continue even if this fails
      }
    }

    // Update the linked products to include this vision in their linkedVision dictionary
    for (const productId in linkedProducts) {
      try {
        // Get the current product to check its linkedVision state
        const currentProduct = await productCollection.findOne({ _id: new ObjectId(productId) });
        
        // If linkedVision is null or undefined, initialize it as an empty object
        if (!currentProduct?.linkedVision) {
          await productCollection.updateOne(
            { _id: new ObjectId(productId) },
            { $set: { linkedVision: {} } }
          );
        }
        
        // If clicks is null or undefined, initialize it as an empty object
        if (!currentProduct?.clicks) {
          await productCollection.updateOne(
            { _id: new ObjectId(productId) },
            { $set: { clicks: {} } }
          );
        }
        
        // Now safely set the vision link
        await productCollection.updateOne(
          { _id: new ObjectId(productId) },
          { $set: { [`linkedVision.${visionId}`]: linkedProducts[productId] } }
        );
        
        // Initialize click count for this vision if it doesn't exist
        await productCollection.updateOne(
          { _id: new ObjectId(productId) },
          { $set: { [`clicks.${visionId}`]: 0 } }
        );
        
        console.log(`Added vision ${visionId} to product ${productId}'s linkedVision with similarity score ${linkedProducts[productId].toFixed(3)}`);
        console.log(`Initialized click tracking for vision ${visionId} in product ${productId}`);
      } catch (error) {
        console.error("Error updating product's linkedVision:", error);
        // Continue even if this fails
      }
    }

    // Return the created vision
    const response: CreateVisionResponse = {
      success: true,
      message: "Vision created successfully",
      vision: {
        id: visionId,
        ...visionData,
        linkedProducts,
        clicks: Object.keys(linkedProducts).length > 0 ? 
          Object.fromEntries(Object.keys(linkedProducts).map(id => [id, 0])) : 
          undefined,
        vectorId,
      },
      linkedProducts: linkedProductsInfo,
    };

    console.log("🎉 VISION CREATION COMPLETED SUCCESSFULLY");
    console.log(`🎉 Vision ID: ${visionId}`);
    console.log(`🎉 Linked Products: ${Object.keys(linkedProducts).length}`);
    console.log(`🎉 Response:`, { success: response.success, message: response.message });

    return Response.json(response);

  } catch (error) {
    console.error("Error in create_vision:", error);
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
  }
}

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
    const userId = url.searchParams.get('userId');
    const limit = parseInt(url.searchParams.get('limit') || '10');
    const skip = parseInt(url.searchParams.get('skip') || '0');

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const collection = db.collection<VisionDocument>("visions");

    // Build query
    const query = userId ? { userId } : {};

    // Get visions with pagination
    const visions = await collection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Convert ObjectId to string for JSON response
    const visionsWithStringIds = visions.map(vision => ({
      ...vision,
      id: vision._id?.toString() || "",
      _id: undefined,
    }));

    // Get total count for pagination
    const totalCount = await collection.countDocuments(query);

    const response: GetVisionsResponse = {
      success: true,
      visions: visionsWithStringIds,
      pagination: {
        total: totalCount,
        skip,
        limit,
        hasMore: skip + limit < totalCount,
      },
    };

    return Response.json(response);

  } catch (error) {
    console.error("Error in get_visions:", error);
    return new Response("Internal server error", { status: 500 });
  }
} 

export async function DELETE(req: Request) {
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
    const visionId = url.searchParams.get('id');

    if (!visionId) {
      return new Response("Vision ID is required", { status: 400 });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(visionId)) {
      return new Response("Invalid vision ID format", { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const visionCollection = db.collection<VisionDocument>("visions");
    const productCollection = db.collection<ProductDocument>("products");

    // Find the vision first to ensure it exists and belongs to the user
    const vision = await visionCollection.findOne({ 
      _id: new ObjectId(visionId),
      userId: token.id as string // Ensure user can only delete their own visions
    });

    if (!vision) {
      return new Response("Vision not found or you don't have permission to delete it", { status: 404 });
    }

    // Remove this vision from the linked product's linkedVision dictionary
    if (vision.linkedProducts && typeof vision.linkedProducts === 'object') {
      console.log(`🗑️ DELETE_VISION: Removing vision from linked products:`, Object.keys(vision.linkedProducts));
      for (const productId in vision.linkedProducts) {
        try {
          await productCollection.updateOne(
            { _id: new ObjectId(productId) },
            { $unset: { [`linkedVision.${visionId}`]: "" } }
          );
          console.log(`🗑️ DELETE_VISION: Removed vision ${visionId} from product ${productId}'s linkedVision`);
        } catch (error) {
          console.error("🗑️ DELETE_VISION: Error updating product's linkedVision:", error);
          // Continue with deletion even if this fails
        }
      }
    }

    // Delete from vector database if vectorId exists
    if (vision.vectorId) {
      try {
        await deleteVisionEmbedding(vision.vectorId);
        console.log("Deleted embedding with vector ID:", vision.vectorId);
      } catch (error) {
        console.error("Error deleting embedding:", error);
        // Continue with MongoDB deletion even if vector deletion fails
      }
    }

    // Delete from MongoDB
    const deleteResult = await visionCollection.deleteOne({ 
      _id: new ObjectId(visionId),
      userId: token.id as string
    });

    if (deleteResult.deletedCount === 0) {
      return new Response("Failed to delete vision", { status: 500 });
    }

    console.log("Successfully deleted vision:", visionId);

    return Response.json({
      success: true,
      message: "Vision deleted successfully",
      deletedId: visionId
    });

  } catch (error) {
    console.error("Error in delete_vision:", error);
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
  }
} 