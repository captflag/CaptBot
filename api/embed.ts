import { getDeps } from './_lib/deps.js';
import { createEmbedHandler } from './_lib/handlers.js';

export default {
  fetch(request: Request): Promise<Response> {
    return createEmbedHandler(getDeps())(request);
  },
};
