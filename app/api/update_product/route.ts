import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { ProductDocument } from "@/types/product";

export async function POST(req: NextRequest) {
  try {
    // Get the session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { productId, onSale, price, url } = await req.json();

    if (!productId) {
      return NextResponse.json({ error: "Product ID is required" }, { status: 400 });
    }

    // Validate price if provided
    if (price !== undefined && (typeof price !== "number" || price < 0)) {
      return NextResponse.json({ error: "Price must be a non-negative number" }, { status: 400 });
    }

    // Validate onSale if provided
    if (onSale !== undefined && typeof onSale !== "boolean") {
      return NextResponse.json({ error: "onSale must be a boolean" }, { status: 400 });
    }

    // Validate URL if provided
    if (url !== undefined && (typeof url !== "string" || !url.trim())) {
      return NextResponse.json({ error: "URL must be a non-empty string" }, { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const collection = db.collection<ProductDocument>("products");

    // Check if product exists and user owns it
    const existingProduct = await collection.findOne({
      _id: new ObjectId(productId),
      userId: session.user.id
    });

    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found or you don't have permission to edit it" }, { status: 404 });
    }

    // Build update object
    const updateData: any = {
      updatedAt: new Date()
    };

    if (onSale !== undefined) {
      updateData.onSale = onSale;
    }

    if (price !== undefined) {
      updateData.price = Math.round(price * 100); // Convert to cents
    }

    if (url !== undefined) {
      updateData.url = url.trim() || undefined; // Remove whitespace, set to undefined if empty
    }

    // Update the product
    const result = await collection.updateOne(
      { _id: new ObjectId(productId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Get the updated product
    const updatedProduct = await collection.findOne({ _id: new ObjectId(productId) });

    return NextResponse.json({
      success: true,
      message: "Product updated successfully",
      product: {
        ...updatedProduct,
        id: updatedProduct?._id?.toString(),
        _id: undefined
      }
    });

  } catch (error) {
    console.error("Error updating product:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
} 