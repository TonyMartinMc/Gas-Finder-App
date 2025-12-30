/**
 * Gas Finder Mobile App
 * React Native application for finding nearby gas stations with community-sourced pricing
 * 
 * Features:
 * - Real-time location-based gas station search
 * - Community-driven price submissions
 * - Multiple fuel type support (regular, midgrade, premium, diesel)
 * - Dark mode support
 * - Customizable search radius
 * - Interactive map with station markers
 * 
 * Author: Anthony Martinz
 * Date: December 2025
 */

import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState, useCallback } from 'react';
import { 
  ActivityIndicator, 
  FlatList, 
  StatusBar, 
  StyleSheet, 
  Text, 
  TouchableOpacity, 
  View,
  Modal,
  TextInput,
  Alert,
  RefreshControl,
  Platform,
  SafeAreaView,
  KeyboardAvoidingView,
  ScrollView,
  Linking,
  Switch,
  useColorScheme,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Type Definitions
 */

// Gas station data structure returned from API
type GasStation = {
  id: string;              // Google Places API identifier
  name: string;            // Station name (e.g., "Shell", "BP")
  distance: string;        // Distance from user with unit (e.g., "2.5 mi")
  price: string;           // Formatted price (e.g., "$3.45")
  priceAge?: string;       // How recent the price is
  address: string;         // Street address
  latitude?: number;       // GPS coordinates for map marker
  longitude?: number;      // GPS coordinates for map marker
  rating?: number;         // Google rating (1-5 stars)
};

// User preferences for distance display
type DistanceUnit = 'miles' | 'kilometers';

// Available fuel types in the system
type FuelType = 'regular' | 'midgrade' | 'premium' | 'diesel';

// Theme options: light, dark, or follow system
type ThemeMode = 'light' | 'dark' | 'system';

// Backend API configuration
const API_URL = 'http://192.168.0.157:5000';

/**
 * Color Schemes
 * Defines colors for both light and dark themes
 */
const Colors = {
  light: {
    background: '#F5F5F5',
    card: '#FFFFFF',
    text: '#000000',
    textSecondary: '#666666',
    textTertiary: '#999999',
    border: '#E0E0E0',
    primary: '#007AFF',
    cardBackground: '#F8F8F8',
    iconBackground: '#E3F2FD',
    success: '#34C759',
    danger: '#FF3B30',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
  dark: {
    background: '#000000',
    card: '#1C1C1E',
    text: '#FFFFFF',
    textSecondary: '#EBEBF5',
    textTertiary: '#8E8E93',
    border: '#38383A',
    primary: '#0A84FF',
    cardBackground: '#2C2C2E',
    iconBackground: '#1C3A52',
    success: '#32D74B',
    danger: '#FF453A',
    overlay: 'rgba(0, 0, 0, 0.8)',
  },
};

/**
 * Main App Component
 */
export default function App() {
  // Get system color scheme (light/dark) from device settings
  const systemColorScheme = useColorScheme();
  
  /**
   * State Management
   */
  
  // Location and gas station data
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [gasStations, setGasStations] = useState<GasStation[]>([]);
  const [filteredStations, setFilteredStations] = useState<GasStation[]>([]);
  
  // UI state for modals and selections
  const [selectedStation, setSelectedStation] = useState<GasStation | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [stationOptionsVisible, setStationOptionsVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [submittingPrice, setSubmittingPrice] = useState(false);
  
  // List filtering and sorting
  const [sortBy, setSortBy] = useState<'distance' | 'price'>('distance');
  const [searchQuery, setSearchQuery] = useState('');

  // User preferences (persisted to AsyncStorage)
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('miles');
  const [defaultFuelType, setDefaultFuelType] = useState<FuelType>('regular');
  const [showRatings, setShowRatings] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchRadius, setSearchRadius] = useState(5);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');

  /**
   * Determine active theme based on user preference and system settings
   */
  const activeTheme = themeMode === 'system' 
    ? (systemColorScheme === 'dark' ? 'dark' : 'light')
    : themeMode;
  const colors = Colors[activeTheme];

  /**
   * Load user settings from AsyncStorage on app mount
   */
  useEffect(() => {
    loadSettings();
  }, []);

  /**
   * Load saved user preferences from device storage
   */
  const loadSettings = async () => {
    try {
      const savedSettings = await AsyncStorage.getItem('appSettings');
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        setDistanceUnit(settings.distanceUnit || 'miles');
        setDefaultFuelType(settings.defaultFuelType || 'regular');
        setShowRatings(settings.showRatings ?? true);
        setAutoRefresh(settings.autoRefresh ?? true);
        setSearchRadius(settings.searchRadius || 5);
        setThemeMode(settings.themeMode || 'system');
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  /**
   * Save a single setting to AsyncStorage
   * @param key - Setting key to update
   * @param value - New value for the setting
   */
  const saveSettings = async (key: string, value: any) => {
    try {
      const currentSettings = await AsyncStorage.getItem('appSettings');
      const settings = currentSettings ? JSON.parse(currentSettings) : {};
      settings[key] = value;
      await AsyncStorage.setItem('appSettings', JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  /**
   * Fetch gas stations from backend API
   * @param currentLocation - User's current GPS location
   * @param showLoading - Whether to show loading indicator
   */
  const fetchGasStations = async (currentLocation: Location.LocationObject, showLoading = true) => {
    if (showLoading) setLoading(true);
    
    try {
      // Convert search radius to meters based on user's distance unit preference
      const radiusInMeters = distanceUnit === 'miles' 
        ? searchRadius * 1609.34  // Convert miles to meters
        : searchRadius * 1000;    // Convert km to meters
      
      // Build API request with location, radius, and fuel type parameters
      const response = await fetch(
        `${API_URL}/api/gas-stations?latitude=${currentLocation.coords.latitude}&longitude=${currentLocation.coords.longitude}&radius=${radiusInMeters}&fuel_type=${defaultFuelType}`,
        { timeout: 10000 } as any
      );
      
      if (!response.ok) {
        throw new Error('Failed to fetch gas stations');
      }
      
      const data = await response.json();
      
      if (data.stations) {
        // Format distances according to user's preferred unit
        const formattedStations = data.stations.map((station: any) => {
          const distanceMatch = station.distance.match(/[\d.]+/);
          const distanceValue = distanceMatch ? parseFloat(distanceMatch[0]) : 0;
          
          return {
            ...station,
            distance: distanceUnit === 'miles' 
              ? `${distanceValue.toFixed(1)} mi`
              : `${(distanceValue * 1.60934).toFixed(1)} km`
          };
        });
        
        setGasStations(formattedStations);
        setFilteredStations(formattedStations);
      } else {
        setGasStations([]);
        setFilteredStations([]);
      }
    } catch (error) {
      console.error('Error fetching gas stations:', error);
      Alert.alert(
        'Connection Error', 
        'Unable to load gas stations. Please check your connection and try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  /**
   * Pull-to-refresh handler
   * Refreshes gas station list without showing full loading screen
   */
  const onRefresh = useCallback(async () => {
    if (!location) return;
    setRefreshing(true);
    await fetchGasStations(location, false);
  }, [location, distanceUnit, searchRadius, defaultFuelType]);

  /**
   * Request location permission and fetch initial data on app mount
   */
  useEffect(() => {
    (async () => {
      // Request location permission from user
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Permission Required',
          'This app needs access to your location to find nearby gas stations.',
          [{ text: 'OK' }]
        );
        setLoading(false);
        return;
      }

      try {
        // Get current GPS location
        let currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        });
        setLocation(currentLocation);
        await fetchGasStations(currentLocation);
      } catch (error) {
        Alert.alert('Error', 'Unable to get your location. Please try again.');
        setLoading(false);
      }
    })();
  }, []);

  /**
   * Re-fetch gas stations when search radius or fuel type changes
   */
  useEffect(() => {
    if (location && !loading) {
      fetchGasStations(location, false);
    }
  }, [searchRadius, defaultFuelType]);

  /**
   * Convert existing distances when user changes distance unit preference
   * This avoids unnecessary API calls by converting in-place
   */
  useEffect(() => {
    if (gasStations.length > 0) {
      const convertedStations = gasStations.map((station) => {
        const distanceMatch = station.distance.match(/[\d.]+/);
        const distanceValue = distanceMatch ? parseFloat(distanceMatch[0]) : 0;
        
        const isCurrentlyMiles = station.distance.includes('mi');
        
        let newDistanceValue = distanceValue;
        
        // Convert between miles and kilometers
        if (distanceUnit === 'kilometers' && isCurrentlyMiles) {
          newDistanceValue = distanceValue * 1.60934;
        } else if (distanceUnit === 'miles' && !isCurrentlyMiles) {
          newDistanceValue = distanceValue / 1.60934;
        }
        
        return {
          ...station,
          distance: distanceUnit === 'miles' 
            ? `${newDistanceValue.toFixed(1)} mi`
            : `${newDistanceValue.toFixed(1)} km`
        };
      });
      
      setGasStations(convertedStations);
      setFilteredStations(convertedStations);
    }
  }, [distanceUnit]);

  /**
   * Filter gas stations based on search query
   */
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredStations(gasStations);
    } else {
      const filtered = gasStations.filter(station => 
        station.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        station.address.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredStations(filtered);
    }
  }, [searchQuery, gasStations]);

  /**
   * Sort stations by distance or price
   */
  useEffect(() => {
    const sorted = [...filteredStations].sort((a, b) => {
      if (sortBy === 'distance') {
        // Sort by distance (closest first)
        const distA = parseFloat(a.distance.match(/[\d.]+/)?.[0] || '0');
        const distB = parseFloat(b.distance.match(/[\d.]+/)?.[0] || '0');
        return distA - distB;
      } else {
        // Sort by price (cheapest first)
        // Push stations without price data to the end
        if (a.price === 'No price data') return 1;
        if (b.price === 'No price data') return -1;
        const priceA = parseFloat(a.price.replace('$', ''));
        const priceB = parseFloat(b.price.replace('$', ''));
        return priceA - priceB;
      }
    });
    setFilteredStations(sorted);
  }, [sortBy]);

  /**
   * Submit gas price to backend API
   */
  const handleSubmitPrice = async () => {
    if (!selectedStation) return;
    
    // Sanitize input: remove non-numeric characters except decimal point
    const sanitizedInput = priceInput.trim().replace(/[^0-9.]/g, '');
    const price = parseFloat(sanitizedInput);
    
    // Validate price input
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid price');
      return;
    }

    if (price < 1 || price > 10) {
      Alert.alert('Invalid Price', 'Please enter a realistic gas price between $1.00 and $10.00');
      return;
    }

    if (!selectedStation.id || selectedStation.id.length > 200) {
      Alert.alert('Error', 'Invalid station data');
      return;
    }

    setSubmittingPrice(true);

    try {
      const response = await fetch(`${API_URL}/api/submit-price`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          place_id: selectedStation.id,
          price: price,
          fuel_type: defaultFuelType
        }),
      });

      const data = await response.json();
      
      // Handle rate limiting
      if (response.status === 429) {
        Alert.alert(
          'Rate Limit Reached ⏰', 
          'You can only submit 20 prices per minute. Please wait a moment and try again.',
          [{ text: 'OK' }]
        );
        setSubmittingPrice(false);
        return;
      }
      
      if (!response.ok) {
        Alert.alert('Error', data.error || 'Failed to submit price. Please try again.');
        setSubmittingPrice(false);
        return;
      }
      
      if (data.success) {
        Alert.alert('Success! 🎉', 'Thank you for contributing to the community!');
        setModalVisible(false);
        setPriceInput('');
        
        // Refresh station list to show updated price
        if (location) {
          await fetchGasStations(location, false);
        }
      } else {
        Alert.alert('Error', data.error || 'Failed to submit price. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting price:', error);
      Alert.alert('Connection Error', 'Unable to submit price. Please check your connection.');
    } finally {
      setSubmittingPrice(false);
    }
  };

  /**
   * Open directions in Apple Maps or Google Maps
   * @param mapType - Which map app to use
   */
  const openDirections = async (mapType: 'apple' | 'google') => {
    if (!selectedStation || !selectedStation.latitude || !selectedStation.longitude) {
      Alert.alert('Error', 'Location data not available');
      return;
    }

    const { latitude, longitude } = selectedStation;
    const label = encodeURIComponent(selectedStation.name);

    let url = '';

    if (mapType === 'apple') {
      // Apple Maps URL scheme
      url = `http://maps.apple.com/?daddr=${latitude},${longitude}&q=${label}`;
    } else {
      // Google Maps URL scheme with place ID
      url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&destination_place_id=${selectedStation.id}`;
    }

    const supported = await Linking.canOpenURL(url);

    if (supported) {
      await Linking.openURL(url);
      setStationOptionsVisible(false);
    } else {
      Alert.alert('Error', `Cannot open ${mapType === 'apple' ? 'Apple' : 'Google'} Maps`);
    }
  };

  /**
   * Open station options modal when user taps a gas station
   */
  const openStationOptions = (station: GasStation) => {
    setSelectedStation(station);
    setStationOptionsVisible(true);
  };

  /**
   * Navigate from station options to price submission modal
   */
  const openPriceModal = () => {
    setStationOptionsVisible(false);
    setModalVisible(true);
  };

  /**
   * Toggle between sorting by distance and price
   */
  const toggleSort = () => {
    setSortBy(prev => prev === 'distance' ? 'price' : 'distance');
  };

  /**
   * Reset all settings to default values
   */
  const handleResetSettings = () => {
    Alert.alert(
      'Reset Settings',
      'Are you sure you want to reset all settings to default?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem('appSettings');
            setDistanceUnit('miles');
            setDefaultFuelType('regular');
            setShowRatings(true);
            setAutoRefresh(true);
            setSearchRadius(5);
            setThemeMode('system');
            Alert.alert('Success', 'Settings have been reset to default');
          },
        },
      ]
    );
  };

  /**
   * Loading Screen
   * Shown while fetching initial location and gas station data
   */
  if (loading) {
    return (
      <SafeAreaView style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <StatusBar barStyle={activeTheme === 'dark' ? 'light-content' : 'dark-content'} />
        <Ionicons name="car-sport" size={64} color={colors.primary} style={{ marginBottom: 24 }} />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.text }]}>Finding nearby gas stations...</Text>
        <Text style={[styles.loadingSubtext, { color: colors.textSecondary }]}>Getting your location</Text>
      </SafeAreaView>
    );
  }

  /**
   * Main App UI
   */
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={activeTheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* Header with title, station count, and action buttons */}
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Ionicons name="location-sharp" size={24} color={colors.primary} />
          <View style={styles.headerTextContainer}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Gas Stations</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              {filteredStations.length} nearby
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {/* Sort toggle button */}
          <TouchableOpacity 
            style={[styles.sortButton, { backgroundColor: activeTheme === 'dark' ? colors.cardBackground : '#F0F0F0' }]}
            onPress={toggleSort}
          >
            <Ionicons 
              name={sortBy === 'distance' ? 'navigate' : 'pricetag'} 
              size={20} 
              color={colors.primary} 
            />
          </TouchableOpacity>
          {/* Settings button */}
          <TouchableOpacity 
            style={[styles.settingsButton, { backgroundColor: activeTheme === 'dark' ? colors.cardBackground : '#F0F0F0' }]}
            onPress={() => setSettingsVisible(true)}
          >
            <Ionicons name="settings-outline" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search" size={20} color={colors.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search gas stations..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={colors.textTertiary}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Map View with Station Markers */}
      {location && (
        <MapView
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          customMapStyle={activeTheme === 'dark' ? darkMapStyle : []}
          initialRegion={{
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          showsUserLocation
          showsMyLocationButton
        >
          {/* Render marker for each gas station */}
          {filteredStations.map((station) => (
            station.latitude && station.longitude && (
              <Marker
                key={station.id}
                coordinate={{
                  latitude: station.latitude,
                  longitude: station.longitude,
                }}
                title={station.name}
                description={`${station.price} • ${station.distance} away`}
                onCalloutPress={() => openStationOptions(station)}
              >
                <View style={styles.customMarker}>
                  <Ionicons name="location" size={32} color="#FF3B30" />
                </View>
              </Marker>
            )
          ))}
        </MapView>
      )}

      {/* Gas Stations List */}
      <View style={[styles.listContainer, { backgroundColor: colors.card }]}>
        <View style={styles.listHeader}>
          <Text style={[styles.listTitle, { color: colors.text }]}>Nearby Stations</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Tap for options</Text>
        </View>
        
        {/* Show empty state if no stations found */}
        {filteredStations.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={64} color={colors.textTertiary} />
            <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>No gas stations found</Text>
            <Text style={[styles.emptyStateSubtext, { color: colors.textTertiary }]}>
              {searchQuery ? 'Try a different search' : 'Try expanding your search radius'}
            </Text>
          </View>
        ) : (
          // Render scrollable list of gas stations
          <FlatList
            data={filteredStations}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
            }
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={[styles.stationCard, { backgroundColor: colors.cardBackground }]}
                onPress={() => openStationOptions(item)}
                activeOpacity={0.7}
              >
                {/* Station icon */}
                <View style={[styles.stationIcon, { backgroundColor: colors.iconBackground }]}>
                  <Ionicons name="business" size={24} color={colors.primary} />
                </View>
                
                {/* Station information */}
                <View style={styles.stationInfo}>
                  <Text style={[styles.stationName, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[styles.stationAddress, { color: colors.textSecondary }]}>{item.address}</Text>
                  <View style={styles.stationMeta}>
                    <Ionicons name="navigate" size={12} color={colors.textTertiary} />
                    <Text style={[styles.stationDistance, { color: colors.textTertiary }]}>{item.distance} away</Text>
                    {/* Show rating if enabled in settings */}
                    {showRatings && item.rating && (
                      <>
                        <Text style={[styles.metaDivider, { color: colors.border }]}>•</Text>
                        <Ionicons name="star" size={12} color="#FFB800" />
                        <Text style={[styles.stationRating, { color: colors.textTertiary }]}>{item.rating}</Text>
                      </>
                    )}
                  </View>
                </View>
                
                {/* Price display */}
                <View style={styles.priceContainer}>
                  <Text style={[styles.priceLabel, { color: colors.textTertiary }]}>{defaultFuelType}</Text>
                  <Text style={[
                    styles.price,
                    { color: colors.primary },
                    item.price === 'No price data' && [styles.noPriceText, { color: colors.textTertiary }]
                  ]}>
                    {item.price}
                  </Text>
                  {/* Show "Recent" badge if price was recently updated */}
                  {item.priceAge && (
                    <View style={[styles.priceAgeContainer, { backgroundColor: activeTheme === 'dark' ? '#1C3A2E' : '#E8F5E9' }]}>
                      <Ionicons name="checkmark-circle" size={12} color={colors.success} />
                      <Text style={[styles.priceAge, { color: colors.success }]}>Recent</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Station Options Modal - Directions and price update */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={stationOptionsVisible}
        onRequestClose={() => setStationOptionsVisible(false)}
      >
        <TouchableOpacity 
          style={[styles.optionsOverlay, { backgroundColor: colors.overlay }]}
          activeOpacity={1} 
          onPress={() => setStationOptionsVisible(false)}
        >
          <View style={[styles.optionsContent, { backgroundColor: colors.card }]}>
            <View style={styles.optionsHeader}>
              <View>
                <Text style={[styles.optionsTitle, { color: colors.text }]}>{selectedStation?.name}</Text>
                <Text style={[styles.optionsAddress, { color: colors.textSecondary }]}>{selectedStation?.address}</Text>
              </View>
              <TouchableOpacity 
                onPress={() => setStationOptionsVisible(false)}
                style={styles.optionsCloseButton}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.optionsDivider, { backgroundColor: colors.border }]} />

            {/* Get Directions Section */}
            <View style={styles.optionsSection}>
              <Text style={[styles.optionsSectionTitle, { color: colors.textTertiary }]}>Get Directions</Text>
              
              {/* Apple Maps button */}
              <TouchableOpacity 
                style={[styles.optionButton, { backgroundColor: colors.cardBackground }]}
                onPress={() => openDirections('apple')}
              >
                <View style={[styles.optionIconContainer, { backgroundColor: colors.card }]}>
                  <Ionicons name="navigate-circle" size={28} color={colors.primary} />
                </View>
                <View style={styles.optionTextContainer}>
                  <Text style={[styles.optionButtonText, { color: colors.text }]}>Apple Maps</Text>
                  <Text style={[styles.optionButtonSubtext, { color: colors.textSecondary }]}>Open in Apple Maps</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.border} />
              </TouchableOpacity>

              {/* Google Maps button */}
              <TouchableOpacity 
                style={[styles.optionButton, { backgroundColor: colors.cardBackground }]}
                onPress={() => openDirections('google')}
              >
                <View style={[styles.optionIconContainer, { backgroundColor: colors.card }]}>
                  <Ionicons name="map" size={28} color="#34A853" />
                </View>
                <View style={styles.optionTextContainer}>
                  <Text style={[styles.optionButtonText, { color: colors.text }]}>Google Maps</Text>
                  <Text style={[styles.optionButtonSubtext, { color: colors.textSecondary }]}>Open in Google Maps</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.border} />
              </TouchableOpacity>
            </View>

            <View style={[styles.optionsDivider, { backgroundColor: colors.border }]} />

            {/* Community Section - Price update */}
            <View style={styles.optionsSection}>
              <Text style={[styles.optionsSectionTitle, { color: colors.textTertiary }]}>Community</Text>
              
              <TouchableOpacity 
                style={[styles.optionButton, { backgroundColor: colors.cardBackground }]}
                onPress={openPriceModal}
              >
                <View style={[styles.optionIconContainer, { backgroundColor: colors.card }]}>
                  <Ionicons name="pricetag" size={28} color="#FF9500" />
                </View>
                <View style={styles.optionTextContainer}>
                  <Text style={[styles.optionButtonText, { color: colors.text }]}>Update Price</Text>
                  <Text style={[styles.optionButtonSubtext, { color: colors.textSecondary }]}>Help the community</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.border} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Price Submission Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity 
            style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
            activeOpacity={1} 
            onPress={() => {
              setModalVisible(false);
              setPriceInput('');
            }}
          />
          
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            {/* Close button */}
            <TouchableOpacity 
              style={[styles.modalCloseButton, { backgroundColor: colors.cardBackground }]}
              onPress={() => {
                setModalVisible(false);
                setPriceInput('');
              }}
            >
              <Ionicons name="close" size={28} color={colors.textSecondary} />
            </TouchableOpacity>

            <ScrollView 
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Ionicons name="pricetag" size={48} color={colors.primary} style={{ alignSelf: 'center', marginBottom: 16 }} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>Update Gas Price</Text>
              <Text style={[styles.modalStation, { color: colors.text }]}>{selectedStation?.name}</Text>
              <Text style={[styles.modalAddress, { color: colors.textSecondary }]}>{selectedStation?.address}</Text>
              
              {/* Price input field */}
              <View style={[styles.inputContainer, { backgroundColor: colors.cardBackground, borderColor: colors.primary }]}>
                <Text style={[styles.dollarSign, { color: colors.primary }]}>$</Text>
                <TextInput
                  style={[styles.priceInputField, { color: colors.text }]}
                  value={priceInput}
                  onChangeText={setPriceInput}
                  placeholder="3.45"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                  autoFocus
                  maxLength={5}
                />
                <Text style={[styles.perGallon, { color: colors.textTertiary }]}>/gal</Text>
              </View>

              <Text style={[styles.helpText, { color: colors.textSecondary }]}>
                Enter the price per gallon for {defaultFuelType} gas
              </Text>

              {/* Action buttons */}
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.cardBackground }]}
                  onPress={() => {
                    setModalVisible(false);
                    setPriceInput('');
                  }}
                >
                  <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[
                    styles.modalButton, 
                    styles.submitButton,
                    { backgroundColor: colors.primary },
                    submittingPrice && styles.submitButtonDisabled
                  ]}
                  onPress={handleSubmitPrice}
                  disabled={submittingPrice}
                >
                  {submittingPrice ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitButtonText}>Submit Price</Text>
                  )}
                </TouchableOpacity>
              </View>

              <Text style={[styles.communityNote, { color: colors.textTertiary }]}>
                Help your community by sharing accurate prices! 🙏
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Settings Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={settingsVisible}
        onRequestClose={() => setSettingsVisible(false)}
      >
        <SafeAreaView style={[styles.settingsContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.settingsHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <Text style={[styles.settingsHeaderTitle, { color: colors.text }]}>Settings</Text>
            <TouchableOpacity onPress={() => setSettingsVisible(false)}>
              <Text style={[styles.doneButton, { color: colors.primary }]}>Done</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.settingsScrollView} showsVerticalScrollIndicator={false}>
            
            {/* Appearance Section - Light/Dark/System theme selection */}
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>APPEARANCE</Text>
              
              <View style={[styles.settingsCard, { backgroundColor: colors.card }]}>
                <TouchableOpacity
                  style={styles.settingsOptionRow}
                  onPress={() => {
                    setThemeMode('light');
                    saveSettings('themeMode', 'light');
                  }}
                >
                  <Text style={[styles.settingsOptionText, { color: colors.text }]}>Light</Text>
                  {themeMode === 'light' && (
                    <Ionicons name="checkmark" size={24} color={colors.primary} />
                  )}
                </TouchableOpacity>

                <View style={[styles.settingsDivider, { backgroundColor: colors.border }]} />

                <TouchableOpacity
                  style={styles.settingsOptionRow}
                  onPress={() => {
                    setThemeMode('dark');
                    saveSettings('themeMode', 'dark');
                  }}
                >
                  <Text style={[styles.settingsOptionText, { color: colors.text }]}>Dark</Text>
                  {themeMode === 'dark' && (
                    <Ionicons name="checkmark" size={24} color={colors.primary} />
                  )}
                </TouchableOpacity>

                <View style={[styles.settingsDivider, { backgroundColor: colors.border }]} />

                <TouchableOpacity
                  style={styles.settingsOptionRow}
                  onPress={() => {
                    setThemeMode('system');
                    saveSettings('themeMode', 'system');
                  }}
                >
                  <Text style={[styles.settingsOptionText, { color: colors.text }]}>System</Text>
                  {themeMode === 'system' && (
                    <Ionicons name="checkmark" size={24} color={colors.primary} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Distance Unit Section - Miles or Kilometers */}
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>DISTANCE</Text>
              
              <View style={[styles.settingsCard, { backgroundColor: colors.card }]}>
                <TouchableOpacity
                  style={styles.settingsOptionRow}
                  onPress={() => {
                    setDistanceUnit('miles');
                    saveSettings('distanceUnit', 'miles');
                  }}
                >
                  <Text style={[styles.settingsOptionText, { color: colors.text }]}>Miles</Text>
                  {distanceUnit === 'miles' && (
                    <Ionicons name="checkmark" size={24} color={colors.primary} />
                  )}
                </TouchableOpacity>

                <View style={[styles.settingsDivider, { backgroundColor: colors.border }]} />

                <TouchableOpacity
                  style={styles.settingsOptionRow}
                  onPress={() => {
                    setDistanceUnit('kilometers');
                    saveSettings('distanceUnit', 'kilometers');
                  }}
                >
                  <Text style={[styles.settingsOptionText, { color: colors.text }]}>Kilometers</Text>
                  {distanceUnit === 'kilometers' && (
                    <Ionicons name="checkmark" size={24} color={colors.primary} />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Search Radius Section - 3, 5, 10, 15, or 20 miles/km */}
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>SEARCH RADIUS</Text>
              
              <View style={[styles.settingsCard, { backgroundColor: colors.card }]}>
                {[3, 5, 10, 15, 20].map((radius, index) => (
                  <View key={radius}>
                    {index > 0 && <View style={[styles.settingsDivider, { backgroundColor: colors.border }]} />}
                    <TouchableOpacity
                      style={styles.settingsOptionRow}
                      onPress={() => {
                        setSearchRadius(radius);
                        saveSettings('searchRadius', radius);
                      }}
                    >
                      <Text style={[styles.settingsOptionText, { color: colors.text }]}>
                        {radius} {distanceUnit === 'miles' ? 'miles' : 'km'}
                      </Text>
                      {searchRadius === radius && (
                        <Ionicons name="checkmark" size={24} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>

            {/* Default Fuel Type Section */}
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>DEFAULT FUEL TYPE</Text>
              
              <View style={[styles.settingsCard, { backgroundColor: colors.card }]}>
                {[
                  { value: 'regular', label: 'Regular (87)' },
                  { value: 'midgrade', label: 'Midgrade (89)' },
                  { value: 'premium', label: 'Premium (91+)' },
                  { value: 'diesel', label: 'Diesel' },
                ].map((fuel, index) => (
                  <View key={fuel.value}>
                    {index > 0 && <View style={[styles.settingsDivider, { backgroundColor: colors.border }]} />}
                    <TouchableOpacity
                      style={styles.settingsOptionRow}
                      onPress={() => {
                        setDefaultFuelType(fuel.value as FuelType);
                        saveSettings('defaultFuelType', fuel.value);
                      }}
                    >
                      <Text style={[styles.settingsOptionText, { color: colors.text }]}>{fuel.label}</Text>
                      {defaultFuelType === fuel.value && (
                        <Ionicons name="checkmark" size={24} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>

            {/* Display Preferences Section - Toggle switches */}
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>DISPLAY</Text>
              
              <View style={[styles.settingsCard, { backgroundColor: colors.card }]}>
                <View style={styles.settingsSwitchRow}>
                  <View style={styles.settingsSwitchTextContainer}>
                    <Text style={[styles.settingsOptionText, { color: colors.text }]}>Show Ratings</Text>
                    <Text style={[styles.settingsOptionSubtext, { color: colors.textSecondary }]}>Display Google ratings</Text>
                  </View>
                  <Switch
                    value={showRatings}
                    onValueChange={(value) => {
                      setShowRatings(value);
                      saveSettings('showRatings', value);
                    }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>

                <View style={[styles.settingsDivider, { backgroundColor: colors.border }]} />

                <View style={styles.settingsSwitchRow}>
                  <View style={styles.settingsSwitchTextContainer}>
                    <Text style={[styles.settingsOptionText, { color: colors.text }]}>Auto-Refresh</Text>
                    <Text style={[styles.settingsOptionSubtext, { color: colors.textSecondary }]}>Update stations automatically</Text>
                  </View>
                  <Switch
                    value={autoRefresh}
                    onValueChange={(value) => {
                      setAutoRefresh(value);
                      saveSettings('autoRefresh', value);
                    }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              </View>
            </View>

            {/* About Section */}
            <View style={styles.settingsSection}>
              <Text style={[styles.settingsSectionTitle, { color: colors.textSecondary }]}>ABOUT</Text>
              
              <View style={[styles.settingsCard, { backgroundColor: colors.card }]}>
                <View style={styles.settingsAboutRow}>
                  <Text style={[styles.settingsOptionText, { color: colors.text }]}>Version</Text>
                  <Text style={[styles.settingsAboutValue, { color: colors.textSecondary }]}>1.0.0</Text>
                </View>
              </View>
            </View>

            {/* Reset Button */}
            <View style={styles.settingsSection}>
              <TouchableOpacity
                style={[styles.settingsResetButton, { backgroundColor: colors.danger }]}
                onPress={handleResetSettings}
              >
                <Text style={styles.settingsResetButtonText}>Reset All Settings</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.settingsFooter}>
              <Text style={[styles.settingsFooterText, { color: colors.textTertiary }]}>
                Made with ❤️ for the community
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/**
 * Dark Mode Map Styling
 * Custom map style to match dark theme aesthetic
 */
const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#263c3f" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6b9a76" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#38414e" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#212a37" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9ca5b3" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#746855" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1f2835" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#f3d19c" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#2f3948" }],
  },
  {
    featureType: "transit.station",
    elementType: "labels.text.fill",
    stylers: [{ color: "#d59563" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17263c" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#515c6d" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#17263c" }],
  },
];

/**
 * StyleSheet
 * All component styles defined using React Native StyleSheet
 */
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '600',
  },
  loadingSubtext: {
    marginTop: 8,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerTextContainer: {
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 12,
  },
  sortButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginVertical: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  map: {
    height: 250,
  },
  customMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContainer: {
    flex: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -20,
    paddingTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  listHeader: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  listTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    marginTop: 8,
  },
  stationCard: {
    flexDirection: 'row',
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  stationIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  stationInfo: {
    flex: 1,
  },
  stationName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  stationAddress: {
    fontSize: 14,
    marginBottom: 6,
  },
  stationMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stationDistance: {
    fontSize: 13,
    marginLeft: 4,
  },
  metaDivider: {
    fontSize: 13,
    marginHorizontal: 6,
  },
  stationRating: {
    fontSize: 13,
    marginLeft: 2,
  },
  priceContainer: {
    alignItems: 'flex-end',
    minWidth: 80,
  },
  priceLabel: {
    fontSize: 11,
    marginBottom: 4,
    textTransform: 'capitalize',
    fontWeight: '600',
  },
  price: {
    fontSize: 22,
    fontWeight: '700',
  },
  noPriceText: {
    fontSize: 12,
    fontWeight: '500',
  },
  priceAgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  priceAge: {
    fontSize: 10,
    marginLeft: 2,
    fontWeight: '600',
  },
  optionsOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  optionsContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  optionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 24,
    paddingBottom: 16,
  },
  optionsTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  optionsAddress: {
    fontSize: 14,
    maxWidth: '80%',
  },
  optionsCloseButton: {
    padding: 4,
  },
  optionsDivider: {
    height: 1,
    marginHorizontal: 24,
  },
  optionsSection: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  optionsSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 10,
  },
  optionIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionButtonText: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 2,
  },
  optionButtonSubtext: {
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    flex: 1,
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '80%',
  },
  modalCloseButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalStation: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  modalAddress: {
    fontSize: 14,
    marginBottom: 28,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginBottom: 12,
    borderWidth: 2,
  },
  dollarSign: {
    fontSize: 36,
    fontWeight: '700',
    marginRight: 8,
  },
  priceInputField: {
    flex: 1,
    fontSize: 36,
    fontWeight: '600',
  },
  perGallon: {
    fontSize: 18,
    fontWeight: '500',
  },
  helpText: {
    fontSize: 14,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {},
  submitButton: {},
  submitButtonDisabled: {
    opacity: 0.6,
  },
  cancelButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  communityNote: {
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  settingsContainer: {
    flex: 1,
  },
  settingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  settingsHeaderTitle: {
    fontSize: 34,
    fontWeight: '700',
  },
  doneButton: {
    fontSize: 17,
    fontWeight: '600',
  },
  settingsScrollView: {
    flex: 1,
  },
  settingsSection: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  settingsSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  settingsCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  settingsOptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  settingsOptionText: {
    fontSize: 17,
  },
  settingsOptionSubtext: {
    fontSize: 13,
    marginTop: 2,
  },
  settingsSwitchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  settingsSwitchTextContainer: {
    flex: 1,
  },
  settingsAboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  settingsAboutValue: {
    fontSize: 17,
  },
  settingsDivider: {
    height: 1,
    marginLeft: 16,
  },
  settingsResetButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  settingsResetButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  settingsFooter: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  settingsFooterText: {
    fontSize: 14,
  },
});