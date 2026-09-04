export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ==========================================
    // D1 TEST
    // ==========================================
    if (url.pathname === "/api/test") {
      try {
        const result = await env.DB
          .prepare("SELECT 1 AS ok")
          .first();

        return Response.json({
          success: true,
          database: result
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

    // ==========================================
    // D1 - BÜTÜN MƏLUMATLARI OXU
    // ==========================================
    if (
      url.pathname === "/api/state" &&
      request.method === "GET"
    ) {
      try {
        const rows = await env.DB
          .prepare(
            "SELECT key, value, updated_at FROM app_state"
          )
          .all();

        const state = {};

        for (const row of rows.results || []) {
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

    // ==========================================
    // D1 - MƏLUMAT YAZ
    // ==========================================
    if (
      url.pathname === "/api/state" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        if (!body.key) {
          return Response.json(
            {
              success: false,
              error: "key tələb olunur"
            },
            { status: 400 }
          );
        }

        const value = JSON.stringify(
          body.value ?? null
        );

        const now = Date.now();

        await env.DB
          .prepare(`
            INSERT INTO app_state
              (key, value, updated_at)
            VALUES (?, ?, ?)

            ON CONFLICT(key)
            DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `)
          .bind(
            body.key,
            value,
            now
          )
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
    // ==========================================
    // LOGIN
    // ==========================================
    if (
      url.pathname === "/api/login" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const id = String(body.id || "").trim();
        const password = String(body.password || "");

        if (!id || !password) {
          return Response.json(
            {
              success: false,
              error: "İstifadəçi adı və şifrə tələb olunur"
            },
            { status: 400 }
          );
        }

        const worker = await env.DB
          .prepare(`
            SELECT id, name, password, active
            FROM workers
            WHERE id = ?
            LIMIT 1
          `)
          .bind(id)
          .first();

        if (!worker) {
          return Response.json(
            {
              success: false,
              error: "İstifadəçi tapılmadı"
            },
            { status: 401 }
          );
        }

        if (!worker.active) {
          return Response.json(
            {
              success: false,
              error: "Bu işçi deaktiv edilib"
            },
            { status: 403 }
          );
        }

        if (String(worker.password) !== password) {
          return Response.json(
            {
              success: false,
              error: "Şifrə yanlışdır"
            },
            { status: 401 }
          );
        }

        return Response.json({
          success: true,
          user: {
            id: worker.id,
            name: worker.name,
            role: "worker"
          }
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
    // ==========================================
    // INDEX.HTML
    // ==========================================
    if (
      request.method === "GET" &&
      (
        url.pathname === "/" ||
        url.pathname === "/index.html"
      )
    ) {
      try {
        const githubUrl =
          "https://raw.githubusercontent.com/" +
          "Celal1997/MercendayzerApp/main/index.html";

        const response = await fetch(githubUrl, {
          headers: {
            "User-Agent": "MercendayzerApp"
          }
        });

        if (!response.ok) {
          return new Response(
            "index.html GitHub-dan oxuna bilmədi. HTTP " +
            response.status,
            {
              status: 500,
              headers: {
                "content-type":
                  "text/plain; charset=UTF-8"
              }
            }
          );
        }

        const html = await response.text();

        return new Response(html, {
          status: 200,
          headers: {
            "content-type":
              "text/html; charset=UTF-8",
            "cache-control":
              "no-cache, no-store, must-revalidate"
          }
        });
      } catch (error) {
        return new Response(
          "index.html açılarkən xəta: " +
          error.message,
          {
            status: 500,
            headers: {
              "content-type":
                "text/plain; charset=UTF-8"
            }
          }
        );
      }
    }

    // ==========================================
    // DEFAULT
    // ==========================================
    return new Response(
      "Mercendayzer API işləyir",
      {
        headers: {
          "content-type":
            "text/plain; charset=UTF-8"
        }
      }
    );
  }
};
