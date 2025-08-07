import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { removeProfileItem } from '@/lib/user-db';

/**
 * POST /api/user/profile/remove - Remove a single item from user's profile array
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

    const userId = token.id as string;

    // Parse request body
    const body = await req.json();
    
    if (typeof body.profileItem !== 'string') {
      return NextResponse.json(
        { error: 'profileItem must be a string' },
        { status: 400 }
      );
    }

    // Remove profile item
    const updatedUser = await removeProfileItem(userId, body.profileItem);

    if (!updatedUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Profile item removed successfully',
      user: {
        userId: updatedUser.userId,
        userName: updatedUser.userName,
        userEmail: updatedUser.userEmail,
        profile: updatedUser.profile,
        updatedAt: updatedUser.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Error in POST /api/user/profile/remove:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}