import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { createOrGetUser, addProfileItem } from '@/lib/user-db';

/**
 * POST /api/user/profile/add - Add a single item to user's profile array
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
    const userName = token.name as string || 'Unknown User';
    const userEmail = token.email as string || 'unknown@example.com';

    // Parse request body
    const body = await req.json();
    
    if (typeof body.profileItem !== 'string') {
      return NextResponse.json(
        { error: 'profileItem must be a string' },
        { status: 400 }
      );
    }

    if (body.profileItem.trim().length === 0) {
      return NextResponse.json(
        { error: 'profileItem cannot be empty' },
        { status: 400 }
      );
    }

    // Ensure user exists first
    await createOrGetUser(userId, userName, userEmail);

    // Add profile item
    const updatedUser = await addProfileItem(userId, body.profileItem.trim());

    if (!updatedUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Profile item added successfully',
      user: {
        userId: updatedUser.userId,
        userName: updatedUser.userName,
        userEmail: updatedUser.userEmail,
        profile: updatedUser.profile,
        updatedAt: updatedUser.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Error in POST /api/user/profile/add:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}