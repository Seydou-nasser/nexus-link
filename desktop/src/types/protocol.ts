export interface ConnectedDevice {
  deviceId: string;
  deviceName: string;
  model: string;
  androidVersion: string;
  ipAddress: string;
  batteryLevel: number;
  isCharging: boolean;
  ringerMode: string;
  screenAwake: boolean;
  connectedAt: string;
}

export interface ServerStatus {
  deviceId: string;
  deviceName: string;
  localIps: string[];
  wsPort: number;
  udpPort: number;
  httpPort: number;
  pairingToken: string;
  qrSvg: string;
  qrRawJson: string;
  mdnsActive: boolean;
  wsListening: boolean;
  connectedDevice: ConnectedDevice | null;
}
