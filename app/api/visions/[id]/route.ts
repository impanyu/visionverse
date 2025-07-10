import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check authentication
    const token = await getToken({ 
      req: request as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Await params in Next.js 15
    const resolvedParams = await params;
    const visionId = resolvedParams.id;

    // Validate vision ID format
    if (!ObjectId.isValid(visionId)) {
      return NextResponse.json({ error: 'Invalid vision ID' }, { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db('visionverse');
    const collection = db.collection('visions');

    // Find the vision (allow viewing visions from any user)
    const vision = await collection.findOne({ 
      _id: new ObjectId(visionId)
    });

    if (!vision) {
      return NextResponse.json({ error: 'Vision not found' }, { status: 404 });
    }

    // Return the vision data
    return NextResponse.json({ 
      success: true, 
      vision: {
        id: vision._id.toString(),
        userId: vision.userId,
        userName: vision.userName,
        userEmail: vision.userEmail,
        visionDescription: vision.visionDescription,
        price: vision.price,
        onSale: vision.onSale,
        createdAt: vision.createdAt,
        updatedAt: vision.updatedAt,
        filePath: vision.filePath || '/no-file',
        supportCount: vision.supportCount || 0,
        supportedBy: vision.supportedBy || [],
        linkedProducts: vision.linkedProducts || {}
      }
    });

  } catch (error) {
    console.error('Error fetching vision:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
} 