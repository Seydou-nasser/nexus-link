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

export interface PendingPairingRequest {
  requestId: string;
  deviceId: string;
  deviceName: string;
  model: string;
  androidVersion: string;
  verificationCode: string;
}

export interface ClipboardHistoryEntry {
  content: string;
  source: string;
  timestamp: string;
}

export interface PhoneNotificationRecord {
  notificationKey: string;
  packageName: string;
  appName: string;
  title: string;
  text: string;
  canReply: boolean;
  actions: string[];
  iconBase64: string | null;
  timestamp: string;
}

export interface FileTransferRecord {
  fileId: string;
  fileName: string;
  fileSize: number;
  direction: "SENT" | "RECEIVED";
  status: "PENDING" | "COMPLETED" | "FAILED";
  savedPath: string | null;
  thumbnailBase64: string | null;
  timestamp: string;
}

export interface InputSettings {
  enabled: boolean;
  edge: "LEFT" | "RIGHT" | "BOTTOM";
  edgeResistanceMs: number;
  requireCtrl: boolean;
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
  pendingPairing: PendingPairingRequest | null;
  inputActiveTarget: "PC" | "ANDROID";
  inputSettings: InputSettings;
  mirrorState: "STOPPED" | "WAITING_PERMISSION" | "ACTIVE" | "ERROR";
  mirrorWidth: number;
  mirrorHeight: number;
  mirrorError: string | null;
}

export interface MediaFolderDto {
  bucketId: string;
  name: string;
  itemCount: number;
  photoCount: number;
  videoCount: number;
  coverMediaId: number;
  coverMediaType: "IMAGE" | "VIDEO";
  latestDateAdded: number;
}

export interface MediaItemDto {
  id: number;
  mediaType: "IMAGE" | "VIDEO";
  displayName: string;
  mimeType: string;
  size: number;
  dateAdded: number;
  width: number;
  height: number;
  durationMs: number;
  bucketId: string;
  bucketName: string;
}

export interface MediaPageResponse {
  items: MediaItemDto[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface FsShortcutDto {
  label: string;
  path: string;
}

export interface FsStorageInfoDto {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  hasAllFilesAccess: boolean;
  shortcuts: FsShortcutDto[];
}

export interface FsEntryDto {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  lastModified: number;
  extension: string;
  childCount: number;
}

export interface FsListResponse {
  currentPath: string;
  parentPath: string | null;
  entries: FsEntryDto[];
}
