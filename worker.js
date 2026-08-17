export default {
  async fetch(request, env) {

    const url = new URL(request.url);

    // TEST
    if (url.pathname === "/api/test") {
      const result = await env.DB
        .prepare("SELECT 1 AS ok")
        .first();

      return Response.json({
        success: true,
        database: result
      });
    }

    return new Response("Mercendayzer API işləyir");
  }
};
