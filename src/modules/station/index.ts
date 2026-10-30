// Kaylee Station's public surface: the route `src/App.tsx` mounts at `/station`, beside the workspace's routes. Lazy (defined
// once, in `lazyStationRoute`), so importing this barrel never pulls the station into the workspace's first load.
// Everything else in this module is private.
export { StationRoute } from '@/modules/station/lazyStationRoute';
