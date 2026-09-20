/**
 * MealSync Frontend Configuration
 * Manages API endpoint connection between Vercel and Render (or Local Development)
 */
(function (root) {
  // 1. Check for manual override in localStorage (allows changing API without code changes)
  let storedApiUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('MEALSYNC_API_BASE_URL') : null;
  if (storedApiUrl && storedApiUrl.includes('mealsync-backend.onrender.com')) {
    storedApiUrl = null;
    localStorage.removeItem('MEALSYNC_API_BASE_URL');
  }

  // 2. Window-level injected variable (if specified via script or environment)
  const windowApiUrl = typeof window !== 'undefined' ? window.MEALSYNC_API_URL : null;

  // 3. Dynamic origin detection:
  // If running on localhost or 127.0.0.1, connect to local backend (http://localhost:3000)
  // If running on Vercel (aws-hackathon-six.vercel.app), connect to your Render host
  const isLocalHost = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || 
     window.location.hostname === '127.0.0.1' || 
     window.location.hostname === '0.0.0.0' || 
     !window.location.hostname);

  // Active production Render Backend URL
  const DEFAULT_PROD_API_URL = 'https://aws-hackathon-1.onrender.com';

  const activeApiBase = (storedApiUrl || windowApiUrl || (isLocalHost ? 'http://localhost:3000' : DEFAULT_PROD_API_URL)).replace(/\/+$/, '');

  root.MEALSYNC_CONFIG = {
    API_BASE_URL: activeApiBase,
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
