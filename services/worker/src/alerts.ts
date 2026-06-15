/**
 * Incident + Discord alerting for the signing worker. Incidents always land in
 * the DB (the admin incident log); the Discord webhook is best-effort and only
 * fires when DISCORD_ADMIN_WEBHOOK_URL is set.
 */
import { incidents } from "@trash-wars/db";
import type { AppContext } from "@trash-wars/api/core";

export async function raiseIncident(
  ctx: AppContext,
  kind: string,
  severity: "info" | "warning" | "critical",
  detail: Record<string, unknown>,
  webhookUrl?: string,
): Promise<void> {
  await ctx.db.insert(incidents).values({ kind, severity, detail });
  ctx.log.error({ kind, severity, detail }, "incident raised");
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: `🚨 **${severity.toUpperCase()}** \`${kind}\`\n\`\`\`json\n${JSON.stringify(
            detail,
            null,
            2,
          )}\n\`\`\``,
        }),
      });
    } catch (err) {
      ctx.log.warn({ err: String(err) }, "discord incident webhook failed (non-fatal)");
    }
  }
}

/** Best-effort plain Discord message (burn announcement drafts, etc.). */
export async function postDiscord(
  ctx: AppContext,
  webhookUrl: string | undefined,
  content: string,
): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    ctx.log.warn({ err: String(err) }, "discord webhook failed (non-fatal)");
  }
}
