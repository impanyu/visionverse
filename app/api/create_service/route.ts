import { getToken } from "next-auth/jwt";
import clientPromise from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { ServiceDocument, CreateServiceRequest, CreateServiceResponse, GetServicesResponse } from "@/types/service";

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { storeServiceEmbedding, deleteServiceEmbedding } from "@/lib/vector-db";

// Function to geocode address using Google Geocoding API
async function geocodeAddress(address: string): Promise<{lat: number, lng: number} | null> {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ Google Maps API key not found');
      return null;
    }

    const encodedAddress = encodeURIComponent(address);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;
    
    console.log(`🗺️ Geocoding address: "${address}"`);
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      console.log(`✅ Geocoding successful:`, location);
      return {
        lat: location.lat,
        lng: location.lng
      };
    } else {
      console.warn(`⚠️ Geocoding failed: ${data.status}`);
      return null;
    }
  } catch (error) {
    console.error('❌ Geocoding error:', error);
    return null;
  }
}

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

    let serviceDescription: string;
    let address: string;
    let coordinates: {lat: number, lng: number} | null = null;
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
      
      serviceDescription = formData.get("serviceDescription") as string;
      address = formData.get("address") as string;
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
      
      // URL is optional for service creation
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
      const jsonData: CreateServiceRequest = await req.json();
      serviceDescription = jsonData.serviceDescription;
      filePath = jsonData.filePath || "/no-file";
      
      // URL is optional for service creation
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
    
    console.log("Received serviceDescription:", JSON.stringify(serviceDescription));
    console.log("File path:", filePath);
    console.log("URL:", url);

    // Validate required fields
    if (!serviceDescription || typeof serviceDescription !== 'string') {
      return new Response("Service description is required and must be a string", { status: 400 });
    }

    if (!address || typeof address !== 'string') {
      return new Response("Address is required and must be a string", { status: 400 });
    }

    // URL is optional but if provided, must be a string
    if (url && typeof url !== 'string') {
      return new Response("URL must be a string if provided", { status: 400 });
    }

    // Geocode the address to get coordinates
    if (address.trim()) {
      coordinates = await geocodeAddress(address.trim());
      if (!coordinates) {
        console.warn(`⚠️ Could not geocode address: ${address}`);
      }
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const serviceCollection = db.collection<ServiceDocument>("services");

    // Insert service into MongoDB
    const serviceData: Omit<ServiceDocument, '_id'> = {
      userId: token.id as string,
      userName: token.name || "Unknown User",
      userEmail: token.email || "unknown@example.com",
      serviceDescription: serviceDescription.trim(),
      address: address.trim(),
      coordinates: coordinates,
      filePath: filePath,
      url: url.trim(),
      price: price, // Include price in cents
      onSale: false, // Default to false
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    console.log("About to save serviceData:", JSON.stringify(serviceData.serviceDescription));

    // Insert service into MongoDB
    const result = await serviceCollection.insertOne(serviceData);
    const serviceId = result.insertedId.toString();
    
    console.log("Saved to MongoDB with ID:", serviceId);

    // Store embedding in vector database
    let vectorId: string | undefined;
    try {
      vectorId = await storeServiceEmbedding(
        serviceId,
        serviceDescription.trim(),
        token.id as string,
        price // Pass price to embedding storage
      );
      
      // Update the service document with vectorId
      await serviceCollection.updateOne(
        { _id: result.insertedId },
        { $set: { vectorId: vectorId } }
      );
      
      console.log("Stored embedding with vector ID:", vectorId);
    } catch (error) {
      console.error("Error storing embedding:", error);
      // Continue without vector storage if it fails
    }

    // Return the created service
    const response: CreateServiceResponse = {
      success: true,
      message: "Service created successfully",
      service: {
        id: serviceId,
        ...serviceData,
        vectorId,
      },
    };

    return Response.json(response);

  } catch (error) {
    console.error("Error in create_service:", error);
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
    const collection = db.collection<ServiceDocument>("services");

    // Build query - only show current user's services
    const query = { userId: token.id as string };

    // Get services with pagination
    const services = await collection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Convert ObjectId to string for JSON response
    const servicesWithStringIds = services.map(service => ({
      ...service,
      id: service._id?.toString() || "",
      _id: undefined,
    }));

    // Get total count for pagination
    const totalCount = await collection.countDocuments(query);

    const response: GetServicesResponse = {
      success: true,
      services: servicesWithStringIds,
      pagination: {
        total: totalCount,
        skip: skip,
        limit: limit,
        hasMore: skip + limit < totalCount,
      },
    };

    return Response.json(response);

  } catch (error) {
    console.error("Error in get_services:", error);
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
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
    const serviceId = url.searchParams.get('id');

    if (!serviceId) {
      return new Response("Service ID is required", { status: 400 });
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(serviceId)) {
      return new Response("Invalid service ID format", { status: 400 });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db("visionverse");
    const collection = db.collection<ServiceDocument>("services");

    // Find the service and verify ownership
    const service = await collection.findOne({ 
      _id: new ObjectId(serviceId),
      userId: token.id as string 
    });

    if (!service) {
      return new Response("Service not found or you don't have permission to delete it", { status: 404 });
    }

    // Delete from vector database first
    try {
      await deleteServiceEmbedding(serviceId);
    } catch (error) {
      console.error("Error deleting service embedding:", error);
      // Continue with deletion even if vector deletion fails
    }

    // Delete from MongoDB
    const result = await collection.deleteOne({ 
      _id: new ObjectId(serviceId),
      userId: token.id as string 
    });

    if (result.deletedCount === 0) {
      return new Response("Service not found or you don't have permission to delete it", { status: 404 });
    }

    return Response.json({
      success: true,
      message: "Service deleted successfully",
    });

  } catch (error) {
    console.error("Error in delete_service:", error);
    return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
  }
}