export interface User {
  _id?: string;
  userId: string; // NextAuth user ID
  userName: string;
  userEmail: string;
  profile: string[]; // Array of profile strings
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDocument extends User {
  _id: string;
}

export interface CreateUserRequest {
  profile: string[];
}

export interface UpdateUserProfileRequest {
  profile: string[];
}