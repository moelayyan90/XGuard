// The wallet page never handles a private key or initiates a second authorization
// to recover an ambiguous payment. The merchant Worker independently checks Base.
const prefix = "/api/gateway/v1";
const page = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>اختبار تسوية إكس جارد</title>
<main><h1>اختبار تسوية إكس جارد</h1>
<p>عملية واحدة بقيمة 0.001 USDC على شبكة Base، مقابل نتيجة تحقق من إصدار React.</p>
<p>تحتاج محفظة متصلة على Base وفيها USDC. راجع المبلغ والمستلم في المحفظة قبل التوقيع.</p>
<p>لن يرسل إكس جارد عملية ثانية عند تأخر الإيصال؛ يمكن متابعة الطلب نفسه.</p>
<button type="button" id="pay">توقيع عملية واحدة أو متابعة الطلب السابق</button>
<pre id="result" aria-live="polite"></pre>
<p><a id="receipt" hidden>عرض الإيصال على BaseScan</a></p>
</main><script src="/api/gateway/v1/test-base.js" defer></script></html>`;

const script = String.raw`
"use strict";
const button = document.getElementById("pay");
const log = document.getElementById("result");
const receipt = document.getElementById("receipt");
const storageKey = "xguard-base-single-settlement-v1";
const resource = location.origin + "/api/gateway/v1/fact/npm/react/latest-version";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
const load = () => JSON.parse(sessionStorage.getItem(storageKey) || "null");
const save = value => sessionStorage.setItem(storageKey, JSON.stringify(value));
const decode = value => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0))));
const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let busy = false;

function showComplete(hash) {
  log.textContent = "تحقق إكس جارد من التسوية على Base. رقم العملية: " + hash;
  receipt.href = "https://basescan.org/tx/" + hash;
  receipt.hidden = false;
  button.disabled = true;
}
if (/^0x[0-9a-fA-F]{64}$/.test(load()?.done ?? "")) showComplete(load().done);

button.addEventListener("click", async () => {
  if (busy || load()?.done) return;
  busy = true; button.disabled = true;
  try {
    let order = load();
    if (!order) {
      const wallet = window.ethereum;
      if (!wallet?.request) throw new Error("افتح الصفحة من متصفح محفظتك المتصلة.");
      const accounts = await wallet.request({ method: "eth_requestAccounts" });
      const from = accounts?.[0];
      if (typeof from !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(from)) throw new Error("المحفظة لم ترجع عنوانًا صالحًا.");
      if (BigInt(await wallet.request({ method: "eth_chainId" })) !== 8453n) throw new Error("اختر شبكة Base في المحفظة ثم أعد المحاولة.");
      const id = "wallet-test-" + crypto.randomUUID();
      const first = await fetch(resource, { headers: { "Idempotency-Key": id }, redirect: "error", signal: AbortSignal.timeout(12000) });
      if (first.status !== 402) throw new Error("لم يصل عرض دفع صالح. لا توجد عملية موقعة.");
      const offer = decode(first.headers.get("Payment-Required") || "");
      const accepted = offer.accepts?.[0];
      if (offer.x402Version !== 2 || offer.resource?.url !== resource || accepted?.scheme !== "exact" ||
          accepted?.network !== "eip155:8453" || accepted?.asset?.toLowerCase() !== usdc ||
          accepted?.amount !== "1000" || accepted?.extra?.name !== "USD Coin" ||
          accepted?.extra?.version !== "2" || !/^0x[0-9a-fA-F]{40}$/.test(accepted?.payTo ?? "") ||
          from.toLowerCase() === accepted.payTo.toLowerCase() ||
          !Number.isSafeInteger(accepted?.maxTimeoutSeconds) || accepted.maxTimeoutSeconds < 60) {
        throw new Error("عرض الدفع لا يطابق عملية 0.001 USDC المتوقعة.");
      }
      const seconds = Math.floor(Date.now() / 1000);
      const authorization = { from, to: accepted.payTo, value: "1000", validAfter: String(seconds - 15),
        validBefore: String(seconds + Math.min(240, accepted.maxTimeoutSeconds)), nonce: "0x" + hex(crypto.getRandomValues(new Uint8Array(32))) };
      const typed = {
        types: {
          EIP712Domain: [{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],
          TransferWithAuthorization: [{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},
            {name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}],
        },
        domain: {name:"USD Coin",version:"2",chainId:8453,verifyingContract:accepted.asset},
        primaryType: "TransferWithAuthorization",
        message: authorization,
      };
      log.textContent = "راجع عملية 0.001 USDC إلى " + accepted.payTo + " في المحفظة.";
      const signature = await wallet.request({ method: "eth_signTypedData_v4", params: [from, JSON.stringify(typed)] });
      if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("المطلوب توقيع محفظة Base عادية.");
      order = { id, proof: encode({ x402Version: 2, resource: offer.resource, accepted, payload: { authorization, signature } }) };
      save(order);
    }
    for (let i = 0; i < 12; i++) {
      log.textContent = "جاري التحقق من الطلب نفسه. لا توقّع طلبًا آخر.";
      const response = await fetch(resource, { headers: {
        "Idempotency-Key": order.id, "Payment-Signature": order.proof,
      }, redirect: "error", signal: AbortSignal.timeout(25000) });
      if (response.status === 200) {
        const payment = decode(response.headers.get("Payment-Response") || "");
        if (payment.success !== true || payment.network !== "eip155:8453" || !/^0x[0-9a-fA-F]{64}$/.test(payment.transaction)) {
          throw new Error("وصل رد دون إيصال صالح. احتفظ بالطلب نفسه.");
        }
        save({ done: payment.transaction });
        showComplete(payment.transaction); return;
      }
      if (response.status !== 503) {
        throw new Error("لم يكتمل الاختبار (HTTP " + response.status + "). احتُفظ بالطلب لمنع إنشاء خصم ثانٍ.");
      }
      await pause(5000);
    }
    log.textContent = "التسوية غير مؤكدة بعد. اضغط متابعة لنفس الطلب دون توقيع جديد.";
  } catch (error) {
    log.textContent = typeof error?.message === "string" ? error.message : "تعذر إكمال الطلب.";
  } finally {
    busy = false;
    if (!load()?.done) button.disabled = false;
  }
});
`;

export function buyerAsset(path: string): Response | undefined {
  const common = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
  if (path === prefix + "/test-base") return new Response(page, { headers: { ...common,
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } });
  if (path === prefix + "/test-base.js") return new Response(script, { headers: { ...common,
    "Content-Type": "application/javascript; charset=utf-8" } });
  return undefined;
}
