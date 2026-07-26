import { ApplicationConfig, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { appRoutes } from './app.routes';
import { environment } from '../environments/environment';
import { APP_ENVIRONMENT } from './tokens/environment.token';
import { StorageService } from './services/storage.service';
import { SecretsYamlVaultService } from './services/secrets-yaml-vault.service';
import { ExternalStorageService } from './services/external-storage.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(appRoutes),
    provideAnimations(),
    { provide: APP_ENVIRONMENT, useValue: environment },
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: (
        storage: StorageService,
        vault: SecretsYamlVaultService,
        external: ExternalStorageService,
      ) => () =>
        Promise.all([
          storage.hydrateIndexedDbFallback(),
          vault.hydrateFromStorage(),
          external.hydrateOnStartup(storage),
        ]),
      deps: [StorageService, SecretsYamlVaultService, ExternalStorageService],
    },
  ],
};
