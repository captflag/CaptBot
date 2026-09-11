import { getDeps } from './_lib/deps.js';
import { createUsageHandler } from './_lib/handlers.js';

export default {
  fetch(request: Request): Promise<Response> {
    return createUsageHandler(getDeps())(request);
  },
};
