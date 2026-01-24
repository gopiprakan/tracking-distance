let map;
let routingControl = null;
let watchId = null;
let startTime = null;
let totalDistance = 0; // in km (real-time)
let routeDistance = 0; // in km (calculated route)
let timerInterval = null;
let trackingPath = [];
let trackingPolyline;
let userMarker = null;

// Initialize Map
function initMap() {
    // Default center (India)
    const defaultCenter = [20.5937, 78.9629];

    map = L.map('map', {
        zoomControl: true,
        attributionControl: true
    }).setView(defaultCenter, 5);

    // Dark Mode Tiles (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    trackingPolyline = L.polyline([], {
        color: '#10b981',
        weight: 5,
        opacity: 0.9
    }).addTo(map);

    setupCustomAutocomplete('start-input', 'start-suggestions');
    setupCustomAutocomplete('end-input', 'end-suggestions');

    // Get current position on load
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const currentPos = [pos.coords.latitude, pos.coords.longitude];
            map.setView(currentPos, 12);
            if (!userMarker) {
                userMarker = L.circleMarker(currentPos, {
                    radius: 8,
                    fillColor: '#6366f1',
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 1
                }).addTo(map);
            }
        });
    }

    renderHistory();
}

/**
 * Geocode address to lat/lng using Nominatim
 */
async function geocode(query) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        const data = await response.json();
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                displayName: data[0].display_name
            };
        }
    } catch (error) {
        console.error("Geocoding error:", error);
    }
    return null;
}

/**
 * Route Calculation using Leaflet Routing Machine
 */
async function calculateRoute() {
    const startQuery = document.getElementById('start-input').value;
    const endQuery = document.getElementById('end-input').value;

    if (!startQuery || !endQuery) {
        alert("Please enter both starting point and destination.");
        return;
    }

    const loader = document.getElementById('plan-loader');
    const btnText = document.getElementById('plan-btn-text');

    loader.style.display = 'block';
    btnText.style.display = 'none';

    try {
        const startPoint = await geocode(startQuery);
        const endPoint = await geocode(endQuery);

        if (!startPoint || !endPoint) {
            alert("Could not find one or both locations. Please try a different search.");
            loader.style.display = 'none';
            btnText.style.display = 'block';
            return;
        }

        if (routingControl) {
            map.removeControl(routingControl);
        }

        routingControl = L.Routing.control({
            waypoints: [
                L.latLng(startPoint.lat, startPoint.lng),
                L.latLng(endPoint.lat, endPoint.lng)
            ],
            lineOptions: {
                styles: [{ color: '#6366f1', opacity: 0.8, weight: 6 }]
            },
            router: L.Routing.osrmv1({
                serviceUrl: `https://router.project-osrm.org/route/v1`
            }),
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: true,
            show: false // Hide the instruction panel
        }).on('routesfound', function (e) {
            const routes = e.routes;
            routeDistance = routes[0].summary.totalDistance / 1000; // converted to km

            // Update Sidebar Stats
            document.getElementById('dist-val').textContent = routeDistance.toFixed(2);
            document.getElementById('status-text').textContent = `Route Calculated: ${routeDistance.toFixed(2)} km`;
            document.getElementById('manual-dist-input').value = routeDistance.toFixed(2);

            updateDetailedCalculator();

            loader.style.display = 'none';
            btnText.style.display = 'block';
        }).on('routingerror', function (err) {
            console.error("Routing error:", err);
            alert("Could not calculate route. Please try different points.");
            loader.style.display = 'none';
            btnText.style.display = 'block';
        }).addTo(map);

    } catch (error) {
        console.error("Calculation error:", error);
        loader.style.display = 'none';
        btnText.style.display = 'block';
    }
}

/**
 * Fuel Calculator Logic
 */
function updateDetailedCalculator() {
    let dist = parseFloat(document.getElementById('manual-dist-input').value);
    if (isNaN(dist)) dist = routeDistance || totalDistance || 0;

    const efficiency = parseFloat(document.getElementById('efficiency-input').value) || 0;
    const price = parseFloat(document.getElementById('price-input').value) || 0;
    const tankCap = parseFloat(document.getElementById('tank-capacity').value) || 0;

    const fuelNeeded = efficiency > 0 ? (dist / efficiency) : 0;
    document.getElementById('fuel-needed-val').textContent = fuelNeeded.toFixed(2);

    const totalCost = fuelNeeded * price;
    document.getElementById('total-cost-val').textContent = totalCost.toFixed(2);
    document.getElementById('fuel-cost').textContent = totalCost.toFixed(2);

    const maxRange = efficiency * tankCap;
    document.getElementById('max-range-val').textContent = maxRange.toFixed(2);

    const costPerKm = dist > 0 ? (totalCost / dist) : 0;
    document.getElementById('cost-per-km-val').textContent = costPerKm.toFixed(2);
}

function updateRealTimeStats() {
    const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const secs = (elapsed % 60).toString().padStart(2, '0');

    document.getElementById('time-val').textContent = `${mins}:${secs}`;
    document.getElementById('dist-val').textContent = totalDistance.toFixed(2);

    const avgSpeed = elapsed > 0 ? (totalDistance / (elapsed / 3600)) : 0;
    document.getElementById('speed-val').textContent = avgSpeed.toFixed(1);

    updateDetailedCalculator();
}

/**
 * Real-Time Tracking
 */
function startTracking() {
    if (watchId) return;

    startTime = Date.now();
    totalDistance = 0;
    trackingPath = [];
    trackingPolyline.setLatLngs([]);

    document.getElementById('start-btn').style.display = 'none';
    document.getElementById('stop-btn').style.display = 'flex';
    document.getElementById('status-dot').classList.add('active');
    document.getElementById('status-text').textContent = 'Tracking Live...';

    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude, longitude, speed, accuracy } = pos.coords;
            const currentPos = [latitude, longitude];

            document.getElementById('accuracy-wrap').style.display = 'block';
            document.getElementById('accuracy-val').textContent = Math.round(accuracy);

            if (userMarker) {
                userMarker.setLatLng(currentPos);
            } else {
                userMarker = L.circleMarker(currentPos, {
                    radius: 8,
                    fillColor: '#6366f1',
                    color: '#fff',
                    weight: 2,
                    fillOpacity: 1
                }).addTo(map);
            }

            if (trackingPath.length > 0) {
                const prevPos = trackingPath[trackingPath.length - 1];
                const d = map.distance(prevPos, currentPos) / 1000; // returns meters, convert to km

                if (d > 0.005) { // 5 meter threshold
                    totalDistance += d;
                    trackingPath.push(currentPos);
                    trackingPolyline.setLatLngs(trackingPath);
                    map.panTo(currentPos);
                }
            } else {
                trackingPath.push(currentPos);
                map.setView(currentPos, 16);
            }

            document.getElementById('curr-speed').textContent = speed ? (speed * 3.6).toFixed(1) : '0.0';
            updateRealTimeStats();
        },
        (err) => console.error(err),
        { enableHighAccuracy: true }
    );

    timerInterval = setInterval(updateRealTimeStats, 1000);
}

function stopTracking() {
    if (!watchId) return;
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearInterval(timerInterval);
    document.getElementById('start-btn').style.display = 'flex';
    document.getElementById('stop-btn').style.display = 'none';
    document.getElementById('status-dot').classList.remove('active');
    document.getElementById('status-text').textContent = 'Tracking stopped';
    saveToHistory();
}

function saveToHistory() {
    const dist = parseFloat(document.getElementById('dist-val').textContent);
    if (dist < 0.1) return;
    const startLoc = document.getElementById('start-input').value || "Current Location";
    const endLoc = document.getElementById('end-input').value || "Trip End";
    const trip = {
        date: new Date().toLocaleString(),
        route: `${startLoc.split(',')[0]} → ${endLoc.split(',')[0]}`,
        distance: dist.toFixed(2),
        cost: document.getElementById('fuel-cost').textContent
    };
    let history = JSON.parse(localStorage.getItem('distTrackHistory') || '[]');
    history.unshift(trip);
    localStorage.setItem('distTrackHistory', JSON.stringify(history.slice(0, 5)));
    renderHistory();
}

function renderHistory() {
    const historyList = document.getElementById('history-list');
    const history = JSON.parse(localStorage.getItem('distTrackHistory') || '[]');
    if (history.length === 0) {
        historyList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">No history yet.</div>';
        return;
    }
    historyList.innerHTML = history.map(trip => `
        <div class="history-item">
            <div class="history-info">
                <div class="history-route">${trip.route}</div>
                <div class="history-meta">${trip.date} • Cost: ₹${trip.cost}</div>
            </div>
            <div class="history-dist">${trip.distance} km</div>
        </div>
    `).join('');
    lucide.createIcons();
}

function resetAll() {
    stopTracking();
    if (routingControl) map.removeControl(routingControl);
    trackingPolyline.setLatLngs([]);
    document.getElementById('start-input').value = '';
    document.getElementById('end-input').value = '';
    document.getElementById('manual-dist-input').value = '';
    document.getElementById('dist-val').textContent = '0.00';
    document.getElementById('time-val').textContent = '00:00';
    document.getElementById('speed-val').textContent = '0.0';
    document.getElementById('curr-speed').textContent = '0.0';
    document.getElementById('fuel-cost').textContent = '0.00';
    document.getElementById('status-text').textContent = 'Ready to track';
    routeDistance = 0;
    totalDistance = 0;
    updateDetailedCalculator();
}

// Event Listeners
document.getElementById('plan-btn').addEventListener('click', calculateRoute);
document.getElementById('start-btn').addEventListener('click', startTracking);
document.getElementById('stop-btn').addEventListener('click', stopTracking);
document.getElementById('reset-btn').addEventListener('click', resetAll);

['efficiency-input', 'price-input', 'tank-capacity', 'manual-dist-input'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateDetailedCalculator);
});

/**
 * Custom Autocomplete using Nominatim
 */
function setupCustomAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    let debounceTimer;

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = input.value;

        if (query.length < 3) {
            list.classList.remove('active');
            return;
        }

        debounceTimer = setTimeout(() => {
            fetchNominatimSuggestions(query, list, input);
        }, 400);
    });

    input.addEventListener('focus', () => {
        if (input.value.length === 0) {
            showRecentSearchSuggestions(list, input);
        }
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !list.contains(e.target)) {
            list.classList.remove('active');
        }
    });
}

async function fetchNominatimSuggestions(query, list, input) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`);
        const data = await response.json();

        if (!data || data.length === 0) {
            list.classList.remove('active');
            return;
        }

        renderSuggestions(data, list, input);
    } catch (error) {
        console.error("Autocomplete error:", error);
    }
}

function renderSuggestions(predictions, list, input) {
    list.innerHTML = '';
    list.classList.add('active');

    predictions.forEach(prediction => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';

        const mainText = prediction.display_name.split(',')[0];
        const subText = prediction.display_name.split(',').slice(1).join(',').trim();

        item.innerHTML = `
            <i data-lucide="map-pin"></i>
            <div class="suggestion-info">
                <div class="suggestion-main">${mainText}</div>
                <div class="suggestion-sub">${subText}</div>
            </div>
        `;

        item.addEventListener('click', () => {
            input.value = prediction.display_name;
            list.classList.remove('active');
            const latlng = [parseFloat(prediction.lat), parseFloat(prediction.lon)];
            map.setView(latlng, 15);

            if (userMarker) {
                // Keep marker logic separate or update as needed
            }
        });

        list.appendChild(item);
    });

    lucide.createIcons();
}

function showRecentSearchSuggestions(list, input) {
    const history = JSON.parse(localStorage.getItem('distTrackHistory') || '[]');
    let uniquePlaces = [...new Set(history.map(h => h.route.split('→')).flat().map(p => p.trim()))].filter(p => p && p !== "Current Location" && p !== "Trip End").slice(0, 5);

    let title = "Recent Places";
    let icon = "history";

    if (uniquePlaces.length === 0) {
        uniquePlaces = ["New Delhi, India", "Mumbai, India", "Bangalore, India", "Chennai, India"];
        title = "Recommended Places";
        icon = "star";
    }

    list.innerHTML = `<div style="padding: 10px 16px; font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; display: flex; align-items: center; gap: 8px;">
        <i data-lucide="${icon}" style="width: 12px; height: 12px;"></i>
        ${title}
    </div>`;
    list.classList.add('active');

    uniquePlaces.forEach(place => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.innerHTML = `
            <i data-lucide="map-pin"></i>
            <div class="suggestion-info">
                <div class="suggestion-main">${place}</div>
            </div>
        `;
        item.addEventListener('click', async () => {
            input.value = place;
            list.classList.remove('active');
            const data = await geocode(place);
            if (data) {
                map.setView([data.lat, data.lng], 12);
            }
        });
        list.appendChild(item);
    });

    lucide.createIcons();
}

// Global initialization
window.onload = initMap;
