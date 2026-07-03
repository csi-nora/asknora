import { Injectable, signal } from '@angular/core';
import { ProductExperience } from '../models';
import { StorageService } from './storage.service';

const LS_PRODUCT = 'csinora_product_mode' as const;

interface StoredProduct {
  v: ProductExperience;
}

/**
 * Persists the user's launcher choice (governance / ask-nora / both) via StorageService.
 */
@Injectable({ providedIn: 'root' })
export class ProductModeService {
  /** Last saved preference (null = never chosen or cleared). */
  readonly preference = signal<ProductExperience | null>(null);

  constructor(private storage: StorageService) {
    this.preference.set(this.read());
  }

  read(): ProductExperience | null {
    const row = this.storage.get<StoredProduct | null>(LS_PRODUCT, null);
    return row?.v ?? null;
  }

  save(mode: ProductExperience): void {
    this.storage.set(LS_PRODUCT, { v: mode });
    this.preference.set(mode);
  }

  clear(): void {
    this.storage.del(LS_PRODUCT);
    this.preference.set(null);
  }
}
