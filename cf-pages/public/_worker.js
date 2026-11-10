// Pages advanced-mode function: forward every request to the OpenNext worker
// over a service binding. Nothing is served from Pages itself.
export default {
  async fetch(request, env) {
    return env.APP.fetch(request);
  },
};
