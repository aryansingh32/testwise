import { NativeModule, registerWebModule } from 'expo';

import type { DeviceIntegrityModuleEvents } from './DeviceIntegrity.types';

// Web has no native integrity checks; the server rejects web clients for proctored tests (requireNativeApp).
class DeviceIntegrityModule extends NativeModule<DeviceIntegrityModuleEvents> {}

export default registerWebModule(DeviceIntegrityModule, 'DeviceIntegrityModule');
