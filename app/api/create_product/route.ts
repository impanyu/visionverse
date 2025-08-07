import { getToken } from "next-auth/jwt";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { ProductDocument, CreateProductRequest, CreateProductResponse, GetProductsResponse } from "@/types/product";

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { storeProductEmbedding, deleteProductEmbedding } from "@/lib/vector-db";

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

    let productDescription: string;
    let filePath: string = "/no-file";
    let url: string;
    let price: number | undefined;

    // Check if this is a form data request (file upload)
    const contentType = req.headers.get("content-type");
    console.log("📝 Content-Type:", contentType);
    
    if (contentType?.includes("multipart/form-data")) {
      // Handle form data request (file upload)
      console.log("🔍 PROCESSING MULTIPART FORM DATA");
      const formData = await req.formData();
      
      // Debug: Log all FormData entries
      console.log("📋 FormData entries:");
      for (const [key, value] of formData.entries()) {
        // Check if value is a file-like object (has file properties)
        if (value && typeof value === 'object' && 'name' in value && 'size' in value) {
          console.log(`  ${key}: File(name="${(value as any).name}", size=${(value as any).size}, type="${(value as any).type || 'unknown'}")`);
        } else {
          console.log(`  ${key}: "${value}"`);
        }
      }
      
      productDescription = formData.get("productDescription") as string;
      const file = formData.get("imageFile");
      const urlStr = formData.get("url") as string;
      const priceStr = formData.get("price") as string;
      
      // Check if file is a file-like object (works in both browser and Node.js)
      const isFileObject = file && typeof file === 'object' && 'name' in file && 'size' in file;
      
      console.log("🔍 File details:", {
        exists: !!file,
        name: isFileObject ? (file as any).name : 'N/A',
        size: isFileObject ? (file as any).size : 0,
        type: isFileObject ? (file as any).type || 'unknown' : 'N/A',
        isFileObject: isFileObject
      });
      
      // URL is optional for product creation
      url = urlStr?.trim() || "";
      
      // Parse price if provided
      if (priceStr && priceStr.trim()) {
        const priceFloat = parseFloat(priceStr.trim());
        if (!isNaN(priceFloat) && priceFloat >= 0) {
          price = Math.round(priceFloat * 100); // Convert to cents
          console.log(`💰 Price parsed: $${priceFloat} -> ${price} cents`);
        }
      }

      if (isFileObject && (file as any).size > 0) {
        // Create user directory
        const userId = token.id as string;
        const userDataDir = path.join(process.cwd(), "data", userId);
        
        // Create directory if it doesn't exist
        if (!existsSync(userDataDir)) {
          await mkdir(userDataDir, { recursive: true });
        }

        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const originalName = (file as any).name;
        const extension = path.extname(originalName);
        const nameWithoutExt = path.basename(originalName, extension);
        const uniqueFileName = `${nameWithoutExt}_${timestamp}${extension}`;
        
        // Save file to disk
        const fileSavePath = path.join(userDataDir, uniqueFileName);
        const bytes = await (file as any).arrayBuffer();
        const buffer = Buffer.from(bytes);
        await writeFile(fileSavePath, buffer);
        
        // Store relative path from project root
        filePath = `/data/${userId}/${uniqueFileName}`;
        console.log("File uploaded successfully:", filePath);
      }
    } else {
      // Handle JSON request (direct creation)
      const jsonData: CreateProductRequest = await req.json();
      productDescription = jsonData.productDescription;
      filePath = jsonData.filePath || "/no-file";
      
      // URL is optional for product creation
      url = jsonData.url?.trim() || "";
      
      // Parse price if provided in JSON
      if ((jsonData as any).price !== undefined) {
        const priceFloat = parseFloat((jsonData as any).price);
        if (!isNaN(priceFloat) && priceFloat >= 0) {
          price = Math.round(priceFloat * 100); // Convert to cents
          console.log(`💰 Price parsed: $${priceFloat} -> ${price} cents`);
        }
      }
    }
    
    console.log("Received productDescription:", JSON.stringify(productDescription));
    console.log("File path:", filePath);
    console.log("URL:", url);

    // Validate required fields
    if (!productDescription || typeof productDescription !== 'string') {
      return new Response("Product description is required and must be a string", { status: 400 });
    }

    // URL is optional but if provided, must be a string
    if (url && typeof url !== 'string') {
      return new Response("URL must be a string if provided", { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const productCollection = db.collection<ProductDocument>("products");

    // Insert product into MongoDB
    const productData: Omit<ProductDocument, '_id'> = {
      userId: token.id as string,
      userName: token.name || "Unknown User",
      userEmail: token.email || "unknown@example.com",
      productDescription: productDescription.trim(),
      filePath: filePath,
      url: url.trim(),
      price: price, // Include price in cents
      onSale: false, // Default to false
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    console.log("About to save productData:", JSON.stringify(productData.productDescription));

    // Insert product into MongoDB
    const result = await productCollection.insertOne(productData);
    const productId = result.insertedId.toString();
    
    console.log("Saved to MongoDB with ID:", productId);

    // Store embedding in vector database
    let vectorId: string | undefined;
    try {
      vectorId = await storeProductEmbedding(
        productId,
        productDescription.trim(),
        token.id as string,
        price // Pass price to embedding storage
      );
      
      // Update the product document with vectorId
      await productCollection.updateOne(
        { _id: result.insertedId },
        { $set: { vectorId: vectorId } }
      );
      
      console.log("Stored embedding with vector ID:", vectorId);
    } catch (error) {
      console.error("Error storing embedding:", error);
      // Continue without vector storage if it fails
    }

    // Vision linking removed - products are now created independently

    // Return the created product
    const response: CreateProductResponse = {
      success: true,
      message: "Product created successfully",
      product: {
        id: productId,
        ...productData,
        vectorId,
      },
    };

    return Response.json(response);

  } catch (error) {
    console.error("Error in create_product:", error);
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
    const collection = db.collection<ProductDocument>("products");

    // Build query - only show current user's products
    const query = { userId: token.id as string };

    // Get products with pagination
    const products = await collection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Convert ObjectId to string for JSON response
    const productsWithStringIds = products.map(product => ({
      ...product,
      id: product._id?.toString() || "",
      _id: undefined,
    }));

    // Get total count for pagination
    const totalCount = await collection.countDocuments(query);

    const response: GetProductsResponse = {
      success: true,
      products: productsWithStringIds,
      pagination: {
        total: totalCount,
        skip,
        limit,
        hasMore: skip + limit < totalCount,
      },
    };

    return Response.json(response);

  } catch (error) {
    console.error("Error in get_products:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    console.log(`🗑️ DELETE_ENDPOINT: Starting DELETE request`);
    
    // Check authentication using JWT token
    const token = await getToken({ 
      req: req as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    if (!token) {
      console.log(`🗑️ DELETE_ENDPOINT: Unauthorized - no token`);
      return new Response("Unauthorized", { status: 401 });
    }

    console.log(`🗑️ DELETE_ENDPOINT: User ID: ${token.id}`);

    const url = new URL(req.url);
    const productId = url.searchParams.get('id');

    console.log(`🗑️ DELETE_ENDPOINT: Product ID to delete: ${productId}`);

    if (!productId) {
      console.log(`🗑️ DELETE_ENDPOINT: No product ID provided`);
      return new Response("Product ID is required", { status: 400 });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(productId)) {
      console.log(`🗑️ DELETE_ENDPOINT: Invalid ObjectId format: ${productId}`);
      return new Response("Invalid product ID format", { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const productCollection = db.collection<ProductDocument>("products");
    const visionCollection = db.collection<VisionDocument>("visions");

    console.log(`🗑️ DELETE_ENDPOINT: Connected to MongoDB`);

    // Find the product first to ensure it exists and belongs to the user
    const product = await productCollection.findOne({ 
      _id: new ObjectId(productId),
      userId: token.id as string // Ensure user can only delete their own products
    });

    console.log(`🗑️ DELETE_ENDPOINT: Product found:`, product ? 'YES' : 'NO');
    if (product) {
      console.log(`🗑️ DELETE_ENDPOINT: Product belongs to user ${product.userId}`);
    }

    if (!product) {
      console.log(`🗑️ DELETE_ENDPOINT: Product not found or no permission`);
      return new Response("Product not found or you don't have permission to delete it", { status: 404 });
    }

    // Check how many products user has before deletion
    const userProductsBefore = await productCollection.countDocuments({ userId: token.id as string });
    console.log(`🗑️ DELETE_ENDPOINT: User has ${userProductsBefore} products before deletion`);

    // Remove this product from the linked vision's linkedProducts dictionary
    if (product.linkedVision) {
      console.log(`🗑️ DELETE_ENDPOINT: Removing product from linked visions:`, Object.keys(product.linkedVision));
      for (const visionId in product.linkedVision) {
        try {
          await visionCollection.updateOne(
            { _id: new ObjectId(visionId) },
            { $unset: { [`linkedProducts.${productId}`]: "" } }
          );
          console.log(`🗑️ DELETE_ENDPOINT: Removed product ${productId} from vision ${visionId}'s linkedProducts`);
        } catch (error) {
          console.error("🗑️ DELETE_ENDPOINT: Error updating vision's linkedProducts:", error);
          // Continue with deletion even if this fails
        }
      }
    }

    // Delete from vector database if vectorId exists
    if (product.vectorId) {
      console.log(`🗑️ DELETE_ENDPOINT: Deleting from vector database: ${product.vectorId}`);
      try {
        await deleteProductEmbedding(product.vectorId);
        console.log("🗑️ DELETE_ENDPOINT: Deleted embedding with vector ID:", product.vectorId);
      } catch (error) {
        console.error("🗑️ DELETE_ENDPOINT: Error deleting embedding:", error);
        // Continue with MongoDB deletion even if vector deletion fails
      }
    }

    // Delete from MongoDB
    console.log(`🗑️ DELETE_ENDPOINT: Deleting from MongoDB`);
    const deleteResult = await productCollection.deleteOne({ 
      _id: new ObjectId(productId),
      userId: token.id as string
    });

    console.log(`🗑️ DELETE_ENDPOINT: Delete result:`, deleteResult);
    console.log(`🗑️ DELETE_ENDPOINT: Deleted count: ${deleteResult.deletedCount}`);

    if (deleteResult.deletedCount === 0) {
      console.log(`🗑️ DELETE_ENDPOINT: Failed to delete product - deletedCount is 0`);
      return new Response("Failed to delete product", { status: 500 });
    }

    // Check how many products user has after deletion
    const userProductsAfter = await productCollection.countDocuments({ userId: token.id as string });
    console.log(`🗑️ DELETE_ENDPOINT: User has ${userProductsAfter} products after deletion`);

    // RECOVERY PHASE: Try to backfill gaps in linked visions' top-3 products
    if (product.linkedVision) {
      console.log(`🔄 RECOVERY_PHASE: Starting recovery for ${Object.keys(product.linkedVision).length} affected visions`);
      
      for (const visionId in product.linkedVision) {
        try {
          console.log(`🔄 RECOVERY_PHASE: Processing vision ${visionId}`);
          
          // Get the current vision document
          const currentVision = await visionCollection.findOne({ _id: new ObjectId(visionId) });
          
          if (!currentVision) {
            console.log(`❌ RECOVERY_PHASE: Vision ${visionId} not found`);
            continue;
          }
          
          const currentLinkedProducts = currentVision.linkedProducts || {};
          const currentProductCount = Object.keys(currentLinkedProducts).length;
          console.log(`📊 RECOVERY_PHASE: Vision ${visionId} currently has ${currentProductCount} linked products`);
          
          // Only try recovery if we have less than 3 products
          if (currentProductCount < 3) {
            console.log(`🔄 RECOVERY_PHASE: Vision ${visionId} needs recovery (${currentProductCount}/3 products)`);
            
            // Search for similar products to this vision
            const candidateProducts = await findSimilarProductsForVision(
              currentVision.visionDescription,
              token.id as string, // userId parameter (not used for filtering)
              10 // Get more candidates
            );
            
            console.log(`🔍 RECOVERY_PHASE: Found ${candidateProducts.ids[0]?.length || 0} candidate products for vision ${visionId}`);
            
            // Process candidate products
            if (candidateProducts.ids[0] && candidateProducts.ids[0].length > 0 && candidateProducts.distances && candidateProducts.distances[0]) {
              const newLinkedProducts = { ...currentLinkedProducts };
              let addedCount = 0;
              
              for (let i = 0; i < candidateProducts.ids[0].length && Object.keys(newLinkedProducts).length < 3; i++) {
                const candidateProductId = candidateProducts.ids[0][i];
                const distance = candidateProducts.distances[0][i];
                const similarityScore = 1 - (distance / 2); // Convert ChromaDB's squared L2 distance to cosine similarity
                
                console.log(`🔍 RECOVERY_PHASE: Evaluating candidate product ${candidateProductId}, similarity: ${similarityScore.toFixed(3)}`);
                
                // Check if this product meets our criteria
                if (similarityScore >= 0.5 && 
                    candidateProductId !== productId && // Not the deleted product
                    !newLinkedProducts.hasOwnProperty(candidateProductId)) { // Not already linked
                  
                  // Verify the product still exists in MongoDB
                  const candidateProductDoc = await productCollection.findOne({ 
                    _id: new ObjectId(candidateProductId) 
                  });
                  
                  if (candidateProductDoc) {
                    console.log(`✅ RECOVERY_PHASE: Adding product ${candidateProductId} to vision ${visionId} (similarity: ${similarityScore.toFixed(3)})`);
                    
                    // Add to vision's linkedProducts
                    newLinkedProducts[candidateProductId] = similarityScore;
                    addedCount++;
                    
                    // Update the product's linkedVision to include this vision
                    try {
                      await productCollection.updateOne(
                        { _id: new ObjectId(candidateProductId) },
                        { $set: { [`linkedVision.${visionId}`]: similarityScore } }
                      );
                      console.log(`🔗 RECOVERY_PHASE: Updated product ${candidateProductId}'s linkedVision to include vision ${visionId}`);
                    } catch (productUpdateError) {
                      console.error(`❌ RECOVERY_PHASE: Error updating product ${candidateProductId}:`, productUpdateError);
                    }
                  } else {
                    console.log(`❌ RECOVERY_PHASE: Candidate product ${candidateProductId} not found in MongoDB`);
                  }
                } else {
                  const reason = similarityScore < 0.5 ? 'similarity below 0.5' : 
                                candidateProductId === productId ? 'is deleted product' : 'already linked';
                  console.log(`❌ RECOVERY_PHASE: Skipping product ${candidateProductId} (${reason})`);
                }
              }
              
              // Update the vision with the recovered products
              if (addedCount > 0) {
                // Sort final products by similarity (highest first) and ensure top 3
                const sortedProducts = Object.entries(newLinkedProducts)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 3);
                
                const finalLinkedProducts: { [productId: string]: number } = {};
                sortedProducts.forEach(([id, score]) => {
                  finalLinkedProducts[id] = score;
                });
                
                await visionCollection.updateOne(
                  { _id: new ObjectId(visionId) },
                  { $set: { linkedProducts: finalLinkedProducts } }
                );
                
                // Initialize clicks for any new products added during recovery
                const updatedVision = await visionCollection.findOne({ _id: new ObjectId(visionId) });
                if (updatedVision) {
                  const currentClicks = updatedVision.clicks || {};
                  let clicksUpdated = false;
                  
                  // Add clicks entry for any product that doesn't have one
                  for (const productId in finalLinkedProducts) {
                    if (!(productId in currentClicks)) {
                      currentClicks[productId] = 0;
                      clicksUpdated = true;
                    }
                  }
                  
                  // Update clicks if new products were added
                  if (clicksUpdated) {
                    await visionCollection.updateOne(
                      { _id: new ObjectId(visionId) },
                      { $set: { clicks: currentClicks } }
                    );
                    console.log(`✅ RECOVERY_PHASE: Updated clicks tracking for vision ${visionId}, products: ${Object.keys(currentClicks)}`);
                  }
                }
                
                console.log(`✅ RECOVERY_PHASE: Vision ${visionId} recovery complete - added ${addedCount} products:`, 
                  Object.keys(finalLinkedProducts).map(id => `${id}: ${finalLinkedProducts[id].toFixed(3)}`));
              } else {
                console.log(`❌ RECOVERY_PHASE: No suitable products found for vision ${visionId} recovery`);
              }
            } else {
              console.log(`❌ RECOVERY_PHASE: No candidate products found for vision ${visionId}`);
            }
          } else {
            console.log(`✅ RECOVERY_PHASE: Vision ${visionId} already has ${currentProductCount} products - no recovery needed`);
          }
        } catch (recoveryError) {
          console.error(`❌ RECOVERY_PHASE: Error during recovery for vision ${visionId}:`, recoveryError);
          // Continue with other visions even if one fails
        }
      }
      
      console.log(`🎉 RECOVERY_PHASE: Recovery phase completed for all affected visions`);
    }

    console.log("🗑️ DELETE_ENDPOINT: Successfully deleted product:", productId);

    return Response.json({
      success: true,
      message: "Product deleted successfully",
      deletedId: productId,
    });

  } catch (error) {
    console.error("🗑️ DELETE_ENDPOINT: Error in delete_product:", error);
    return new Response("Internal server error", { status: 500 });
  }
} 