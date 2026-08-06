export const FEATURES = {
  crowd: {
    enabled: true,
    apiUrl: '',
    fallbackUrl: './data/crowd.json',
    requestTimeoutMs: 10000,
    refreshOnReturnAfterMs: 60000,
  },
};

export function resolveCrowdApiUrl() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('crowdApi');
  if (fromQuery) {
    try {
      const parsed = new URL(fromQuery);
      if (parsed.protocol === 'https:') localStorage.setItem('sushiCrowdApiUrl', parsed.href.replace(/\/$/, ''));
    } catch {}
  }
  return (localStorage.getItem('sushiCrowdApiUrl') || FEATURES.crowd.apiUrl || '').replace(/\/$/, '');
}

export function crowdFeatureEnabled() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('crowd') === 'off') return false;
  return FEATURES.crowd.enabled;
}
