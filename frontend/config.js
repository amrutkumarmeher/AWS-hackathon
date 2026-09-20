/**
 * MealSync Frontend Configuration
 * Routes every /api call to the Render backend (or an explicit override).
 */
(function (root) {
  const DEFAULT_PROD_API_URL = 'https://aws-hackathon-1.onrender.com';
  const LOCAL_API_URL = 'http://localhost:3000';

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  if (params && params.get('api')) {
    try {
      localStorage.setItem('MEALSYNC_API_BASE_URL', params.get('api').replace(/\/+$/, ''));
    } catch (e) {}
  }

  let storedApiUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('MEALSYNC_API_BASE_URL') : null;
  if (storedApiUrl && storedApiUrl.includes('mealsync-backend.onrender.com')) {
    storedApiUrl = null;
    try { localStorage.removeItem('MEALSYNC_API_BASE_URL'); } catch (e) {}
  }

  const windowApiUrl = typeof window !== 'undefined' ? window.MEALSYNC_API_URL : null;
  const isLocalHost = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
     window.location.hostname === '127.0.0.1' ||
     window.location.hostname === '0.0.0.0' ||
     !window.location.hostname);

  const forceLocal = params && (params.get('local') === '1' || params.get('api') === 'local');
  const useLocalBackend = forceLocal || (storedApiUrl && /localhost|127\.0\.0\.1/.test(storedApiUrl));

  const activeApiBase = (
    windowApiUrl ||
    (useLocalBackend ? (storedApiUrl && /localhost|127\.0\.0\.1/.test(storedApiUrl) ? storedApiUrl : LOCAL_API_URL) : (storedApiUrl || DEFAULT_PROD_API_URL))
  ).replace(/\/+$/, '');

  root.MEALSYNC_CONFIG = {
    API_BASE_URL: activeApiBase,
    DEFAULT_PROD_API_URL,
    LOCAL_API_URL,
    isLocal: isLocalHost,
    setApiBaseUrl: function (url) {
      if (!url) {
        localStorage.removeItem('MEALSYNC_API_BASE_URL');
      } else {
        localStorage.setItem('MEALSYNC_API_BASE_URL', url.trim().replace(/\/+$/, ''));
      }
      window.location.reload();
    },
    apiUrl: function (endpoint) {
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
      return `${this.API_BASE_URL}${cleanEndpoint}`;
    }
  };

  console.log(`[MealSync] API Target: ${root.MEALSYNC_CONFIG.API_BASE_URL}`);
})(typeof window !== 'undefined' ? window : this);
