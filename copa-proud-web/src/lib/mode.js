// Modo demo escondido: todo lo que cuelga de /demo (sitio y links de veedor /demo/v/<token>)
// usa la competencia "<slug>-demo", que se arma con scripts/demo_competition.py.
// No está enlazado desde ningún lado y no se indexa. Se decide una sola vez al cargar la página.

export const DEMO_PREFIX = '/demo'

export const IS_DEMO =
  typeof window !== 'undefined' &&
  (window.location.pathname === DEMO_PREFIX || window.location.pathname.startsWith(`${DEMO_PREFIX}/`))

// basename del router: con /demo, NavLink "/fixture" → "/demo/fixture" sin tocar cada link.
export const ROUTER_BASENAME = IS_DEMO ? DEMO_PREFIX : undefined
