import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { Vision } from "@/types/vision";
import { Product } from "@/types/product";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { visionId, productId } = await request.json();

    if (!visionId || !productId) {
      return NextResponse.json(
        { success: false, error: "Vision ID and Product ID are required" },
        { status: 400 }
      );
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(visionId) || !ObjectId.isValid(productId)) {
      return NextResponse.json(
        { success: false, error: "Invalid vision ID or product ID format" },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const db = client.db("visionverse");
    const visionsCollection = db.collection<Vision>('visions');
    const productsCollection = db.collection<Product>('products');

    // Find the vision and update the click count using ObjectId
    const vision = await visionsCollection.findOne({ _id: new ObjectId(visionId) });
    if (!vision) {
      return NextResponse.json(
        { success: false, error: "Vision not found" },
        { status: 404 }
      );
    }

    // Find the product and update the click count using ObjectId
    const product = await productsCollection.findOne({ _id: new ObjectId(productId) });
    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    // Update vision's click count
    const currentVisionClicks = vision.clicks || {};
    const newVisionClickCount = (currentVisionClicks[productId] || 0) + 1;
    currentVisionClicks[productId] = newVisionClickCount;

    // Update product's click count
    const currentProductClicks = product.clicks || {};
    const newProductClickCount = (currentProductClicks[visionId] || 0) + 1;
    currentProductClicks[visionId] = newProductClickCount;

    // Update both vision and product with the new click counts
    await Promise.all([
      visionsCollection.updateOne(
        { _id: new ObjectId(visionId) },
        { 
          $set: { 
            clicks: currentVisionClicks,
            updatedAt: new Date()
          }
        }
      ),
      productsCollection.updateOne(
        { _id: new ObjectId(productId) },
        { 
          $set: { 
            clicks: currentProductClicks,
            updatedAt: new Date()
          }
        }
      )
    ]);

    console.log(`📊 Click tracked: Vision ${visionId} -> Product ${productId}`);
    console.log(`📊 Vision side: ${newVisionClickCount} clicks`);
    console.log(`📊 Product side: ${newProductClickCount} clicks`);

    return NextResponse.json({
      success: true,
      message: "Click tracked successfully",
      visionClickCount: newVisionClickCount,
      productClickCount: newProductClickCount
    });

  } catch (error) {
    console.error('Error tracking click:', error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
} 