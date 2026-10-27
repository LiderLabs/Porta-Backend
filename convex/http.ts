import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";

const http = httpRouter();

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return new Response("Webhook secret not configured", { status: 500 });
    }

    const svix_id = request.headers.get("svix-id");
    const svix_timestamp = request.headers.get("svix-timestamp");
    const svix_signature = request.headers.get("svix-signature");

    if (!svix_id || !svix_timestamp || !svix_signature) {
      return new Response("Missing svix headers", { status: 400 });
    }

    const payload = await request.text();
    const wh = new Webhook(webhookSecret);

    let event: { type: string; data: Record<string, unknown> };
    try {
      event = wh.verify(payload, {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      }) as typeof event;
    } catch {
      return new Response("Invalid webhook signature", { status: 400 });
    }

    const { type, data } = event;

    if (type === "user.created" || type === "user.updated") {
      const emailAddresses = data.email_addresses as { email_address: string }[];
      const primaryEmailId = data.primary_email_address_id as string;
      const primaryEmail = emailAddresses.find(
        (e) => (e as unknown as { id: string }).id === primaryEmailId
      );

      const metadata = data.public_metadata as { role?: string; orgId?: string } | undefined;
      const role = (metadata?.role ?? "employee") as
        | "admin"
        | "receptionist"
        | "employee";

      const firstName = (data.first_name as string) ?? "";
      const lastName = (data.last_name as string) ?? "";

      await ctx.runMutation(internal.users.upsertFromClerk, {
        clerkUserId: data.id as string,
        name: `${firstName} ${lastName}`.trim() || (primaryEmail?.email_address ?? "").split("@")[0],
        email: (primaryEmail?.email_address ?? "").toLowerCase().trim(),
        role,
        imageUrl: (data.image_url as string) ?? undefined,
        orgId: metadata?.orgId,
      });
    }

    if (type === "user.deleted") {
      await ctx.runMutation(internal.users.deleteByClerkId, {
        clerkUserId: data.id as string,
      });
    }


    if (type === "invitation.accepted") {
      const email = ((data.email_address as string) ?? "").toLowerCase().trim();
      if (email) {
        await ctx.runMutation(internal.invites.markAccepted, { email });
        const clerkUserId = (data.user_id as string) ?? "";
        if (clerkUserId) {
          await ctx.runMutation(internal.invites.linkClerkUserInternal, { clerkUserId, email });
        }
      }
    }
    return new Response(null, { status: 200 });
  }),
});

// ── WhatsApp Webhook: Verification (GET) ──────────────────────────────────────
http.route({
  path: "/whatsapp",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const configuredVerifyToken = process.env.WA_VERIFY_TOKEN;

    if (mode === "subscribe" && token && token === configuredVerifyToken) {
      console.log("[WhatsApp Webhook] Verification challenge passed.");
      return new Response(challenge ?? "", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    console.warn("[WhatsApp Webhook] Verification failed. Invalid verify_token or mode.");
    return new Response("Forbidden", { status: 403 });
  }),
});

// ── WhatsApp Webhook: Inbound Messages & Status Updates (POST) ────────────────
http.route({
  path: "/whatsapp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("x-hub-signature-256");
    const appSecret = process.env.WA_APP_SECRET;

    // Verify HMAC-SHA256 signature when WA_APP_SECRET is configured
    if (appSecret) {
      const { verifyMetaSignature } = await import("./whatsappUtils");
      const isValid = await verifyMetaSignature(rawBody, signatureHeader, appSecret);
      if (!isValid) {
        console.warn("[WhatsApp Webhook] Invalid X-Hub-Signature-256 rejected.");
        return new Response("Invalid signature", { status: 401 });
      }
    }

    // Heavy work is offloaded to the background scheduler to respond with 200 immediately
    await ctx.scheduler.runAfter(0, internal.whatsapp.processIncomingWebhook, {
      rawBody,
    });

    return new Response("OK", { status: 200 });
  }),
});

export default http;
