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

      const metadata = data.public_metadata as { role?: string } | undefined;
      const role = (metadata?.role ?? "employee") as
        | "admin"
        | "receptionist"
        | "employee";

      const firstName = (data.first_name as string) ?? "";
      const lastName = (data.last_name as string) ?? "";

      await ctx.runMutation(internal.users.upsertFromClerk, {
        clerkUserId: data.id as string,
        name: `${firstName} ${lastName}`.trim() || (primaryEmail?.email_address ?? "").split("@")[0],
        email: primaryEmail?.email_address ?? "",
        role,
        imageUrl: (data.image_url as string) ?? undefined,
      });
    }

    if (type === "user.deleted") {
      await ctx.runMutation(internal.users.deleteByClerkId, {
        clerkUserId: data.id as string,
      });
    }


    if (type === "invitation.accepted") {
      const email = (data.email_address as string) ?? "";
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

export default http;
