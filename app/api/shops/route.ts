import { NextRequest, NextResponse } from 'next/server';
import { getToken } from "next-auth/jwt";
import clientPromise from "@/lib/mongodb";
import { ShopDocument, Shop, CreateShopRequest, CreateShopResponse, GetShopsResponse } from "@/types/shop";
import { ObjectId } from "mongodb";

export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const token = await getToken({ 
      req: req as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    if (!token) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const body: CreateShopRequest = await req.json();
    const { platform, name, url } = body;

    // Validate required fields
    if (!platform || !name || !url) {
      return NextResponse.json({ 
        success: false, 
        message: "Platform, name, and URL are required" 
      }, { status: 400 });
    }

    // Sanitize and validate URL
    const sanitizeUrl = (url: string): string => {
      if (!url) return url;
      
      try {
        const urlObj = new URL(url);
        // Remove query parameters and hash
        urlObj.search = '';
        urlObj.hash = '';
        // Get the clean URL and remove trailing slash
        let cleanUrl = urlObj.toString();
        if (cleanUrl.endsWith('/') && cleanUrl.length > urlObj.origin.length + 1) {
          cleanUrl = cleanUrl.slice(0, -1);
        }
        return cleanUrl;
      } catch {
        // If URL parsing fails, fall back to simple string manipulation
        let cleanUrl = url.split('?')[0]; // Remove everything after ?
        cleanUrl = cleanUrl.split('#')[0]; // Remove everything after #
        // Remove trailing slash, but keep it if it's just the domain
        if (cleanUrl.endsWith('/') && cleanUrl.split('/').length > 3) {
          cleanUrl = cleanUrl.slice(0, -1);
        }
        return cleanUrl;
      }
    };

    const sanitizedUrl = sanitizeUrl(url);

    // Validate URL format
    try {
      new URL(sanitizedUrl);
    } catch {
      return NextResponse.json({ 
        success: false, 
        message: "Invalid URL format" 
      }, { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const shopCollection = db.collection<ShopDocument>("shops");

    // Check if shop with same URL already exists for this user
    const existingShop = await shopCollection.findOne({
      userId: token.id as string,
      url: sanitizedUrl
    });

    if (existingShop) {
      return NextResponse.json({ 
        success: false, 
        message: "A shop with this URL already exists" 
      }, { status: 409 });
    }

    // Create shop document
    const shopData: Omit<ShopDocument, '_id'> = {
      userId: token.id as string,
      userName: token.name || "Unknown User",
      userEmail: token.email || "unknown@example.com",
      platform,
      name: name.trim(),
      url: sanitizedUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert shop into MongoDB
    const result = await shopCollection.insertOne(shopData);
    
    // Create response shop object
    const shop: Shop = {
      id: result.insertedId.toString(),
      userId: shopData.userId,
      userName: shopData.userName,
      userEmail: shopData.userEmail,
      platform: shopData.platform,
      name: shopData.name,
      url: shopData.url,
      createdAt: shopData.createdAt,
      updatedAt: shopData.updatedAt,
    };

    const response: CreateShopResponse = {
      success: true,
      message: "Shop created successfully",
      shop
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error("Error creating shop:", error);
    return NextResponse.json({ 
      success: false, 
      message: "Internal server error" 
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    // Check authentication
    const token = await getToken({ 
      req: req as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    if (!token) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const shopCollection = db.collection<ShopDocument>("shops");

    // Get user's shops
    const shops = await shopCollection
      .find({ userId: token.id as string })
      .sort({ createdAt: -1 })
      .toArray();

    // Convert to Shop interface format
    const shopsData: Shop[] = shops.map(shop => ({
      id: shop._id!.toString(),
      userId: shop.userId,
      userName: shop.userName,
      userEmail: shop.userEmail,
      platform: shop.platform,
      name: shop.name,
      url: shop.url,
      createdAt: shop.createdAt,
      updatedAt: shop.updatedAt,
    }));

    const response: GetShopsResponse = {
      success: true,
      shops: shopsData
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error("Error fetching shops:", error);
    return NextResponse.json({ 
      success: false, 
      message: "Internal server error" 
    }, { status: 500 });
  }
} 