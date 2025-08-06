import { ObjectId } from "mongodb";

export interface Service {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  serviceDescription: string;
  address: string;
  coordinates?: {lat: number, lng: number} | null;
  filePath: string;
  url?: string; // Service URL - optional
  price?: number; // Price in cents (e.g., 1000 = $10.00)
  onSale?: boolean; // Whether the service is on sale, defaults to false
  vectorId?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceDocument extends Omit<Service, 'id'> {
  _id?: ObjectId;
}

export interface CreateServiceRequest {
  serviceDescription: string;
  address: string;
  filePath: string;
  url?: string; // Service URL - optional
}

export interface CreateServiceResponse {
  success: boolean;
  message: string;
  service: Service;
}

export interface GetServicesResponse {
  success: boolean;
  services: Service[];
  pagination: {
    total: number;
    skip: number;
    limit: number;
    hasMore: boolean;
  };
}