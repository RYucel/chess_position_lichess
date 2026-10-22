'use client';

import { useEffect } from 'react';
import { initProfileSync } from '@/lib/profile';
import { initPwa, registerServiceWorker } from '@/lib/pwa';

export function ClientBootstrap() {
  useEffect(() => {
    initPwa();
    initProfileSync();
    registerServiceWorker();

    if (navigator.storage?.persist) {
      void navigator.storage.persist().catch(() => undefined);
    }
  }, []);

  return null;
}
