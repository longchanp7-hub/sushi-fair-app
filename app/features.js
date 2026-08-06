export const FEATURES = {
  crowd: {
    enabled: true,
    snapshotUrl: './data/crowd.json',
    requestTimeoutMs: 10000,
    refreshOnReturnAfterMs: 60000,
  },
};

export function crowdFeatureEnabled() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('crowd') === 'off') return false;
  return FEATURES.crowd.enabled;
}
