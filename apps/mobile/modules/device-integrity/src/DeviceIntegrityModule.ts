import { NativeModule, requireNativeModule } from 'expo';

import type { DeviceIntegrityModuleEvents, NativeIntegrityReport } from './DeviceIntegrity.types';

declare class DeviceIntegrityModule extends NativeModule<DeviceIntegrityModuleEvents> {
  getReport(blockedPackages: string[]): Promise<NativeIntegrityReport>;
  setSecure(enabled: boolean): boolean;
  isSecure(): boolean;
  startCaptureWatch(): boolean;
  stopCaptureWatch(): boolean;
}

export default requireNativeModule<DeviceIntegrityModule>('DeviceIntegrity');
