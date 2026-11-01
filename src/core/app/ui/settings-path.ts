/** Settings is current on its index and on every path under it. */
export const inSettings = (pathname: string) => pathname === '/app/settings' || pathname.startsWith('/app/settings/');
