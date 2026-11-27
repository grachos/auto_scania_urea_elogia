export interface VehicleReading {
  vin: string;
  plate: string | null;
  name?: string | null;
  /** AdBlue / urea tank level in percent, null if unknown */
  ureaLevel: number | null;
  fuelLevel: number | null;
  /** ISO timestamp of the telematics snapshot */
  receivedAt: string | null;
  lat: number | null;
  lon: number | null;
  /** hrTotalVehicleDistance (metres) */
  odometerM: number | null;
}

export interface FleetSource {
  fetchReadings(): Promise<VehicleReading[]>;
}
