/**
 * מערכת ניהול שיבוצים מעון הדס — API מאוחד לגרסת Vercel Hobby.
 * כל נתיבי ה-API מנותבים לפונקציית Serverless יחידה כדי להישאר מתחת
 * למגבלת 12 הפונקציות של החבילה החינמית.
 */
const routes = Object.freeze({
  'announcements': require('../handlers/announcements'),
  'attendance': require('../handlers/attendance'),
  'auth-change-password': require('../handlers/auth-change-password'),
  'auth-login': require('../handlers/auth-login'),
  'auth-logout': require('../handlers/auth-logout'),
  'auth-me': require('../handlers/auth-me'),
  'calendar': require('../lib/calendar-v027'),
  'config': require('../handlers/config'),
  'data': require('../handlers/data'),
  'daily-operations': require('../handlers/daily-operations'),
  'employees': require('../handlers/employees'),
  'feedback': require('../handlers/feedback'),
  'health': require('../handlers/health'),
  'notifications': require('../handlers/notifications'),
  'requests': require('../lib/requests-v026'),
  'settings': require('../handlers/settings'),
  'shifts': require('../lib/shifts-v027'),
  'suggestions': require('../lib/suggestions-v026'),
  'tasks': require('../handlers/tasks'),
});

function getRoute(req) {
  const queryRoute = Array.isArray(req.query?.route) ? req.query.route[0] : req.query?.route;
  if (queryRoute) return String(queryRoute).replace(/^\/+|\/+$/g, '');

  try {
    const pathname = new URL(req.url || '/', 'https://hadas.local').pathname;
    const match = pathname.match(/^\/api\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

module.exports = async function unifiedApiHandler(req, res) {
  const route = getRoute(req);
  const handler = routes[route];

  if (!handler) {
    res.status(404);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.end(JSON.stringify({ ok: false, error: 'נתיב API לא נמצא' }));
  }

  return handler(req, res);
};

module.exports.routes = routes;
module.exports.getRoute = getRoute;
