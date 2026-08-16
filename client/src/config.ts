const getApiUrlBase = () => {
  const isSecure = window.location.protocol === 'https:';
  const protocol = isSecure ? 'https:' : 'http:';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${protocol}//${window.location.hostname}:4000`;
  }
  return `${protocol}//${window.location.host}`;
};

const getSocketUrl = () => {
  const isSecure = window.location.protocol === 'https:';
  const protocol = isSecure ? 'wss:' : 'ws:';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${protocol}//${window.location.hostname}:4000`;
  }
  return `${protocol}//${window.location.host}`;
};

export const API_BASE_URL = getApiUrlBase();
export const WS_URL = getSocketUrl();
