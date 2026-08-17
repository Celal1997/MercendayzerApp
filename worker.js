export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // D1 test
    if (url.pathname === "/api/test") {
      const result = await env.DB
        .prepare("SELECT 1 AS ok")
        .first();

      return Response.json({
        success: true,
        database: result
      });
    }

    // Bütün yaddaşı oxu
    if (url.pathname === "/api/state" && request.method === "GET") {
      const rows = await env.DB
        .prepare("SELECT key, value, updated_at FROM app_state")
        .all();

      const state = {};

      for (const row of rows.results) {
        try {
          state[row.key] = JSON.parse(row.value);
        } catch {
          state[row.key] = row.value;
        }
      }

      return Response.json({
        success: true,
        state
      });
    }

    // Bir məlumatı yadda saxla
    if (url.pathname === "/api/state" && request.method === "POST") {
      try {
        const body = await request.json();

        if (!body.key) {
          return Response.json(
            { success: false, error: "key tələb olunur" },
            { status: 400 }
          );
        }

        const value = JSON.stringify(body.value ?? null);
        const now = Date.now();

        await env.DB
          .prepare(`
            INSERT INTO app_state (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key)
            DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `)
          .bind(body.key, value, now)
          .run();

        return Response.json({
          success: true,
          saved: body.key
        });
      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error.message
          },
          { status: 500 }
        );
      }
    }

    return new Response("Mercendayzer API işləyir");
  }
};
