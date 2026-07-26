import { InjectionToken } from '@angular/core';
import type { AppEnvironment } from '../models';

export const APP_ENVIRONMENT = new InjectionToken<AppEnvironment>('csi.nora.environment');
