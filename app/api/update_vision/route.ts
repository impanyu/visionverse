import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { VisionDocument } from "@/types/vision";

export async function POST(req: NextRequest) {
  try {
    // Get the session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { visionId, onSale, price } = await req.json();

    if (!visionId) {
      return NextResponse.json({ error: "Vision ID is required" }, { status: 400 });
    }

    // Validate price if provided
    if (price !== undefined && (typeof price !== 'number' || price < 0)) {
      return NextResponse.json({ error: "Price must be a non-negative number" }, { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const collection = db.collection<VisionDocument>("visions");

    // Find the vision and check ownership
    const vision = await collection.findOne({ 
      _id: new ObjectId(visionId),
      userId: session.user.id // Ensure user can only update their own visions
    });

    if (!vision) {
      return NextResponse.json({ error: "Vision not found or you don't have permission to update it" }, { status: 404 });
    }

    // Prepare update data
    const updateData: Partial<VisionDocument> = {
      updatedAt: new Date()
    };

    if (onSale !== undefined) {
      updateData.onSale = onSale;
    }

    if (price !== undefined) {
      updateData.price = price;
    }

    // Update the vision document
    const updateResult = await collection.updateOne(
      { _id: new ObjectId(visionId) },
      { $set: updateData }
    );

    if (updateResult.modifiedCount === 0) {
      return NextResponse.json({ error: "Failed to update vision" }, { status: 500 });
    }

    // Get the updated vision
    const updatedVision = await collection.findOne({ _id: new ObjectId(visionId) });

    return NextResponse.json({
      success: true,
      message: "Vision updated successfully",
      vision: {
        id: updatedVision?._id?.toString(),
        ...updatedVision,
        _id: undefined,
      }
    });

  } catch (error) {
    console.error("Error updating vision:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
} 