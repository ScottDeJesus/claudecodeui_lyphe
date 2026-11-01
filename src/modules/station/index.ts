// Kaylee Station's public surface: the layer `src/App.tsx` hands the workspace's route as its `stationLayer`, which draws the station over the workspace while
// the router stands at `/station`. It mounts the station's lazy chunk (defined once, in `lazyStationRoute`) on the first visit and keeps it mounted, so importing
// this barrel never pulls the station into the workspace's first load. Everything else in this module is private.
export { StationLayer } from '@/modules/station/StationLayer';
