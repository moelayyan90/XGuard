import XGuard from './live-entry.js';
import handler from './live-handler.js';
import { intelligenceSurface } from './intelligence/surface.js';

export * from './live-entry.js';

export default class PaidXGuard extends XGuard {
  fetch(request) {
    return intelligenceSurface(request, this.env, this.ctx, handler.fetch);
  }
}
