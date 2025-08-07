import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { createOrGetUser, updateUserProfile, getUserProfile } from '@/lib/user-db';
import { UpdateUserProfileRequest } from '@/types/user';

/**
 * GET /api/user/profile - Get user profile
 */
export async function GET(req: NextRequest) {
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

    // Create or get user profile (ensures user exists)
    const user = await createOrGetUser(userId, userName, userEmail);

    return NextResponse.json({
      success: true,
      user: {
        userId: user.userId,
        userName: user.userName,
        userEmail: user.userEmail,
        profile: user.profile,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Error in GET /api/user/profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/profile - Update user profile
 */
export async function PUT(req: NextRequest) {
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
    const body: UpdateUserProfileRequest = await req.json();
    
    if (!Array.isArray(body.profile)) {
      return NextResponse.json(
        { error: 'Profile must be an array of strings' },
        { status: 400 }
      );
    }

    // Validate that all items in the array are strings
    if (!body.profile.every(item => typeof item === 'string')) {
      return NextResponse.json(
        { error: 'All profile items must be strings' },
        { status: 400 }
      );
    }

    // Ensure user exists first
    await createOrGetUser(userId, userName, userEmail);

    // Update profile
    const updatedUser = await updateUserProfile(userId, body.profile);

    if (!updatedUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        userId: updatedUser.userId,
        userName: updatedUser.userName,
        userEmail: updatedUser.userEmail,
        profile: updatedUser.profile,
        updatedAt: updatedUser.updatedAt
      }
    });

  } catch (error) {
    console.error('❌ Error in PUT /api/user/profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}