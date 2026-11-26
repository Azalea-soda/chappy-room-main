export default {
  async fetch(request, env) {
    const allowedAdminOrigin = "https://chappy-memory-admin-test.pages.dev";
    const requestOrigin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const isAdminRoute = path.startsWith("/admin/");
    const cors = {
      "Access-Control-Allow-Origin": isAdminRoute ? allowedAdminOrigin : "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...(isAdminRoute ? { "Vary": "Origin" } : {}),
    };
    const headers = {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
    };
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });

    // Admin preflight and actual requests are restricted to the test Cloudflare Pages origin.
    if (isAdminRoute && requestOrigin !== allowedAdminOrigin) {
      return new Response(
        request.method === "OPTIONS" ? null : JSON.stringify({ error: "管理画面の接続元が許可されていません" }),
        {
          status: 403,
          headers: isAdminRoute ? { "Vary": "Origin", "Content-Type": "application/json; charset=utf-8" } : headers,
        }
      );
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: cors });
    }

    try {
      if (!env.DB) return json({ error: "D1データベースが未設定です" }, 500);
      const body = await request.json();
      const now = () => new Date().toISOString();
      const validText = (v, max = 10000) =>
        typeof v === "string" && v.trim().length > 0 && v.length <= max;
      const validStatus = (v) => ["継続中", "終了", "取り消し"].includes(v);
      const hashToken = async (token) => {
        const bytes = new TextEncoder().encode(token);
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, "0")).join("");
      };
      const createToken = () => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      };

      // Limit failed password attempts per Cloudflare client IP.
      const checkAdminPassword = async (password) => {
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS admin_login_attempts (ip_hash TEXT PRIMARY KEY, window_started_at TEXT NOT NULL, attempts INTEGER NOT NULL, blocked_until TEXT)"
        ).run();
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashToken("admin-login:" + ip);
        const timestamp = now();
        const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const blocked = await env.DB.prepare(
          "SELECT blocked_until FROM admin_login_attempts WHERE ip_hash = ? AND blocked_until > ?"
        ).bind(ipHash, timestamp).first();
        if (blocked) return { ok: false, limited: true };

        const supplied = typeof password === "string" ? password : "";
        const expected = env.CHAPPY_ADMIN_PASSWORD;
        const suppliedHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied));
        const expectedHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected));
        const a = new Uint8Array(suppliedHash);
        const b = new Uint8Array(expectedHash);
        let difference = 0;
        for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
        if (difference === 0 && typeof password === "string") {
          await env.DB.prepare("DELETE FROM admin_login_attempts WHERE ip_hash = ?").bind(ipHash).run();
          return { ok: true, limited: false };
        }

        const blockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await env.DB.prepare(
          "INSERT INTO admin_login_attempts (ip_hash, window_started_at, attempts, blocked_until) VALUES (?, ?, 1, NULL) " +
          "ON CONFLICT(ip_hash) DO UPDATE SET " +
          "attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END, " +
          "blocked_until = CASE WHEN window_started_at <= ? THEN NULL WHEN attempts + 1 >= 5 THEN ? ELSE blocked_until END, " +
          "window_started_at = CASE WHEN window_started_at <= ? THEN ? ELSE window_started_at END"
        ).bind(ipHash, timestamp, cutoff, cutoff, blockedUntil, cutoff, timestamp).run();
        const status = await env.DB.prepare(
          "SELECT attempts, blocked_until FROM admin_login_attempts WHERE ip_hash = ?"
        ).bind(ipHash).first();
        return { ok: false, limited: !!status?.blocked_until && status.blocked_until > timestamp };
      };

      const nextId = async (series, prefix) => {
        const table = series === "mother" ? "mother_memories" :
          series === "chappy" ? "chappy_profile" : "fixed_rules";
        const idNumberStart = series === "fixed" ? 3 : 2;
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS id_counters (series TEXT PRIMARY KEY, last_number INTEGER NOT NULL)"
        ).run();
        await env.DB.prepare(
          "INSERT OR IGNORE INTO id_counters (series, last_number) SELECT ?, COALESCE(MAX(CAST(SUBSTR(id, " +
          idNumberStart + ") AS INTEGER)), 0) FROM " + table
        ).bind(series).run();
        const row = await env.DB.prepare(
          "UPDATE id_counters SET last_number = last_number + 1 WHERE series = ? RETURNING last_number"
        ).bind(series).first();
        if (!row) throw new Error("ID採番に失敗しました");
        return prefix + String(row.last_number).padStart(3, "0");
      };

      // Admin routes are isolated from device-token authentication.
      if (path === "/admin/login") {
        if (!env.CHAPPY_ADMIN_PASSWORD) {
          return json({ error: "管理者パスワードが未設定です" }, 500);
        }
        const passwordCheck = await checkAdminPassword(body.password);
        if (!passwordCheck.ok) {
          return json({
            error: passwordCheck.limited
              ? "入力回数が上限に達しました。15分後にもう一度お試しください"
              : "管理者パスワードが違います",
          }, passwordCheck.limited ? 429 : 401);
        }
        const token = createToken();
        const timestamp = now();
        const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          "INSERT INTO admin_sessions (id, token_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)"
        ).bind(crypto.randomUUID(), await hashToken(token), timestamp, expiresAt).run();
        return json({ success: true, adminToken: token, expiresAt });
      }

      const requireAdmin = async () => {
        const auth = request.headers.get("Authorization") || "";
        if (!auth.startsWith("Bearer ")) return false;
        const token = auth.slice(7).trim();
        if (!token) return false;
        const tokenHash = await hashToken(token);
        const session = await env.DB.prepare(
          "SELECT id FROM admin_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?"
        ).bind(tokenHash, now()).first();
        return session || false;
      };

      if (path === "/admin/logout") {
        const session = await requireAdmin();
        if (!session) return json({ error: "管理者認証の有効期限が切れています" }, 401);
        const auth = request.headers.get("Authorization") || "";
        const tokenHash = await hashToken(auth.slice(7).trim());
        const revoked = await env.DB.prepare(
          "UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL"
        ).bind(now(), tokenHash).run();
        if ((revoked.meta?.changes ?? 0) < 1) {
          return json({ error: "ログアウト処理を確認できませんでした" }, 409);
        }
        return json({ success: true });
      }

      if (path === "/admin/records") {
        if (!(await requireAdmin())) {
          return json({ error: "管理者認証の有効期限が切れています" }, 401);
        }
        const rooms = {
          mother_memories: { table: "mother_memories", series: "mother", prefix: "M" },
          chappy_profile: { table: "chappy_profile", series: "chappy", prefix: "C" },
          fixed_rules: { table: "fixed_rules", series: "fixed", prefix: "FR" },
        };
        const room = rooms[body.room];
        if (!room) return json({ error: "管理対象が正しくありません" }, 400);
        const table = room.table;
        const hasDrawer = table !== "fixed_rules";

        if (body.action === "list") {
          const columns = hasDrawer
            ? "id, category, drawer_name, content, created_at, updated_at, status"
            : "id, category, content, created_at, updated_at, status";
          const order = hasDrawer
            ? "category ASC, drawer_name ASC, created_at ASC"
            : "created_at ASC";
          const result = await env.DB.prepare(
            "SELECT " + columns + " FROM " + table + " ORDER BY " + order
          ).all();
          return json({ success: true, records: result.results || [] });
        }

        if (body.action === "create") {
          if (!validText(body.category, 100) || (hasDrawer && !validText(body.drawer_name, 200)) ||
              !validText(body.content)) {
            return json({ error: "大分類・引き出し名・内容が正しくありません" }, 400);
          }
          const id = await nextId(room.series, room.prefix);
          const timestamp = now();
          if (hasDrawer) {
            await env.DB.prepare(
              "INSERT INTO " + table +
              " (id, category, drawer_name, content, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, '継続中')"
            ).bind(id, body.category.trim(), body.drawer_name.trim(), body.content.trim(), timestamp, timestamp).run();
          } else {
            await env.DB.prepare(
              "INSERT INTO " + table +
              " (id, category, content, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, '継続中')"
            ).bind(id, body.category.trim(), body.content.trim(), timestamp, timestamp).run();
          }
          return json({ success: true, id });
        }

        if (body.action === "update") {
          if (!validText(body.id, 100) || !validText(body.category, 100) ||
              (hasDrawer && !validText(body.drawer_name, 200)) || !validText(body.content)) {
            return json({ error: "ID・大分類・引き出し名・内容が正しくありません" }, 400);
          }
          const result = hasDrawer
            ? await env.DB.prepare(
                "UPDATE " + table + " SET category = ?, drawer_name = ?, content = ?, updated_at = ? WHERE id = ?"
              ).bind(body.category.trim(), body.drawer_name.trim(), body.content.trim(), now(), body.id).run()
            : await env.DB.prepare(
                "UPDATE " + table + " SET category = ?, content = ?, updated_at = ? WHERE id = ?"
              ).bind(body.category.trim(), body.content.trim(), now(), body.id).run();
          const changes = result.meta?.changes ?? 0;
          if (changes < 1) return json({ error: "指定された記録がありません" }, 404);
          return json({ success: true, changes });
        }

        if (body.action === "append") {
          if (!validText(body.id, 100) || !validText(body.content)) {
            return json({ error: "IDまたは追加内容が正しくありません" }, 400);
          }
          const existing = await env.DB.prepare(
            "SELECT content FROM " + table + " WHERE id = ?"
          ).bind(body.id).first();
          if (!existing) return json({ error: "指定された記録がありません" }, 404);
          await env.DB.prepare(
            "UPDATE " + table + " SET content = ?, updated_at = ? WHERE id = ?"
          ).bind(existing.content + "\n" + body.content.trim(), now(), body.id).run();
          return json({ success: true });
        }

        if (body.action === "status") {
          if (!validText(body.id, 100) || !validStatus(body.status)) {
            return json({ error: "IDまたは状態が正しくありません" }, 400);
          }
          const result = await env.DB.prepare(
            "UPDATE " + table + " SET status = ?, updated_at = ? WHERE id = ?"
          ).bind(body.status, now(), body.id).run();
          const changes = result.meta?.changes ?? 0;
          if (changes < 1) return json({ error: "指定された記録がありません" }, 404);
          return json({ success: true, changes });
        }

        if (body.action === "delete") {
          if (!validText(body.id, 100)) return json({ error: "IDが正しくありません" }, 400);
          const result = await env.DB.prepare(
            "DELETE FROM " + table + " WHERE id = ?"
          ).bind(body.id).run();
          const changes = result.meta?.changes ?? 0;
          if (changes < 1) return json({ error: "指定された記録がありません" }, 404);
          return json({ success: true, changes });
        }
        return json({ error: "不明な操作です" }, 400);
      }

      // Device authentication
      const requireDevice = async () => {
        const auth = request.headers.get("Authorization") || "";
        if (!auth.startsWith("Bearer ")) return false;
        const token = auth.slice(7).trim();
        if (!token) return false;
        const tokenHash = await hashToken(token);
        const device = await env.DB.prepare(
          "SELECT id FROM device_tokens WHERE token_hash = ? AND revoked_at IS NULL"
        ).bind(tokenHash).first();
        return !!device;
      };

      if (path === "/enroll") {
        if (!env.CHAPPY_ADMIN_PASSWORD) {
          return json({ error: "管理者パスワードが未設定です" }, 500);
        }
        const passwordCheck = await checkAdminPassword(body.password);
        if (!passwordCheck.ok) {
          return json({
            error: passwordCheck.limited
              ? "入力回数が上限に達しました。15分後にもう一度お試しください"
              : "管理者パスワードが違います",
          }, passwordCheck.limited ? 429 : 401);
        }
        const token = createToken();
        const tokenHash = await hashToken(token);
        const label = validText(body.label, 100) ? body.label.trim() : "チャッピー端末";
        await env.DB.prepare(
          "INSERT INTO device_tokens (id, token_hash, created_at, revoked_at, label) VALUES (?, ?, ?, NULL, ?)"
        ).bind(crypto.randomUUID(), tokenHash, now(), label).run();
        return json({ success: true, token, message: "端末登録が完了しました" });
      }

      if (!(await requireDevice())) {
        return json({ error: "端末認証に失敗しました" }, 401);
      }

      const handleRecords = async (table, series, resultKey) => {
        if (body.action === "list") {
          const result = await env.DB.prepare(
            "SELECT id, category, drawer_name, content, created_at, updated_at, status FROM " +
            table + " ORDER BY category ASC, drawer_name ASC, created_at ASC"
          ).all();
          return json({ success: true, [resultKey]: result.results || [] });
        }
        if (body.action === "create") {
          if (!validText(body.category, 100) || !validText(body.drawer_name, 200) ||
              !validText(body.content)) {
            return json({ error: "大分類・引き出し名・記憶内容が正しくありません" }, 400);
          }
          const prefix = series === "mother" ? "M" : "C";
          const id = await nextId(series, prefix);
          const timestamp = now();
          await env.DB.prepare(
            "INSERT INTO " + table +
            " (id, category, drawer_name, content, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, '継続中')"
          ).bind(id, body.category.trim(), body.drawer_name.trim(), body.content.trim(), timestamp, timestamp).run();
          return json({ success: true, id });
        }
        if (body.action === "status") {
          if (!validText(body.id, 50) || !validStatus(body.status)) {
            return json({ error: "IDまたは状態が正しくありません" }, 400);
          }
          const result = await env.DB.prepare(
            "UPDATE " + table + " SET status = ?, updated_at = ? WHERE id = ?"
          ).bind(body.status, now(), body.id).run();
          return json({ success: true, changes: result.meta?.changes ?? 0 });
        }
        if (body.action === "append") {
          if (!validText(body.id, 50) || !validText(body.content)) {
            return json({ error: "IDまたは追加内容が正しくありません" }, 400);
          }
          const existing = await env.DB.prepare(
            "SELECT content FROM " + table + " WHERE id = ?"
          ).bind(body.id).first();
          if (!existing) return json({ error: "指定された記録がありません" }, 404);
          await env.DB.prepare(
            "UPDATE " + table + " SET content = ?, updated_at = ? WHERE id = ?"
          ).bind(existing.content + "\n" + body.content.trim(), now(), body.id).run();
          return json({ success: true });
        }
        return json({ error: "不明な操作です" }, 400);
      };

      // Memory extraction prompt preview only. This route does not call Workers AI or write to D1.
      if (path === "/memory-extract-preview" || path === "/memory-extract-test") {
        const runModel = path === "/memory-extract-test";
        if (!validText(body.conversation, 12000)) {
          return json({ error: "記憶抽出の対象となる会話文がありません（12,000文字以内）" }, 400);
        }

        const [rulesResult, profileResult, memoriesResult] = await Promise.all([
          env.DB.prepare(
            "SELECT id, category, content FROM fixed_rules WHERE status = '継続中' ORDER BY created_at ASC"
          ).all(),
          env.DB.prepare(
            "SELECT id, category, drawer_name, content FROM chappy_profile WHERE status = '継続中' ORDER BY category ASC, drawer_name ASC, created_at ASC"
          ).all(),
          env.DB.prepare(
            "SELECT id, category, drawer_name, content FROM mother_memories WHERE status = '継続中' ORDER BY category ASC, drawer_name ASC, created_at ASC"
          ).all()
        ]);
        const fixedRules = rulesResult.results || [];
        const chappyProfile = profileResult.results || [];
        const memories = memoriesResult.results || [];

        const systemPrompt = [
          "あなたは会話内容から、お母さんについて長く役立つ記憶候補を抽出する補助AIです。",
          "最優先ルール：会話の文脈と本人の気持ち・感情を大切にし、推測で事実を補わないこと。",
          "以下のD1固定ルールが記憶対象・分類・引き出し名の判断基準です。固定ルールを必ず読み、そこにない分類や引き出し名を勝手に作らないでください。",
          "既存記憶と照合し、候補を new（新規）, add（既存記憶への追加）, correction（訂正・更新）, duplicate（重複）, confirm（既存内容の再確認）に分類してください。",
          "訂正では最新の本人の明確な発言を優先し、古い記憶を黙って消さず、どの記録をどう更新する候補か示してください。",
          "会話に出た重要な出来事や初めての体験は、その出来事だけでなく、その時のお母さんの気持ち・感情も候補に含めてください。",
          "雑談の一時的な内容、チャッピーの発言、音声認識の誤りと疑われる語句を事実として登録しないでください。",
          "出力はJSONのみ。形式は {\"candidates\":[{\"type\":\"new|add|correction|duplicate|confirm\",\"category\":\"D1固定ルールに沿った大分類\",\"drawer_name\":\"既存または固定ルールに合う引き出し名\",\"content\":\"記憶内容。気持ち・感情を含める\",\"target_id\":null,\"reason\":\"短い判断理由\"}]}。該当なしなら {\"candidates\":[]}。",
          "まだ保存処理は行いません。候補を提案するだけです。"
        ].join("\n");

        const userPrompt = [
          "【チャッピーの固定ルール（基本方針・判断基準）】",
          JSON.stringify(fixedRules),
          "【チャッピー自身のプロフィール】",
          JSON.stringify(chappyProfile),
          "【お母さんについての既存記憶】",
          JSON.stringify(memories),
          "【今回のお母さんの会話】",
          body.conversation
        ].join("\n\n");

        if (runModel) {
          if (!env.AI || typeof env.AI.run !== "function") {
            return json({ error: "Workers AI binding（AI）が利用できません。推論は実行していません", modelCalled: false, d1WritePerformed: false }, 503);
          }
          try {
            const inference = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ],
              max_tokens: 2048,
              temperature: 0.1
            });
            const resultText = typeof inference?.response === "string"
              ? inference.response
              : JSON.stringify(inference);
            return json({
              success: true,
              previewOnly: true,
              model: "@cf/zai-org/glm-4.7-flash",
              modelCalled: true,
              d1WritePerformed: false,
              contextCounts: { fixedRules: fixedRules.length, chappyProfile: chappyProfile.length, memories: memories.length },
              resultText
            });
          } catch (error) {
            return json({
              error: "GLMの推論に失敗しました。自動再試行は行っていません",
              detail: String(error?.message || error).slice(0, 500),
              modelCalled: true,
              d1WritePerformed: false
            }, 502);
          }
        }

        return json({
          success: true,
          previewOnly: true,
          model: "@cf/zai-org/glm-4.7-flash",
          modelCalled: false,
          d1WritePerformed: false,
          contextCounts: { fixedRules: fixedRules.length, chappyProfile: chappyProfile.length, memories: memories.length },
          systemPrompt,
          userPrompt
        });
      }

      if (path === "/memories") {
        return await handleRecords("mother_memories", "mother", "memories");
      }
      if (path === "/chappy-profile") {
        return await handleRecords("chappy_profile", "chappy", "profile");
      }
      if (path === "/fixed-rules") {
        if (body.action !== "list") return json({ error: "不明な操作です" }, 400);
        const result = await env.DB.prepare(
          "SELECT id, category, content, created_at, updated_at, status FROM fixed_rules WHERE status = '継続中' ORDER BY created_at ASC"
        ).all();
        return json({ success: true, fixedRules: result.results || [] });
      }

      // Groq AI connection (JSON and SSE streaming)
      if (path === "/" || path === "/chat") {
        if (!env.GROQ_API_KEY) return json({ error: "GROQ_API_KEYが未設定です" }, 500);
        const contents = Array.isArray(body.contents) ? body.contents : [];
        const messages = contents.map((item) => {
          const role = item.role === "model" ? "assistant" :
            item.role === "system" ? "system" : "user";
          const content = Array.isArray(item.parts)
            ? item.parts.map((part) => typeof part.text === "string" ? part.text : "").join("")
            : "";
          return { role, content };
        }).filter((m) => m.content.trim() !== "");
        if (!messages.length) return json({ error: "送信するメッセージがありません" }, 400);
        const useStreaming = body.stream === true;
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + env.GROQ_API_KEY,
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b",
            messages,
            reasoning_effort: "low",
            include_reasoning: false,
            stream: useStreaming,
          }),
        });
        if (!response.ok) {
          const responseText = await response.text();
          let data;
          try { data = JSON.parse(responseText); } catch { data = { error: responseText }; }
          return json({ error: "Groq API Error", status: response.status, details: data }, response.status);
        }
        if (useStreaming) {
          if (!response.body) {
            return json({ error: "Groqからストリーミング本文を受信できませんでした" }, 502);
          }
          return new Response(response.body, {
            status: 200,
            headers: {
              ...cors,
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
            },
          });
        }
        const responseText = await response.text();
        let data;
        try { data = JSON.parse(responseText); } catch { data = { error: responseText }; }
        const reply = data?.choices?.[0]?.message?.content?.trim();
        if (!reply) return json({ error: "Groqの返答が空でした" }, 502);
        return json({
          candidates: [{
            content: { parts: [{ text: reply }], role: "model" },
            finishReason: "STOP",
          }],
        });
      }
      return json({ error: "指定されたURLは存在しません" }, 404);
    } catch (error) {
      console.error("Worker Error:", error);
      if (isAdminRoute) {
        return json({ error: "管理画面でエラーが発生しました。時間をおいて再度お試しください" }, 500);
      }
      return json({
        error: "Worker内部でエラーが発生しました",
        details: error.message,
      }, 500);
    }
  },
};
