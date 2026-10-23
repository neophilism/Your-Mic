import handler from 'vinext/server/fetch-handler';
import {standaloneFetch} from '../lib/standalone';

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    return standaloneFetch(request, env, clean => handler.fetch(clean, env, ctx));
  },
};
