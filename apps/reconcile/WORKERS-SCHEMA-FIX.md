# إصلاح تجميع مخططات XGuard Reconcile في Cloudflare Workers

تاريخ الفحص: 2026-10-21. النسخة الأصلية: `34bdb7f095ad3f623b7bc1ebfde136535a7fa615`.

الإصلاح محصور في `apps/reconcile` واختباراتها، مع إضافة مهمة CI خاصة بها. لا يتضمن نشرًا على Cloudflare أو تغييرًا في الأسعار أو الشبكة أو العملة أو مسار الإيرادات.

## السبب الجذري والدالة التي تفشل

الاعتماديات المباشرة هي `@x402/hono@2.24.0` و`@x402/extensions@2.24.0`؛ نسخة Ajv المثبتة والمختبرة هي `8.20.0`، وثُبتت الاعتماديات في `package-lock.json` لإعادة إنتاج البناء.

مسار الاستدعاء في النسخة الأصلية:

```text
discovery-entry.fetch → index.fetch → getApp → appFor
→ paymentMiddleware → paymentMiddlewareFromHTTPServer
→ validateBazaarRouteExtensions → validateDiscoveryExtension
→ Ajv2020.compile(extension.schema)
→ validateSchema / تجميع المخططات المرجعية
→ compileSchema → new Function("self", "scope", sourceCode)
```

ملف x402 المسؤول هو `@x402/extensions/dist/esm/chunk-XWKAN63N.mjs`، والدالة `validateDiscoveryExtension()` تستدعي `new Ajv({ strict: false, allErrors: true })` ثم `ajv.compile(extension.schema)`.

موضع الفشل الفعلي هو **`compileSchema()` في `ajv/dist/compile/index.js` عند إنشاء `makeValidate` باستخدام `new Function(...)`**. عبارة `Error compiling schema, function code:` تصدر من كتلة `catch` في الدالة نفسها. اسم `validate1` الذي يظهر في الكود المسجل هو اسم دالة تحقق يحاول Ajv إنشاءها، وليس الدالة التي بدأت المشكلة.

في إعادة الإنتاج، كان الكود المسجل خاصًا بمخطط JSON Schema المرجعي `https://json-schema.org/draft/2020-12/meta/core`؛ أي إن الفشل يحدث أثناء تجميع المخططات المرجعية قبل اكتمال تجميع مخطط Bazaar الخاص بالخدمة. تعطيل `validateSchema` وحده يترك توليد دالة المخطط الفعلي قائمًا، ولذلك ليس إصلاحًا جذريًا.

أُعيد إنتاج الخطأ في `workerd` بنفس تاريخ التوافق `2026-08-26` والعلم `nodejs_compat`. ظهر الخطأ:

```text
Schema validation failed: Code generation from strings disallowed for this context
```

كانت `getApp()` تُستدعى أيضًا للطلبات غير المعروفة، فتُنشئ middleware الدفع وتطلق تزامن facilitator وفحص Bazaar قبل الوصول إلى رد Hono الافتراضي `404`. وقد أعاد طلب `/unknown` إنتاج خطأ التجميع. عبارة «startup validation» في SDK لا تعني startup الخاص بعزل Worker، لأن التطبيق كان يُنشأ داخل `fetch()`.

## ما تغيّر

- نقل إعلان Bazaar الحالي حرفيًا إلى `src/discovery.js` ليستخدمه كل من Worker ومولّد الدوال.
- إنشاء دوال Ajv standalone وقت البناء للمخطط المعلن وصيغته بعد إثراء x402 لطريقة `GET`.
- إضافة alias في Wrangler لـ`ajv/dist/2020.js` داخل هذه الخدمة فقط. تنفذ `compile()` في البديل بحثًا عن الدالة المولدة للمخطط المطابق، ولا تولد JavaScript أثناء الطلب.
- الحفاظ على قرارات Ajv وكائنات الأخطاء. تُرفض المخططات غير المسجلة وخيارات Ajv المختلفة بدل قبولها تلقائيًا.
- تشغيل التوليد عند بناء Wrangler، وإضافة فحص يمنع بقاء الملفات المولدة قديمة.
- رفض المسارات والطرق غير المعروفة بـ`404` قبل تهيئة الدفع، بما فيها `HEAD/POST/OPTIONS` على المسار المدفوع. نُقل فحص المدخلات الحالي إلى ما قبل التهيئة أيضًا، مع الحفاظ على عقد `400`.
- إضافة lockfile وأدوات الاختبار ومهمة CI لا تتضمن أوامر نشر إنتاجي.

لم تُستبدل دوال x402 للتحقق من الدفع أو التسوية، ولم تُضف أي آلية لتجاوزهما. لا تغيير في `exact` أو السعر `$0.002` أو المبلغ `2000` أو USDC الأصلي على Base أو `eip155:8453` أو عنوان الخزينة أو `withBazaar` أو تسجيل امتداد Bazaar أو إعدادات CDP/fallback. بقي مدخل الإنتاج `src/discovery-entry.js` كما هو.

## نتائج الاختبارات

استُخدمت Node `24.19.0` وWrangler `4.147.0` وMiniflare `5.20261001.0-alpha` و**workerd `2026-10-01`**. Miniflare هنا يشغّل ثنائية `workerd` الحقيقية، ولا يحاكي تنفيذ Worker في Node.

| الفحص | النتيجة |
| --- | --- |
| فحوص الصياغة وحداثة الدوال المولدة واختبارات Node | `7/7` ناجحة |
| اختبارات تكامل Worker المبني بإعداد Wrangler الإنتاجي | `14/14` ناجحة |
| مقارنة مع النسخة الأصلية في workerd | `15` استجابة متطابقة، بما فيها المحتوى وتحديات الدفع والرؤوس المختارة |
| خطأ تجميع Ajv في المقارنة | النسخة الأصلية: `1`؛ النسخة المعدلة: `0` |
| توليد الكود أثناء الطلب في Worker الاختبار | محظور؛ دوال standalone تعمل وترد بقرارات التحقق الصحيحة |
| فحوص المشروع الحالية `npm run check` و`npm test` | فحوص الصياغة والأمان وTypeScript ناجحة، واختبارات المشروع `48/48` ناجحة |

| الحالة | ما ثبت |
| --- | --- |
| `200` | التحقق من توقيع EIP-712 صحيح ثم استعلام RPC ثم التسوية وإرجاع `PAYMENT-RESPONSE` ناجح؛ اختُبرت حالات nonce غير مستخدم، وتسوية مرصودة، وnonce مستهلك بلا سجل حديث |
| `400` | مدخلات ناقصة أو غير صالحة ومحاولة دفع على رابط الفحص المجرد تُرفض قبل أي اتصال بالدفع أو RPC |
| `402` | لا تُسلّم النتيجة دون دفع؛ تحدي x402 الكامل يحتفظ بالسعر والعملة والشبكة وبيانات Bazaar |
| `404` | المسارات والطرق غير المعرفة تُرفض دون facilitator أو تحقق أو تسوية أو RPC، حتى مع غياب إعداد الخزينة |
| `503` | فشل RPC بعد تحقق الدفع يلغي التسوية؛ غياب الخزينة في تحدي الاكتشاف يبقى مغلقًا بـ`503` |
| التلاعب بالدفع | توقيع مزور، ومبلغ غير صحيح، وشبكة مختلفة، وخزينة مختلفة، وترويسة مشوهة: لا نتيجة مدفوعة ولا تسوية |
| رفض facilitator للتحقق | لا استعلام RPC ولا تسوية |
| فشل التسوية | تُحجب نتيجة RPC الناجحة ويُعاد خطأ الدفع |
| الطلبات المشروعة | عميل x402 الرسمي والتوقيع الصحيح واسم المعامل البديل `authorizer` تعمل؛ الطلب غير الموقع بعد طلب مدفوع يبقى `402` |
| Coinbase CDP | يولّد Worker ترويسات JWT بإعداد اختبار مؤقت، ويحتفظ بوضع CDP وجاهزية Bazaar ومسار التحقق والتسوية |
| ترويسة `x-payment` القديمة مع payload v2 | تبقى مرفوضة بـ`402` طبقًا لسلوك SDK الحالي؛ لا يتغير بروتوكول الترويسات |

تشمل مقارنة الاستجابات المتطابقة الصفحة الرئيسية و`HEAD /` و`healthz` و`docs` و`openapi.json` ومساري x402 discovery و`robots.txt` و`sitemap.xml` و`llms.txt`، إضافة إلى تحديات الدفع بالمعاملين `from/authorizer` وتحدي الرابط المجرد وحالات المدخلات غير الصالحة. لم تتغير مستندات الاكتشاف أو نصوصها أو بيانات السعر.

جميع اتصالات facilitator وBase RPC اعتُرضت باستجابات اختبار محلية. جرى التحقق التشفيري الفعلي من توقيعات العميل عند حد facilitator الاختباري، وشُغّل middleware الحقيقي في workerd. **التسوية محاكاة، ولم تُنقل أموال حقيقية أو تُختبر معاملة mainnet حية.** لا يدعي هذا التقرير قياس حركة الزوار المستقبلية أو نجاح دفع إنتاجي لم يُنفذ.

## الملفات المعدلة والمضافة

| الملف داخل المستودع | الغرض |
| --- | --- |
| `apps/reconcile/src/index.js` | إعادة استخدام إعلان Bazaar، وحراسة المسار والمدخلات قبل تهيئة الدفع |
| `apps/reconcile/src/discovery.js` | إعلان Bazaar المشترك دون تغيير بياناته |
| `apps/reconcile/src/schema-key.js` | مطابقة المخططات دون التأثر بترتيب مفاتيح الكائنات |
| `apps/reconcile/src/ajv2020-standalone.js` | استرجاع دوال التحقق الجاهزة ورفض المخططات غير المسجلة |
| `apps/reconcile/src/generated/bazaar-validators.js` | دوال Ajv المولدة وقت البناء |
| `apps/reconcile/scripts/generate-validators.mjs` | التوليد وفحص حداثة المخرجات والتحقق من إعلان الخدمة وقت البناء |
| `apps/reconcile/wrangler.jsonc` | ربط البديل بخط بناء Worker |
| `apps/reconcile/package.json` | أوامر البناء والتوليد والاختبار وأدوات التطوير |
| `apps/reconcile/package-lock.json` | تثبيت نسخ الاعتماديات لإعادة إنتاج الاختبارات |
| `apps/reconcile/test/standalone-validators.mjs` | مقارنة قرارات وأخطاء الدوال الجاهزة مع Ajv الأصلي |
| `apps/reconcile/test/reconcile-workerd.mjs` | حالات HTTP والدفع والتسوية والاكتشاف داخل workerd |
| `apps/reconcile/test/validator-worker.js` | مدخل اختبار منفصل لإثبات منع التوليد الديناميكي؛ لا يُضم إلى الإنتاج |
| `apps/reconcile/test/compatibility-workerd.mjs` | بناء النسخة الأصلية ومقارنة الاستجابات داخل workerd |
| `.github/workflows/reconcile-ci.yml` | إعادة الاختبارات والمقارنة في CI؛ دون نشر |
| `apps/reconcile/WORKERS-SCHEMA-FIX.md` | هذا التقرير |

## إعادة الاختبارات

من جذر المستودع:

```bash
npm ci --prefix apps/reconcile --no-audit --no-fund
npm run --prefix apps/reconcile check
WRANGLER_SEND_METRICS=false npm run --prefix apps/reconcile test:workerd
node apps/reconcile/test/compatibility-workerd.mjs 34bdb7f095ad3f623b7bc1ebfde136535a7fa615
```

عند تعديل مخطط Bazaar أو ترقية SDK، يجب إعادة توليد دوال التحقق وتشغيل الاختبارات. يحدث التوليد تلقائيًا في بناء Wrangler؛ فحص `check` يكتشف أيضًا المخرجات القديمة. لا يحتاج الإصلاح إلى توسيع صلاحيات `eval` أو تغيير أعلام التوافق.

## المراجع التقنية

- [Ajv: standalone validation code](https://ajv.js.org/standalone.html): توليد دوال التحقق وقت البناء واستخدامها دون compiler أثناء التشغيل.
- [Cloudflare: compatibility flags — eval during startup](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#enable-eval-during-startup): السماح عند startup لا يتيح توليد الدوال أثناء معالجة الطلبات.
- [Ajv: implementation of compileSchema](https://github.com/ajv-validator/ajv/blob/v8.20.0/lib/compile/index.ts): إنشاء `makeValidate` وعبارة تسجيل الخطأ.
- مصدر x402 الفعلي وملفات Ajv المثبتة وفُحصت محليًا؛ النسخ الدقيقة محفوظة في lockfile.
