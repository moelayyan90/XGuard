# XGuard Child Safety Enforcement SDK

The Child Safety API returns a control decision. The SDK turns that decision into host-application callbacks so a product can enforce protection in its own message, ad and video flows.

The SDK is intended for trusted server-side or backend-for-frontend code. **Do not expose an XGuard merchant API key in browser JavaScript or a mobile application binary.**

## Create a client

```ts
import { createChildSafetyClient } from "@xguard/sdk";

const safety = createChildSafetyClient({
  url: "https://xguardgate.com",
  apiKey: process.env.XGUARD_API_KEY!,
});
```

## Gate a message before delivery

```ts
const decision = await safety.scanAndEnforce(
  {
    eventId: message.id,
    riskSessionId: conversation.id,
    contentKind: "message",
    language: message.language,
    childLikely: recipient.isMinor,
    childAgeBand: recipient.ageBand,
    text: message.body,
    signals: ["new-contact", "adult-minor-age-gap"],
  },
  {
    onWarn: async () => showSafetyWarning(message.id),
    onBlock: async () => blockMessageDelivery(message.id),
    onFreezeConversation: async () => freezeConversation(conversation.id),
    onPreventFurtherContact: async () =>
      preventContact(sender.id, recipient.id),
    onHumanReview: async () => enqueueSafetyReview(message.id),
    onReportFlow: async () => surfaceReportingFlow(recipient.id),
    onPreserveEvidence: async () =>
      preserveEvidenceUnderYourRetentionPolicy(message.id),
  },
);
```

The host should call XGuard **before** releasing high-risk content to the child when latency and product architecture allow. If a product uses optimistic delivery, it should be able to revoke the item immediately when the decision is `BLOCK` or `FREEZE_CHAT`.

## Gate an advertisement

Send the ad text or a trusted media-classification description using `ad_text` or `image_description`. When the returned enforcement object contains `suppressAd: true`, remove the creative from the child-facing impression and send it to safety review.

## Gate video playback

The current endpoint accepts `video_transcript`. The host can scan transcripts and other derived safety signals before or during playback. A later raw-media pipeline can add sampled frames and audio classification. Until that pipeline is deployed, the SDK must not claim to inspect raw video bytes itself.

## Enforcement is explicit

The SDK never silently takes control of an unrelated third-party product. The integrating service supplies the callbacks that implement its own actions. This makes enforcement auditable and avoids turning XGuard into covert spyware.

## Fail behavior

A child-safety integration should choose its fail behavior deliberately:

- high-risk surfaces such as adult-to-minor direct messages can **fail closed** if XGuard is unavailable;
- lower-risk surfaces can queue content for review or delay delivery;
- never silently downgrade a known `CRITICAL` result to `ALLOW` because an enforcement callback failed.

The SDK exposes API errors to the host so the product can implement this policy explicitly.
