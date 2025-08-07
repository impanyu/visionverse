import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function GET(req: NextRequest) {
  try {
    // Check authentication
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔧 DEBUG: Testing database connections...');

    const results: any = {
      timestamp: new Date().toISOString(),
      userId: token.id,
      tests: {}
    };

    // Test 1: Import user-db functions
    try {
      const { createOrGetUser, getUserProfile, addQueryToProfile } = await import('@/lib/user-db');
      results.tests.importUserDb = { status: 'success', message: 'Successfully imported user-db functions' };
    } catch (error) {
      results.tests.importUserDb = { status: 'error', message: `Failed to import user-db: ${error}` };
      return NextResponse.json(results, { status: 200 });
    }

    // Test 2: Test MongoDB connection and users collection
    try {
      const { createOrGetUser } = await import('@/lib/user-db');
      const userId = token.id as string;
      const userName = token.name as string || 'Test User';
      const userEmail = token.email as string || 'test@example.com';
      
      console.log('🔧 DEBUG: Testing createOrGetUser...');
      const user = await createOrGetUser(userId, userName, userEmail);
      results.tests.createOrGetUser = { 
        status: 'success', 
        message: `User created/retrieved successfully`,
        data: {
          userId: user.userId,
          profileLength: user.profile?.length || 0,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      };
    } catch (error) {
      results.tests.createOrGetUser = { status: 'error', message: `createOrGetUser failed: ${error}` };
      return NextResponse.json(results, { status: 200 });
    }

    // Test 3: Test profile operations
    try {
      const { addQueryToProfile } = await import('@/lib/user-db');
      const userId = token.id as string;
      
      console.log('🔧 DEBUG: Testing addQueryToProfile...');
      const testQuery = `Database test query - ${new Date().toISOString()}`;
      const updatedUser = await addQueryToProfile(userId, testQuery);
      
      if (updatedUser) {
        results.tests.addQueryToProfile = { 
          status: 'success', 
          message: `Query added successfully`,
          data: {
            profileLength: updatedUser.profile?.length || 0,
            lastQuery: updatedUser.profile?.[updatedUser.profile.length - 1] || 'none'
          }
        };
      } else {
        results.tests.addQueryToProfile = { status: 'error', message: 'addQueryToProfile returned null' };
      }
    } catch (error) {
      results.tests.addQueryToProfile = { status: 'error', message: `addQueryToProfile failed: ${error}` };
    }

    // Test 4: Test profile retrieval
    try {
      const { getUserProfile } = await import('@/lib/user-db');
      const userId = token.id as string;
      
      console.log('🔧 DEBUG: Testing getUserProfile...');
      const userProfile = await getUserProfile(userId);
      
      if (userProfile) {
        results.tests.getUserProfile = { 
          status: 'success', 
          message: `Profile retrieved successfully`,
          data: {
            profileLength: userProfile.profile?.length || 0,
            profileItems: userProfile.profile?.slice(-3) || [] // Last 3 items
          }
        };
      } else {
        results.tests.getUserProfile = { status: 'error', message: 'getUserProfile returned null' };
      }
    } catch (error) {
      results.tests.getUserProfile = { status: 'error', message: `getUserProfile failed: ${error}` };
    }

    // Overall status
    const allPassed = Object.values(results.tests).every((test: any) => test.status === 'success');
    results.overallStatus = allPassed ? 'success' : 'failure';
    results.message = allPassed ? 'All database tests passed!' : 'Some database tests failed - check individual test results';

    console.log('🔧 DEBUG: Database test results:', results);

    return NextResponse.json(results, { status: 200 });

  } catch (error) {
    console.error('❌ CRITICAL: Database debug endpoint error:', error);
    return NextResponse.json({ 
      error: 'Database debug failed', 
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}