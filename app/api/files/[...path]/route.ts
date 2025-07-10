import { getToken } from "next-auth/jwt";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import clientPromise from "@/lib/mongodb";
import { VisionDocument } from "@/types/vision";
import { ProductDocument } from "@/types/product";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    // Check authentication
    const token = await getToken({ 
      req: req as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });
    
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Await params in Next.js 15
    const resolvedParams = await params;

    // Construct file path
    const filePath = resolvedParams.path.join("/");
    const fullPath = path.join(process.cwd(), "data", filePath);

    // Security check: ensure the path is within the data directory
    const dataDir = path.join(process.cwd(), "data");
    if (!fullPath.startsWith(dataDir)) {
      return new Response("Forbidden", { status: 403 });
    }

    // Check if file exists
    if (!existsSync(fullPath)) {
      return new Response("File not found", { status: 404 });
    }

    // Enhanced security: check if user has permission to access this file
    const currentUserId = token.id as string;
    
    // Extract the file owner's user ID from the path (format: /data/userId/filename)
    const pathSegments = filePath.split('/');
    const fileOwnerUserId = pathSegments[0];
    
    // If the current user is the file owner, allow access
    if (currentUserId === fileOwnerUserId) {
      // User is accessing their own file - allow
    } else {
      // User is trying to access someone else's file
      // Check if this file is attached to a vision or product that the current user can view
      try {
        const client = await clientPromise;
        const db = client.db("visionverse");
        const visionCollection = db.collection<VisionDocument>("visions");
        const productCollection = db.collection<ProductDocument>("products");
        
        // Construct the file path as stored in the database
        const dbFilePath = `/data/${filePath}`;
        
        // Check if file is attached to any vision
        const visionWithFile = await visionCollection.findOne({
          filePath: dbFilePath
        });
        
        // Check if file is attached to any product
        const productWithFile = await productCollection.findOne({
          filePath: dbFilePath
        });
        
        if (!visionWithFile && !productWithFile) {
          // No vision or product found with this file - deny access
          return new Response("Forbidden", { status: 403 });
        }
        
        // File is attached to a vision or product - allow access
        if (visionWithFile) {
          console.log(`📁 File access granted: User ${currentUserId} accessing file from vision ${visionWithFile._id} owned by ${visionWithFile.userId}`);
        } else if (productWithFile) {
          console.log(`📁 File access granted: User ${currentUserId} accessing file from product ${productWithFile._id} owned by ${productWithFile.userId}`);
        }
        
      } catch (dbError) {
        console.error("Error checking file permissions:", dbError);
        return new Response("Forbidden", { status: 403 });
      }
    }

    // Read and serve the file
    const fileBuffer = await readFile(fullPath);
    
    // Determine content type based on file extension
    const ext = path.extname(fullPath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
    };
    
    const contentType = contentTypeMap[ext] || 'application/octet-stream';

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=31536000', // Cache for 1 year
      },
    });

  } catch (error) {
    console.error("Error serving file:", error);
    return new Response("Internal server error", { status: 500 });
  }
} 