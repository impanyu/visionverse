import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { VisionDocument } from "@/types/vision";

export async function GET(req: NextRequest) {
  try {
    // Get the session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const visionId = searchParams.get('visionId');

    if (!visionId) {
      return NextResponse.json({ error: "Vision ID is required" }, { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const collection = db.collection<VisionDocument>("visions");

    // Find the vision
    const vision = await collection.findOne({ _id: new ObjectId(visionId) });

    if (!vision) {
      return NextResponse.json({ error: "Vision not found" }, { status: 404 });
    }

    const userId = session.user.id;
    const supportedBy = vision.supportedBy || [];
    const isSupported = supportedBy.includes(userId);

    return NextResponse.json({
      success: true,
      isSupported,
      supportCount: supportedBy.length
    });

  } catch (error) {
    console.error("Error checking vision support:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // Get the session
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { visionId } = await req.json();

    if (!visionId) {
      return NextResponse.json({ error: "Vision ID is required" }, { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const collection = db.collection<VisionDocument>("visions");

    // Find the vision
    const vision = await collection.findOne({ _id: new ObjectId(visionId) });

    if (!vision) {
      return NextResponse.json({ error: "Vision not found" }, { status: 404 });
    }

    const userId = session.user.id;
    const supportedBy = vision.supportedBy || [];
    const isCurrentlySupported = supportedBy.includes(userId);

    let updatedSupportedBy: string[];
    let action: 'added' | 'removed';

    if (isCurrentlySupported) {
      // Remove support
      updatedSupportedBy = supportedBy.filter(id => id !== userId);
      action = 'removed';
    } else {
      // Add support
      updatedSupportedBy = [...supportedBy, userId];
      action = 'added';
    }

    // Update the vision document
    const updateResult = await collection.updateOne(
      { _id: new ObjectId(visionId) },
      {
        $set: {
          supportedBy: updatedSupportedBy,
          supportCount: updatedSupportedBy.length,
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount === 0) {
      return NextResponse.json({ error: "Failed to update vision" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      action,
      supportCount: updatedSupportedBy.length,
      isSupported: !isCurrentlySupported
    });

  } catch (error) {
    console.error("Error toggling vision support:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
} 