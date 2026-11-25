import previous from './live-entry.js';
import { intelligenceSurface } from './intelligence/surface.js';

// Keep deployed object classes and alarms readable by both sides of the cutover.
export * from './live-entry.js';
export default {
  scheduled: previous.scheduled,
  fetch(request,env,ctx) { return intelligenceSurface(request,env,ctx,previous.fetch); },
};
