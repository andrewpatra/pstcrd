// Shared email presentation. URLs are signed by the caller; never embed secrets here.
export const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const font = "'Roboto Serif', Georgia, 'Times New Roman', serif";
const createUrl = "https://www.pstcrd.art";
export function emailLayout(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#F3E0C4;color:#222;font-family:${font}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3E0C4"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border:1px solid #cdbb9f;background:#F3E0C4">
  <tr><td style="padding:32px 32px 12px;font-family:${font};font-size:25px;font-weight:bold;letter-spacing:2px">PSTCRD</td></tr>
  <tr><td style="padding:8px 32px 32px;font-family:${font};font-size:16px;line-height:1.6">${body}</td></tr>
  <tr><td style="padding:18px 32px 26px;border-top:1px solid #cdbb9f;color:#554b3e;font-family:${font};font-size:13px">
  <a href="${createUrl}" style="color:#222;text-decoration:underline;font-weight:600">Create Your Own</a>
  <div style="margin-top:8px">Sent through PSTCRD &middot; <a href="https://pstcrd.art" style="color:#554b3e">pstcrd.art</a></div>
  </td></tr></table></td></tr></table></body></html>`;
}
export function actionLink(url: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="color:#222;text-decoration:underline;font-family:${font};font-weight:600">${escapeHtml(label)}</a></p>`;
}
export function postcardEmail(args: {senderName: string; messageText: string; videoUrl: string; posterUrl: string; videoMimeType: string}): {html:string; text:string} {
  const {senderName, messageText, videoUrl, posterUrl, videoMimeType} = args;
  const safeVideo = escapeHtml(videoUrl), safePoster = escapeHtml(posterUrl);
  const safeSender = escapeHtml(senderName), safeMime = escapeHtml(videoMimeType);
  const formattedText = escapeHtml(messageText).replaceAll(/\r?\n/g, "<br>");
  const body = `<p><strong>${safeSender}</strong> sent you a video postcard.</p>
    ${messageText ? `<p>${formattedText}</p>` : ""}
    <video controls playsinline preload="metadata" poster="${safePoster}" width="536" style="display:block;width:100%;max-width:536px;height:auto;background:#111">
      <source src="${safeVideo}" type="${safeMime}">
      <p>Video playback is not supported in this email client.</p>
    </video>
    <p><a href="${safeVideo}" style="display:block;text-decoration:none"><img src="${safePoster}" width="536" alt="Video postcard preview. Open video." style="display:block;width:100%;max-width:536px;height:auto;border:0"></a></p>
    ${actionLink(videoUrl, "Watch your postcard")}
    <p style="font-size:13px;color:#554b3e">This video link expires 3 days after delivery.</p>`;
  return {html: emailLayout(body), text: `${senderName} sent you a PSTCRD.\n\n${messageText}\n\nWatch: ${videoUrl}\n\nThe link expires in 3 days.\nCreate Your Own: ${createUrl}`};
}
export function consentRequestEmail(args: {senderName:string; senderEmail:string; accept:string; decline:string; unsubscribe:string}): {html:string; text:string} {
  const {senderName,senderEmail,accept,decline,unsubscribe} = args;
  const html = emailLayout(`<p><strong>${escapeHtml(senderName)}</strong> (${escapeHtml(senderEmail)}) wants to send you a PSTCRD.</p>
  <p>Accepting allows future postcards from this verified sender until you revoke consent. The video is not included in this request.</p>
  ${actionLink(accept,"Accept postcards from this sender")}
  ${actionLink(decline,"Decline this postcard")}
  ${actionLink(unsubscribe,"Stop future requests from this sender")}
  <p style="font-size:13px;color:#554b3e">If you did not expect this request, you can ignore it.</p>`);
  return {html, text: `${senderName} (${senderEmail}) wants to send you a PSTCRD. Accepting allows future postcards from this sender.\n\nAccept: ${accept}\nDecline: ${decline}\nStop future requests: ${unsubscribe}`};
}
