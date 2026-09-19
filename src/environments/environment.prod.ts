export const environment = {
  production: true,
  // Get your own at https://console.cloud.google.com/ — see README.md
  // section 5 ("Setting up Google Drive"). Not required to run the app;
  // only the Google Drive document-upload/export features need it.
  googleClientId: 'PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE.apps.googleusercontent.com',
  // Relative, not an absolute host: the production build is served by the
  // frontend's own nginx container, which reverse-proxies /api and
  // /healthz to the backend container under this same origin (see
  // nginx.conf) — so the browser never needs to know the backend's
  // address, and there's no cross-origin request involved.
  apiBaseUrl: '',
};
