# Gas Finder App

A full-stack mobile application for finding nearby gas stations with community-sourced pricing.

## 🚀 Features

- **Real-time Location Search**: Find gas stations near you using GPS
- **Community Pricing**: Users can submit and view gas prices
- **Multiple Fuel Types**: Support for Regular, Midgrade, Premium, and Diesel
- **Dark Mode**: Full dark mode support
- **Interactive Map**: View stations on an interactive map with custom markers
- **Smart Filtering**: Search and filter by station name or address
- **Customizable Settings**: Distance units, search radius, fuel type preferences, and theme

## 🛠️ Tech Stack

### Frontend (Mobile)
- React Native with Expo
- TypeScript
- React Native Maps
- AsyncStorage
- Expo Location

### Backend (API)
- Flask (Python)
- SQLite
- Google Places API
- Flask-CORS
- Flask-Limiter

## 📦 Installation

### Backend Setup
```bash
cd gas-finder-backend
python -m venv venv
venv\Scripts\activate  # Windows
pip install -r requirements.txt
echo "GOOGLE_PLACES_API_KEY=your_api_key_here" > .env
python app.py
```

### Frontend Setup
```bash
cd gas-station-app
npm install
npx expo start
```

## 🔑 Environment Variables

Create `.env` in `gas-finder-backend/`:
```
GOOGLE_PLACES_API_KEY=your_google_api_key_here
```

## 📱 Running the App

1. Start backend server (`python app.py`)
2. Start Expo (`npx expo start`)
3. Scan QR code with Expo Go app
4. Update `API_URL` in `App.tsx` to your computer's IP

## 🏗️ Project Structure
```
GasApp/
├── gas-finder-backend/
│   ├── app.py
│   ├── requirements.txt
│   └── .env
└── gas-station-app/
    ├── App.tsx
    ├── package.json
    └── app.json
```

## 🔒 API Endpoints

### GET `/api/gas-stations`
- Query: `latitude`, `longitude`, `radius`, `fuel_type`
- Returns: Array of gas stations

### POST `/api/submit-price`
- Body: `{ place_id, price, fuel_type }`
- Returns: Success confirmation

## 👤 Author

**Anthony Martin**
- GitHub: [@YourUsername](https://github.com/YourUsername)
