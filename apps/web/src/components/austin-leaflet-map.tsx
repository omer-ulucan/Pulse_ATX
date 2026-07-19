"use client";

import type { LatLngExpression, PathOptions } from "leaflet";
import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  ZoomControl,
} from "react-leaflet";

import type { DashboardIncident } from "../lib/dashboard-data";

const AUSTIN_CENTER: LatLngExpression = [30.2672, -97.7431];
const CYAN = "#38BDF8";
const AMBER = "#FFB020";
const RED = "#FF5A5F";
const INK = "#F2EFEA";

export interface AnalyzingMapSignal {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
}

export interface AustinLeafletMapProps {
  analyzingSignals: AnalyzingMapSignal[];
  incidents: DashboardIncident[];
  onSelectIncident: (incidentId: string) => void;
  selectedIncidentId: string | null;
}

function severityStyle(
  severity: number | null,
  selected: boolean,
): PathOptions {
  const high = (severity ?? 0) >= 4;
  const moderate = severity === 3;
  const fillColor = high ? RED : moderate ? AMBER : CYAN;
  return {
    className: high
      ? "map-marker map-marker--high"
      : moderate
        ? "map-marker map-marker--moderate"
        : "map-marker map-marker--low",
    color: selected ? INK : fillColor,
    fillColor,
    fillOpacity: high ? 0.88 : moderate ? 0.64 : 0.58,
    opacity: 1,
    weight: selected ? 3 : 2,
  };
}

function MapViewport({
  points,
  selectedPoint,
}: {
  points: [number, number][];
  selectedPoint: [number, number] | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (selectedPoint) {
      map.flyTo(selectedPoint, Math.max(map.getZoom(), 13), {
        duration: 0.55,
      });
      return;
    }
    if (points.length === 1 && points[0]) {
      map.setView(points[0], 13);
      return;
    }
    if (points.length > 1) {
      map.fitBounds(points, {
        animate: true,
        maxZoom: 13,
        padding: [72, 72],
      });
    }
  }, [map, points, selectedPoint]);

  return null;
}

export function AustinLeafletMap({
  analyzingSignals,
  incidents,
  onSelectIncident,
  selectedIncidentId,
}: AustinLeafletMapProps) {
  const locatedIncidents = useMemo(
    () =>
      incidents.filter(
        (
          incident,
        ): incident is DashboardIncident & {
          latitude: number;
          longitude: number;
        } => incident.latitude !== null && incident.longitude !== null,
      ),
    [incidents],
  );
  const points = useMemo<[number, number][]>(
    () => [
      ...locatedIncidents.map((incident): [number, number] => [
        incident.latitude,
        incident.longitude,
      ]),
      ...analyzingSignals.map((signal): [number, number] => [
        signal.latitude,
        signal.longitude,
      ]),
    ],
    [analyzingSignals, locatedIncidents],
  );
  const selectedPoint = useMemo<[number, number] | null>(() => {
    const incident = locatedIncidents.find(
      (item) => item.id === selectedIncidentId,
    );
    return incident ? [incident.latitude, incident.longitude] : null;
  }, [locatedIncidents, selectedIncidentId]);

  return (
    <MapContainer
      center={AUSTIN_CENTER}
      className="pulse-atx-leaflet"
      preferCanvas
      scrollWheelZoom
      zoom={11}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        maxZoom={20}
        subdomains="abcd"
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <ZoomControl position="bottomright" />
      <MapViewport points={points} selectedPoint={selectedPoint} />

      {analyzingSignals.map((signal) => (
        <CircleMarker
          center={[signal.latitude, signal.longitude]}
          key={signal.id}
          pathOptions={{
            className: "map-marker map-marker--analyzing",
            color: AMBER,
            dashArray: "3 4",
            fillColor: AMBER,
            fillOpacity: 0.34,
            weight: 3,
          }}
          radius={9}
        >
          <Popup>
            <p className="map-popup__state map-popup__state--analyzing">
              ANALYZING
            </p>
            <p className="map-popup__title">{signal.title}</p>
          </Popup>
        </CircleMarker>
      ))}

      {locatedIncidents.map((incident) => {
        const selected = incident.id === selectedIncidentId;
        return (
          <CircleMarker
            center={[incident.latitude, incident.longitude]}
            eventHandlers={{ click: () => onSelectIncident(incident.id) }}
            key={incident.id}
            pathOptions={severityStyle(incident.severity, selected)}
            radius={selected ? 11 : 8}
          >
            <Popup>
              <p
                className={`map-popup__state ${
                  (incident.severity ?? 0) >= 4
                    ? "map-popup__state--critical"
                    : ""
                }`}
              >
                SEVERITY {incident.severity ?? "PENDING"}
              </p>
              <p className="map-popup__title">{incident.title}</p>
              <p className="map-popup__location">
                {incident.location_name ?? "Austin location pending"}
              </p>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
