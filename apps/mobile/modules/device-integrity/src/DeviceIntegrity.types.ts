export type NativeIntegrityReport = {
  rooted: boolean;
  emulator: boolean;
  usbDebugging: boolean;
  developerMode: boolean;
  accessibilityServices: string[];
  /** Package ids from the list passed in that are installed (Android only). */
  remoteApps: string[];
  externalDisplays: number;
  headphones: boolean;
  multiWindow: boolean;
  hooked: boolean;
  sideloaded: boolean;
  screenCaptured?: boolean;
};

export type CaptureStatePayload = { recording: boolean };

export type DeviceIntegrityModuleEvents = {
  onCaptureState: (params: CaptureStatePayload) => void;
};
