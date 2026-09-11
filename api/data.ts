import { createDataHandler } from './_lib/data.js';
import { getDeps } from './_lib/deps.js';

// Relative imports keep their .js extension: Vercel runs these files as unbundled ESM.
export default {
  fetch(request: Request): Promise<Response> {
    return createDataHandler(getDeps())(request);
  },
};
