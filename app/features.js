export const FEATURES = {
  crowd: {
    enabled: true,
    snapshotUrl: 'https://raw.githubusercontent.com/longchanp7-hub/sushi-fair-app/crowd-live/app/data/crowd.json',
    fallbackUrl: './data/crowd.json',
    requestTimeoutMs: 10000,
    refreshOnReturnAfterMs: 60000,
  },
};

export function crowdFeatureEnabled() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('crowd') === 'off') return false;
  return FEATURES.crowd.enabled;
}
