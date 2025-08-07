import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { initializeExistingUsers } from '@/lib/user-db';

/**
 * POST /api/user/initialize - Initialize existing users (admin only)
 * Creates user profiles for all existing users in the system
 */
export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const token = await getToken({ 
      req: req as any, 
      secret: process.env.NEXTAUTH_SECRET 
    });

    if (!token?.id) {
      return NextResponse.json(
        { error: 'Authentication required' }, 
        { status: 401 }
      );
    }

    console.log(`🚀 User initialization requested by: ${token.id}`);

    // Initialize existing users
    await initializeExistingUsers();

    return NextResponse.json({
      success: true,
      message: 'Existing users initialized successfully'
    });

  } catch (error) {
    console.error('❌ Error in POST /api/user/initialize:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}