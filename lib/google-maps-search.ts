// Google Maps Service Search using SearchAPI.io
// Google Maps Documentation: https://www.searchapi.io/docs/google-maps

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Function to calculate distance between two coordinates in miles
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in miles
}

export interface GoogleMapsService {
  position: number;
  ludocid?: string;
  place_id?: string;
  kgmid?: string;
  title: string;
  address?: string;
  gps_coordinates?: {
    latitude: number;
    longitude: number;
  };
  rating?: number;
  reviews?: number;
  reviews_histogram?: {
    "1": number;
    "2": number;
    "3": number;
    "4": number;
    "5": number;
  };
  price?: string;
  open_state?: string;
  open_hours?: {
    [key: string]: string;
  };
  type?: string;
  thumbnail?: string;
  images?: Array<{
    title?: string;
    thumbnail?: string;
  }>;
  phone?: string;
  website?: string;
  description?: string;
  extensions?: Array<{
    title: string;
    items: Array<{
      title: string;
      value: string;
    }>;
  }>;
}

export interface GoogleMapsSearchResponse {
  local_results?: GoogleMapsService[];
  search_metadata?: {
    status: string;
    created_at: string;
    request_time_taken: number;
    total_time_taken: number;
  };
  search_parameters?: {
    engine: string;
    q: string;
    ll?: string;
    google_domain?: string;
    hl?: string;
  };
}

export interface UnifiedService {
  id: string;
  title: string;
  description?: string;
  address?: string;
  price?: string;
  currency?: string;
  rating?: number;
  reviews?: number;
  source: 'google_maps' | 'local';
  phone?: string;
  website?: string;
  gps_coordinates?: {
    latitude: number;
    longitude: number;
  };
  open_state?: string;
  open_hours?: { [key: string]: string };
  type?: string;
  thumbnail?: string;
  availability?: string;
  provider?: string;
  is_recommended?: boolean;
  
  // Original data for reference
  _originalData?: any;
}

export interface ServiceSearchOptions {
  query: string;
  location?: string; // e.g., "Los Angeles, CA" or "@40.7009973,-73.994778,12z"
  maxResults?: number;
  includeGoogleMaps?: boolean;
  includeLocal?: boolean;
  priceMin?: number; // Minimum price in dollars
  priceMax?: number; // Maximum price in dollars
  userLocation?: {lat: number, lng: number} | null; // User's GPS location
  radiusMiles?: number; // Search radius in miles
}

class ServiceSearchService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.SEARCHAPI_KEY || '';
    if (!this.apiKey) {
      console.warn('⚠️ SEARCHAPI_KEY not found in environment variables');
    }
  }

  async searchGoogleMaps(query: string, location?: string, maxResults: number = 10, radiusMiles?: number): Promise<GoogleMapsService[]> {
    try {
      if (!this.apiKey) {
        console.warn('⚠️ Cannot search Google Maps: API key missing');
        return [];
      }

      console.log(`🗺️ Searching Google Maps for: "${query}" ${location ? `in ${location}` : ''}`);

      const params = new URLSearchParams({
        engine: 'google_maps',
        api_key: this.apiKey,
        q: query,
        hl: 'en'
      });

      // Add location if provided
      if (location) {
        if (location.startsWith('@')) {
          // GPS coordinates format - add radius if specified
          let locationParam = location;
          if (radiusMiles && location.includes(',') && !location.includes('m') && !location.includes('z')) {
            // Convert miles to meters (1 mile = 1609.34 meters)
            const radiusMeters = Math.round(radiusMiles * 1609.34);
            locationParam = `${location},${radiusMeters}m`;
            console.log(`🎯 Added ${radiusMiles} mile radius (${radiusMeters}m) to Google Maps search`);
          }
          params.append('ll', locationParam);
        } else {
          // Location name - append to query
          params.set('q', `${query} in ${location}`);
        }
      }

      const url = `https://www.searchapi.io/api/v1/search?${params.toString()}`;
      console.log(`🗺️ Google Maps API URL: ${url.replace(this.apiKey, 'API_KEY_HIDDEN')}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      });

      if (!response.ok) {
        console.error(`❌ Google Maps API error: ${response.status} ${response.statusText}`);
        return [];
      }

      const data: GoogleMapsSearchResponse = await response.json();
      
      if (!data.local_results) {
        console.log('🗺️ No local results found in Google Maps response');
        return [];
      }

      console.log(`🗺️ Found ${data.local_results.length} services from Google Maps`);
      
      // Debug: Log thumbnail data for first few results
      data.local_results.slice(0, 3).forEach((service, index) => {
        console.log(`🔍 Debug service ${index + 1}: "${service.title}"`);
        console.log(`  - thumbnail: ${service.thumbnail || 'none'}`);
        console.log(`  - images array: ${service.images ? service.images.length : 0} items`);
        if (service.images && service.images.length > 0) {
          service.images.slice(0, 2).forEach((img, imgIndex) => {
            console.log(`    - Image ${imgIndex + 1}: title="${img.title}", thumbnail="${img.thumbnail}"`);
          });
        }
      });
      
      // Limit results
      const limitedResults = data.local_results.slice(0, maxResults);
      
      return limitedResults;

    } catch (error) {
      console.error('❌ Error searching Google Maps:', error);
      return [];
    }
  }

  // Select the best thumbnail image from available options
  private selectBestThumbnail(service: GoogleMapsService): string | undefined {
    // Priority order for thumbnail selection:
    // 1. Primary thumbnail if available
    // 2. First "All" or general image from images array
    // 3. Any available image from images array
    // 4. No thumbnail (undefined)
    
    if (service.thumbnail) {
      console.log(`🖼️ Using primary thumbnail for "${service.title}"`);
      return service.thumbnail;
    }
    
    if (service.images && service.images.length > 0) {
      // Look for "All" category first (usually the best general image)
      const allImage = service.images.find(img => 
        img.title?.toLowerCase() === 'all' && img.thumbnail
      );
      if (allImage?.thumbnail) {
        console.log(`🖼️ Using "All" category image for "${service.title}"`);
        return allImage.thumbnail;
      }
      
      // Fall back to first available image
      const firstImage = service.images.find(img => img.thumbnail);
      if (firstImage?.thumbnail) {
        console.log(`🖼️ Using first available image for "${service.title}"`);
        return firstImage.thumbnail;
      }
    }
    
    console.log(`🖼️ No thumbnail found for "${service.title}"`);
    return undefined;
  }

  // Convert Google Maps service to unified format
  convertToUnifiedService(service: GoogleMapsService): UnifiedService {
    return {
      id: service.place_id || service.ludocid || `gm_${service.position}`,
      title: service.title,
      description: service.type || 'Service Provider',
      address: service.address,
      price: service.price,
      currency: 'USD',
      rating: service.rating,
      reviews: service.reviews,
      source: 'google_maps',
      phone: service.phone,
      website: service.website,
      gps_coordinates: service.gps_coordinates,
      open_state: service.open_state,
      open_hours: service.open_hours,
      type: service.type,
      thumbnail: this.selectBestThumbnail(service),
      availability: service.open_state || 'Unknown',
      provider: service.title,
      
      _originalData: service
    };
  }

  // Evaluate service quality based on rating, reviews, and other factors
  evaluateServiceQuality(service: UnifiedService): {
    score: number;
    reasons: string[];
    isRecommended: boolean;
  } {
    const reasons: string[] = [];
    let score = 0;

    // Rating evaluation (0-40 points)
    if (service.rating) {
      if (service.rating >= 4.5) {
        score += 40;
        reasons.push(`Excellent rating: ${service.rating}★`);
      } else if (service.rating >= 4.0) {
        score += 30;
        reasons.push(`Good rating: ${service.rating}★`);
      } else if (service.rating >= 3.5) {
        score += 20;
        reasons.push(`Average rating: ${service.rating}★`);
      } else {
        score += 5;
        reasons.push(`Low rating: ${service.rating}★`);
      }
    } else {
      reasons.push('No rating available');
    }

    // Review count evaluation (0-30 points)
    if (service.reviews) {
      if (service.reviews >= 500) {
        score += 30;
        reasons.push(`Many reviews: ${service.reviews}`);
      } else if (service.reviews >= 100) {
        score += 20;
        reasons.push(`Good number of reviews: ${service.reviews}`);
      } else if (service.reviews >= 50) {
        score += 15;
        reasons.push(`Some reviews: ${service.reviews}`);
      } else if (service.reviews >= 10) {
        score += 10;
        reasons.push(`Few reviews: ${service.reviews}`);
      } else {
        score += 5;
        reasons.push(`Very few reviews: ${service.reviews}`);
      }
    } else {
      reasons.push('No reviews available');
    }

    // Open status evaluation (0-15 points)
    if (service.open_state) {
      if (service.open_state.toLowerCase().includes('open')) {
        score += 15;
        reasons.push('Currently open');
      } else if (service.open_state.toLowerCase().includes('closed')) {
        score += 5;
        reasons.push('Currently closed');
      }
    }

    // Contact information availability (0-15 points)
    let contactScore = 0;
    if (service.phone) {
      contactScore += 8;
      reasons.push('Phone number available');
    }
    if (service.website) {
      contactScore += 7;
      reasons.push('Website available');
    }
    score += contactScore;

    const isRecommended = score >= 50; // Minimum 50/100 for recommendation

    return {
      score,
      reasons,
      isRecommended
    };
  }

  // Search both Google Maps and local services
  async searchAllServices(options: ServiceSearchOptions): Promise<UnifiedService[]> {
    const { 
      query, 
      location, 
      maxResults = 10, 
      includeGoogleMaps = true, 
      includeLocal = true, 
      priceMin, 
      priceMax, 
      userLocation, 
      radiusMiles 
    } = options;
    
    const allServices: UnifiedService[] = [];
    const searchPromises: Promise<UnifiedService[]>[] = [];

    // Search Google Maps
    if (includeGoogleMaps) {
      const googleMapsPromise = this.searchGoogleMaps(query, location, maxResults, radiusMiles).then(results =>
        results.map(service => this.convertToUnifiedService(service))
      );
      searchPromises.push(googleMapsPromise);
    }

    // Wait for all searches to complete
    const searchResults = await Promise.all(searchPromises);
    
    // Combine all results
    for (const results of searchResults) {
      allServices.push(...results);
    }

    console.log(`🔍 Service search complete: Found ${allServices.length} total services (Google Maps: ${includeGoogleMaps ? 'enabled' : 'disabled'})`);

    // Apply filters
    let filteredServices = allServices;

    // Filter out services without valid contact methods (website or phone)
    filteredServices = filteredServices.filter(service => {
      const hasWebsite = service.website && 
                        service.website.trim() !== '' && 
                        service.website !== '#' && 
                        !service.website.includes('undefined') &&
                        !service.website.includes('null');
      
      const hasPhone = service.phone && 
                      service.phone.trim() !== '' && 
                      service.phone !== 'N/A' &&
                      !service.phone.includes('undefined') &&
                      !service.phone.includes('null');
      
      const hasValidContact = hasWebsite || hasPhone;
      
      if (!hasValidContact) {
        console.log(`🔗 Filtered out service without contact info: "${service.title}"`);
      }
      
      return hasValidContact;
    });

    // Note: Distance filtering for Google Maps is now handled by the API with radius parameter
    // Only need manual filtering for services that don't support API-level radius filtering
    if (userLocation && radiusMiles) {
      console.log(`📍 Location filtering: Using API radius parameter for Google Maps services (${radiusMiles} miles)`);
    }

    // Filter by price if specified
    if (priceMin !== undefined || priceMax !== undefined) {
      const beforePriceFilter = filteredServices.length;
      filteredServices = filteredServices.filter(service => {
        if (!service.price) return true; // Include services without price info
        
        // Parse price from string (handle formats like "$50", "$25-50", "$100+")
        const priceStr = service.price.toString().replace(/[^\d.-]/g, ''); // Remove non-numeric chars except dots and dashes
        const priceNum = parseFloat(priceStr.split('-')[0]); // Take first number if range
        
        if (isNaN(priceNum)) return true; // Include if price can't be parsed
        
        // Check price bounds
        if (priceMin !== undefined && priceNum < priceMin) return false;
        if (priceMax !== undefined && priceNum > priceMax) return false;
        
        return true;
      });
      console.log(`💰 Filtered by price ($${priceMin || 'any'} - $${priceMax || 'any'}): ${beforePriceFilter} → ${filteredServices.length} services`);
    }

    // Limit total results
    const limitedServices = filteredServices.slice(0, maxResults);
    
    console.log(`📦 Returning ${limitedServices.length} services (limited from ${filteredServices.length} filtered, ${allServices.length} total for Google Maps)`);

    return limitedServices;
  }
}

// Export singleton instance
export const serviceSearchService = new ServiceSearchService();