import { useEffect, useRef, useState } from "react";

type Candidate = { name: string; category: string; coords: [number, number] };
type MapPlace = {
  id: string;
  time: string;
  title: string;
  category: string;
  coords: [number, number];
  alternatives: Candidate[];
};

type FocusPoint = { coords: [number, number]; name: string; token: number } | null;

let googleMapsLoader: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps) return Promise.resolve();
  if (googleMapsLoader) return googleMapsLoader;

  googleMapsLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
  return googleMapsLoader;
}

export default function GoogleMapView({
  apiKey,
  places,
  selectedId,
  focusPoint,
  onSelect,
}: {
  apiKey: string;
  places: MapPlace[];
  selectedId: string;
  focusPoint: FocusPoint;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Record<string, google.maps.Marker>>({});
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const markers: google.maps.Marker[] = [];
    let directionsRenderer: google.maps.DirectionsRenderer | null = null;
    let fallbackRoute: google.maps.Polyline | null = null;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (disposed || !containerRef.current) return;
        const map = new google.maps.Map(containerRef.current, {
          center: { lat: 33.477, lng: 126.87 },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
          styles: [
            { featureType: "poi", elementType: "labels", stylers: [{ visibility: "simplified" }] },
            { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
          ],
        });
        mapRef.current = map;
        infoRef.current = new google.maps.InfoWindow();
        const bounds = new google.maps.LatLngBounds();

        places.forEach((place, index) => {
          bounds.extend({ lat: place.coords[0], lng: place.coords[1] });
          const marker = new google.maps.Marker({
            map,
            position: { lat: place.coords[0], lng: place.coords[1] },
            title: place.title,
            label: { text: String(index + 1), color: "#ffffff", fontWeight: "700", fontSize: "12px" },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: "#173f36",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
              scale: 16,
            },
            zIndex: 20,
          });
          marker.addListener("click", () => onSelect(place.id));
          markers.push(marker);
          markersRef.current[place.id] = marker;

          place.alternatives.forEach((candidate) => {
            bounds.extend({ lat: candidate.coords[0], lng: candidate.coords[1] });
            const candidateMarker = new google.maps.Marker({
              map,
              position: { lat: candidate.coords[0], lng: candidate.coords[1] },
              title: `${candidate.name} · 후보`,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: "#8d9993",
                fillOpacity: 0.9,
                strokeColor: "#ffffff",
                strokeWeight: 2,
                scale: 7,
              },
              zIndex: 5,
            });
            candidateMarker.addListener("click", () => {
              infoRef.current?.setContent(`<strong>${candidate.name}</strong><small>후보 · ${candidate.category}</small>`);
              infoRef.current?.open({ map, anchor: candidateMarker });
            });
            markers.push(candidateMarker);
          });
        });

        map.fitBounds(bounds, 70);

        const directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: true,
          preserveViewport: true,
          polylineOptions: { strokeColor: "#ef765f", strokeOpacity: 0.95, strokeWeight: 5 },
        });
        directionsService.route(
          {
            origin: { lat: places[0].coords[0], lng: places[0].coords[1] },
            destination: {
              lat: places[places.length - 1].coords[0],
              lng: places[places.length - 1].coords[1],
            },
            waypoints: places.slice(1, -1).map((place) => ({
              location: { lat: place.coords[0], lng: place.coords[1] },
              stopover: true,
            })),
            optimizeWaypoints: false,
            travelMode: google.maps.TravelMode.DRIVING,
          },
          (result, status) => {
            if (result && status === google.maps.DirectionsStatus.OK) {
              directionsRenderer?.setDirections(result);
              return;
            }
            fallbackRoute = new google.maps.Polyline({
              map,
              path: places.map((place) => ({ lat: place.coords[0], lng: place.coords[1] })),
              strokeColor: "#ef765f",
              strokeOpacity: 0.95,
              strokeWeight: 5,
            });
          },
        );
      })
      .catch(() => setErrorMessage("Google Maps API 키 또는 허용 도메인을 확인해주세요."));

    return () => {
      disposed = true;
      markers.forEach((marker) => marker.setMap(null));
      directionsRenderer?.setMap(null);
      fallbackRoute?.setMap(null);
      markersRef.current = {};
      mapRef.current = null;
    };
  }, [apiKey, onSelect, places, setErrorMessage]);

  useEffect(() => {
    const place = places.find((item) => item.id === selectedId);
    const map = mapRef.current;
    if (!place || !map) return;
    const coords = focusPoint?.coords ?? place.coords;
    map.panTo({ lat: coords[0], lng: coords[1] });
    map.setZoom(15);
    if (!focusPoint) {
      const marker = markersRef.current[place.id];
      infoRef.current?.setContent(`<strong>${place.title}</strong><small>${place.time} · ${place.category}</small>`);
      if (marker) infoRef.current?.open({ map, anchor: marker });
    }
  }, [selectedId, focusPoint, places]);

  return (
    <div className="google-map-shell">
      <div ref={containerRef} className="map-canvas" aria-label="Google Maps 여행 경로 지도" />
      {errorMessage && <div className="map-api-error">{errorMessage}</div>}
    </div>
  );
}
