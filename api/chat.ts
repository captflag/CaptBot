import { getDeps } from './_lib/deps.js';
import { createChatHandler } from './_lib/handlers.js';

// Relative imports keep their .js extension: Vercel runs these files as unbundled ESM.
export default {
  fetch(request: Request): Promise<Response> {
    return createChatHandler(getDeps())(request);
  },
};
