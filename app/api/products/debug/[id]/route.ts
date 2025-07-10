import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Await params in Next.js 15
    const resolvedParams = await params;
    const productId = resolvedParams.id;

    // Validate product ID format
    if (!ObjectId.isValid(productId)) {
      return NextResponse.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db('visionverse');
    const collection = db.collection('products');

    // Find the product (allow viewing products from any user)
    const product = await collection.findOne({ 
      _id: new ObjectId(productId)
    });

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Return the product data
    return NextResponse.json({ 
      success: true, 
      product: {
        id: product._id.toString(),
        userId: product.userId,
        userName: product.userName,
        userEmail: product.userEmail,
        productName: product.productName,
        productDescription: product.productDescription,
        url: product.url,
        price: product.price,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        filePath: product.filePath || '/no-file'
      }
    });

  } catch (error) {
    console.error('Error fetching product:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
} 