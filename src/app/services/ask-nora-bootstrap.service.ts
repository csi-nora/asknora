import { Injectable } from '@angular/core';
import { StateService } from './state.service';
import { StorageService } from './storage.service';
import { SecretsYamlVaultService } from './secrets-yaml-vault.service';
import { RuntimeEnvironmentService } from './runtime-environment.service';
import { SECTORS } from '../data/sectors.data';
import { useBackendGateway } from '../utils/backend-llm-urls';

/**
 * Restores Ask Nora workspace from browser storage once per app load (avoids double-restore when navigating between `/ask-nora` and `/both/...`).
 */
@Injectable({ providedIn: 'root' })
export class AskNoraBootstrapService {
  private restored = false;

  constructor(
    private vault: SecretsYamlVaultService,
    private runtime: RuntimeEnvironmentService,
  ) {}

  restoreOnce(st: StateService, ss: StorageService): void {
    if (this.restored) {
      return;
    }
    this.restored = true;
    ss.loadPrefs();

    const cfg = ss.loadApiCfg();
    if (cfg) {
      st.patchApi(cfg);
    }
    if (ss.rememberKeys$.value) {
      const keys = ss.loadApiKeys();
      if (keys && Object.keys(keys).length) {
        st.patchApi({ keys });
      }
    }
    this.vault.applyYamlApiKeysToState();
    const docs = ss.loadDocs();
    if (docs.length) {
      st.setDocs(docs);
    }
    const audit = ss.loadAudit();
    if (audit.length) {
      st.setAudits(audit);
    }
    const sess = ss.loadSession();
    if (sess) {
      if (sess.role) {
        st.role.set(sess.role);
      }
      if (sess.sensitivity) {
        st.sensitivity.set(sess.sensitivity);
      }
      if (sess.useRag != null) {
        st.useRag.set(sess.useRag);
      }
      if (sess.ragConfig) {
        st.ragConfig.set(sess.ragConfig);
      }
      if (sess.sector && SECTORS[sess.sector]) {
        st.sector.set(sess.sector);
      }
      if (sess.messages?.length) {
        st.setMessages(sess.messages);
      }
    }
    st.alignActiveProviderToConfiguredKeys(useBackendGateway(this.runtime.effective()));
  }
}
