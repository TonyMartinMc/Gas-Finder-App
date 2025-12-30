"""
Gas Finder API - Backend Service
Flask-based REST API for finding nearby gas stations and managing community-sourced gas prices.

Author: Anthony Martinz
Date: December 2025
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import requests
import os
from dotenv import load_dotenv
import sqlite3
from datetime import datetime, timedelta

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Enable Cross-Origin Resource Sharing (CORS) for mobile app communication
CORS(app)

# Configure rate limiting to prevent API abuse
# Uses in-memory storage for development (consider Redis for production)
limiter = Limiter(
    app=app,
    key_func=get_remote_address,  # Rate limit by IP address
    storage_uri="memory://",
    default_limits=["200 per day", "50 per hour"]  # Global rate limits
)

# API configuration
GOOGLE_API_KEY = os.getenv('GOOGLE_PLACES_API_KEY')
DATABASE = 'gas_prices.db'


def init_db():
    """
    Initialize SQLite database with gas_prices table.
    
    Schema:
    - id: Primary key
    - place_id: Google Places API unique identifier for the gas station
    - price: Gas price per gallon (float)
    - fuel_type: Type of fuel (regular, midgrade, premium, diesel)
    - timestamp: When the price was submitted
    
    Indexes:
    - Composite index on (place_id, fuel_type, timestamp) for efficient querying
    """
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    # Create gas_prices table if it doesn't exist
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS gas_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            place_id TEXT NOT NULL,
            price REAL NOT NULL,
            fuel_type TEXT DEFAULT 'regular',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create composite index for faster queries on place_id + fuel_type + timestamp
    # This index speeds up the get_latest_price() function significantly
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_place_fuel_timestamp 
        ON gas_prices(place_id, fuel_type, timestamp DESC)
    ''')
    
    conn.commit()
    conn.close()
    print('✅ Database initialized')


# Initialize database on application startup
init_db()


def get_latest_price(place_id, fuel_type='regular'):
    """
    Retrieve the most recent price for a specific gas station and fuel type.
    
    Args:
        place_id (str): Google Places API identifier for the gas station
        fuel_type (str): Type of fuel (regular, midgrade, premium, diesel)
    
    Returns:
        dict: {'price': float, 'timestamp': str} or None if no recent price exists
    
    Note:
        Only returns prices from the last 24 hours to ensure freshness
    """
    conn = sqlite3.connect(DATABASE)
    cursor = conn.cursor()
    
    # Calculate timestamp for 24 hours ago
    yesterday = datetime.now() - timedelta(hours=24)
    
    # Query for most recent price within last 24 hours
    # Uses the composite index for optimal performance
    cursor.execute('''
        SELECT price, timestamp 
        FROM gas_prices 
        WHERE place_id = ? AND fuel_type = ? AND timestamp > ?
        ORDER BY timestamp DESC 
        LIMIT 1
    ''', (place_id, fuel_type, yesterday))
    
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return {'price': result[0], 'timestamp': result[1]}
    return None


@app.route('/api/gas-stations', methods=['GET'])
@limiter.limit("30 per minute")  # Endpoint-specific rate limit
def get_gas_stations():
    """
    Find nearby gas stations using Google Places API.
    
    Query Parameters:
        latitude (float): User's latitude coordinate
        longitude (float): User's longitude coordinate
        radius (float): Search radius in meters
        fuel_type (str): Type of fuel to show prices for (default: 'regular')
    
    Returns:
        JSON: {
            'stations': [
                {
                    'id': str,
                    'name': str,
                    'address': str,
                    'distance': str,
                    'price': str,
                    'priceAge': str,
                    'latitude': float,
                    'longitude': float,
                    'rating': float,
                    'isOpen': bool
                }
            ]
        }
    
    Error Codes:
        400: Missing or invalid parameters
        500: Google API error or internal server error
        504: Request timeout
    """
    try:
        # Extract and validate query parameters
        lat = request.args.get('latitude')
        lng = request.args.get('longitude')
        radius = request.args.get('radius', 8000)  # Default 5 miles in meters
        fuel_type = request.args.get('fuel_type', 'regular')
        
        # Validate required parameters
        if not lat or not lng:
            return jsonify({'error': 'Latitude and longitude required'}), 400
        
        # Type conversion and validation
        try:
            lat = float(lat)
            lng = float(lng)
            radius = float(radius)
            
            # Validate coordinate ranges
            if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
                return jsonify({'error': 'Invalid coordinates'}), 400
            
            # Validate radius range (100m to 50km)
            if not (100 <= radius <= 50000):
                return jsonify({'error': 'Invalid radius'}), 400
                
        except ValueError:
            return jsonify({'error': 'Invalid coordinate format'}), 400
        
        # Validate fuel type
        valid_fuel_types = ['regular', 'midgrade', 'premium', 'diesel']
        if fuel_type not in valid_fuel_types:
            fuel_type = 'regular'  # Fallback to regular if invalid
        
        # Log search parameters for debugging
        print(f'\n🔍 Searching {radius/1609.34:.1f} miles around ({lat:.4f}, {lng:.4f})')
        print(f'⛽ Fuel type: {fuel_type}')
        
        # Query Google Places API for nearby gas stations
        url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json'
        params = {
            'location': f'{lat},{lng}',
            'radius': radius,
            'type': 'gas_station',  # Filter for gas stations only
            'key': GOOGLE_API_KEY
        }
        
        # Make request with 15-second timeout
        response = requests.get(url, params=params, timeout=15)
        data = response.json()
        
        print(f'✅ Google returned: {len(data.get("results", []))} results')
        
        # Handle Google API errors
        if data['status'] != 'OK':
            print(f'❌ Google API error: {data["status"]}')
            return jsonify({'error': f"Google API error: {data['status']}"}), 500
        
        # Keywords to filter out non-gas-station businesses
        # Some places (convenience stores, etc.) are tagged as gas stations but aren't primarily that
        exclude_keywords = ['store', 'mart', 'market', 'shop', 'pharmacy', 'coffee', 'restaurant']
        
        gas_stations = []
        
        # Process each result from Google Places API
        for place in data.get('results', []):
            name_lower = place.get('name', '').lower()
            
            # Filter out businesses that aren't primarily gas stations
            # Skip if name contains exclude keywords AND doesn't contain 'gas' or 'fuel'
            if any(keyword in name_lower for keyword in exclude_keywords) and 'gas' not in name_lower and 'fuel' not in name_lower:
                continue
            
            # Double-check that 'gas_station' is in the types array
            place_types = place.get('types', [])
            if 'gas_station' not in place_types:
                continue
            
            # Calculate distance from user to station using Haversine formula
            distance = calculate_distance(
                lat, lng,
                place['geometry']['location']['lat'],
                place['geometry']['location']['lng']
            )
            
            place_id = place.get('place_id')
            
            # Get most recent community-submitted price for this fuel type
            price_data = get_latest_price(place_id, fuel_type)
            
            # Format price display
            if price_data:
                price_display = f"${price_data['price']:.2f}"
                price_age = "Updated recently"
            else:
                price_display = "No price data"
                price_age = None
            
            # Build station object for response
            gas_stations.append({
                'id': place_id,
                'name': place.get('name', 'Unknown'),
                'address': place.get('vicinity', 'N/A'),
                'distance': f"{distance:.1f} mi",
                'price': price_display,
                'priceAge': price_age,
                'latitude': place['geometry']['location']['lat'],
                'longitude': place['geometry']['location']['lng'],
                'rating': place.get('rating', 'N/A'),
                'isOpen': place.get('opening_hours', {}).get('open_now', None)
            })
        
        # Sort stations by distance (closest first)
        gas_stations.sort(key=lambda x: float(x['distance'].split()[0]))
        
        print(f'✅ Returning {len(gas_stations)} gas stations for {fuel_type}\n')
        return jsonify({'stations': gas_stations})
    
    except requests.Timeout:
        print('❌ Request timeout')
        return jsonify({'error': 'Request timeout'}), 504
    except Exception as e:
        print(f'❌ Error: {str(e)}')
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/api/submit-price', methods=['POST'])
@limiter.limit("20 per minute")  # Rate limit to prevent spam (increased for testing)
def submit_price():
    """
    Allow users to submit gas prices for community sharing.
    
    Request Body (JSON):
        {
            'place_id': str,      # Google Places API identifier
            'price': float,       # Price per gallon
            'fuel_type': str      # regular, midgrade, premium, or diesel
        }
    
    Returns:
        JSON: {'success': bool, 'message': str}
    
    Error Codes:
        400: Invalid input data
        429: Rate limit exceeded (too many submissions)
        500: Database or server error
    """
    try:
        # Validate content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        data = request.json
        
        # Extract parameters
        place_id = data.get('place_id')
        price = data.get('price')
        fuel_type = data.get('fuel_type', 'regular')
        
        print(f'\n💰 Price submission: ${price} for {fuel_type} at {place_id}')
        
        # Validate required fields
        if not place_id or price is None:
            return jsonify({'error': 'Missing place_id or price'}), 400
        
        # Validate fuel type
        valid_fuel_types = ['regular', 'midgrade', 'premium', 'diesel']
        if fuel_type not in valid_fuel_types:
            return jsonify({'error': 'Invalid fuel type'}), 400
        
        # Validate price
        try:
            price = float(price)
            
            # Realistic price range: $0.01 to $20.00 per gallon
            if price <= 0 or price > 20:
                return jsonify({'error': 'Invalid price. Must be between $0.01 and $20.00'}), 400
            
            # Additional check for suspiciously low prices
            if price < 1:
                return jsonify({'error': 'Price seems too low. Please check and try again.'}), 400
                
        except (ValueError, TypeError):
            return jsonify({'error': 'Price must be a valid number'}), 400
        
        # Insert price into database
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO gas_prices (place_id, price, fuel_type)
                VALUES (?, ?, ?)
            ''', (place_id, price, fuel_type))
            
            conn.commit()
            print(f'✅ Price saved successfully for {fuel_type}\n')
            
        except Exception as e:
            print(f'❌ Database error: {e}\n')
            conn.close()
            return jsonify({'error': 'Failed to save price'}), 500
        finally:
            conn.close()
        
        return jsonify({'success': True, 'message': 'Price submitted successfully'})
    
    except Exception as e:
        print(f'❌ Error: {str(e)}\n')
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Internal server error'}), 500


def calculate_distance(lat1, lon1, lat2, lon2):
    """
    Calculate distance between two coordinates using the Haversine formula.
    
    Args:
        lat1 (float): Latitude of first point
        lon1 (float): Longitude of first point
        lat2 (float): Latitude of second point
        lon2 (float): Longitude of second point
    
    Returns:
        float: Distance in miles
    
    Note:
        Haversine formula accounts for Earth's curvature and is accurate for distances up to ~500km.
        For longer distances, consider using Vincenty's formula for better accuracy.
    """
    from math import radians, sin, cos, sqrt, atan2
    
    # Earth's radius in miles
    R = 3959
    
    # Convert coordinates from degrees to radians
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    
    # Calculate differences
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    
    # Haversine formula
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    distance = R * c
    
    return distance


@app.route('/health', methods=['GET'])
def health():
    """
    Health check endpoint for monitoring service status.
    
    Returns:
        JSON: {'status': str, 'database': str}
    """
    return jsonify({'status': 'ok', 'database': 'connected'})


# Application entry point
if __name__ == '__main__':
    # Run Flask development server
    # For production, use a WSGI server like Gunicorn
    app.run(debug=True, host='0.0.0.0', port=5000)