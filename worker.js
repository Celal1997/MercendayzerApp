export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const json = (data, status = 200) =>
      Response.json(data, {
        status,
        headers: {
          "Cache-Control": "no-store"
        }
      });

    try {

      // ==================================================
      // D1 TEST
      // ==================================================
      if (url.pathname === "/api/test") {
        const result = await env.DB
          .prepare("SELECT 1 AS ok")
          .first();

        return json({
          success: true,
          database: result
        });
      }


      // ==================================================
      // LOGIN
      // ==================================================
      if (
        url.pathname === "/api/login" &&
        request.method === "POST"
      ) {
        const body = await request.json();

        const id = String(body.id || "").trim();
        const password = String(body.password || "");

        if (!id || !password) {
          return json({
            success: false,
            error: "İstifadəçi adı və şifrə tələb olunur"
          }, 400);
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
          return json({
            success: false,
            error: "İstifadəçi tapılmadı"
          }, 401);
        }

        if (!worker.active) {
          return json({
            success: false,
            error: "Bu işçi deaktiv edilib"
          }, 403);
        }

        if (String(worker.password) !== password) {
          return json({
            success: false,
            error: "Şifrə yanlışdır"
          }, 401);
        }

        return json({
          success: true,
          user: {
            id: worker.id,
            name: worker.name,
            role: "worker"
          }
        });
      }


      // ==================================================
      // STATISTICS
      // ==================================================
      if (
        url.pathname === "/api/stats" &&
        request.method === "GET"
      ) {

        const workers = await env.DB
          .prepare(`
            SELECT COUNT(*) AS c
            FROM workers
            WHERE active = 1
          `)
          .first();

        const stores = await env.DB
          .prepare(`
            SELECT COUNT(*) AS c
            FROM stores
            WHERE active = 1
          `)
          .first();

        const active = await env.DB
          .prepare(`
            SELECT COUNT(*) AS c
            FROM work_sessions
            WHERE status = 'active'
          `)
          .first();

        const gps = await env.DB
          .prepare(`
            SELECT COUNT(DISTINCT worker_id) AS c
            FROM gps_logs
            WHERE created_at >= datetime('now','-15 minutes')
          `)
          .first();

        const visits = await env.DB
          .prepare(`
            SELECT COUNT(*) AS c
            FROM visits
            WHERE date(start_time) = date('now')
          `)
          .first();

        return json({
          success: true,
          stats: {
            workers: Number(workers?.c || 0),
            stores: Number(stores?.c || 0),
            active: Number(active?.c || 0),
            gps: Number(gps?.c || 0),
            visits: Number(visits?.c || 0)
          }
        });
      }


      // ==================================================
      // WORKERS
      // ==================================================
      if (
        url.pathname === "/api/workers" &&
        request.method === "GET"
      ) {

        const result = await env.DB
          .prepare(`
            SELECT id, name, active, created_at
            FROM workers
            ORDER BY id
          `)
          .all();

        return json({
          success: true,
          workers: result.results || []
        });
      }


      // ==================================================
      // WORKER UPDATE
      // ==================================================
      if (
        url.pathname.startsWith("/api/workers/") &&
        request.method === "PUT"
      ) {

        const id = decodeURIComponent(
          url.pathname.split("/").pop()
        );

        const body = await request.json();

        if (body.password !== undefined) {
          await env.DB
            .prepare(`
              UPDATE workers
              SET password = ?
              WHERE id = ?
            `)
            .bind(
              String(body.password),
              id
            )
            .run();
        }

        if (body.active !== undefined) {
          await env.DB
            .prepare(`
              UPDATE workers
              SET active = ?
              WHERE id = ?
            `)
            .bind(
              body.active ? 1 : 0,
              id
            )
            .run();
        }

        return json({
          success: true
        });
      }


      // ==================================================
      // STORES - GET
      // ==================================================
      if (
        url.pathname === "/api/stores" &&
        request.method === "GET"
      ) {

        const result = await env.DB
          .prepare(`
            SELECT
              id,
              chain,
              name,
              latitude,
              longitude,
              radius,
              active
            FROM stores
            WHERE active = 1
            ORDER BY chain, name
          `)
          .all();

        return json({
          success: true,
          stores: result.results || []
        });
      }


      // ==================================================
      // STORE ADD
      // ==================================================
      if (
        url.pathname === "/api/stores" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        const id =
          String(body.id || crypto.randomUUID());

        const chain =
          String(body.chain || "").trim();

        const name =
          String(body.name || "").trim();

        if (!chain || !name) {
          return json({
            success: false,
            error: "Şəbəkə və mağaza adı tələb olunur"
          }, 400);
        }

        const latitude =
          body.latitude === "" ||
          body.latitude === null ||
          body.latitude === undefined
            ? null
            : Number(body.latitude);

        const longitude =
          body.longitude === "" ||
          body.longitude === null ||
          body.longitude === undefined
            ? null
            : Number(body.longitude);

        const radius =
          Number(body.radius || 500);

        await env.DB
          .prepare(`
            INSERT INTO stores
            (
              id,
              chain,
              name,
              latitude,
              longitude,
              radius,
              active
            )
            VALUES (?, ?, ?, ?, ?, ?, 1)
          `)
          .bind(
            id,
            chain,
            name,
            latitude,
            longitude,
            radius
          )
          .run();

        return json({
          success: true,
          id
        });
      }


      // ==================================================
      // STORE DELETE
      // ==================================================
      if (
        url.pathname.startsWith("/api/stores/") &&
        request.method === "DELETE"
      ) {

        const id = decodeURIComponent(
          url.pathname.split("/").pop()
        );

        await env.DB
          .prepare(`
            UPDATE stores
            SET active = 0
            WHERE id = ?
          `)
          .bind(id)
          .run();

        return json({
          success: true
        });
      }


      // ==================================================
      // ROUTES - GET
      // ==================================================
      if (
        url.pathname === "/api/routes" &&
        request.method === "GET"
      ) {

        const workerId =
          url.searchParams.get("worker_id");

        const day =
          url.searchParams.get("day");

        let sql = `
          SELECT
            ws.worker_id,
            ws.store_id,
            ws.day,
            s.chain,
            s.name,
            s.latitude,
            s.longitude,
            s.radius
          FROM worker_stores ws
          JOIN stores s
            ON s.id = ws.store_id
          WHERE s.active = 1
        `;

        const args = [];

        if (workerId) {
          sql += ` AND ws.worker_id = ?`;
          args.push(workerId);
        }

        if (day) {
          sql += ` AND ws.day = ?`;
          args.push(Number(day));
        }

        sql += `
          ORDER BY
            ws.worker_id,
            ws.day,
            s.chain,
            s.name
        `;

        const result =
          await env.DB.prepare(sql)
            .bind(...args)
            .all();

        return json({
  success: true,
  stores: result.results || [],
  routes: result.results || []
});
      }


      // ==================================================
      // ROUTE ADD
      // ==================================================
      if (
        url.pathname === "/api/routes" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        if (
          !body.worker_id ||
          !body.store_id ||
          !body.day
        ) {
          return json({
            success: false,
            error: "İşçi, mağaza və gün tələb olunur"
          }, 400);
        }

        await env.DB
          .prepare(`
            INSERT OR IGNORE INTO worker_stores
            (
              worker_id,
              store_id,
              day
            )
            VALUES (?, ?, ?)
          `)
          .bind(
            body.worker_id,
            body.store_id,
            Number(body.day)
          )
          .run();

        return json({
          success: true
        });
      }


      // ==================================================
      // ROUTE DELETE
      // ==================================================
      if (
        url.pathname === "/api/routes" &&
        request.method === "DELETE"
      ) {

        const body = await request.json();

        await env.DB
          .prepare(`
            DELETE FROM worker_stores
            WHERE worker_id = ?
              AND store_id = ?
              AND day = ?
          `)
          .bind(
            body.worker_id,
            body.store_id,
            Number(body.day)
          )
          .run();

        return json({
          success: true
        });
      }


      // ==================================================
      // WORK START
      // ==================================================
      if (
        url.pathname === "/api/work/start" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        const active =
          await env.DB
            .prepare(`
              SELECT id
              FROM work_sessions
              WHERE worker_id = ?
                AND status = 'active'
              LIMIT 1
            `)
            .bind(body.worker_id)
            .first();

        if (active) {
          return json({
            success: true,
            session_id: active.id,
            already: true
          });
        }

        const id = crypto.randomUUID();

        await env.DB
          .prepare(`
            INSERT INTO work_sessions
            (
              id,
              worker_id,
              start_time,
              start_lat,
              start_lng,
              status
            )
            VALUES (?, ?, ?, ?, ?, 'active')
          `)
          .bind(
            id,
            body.worker_id,
            new Date().toISOString(),
            body.latitude ?? null,
            body.longitude ?? null
          )
          .run();

        return json({
          success: true,
          session_id: id
        });
      }


      // ==================================================
      // WORK END
      // ==================================================
      if (
        url.pathname === "/api/work/end" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        const now =
          new Date(
            new Date().toLocaleString(
              "en-US",
              {
                timeZone: "Asia/Baku"
              }
            )
          );

        if (now.getHours() < 17) {
          return json({
            success: false,
            error:
              "İşi yalnız 17:00-dan sonra bitirmək olar"
          }, 400);
        }

        await env.DB
          .prepare(`
            UPDATE work_sessions
            SET
              end_time = ?,
              end_lat = ?,
              end_lng = ?,
              status = 'ended'
            WHERE worker_id = ?
              AND status = 'active'
          `)
          .bind(
            new Date().toISOString(),
            body.latitude ?? null,
            body.longitude ?? null,
            body.worker_id
          )
          .run();

        return json({
          success: true
        });
      }


      // ==================================================
      // ACTIVE WORK
      // ==================================================
      if (
        url.pathname === "/api/work/active" &&
        request.method === "GET"
      ) {

        const workerId =
          url.searchParams.get("worker_id");

        const result =
          await env.DB
            .prepare(`
              SELECT *
              FROM work_sessions
              WHERE worker_id = ?
                AND status = 'active'
              ORDER BY start_time DESC
              LIMIT 1
            `)
            .bind(workerId)
            .first();

        return json({
          success: true,
          session: result || null
        });
      }


      // ==================================================
      // VISIT START
      // ==================================================
      if (
        url.pathname === "/api/visits/start" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        const store =
          await env.DB
            .prepare(`
              SELECT *
              FROM stores
              WHERE id = ?
                AND active = 1
            `)
            .bind(body.store_id)
            .first();

        if (!store) {
          return json({
            success: false,
            error: "Mağaza tapılmadı"
          }, 404);
        }

        let distance = null;

        if (
          store.latitude != null &&
          store.longitude != null &&
          body.latitude != null &&
          body.longitude != null
        ) {
          distance = calculateDistance(
            Number(body.latitude),
            Number(body.longitude),
            Number(store.latitude),
            Number(store.longitude)
          );
        }

        if (
          distance != null &&
          distance > Number(store.radius || 500)
        ) {
          return json({
            success: false,
            error:
              `Mağazaya məsafə ${Math.round(distance)} m-dir. ` +
              `${store.radius || 500} m daxilində olmalısınız.`
          }, 400);
        }

        const id = crypto.randomUUID();

        await env.DB
          .prepare(`
            INSERT INTO visits
            (
              id,
              worker_id,
              store_id,
              session_id,
              start_time,
              start_lat,
              start_lng,
              distance_start,
              status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
          `)
          .bind(
            id,
            body.worker_id,
            body.store_id,
            body.session_id || null,
            new Date().toISOString(),
            body.latitude ?? null,
            body.longitude ?? null,
            distance
          )
          .run();

        return json({
          success: true,
          visit_id: id,
          distance
        });
      }


      // ==================================================
      // VISIT END
      // ==================================================
      if (
        url.pathname === "/api/visits/end" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        const visit =
          await env.DB
            .prepare(`
              SELECT
                v.*,
                s.latitude,
                s.longitude,
                s.radius
              FROM visits v
              JOIN stores s
                ON s.id = v.store_id
              WHERE v.id = ?
            `)
            .bind(body.visit_id)
            .first();

        if (!visit) {
          return json({
            success: false,
            error: "Ziyarət tapılmadı"
          }, 404);
        }

        let distance = null;

        if (
          visit.latitude != null &&
          visit.longitude != null &&
          body.latitude != null &&
          body.longitude != null
        ) {
          distance = calculateDistance(
            Number(body.latitude),
            Number(body.longitude),
            Number(visit.latitude),
            Number(visit.longitude)
          );
        }

        await env.DB
          .prepare(`
            UPDATE visits
            SET
              end_time = ?,
              end_lat = ?,
              end_lng = ?,
              distance_end = ?,
              status = 'ended'
            WHERE id = ?
          `)
          .bind(
            new Date().toISOString(),
            body.latitude ?? null,
            body.longitude ?? null,
            distance,
            body.visit_id
          )
          .run();

        return json({
          success: true,
          distance
        });
      }


      // ==================================================
      // ACTIVE VISIT
      // ==================================================
      if (
        url.pathname === "/api/visits/active" &&
        request.method === "GET"
      ) {

        const workerId =
          url.searchParams.get("worker_id");

        const result =
          await env.DB
            .prepare(`
              SELECT
                v.*,
                s.chain,
                s.name,
                s.latitude,
                s.longitude,
                s.radius
              FROM visits v
              JOIN stores s
                ON s.id = v.store_id
              WHERE v.worker_id = ?
                AND v.status = 'active'
              ORDER BY v.start_time DESC
              LIMIT 1
            `)
            .bind(workerId)
            .first();

        return json({
          success: true,
          visit: result || null
        });
      }


      // ==================================================
      // VISITS
      // ==================================================
      if (
        url.pathname === "/api/visits" &&
        request.method === "GET"
      ) {

        const workerId =
          url.searchParams.get("worker_id");

        const result =
          await env.DB
            .prepare(`
              SELECT
                v.*,
                w.name AS worker_name,
                s.chain,
                s.name AS store_name
              FROM visits v
              JOIN workers w
                ON w.id = v.worker_id
              JOIN stores s
                ON s.id = v.store_id
              WHERE (? IS NULL OR v.worker_id = ?)
              ORDER BY v.start_time DESC
              LIMIT 200
            `)
            .bind(
              workerId || null,
              workerId || null
            )
            .all();

        return json({
          success: true,
          visits: result.results || []
        });
      }


      // ==================================================
      // GPS SAVE
      // ==================================================
      if (
        url.pathname === "/api/gps" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        let distance = null;

        if (
          body.store_lat != null &&
          body.store_lng != null &&
          body.latitude != null &&
          body.longitude != null
        ) {
          distance = calculateDistance(
            Number(body.latitude),
            Number(body.longitude),
            Number(body.store_lat),
            Number(body.store_lng)
          );
        }

        await env.DB
          .prepare(`
            INSERT INTO gps_logs
            (
              worker_id,
              session_id,
              visit_id,
              latitude,
              longitude,
              accuracy,
              distance_from_store
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            body.worker_id,
            body.session_id || null,
            body.visit_id || null,
            Number(body.latitude),
            Number(body.longitude),
            body.accuracy ?? null,
            distance
          )
          .run();

        return json({
          success: true,
          distance
        });
      }


      // ==================================================
      // GPS GET
      // ==================================================
      if (
        url.pathname === "/api/gps" &&
        request.method === "GET"
      ) {

        const workerId =
          url.searchParams.get("worker_id");

        const result =
          await env.DB
            .prepare(`
              SELECT
                g.*,
                w.name
              FROM gps_logs g
              JOIN workers w
                ON w.id = g.worker_id
              WHERE (? IS NULL OR g.worker_id = ?)
              ORDER BY g.created_at DESC
              LIMIT 100
            `)
            .bind(
              workerId || null,
              workerId || null
            )
            .all();

        return json({
          success: true,
          gps: result.results || []
        });
      }


      // ==================================================
      // GPS ALERT
      // ==================================================
      if (
        url.pathname === "/api/gps-alert" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        await env.DB
          .prepare(`
            INSERT INTO gps_alerts
            (
              worker_id,
              visit_id,
              latitude,
              longitude,
              distance,
              message
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .bind(
            body.worker_id,
            body.visit_id || null,
            body.latitude ?? null,
            body.longitude ?? null,
            body.distance ?? null,
            body.message ||
              "500 m-dən kənardadır"
          )
          .run();

        return json({
          success: true
        });
      }


      // ==================================================
      // GPS ALERTS
      // ==================================================
      if (
        url.pathname === "/api/gps-alerts" &&
        request.method === "GET"
      ) {

        const result =
          await env.DB
            .prepare(`
              SELECT
                a.*,
                w.name
              FROM gps_alerts a
              JOIN workers w
                ON w.id = a.worker_id
              WHERE a.acknowledged = 0
              ORDER BY a.created_at DESC
              LIMIT 100
            `)
            .all();

        return json({
          success: true,
          alerts: result.results || []
        });
      }


      // ==================================================
      // PHOTOS - SAVE
      // ==================================================
      if (
        url.pathname === "/api/photos" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        await env.DB
          .prepare(`
            INSERT INTO visit_photos
            (
              visit_id,
              photo_url
            )
            VALUES (?, ?)
          `)
          .bind(
            body.visit_id,
            body.photo_url
          )
          .run();

        return json({
          success: true
        });
      }


      // ==================================================
      // PHOTOS - GET
      // ==================================================
      if (
        url.pathname === "/api/photos" &&
        request.method === "GET"
      ) {

        const visitId =
          url.searchParams.get("visit_id");

        const result =
          await env.DB
            .prepare(`
              SELECT *
              FROM visit_photos
              WHERE visit_id = ?
              ORDER BY id
            `)
            .bind(visitId)
            .all();

        return json({
          success: true,
          photos: result.results || []
        });
      }


      // ==================================================
      // PRODUCT CHECKS
      // ==================================================
      if (
        url.pathname === "/api/checks" &&
        request.method === "POST"
      ) {

        const body = await request.json();

        await env.DB
          .prepare(`
            INSERT INTO visit_checks
            (
              visit_id,
              product_name,
              checked
            )
            VALUES (?, ?, ?)
          `)
          .bind(
            body.visit_id,
            body.product_name || "",
            body.checked ? 1 : 0
          )
          .run();

        return json({
          success: true
        });
      }


      // ==================================================
      // PRODUCT CHECKS - GET
      // ==================================================
      if (
        url.pathname === "/api/checks" &&
        request.method === "GET"
      ) {

        const visitId =
          url.searchParams.get("visit_id");

        const result =
          await env.DB
            .prepare(`
              SELECT *
              FROM visit_checks
              WHERE visit_id = ?
              ORDER BY id
            `)
            .bind(visitId)
            .all();

        return json({
          success: true,
          checks: result.results || []
        });
      }


      // ==================================================
      // LEGACY STATE GET
      // ==================================================
      if (
        url.pathname === "/api/state" &&
        request.method === "GET"
      ) {

        const result =
          await env.DB
            .prepare(`
              SELECT
                key,
                value,
                updated_at
              FROM app_state
            `)
            .all();

        const state = {};

        for (
          const row of result.results || []
        ) {
          try {
            state[row.key] =
              JSON.parse(row.value);
          } catch {
            state[row.key] =
              row.value;
          }
        }

        return json({
          success: true,
          state
        });
      }


      // ==================================================
      // LEGACY STATE POST
      // ==================================================
      if (
        url.pathname === "/api/state" &&
        request.method === "POST"
      ) {

        const body =
          await request.json();

        if (!body.key) {
          return json({
            success: false,
            error: "key tələb olunur"
          }, 400);
        }

        const value =
          JSON.stringify(
            body.value ?? null
          );

        await env.DB
          .prepare(`
            INSERT INTO app_state
            (
              key,
              value,
              updated_at
            )
            VALUES (?, ?, ?)
            ON CONFLICT(key)
            DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `)
          .bind(
            body.key,
            value,
            Date.now()
          )
          .run();

        return json({
          success: true,
          saved: body.key
        });
      }


      // ==================================================
      // INDEX.HTML
      // ==================================================
      if (
        request.method === "GET" &&
        (
          url.pathname === "/" ||
          url.pathname === "/index.html"
        )
      ) {

        const githubUrl =
          "https://raw.githubusercontent.com/" +
          "Celal1997/MercendayzerApp/main/index.html";

        const response =
          await fetch(
            githubUrl,
            {
              headers: {
                "User-Agent":
                  "MercendayzerApp"
              }
            }
          );

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

        const html =
          await response.text();

        return new Response(
          html,
          {
            status: 200,
            headers: {
              "content-type":
                "text/html; charset=UTF-8",
              "cache-control":
                "no-cache, no-store, must-revalidate"
            }
          }
        );
      }


      // ==================================================
      // DEFAULT
      // ==================================================
      return json({
        success: false,
        error: "API route tapılmadı",
        path: url.pathname
      }, 404);

    } catch (error) {

      return json({
        success: false,
        error:
          error?.message ||
          String(error)
      }, 500);
    }
  }
};


// ==================================================
// DISTANCE CALCULATION
// ==================================================
function calculateDistance(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R = 6371000;

  const p =
    Math.PI / 180;

  const a =
    Math.sin(
      (lat2 - lat1) *
      p / 2
    ) ** 2
    +
    Math.cos(lat1 * p) *
    Math.cos(lat2 * p) *
    Math.sin(
      (lon2 - lon1) *
      p / 2
    ) ** 2;

  return (
    2 *
    R *
    Math.asin(
      Math.sqrt(a)
    )
  );
}
