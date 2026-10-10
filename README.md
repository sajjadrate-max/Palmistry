# AI Palmistry Web App — مکمل رہنمائی

یہ ایک مکمل، موبائل فرینڈلی AI Palm Reading ویب ایپ ہے۔ صارف ہتھیلی کی تصویر اپلوڈ کرتا ہے، AI Vision ماڈل (OpenAI GPT-4o) تصویر دیکھ کر روایتی علمِ کف شناسی کے مطابق تفصیلی reading دیتا ہے، اور نتائج خوبصورت cards میں + تصویر پر نشان زدہ لکیروں کے ساتھ دکھائے جاتے ہیں۔

⚠️ یہ صرف روایتی/تفریحی مقصد کے لیے ہے، طبی یا سائنسی پیش گوئی نہیں۔

---

## 1. Folder Structure

```
palmistry-app/
├── index.html          ← مکمل frontend (HTML+CSS+JS ایک ہی فائل میں)
├── server.js            ← Express backend (local testing / کسی بھی Node host کے لیے)
├── api/
│   └── analyze.js       ← Serverless function (Vercel کے لیے) — اصل AI logic یہیں ہے
├── manifest.json         ← PWA manifest (ایپ کا نام، آئیکن، تھیم رنگ)
├── sw.js                 ← Service worker (Install / Add to Home Screen کے لیے)
├── icon-192.png, icon-512.png, apple-touch-icon.png  ← ایپ آئیکنز (root پر)
├── package.json          ← Node dependencies
├── .env.example          ← environment variables کا نمونہ
├── .gitignore
└── README.md             ← یہی فائل
```

### Install App (PWA)

یہ ویب ایپ اب ایک Progressive Web App بھی ہے — یعنی صارف اسے اپنے فون/کمپیوٹر کے ہوم اسکرین پر عام موبائل ایپ کی طرح انسٹال کر سکتا ہے:

- Android/Chrome پر: ہیڈر میں "📲 ایپ Install کریں" بٹن یا نیچے سے نمودار ہونے والا install banner دکھایا جاتا ہے۔
- iPhone/Safari پر: چونکہ iOS خودکار install prompt نہیں دیتا، بٹن دبانے پر "Share → Add to Home Screen" کی ہدایات دکھائی جاتی ہیں۔
- انسٹال کے بعد ایپ الگ ونڈو میں، بغیر براؤزر بار کے کھلتی ہے۔
- یہ صرف HTTPS پر (یعنی لائیو deployment پر) صحیح کام کرتا ہے — `localhost` پر بھی چل جاتا ہے، لیکن پیداواری استعمال کے لیے HTTPS ضروری ہے۔

نوٹ: `server.js` اندر سے وہی `api/analyze.js` کو استعمال کرتا ہے، یعنی logic ایک ہی جگہ ہے — چاہے آپ Vercel پر deploy کریں یا اپنے Node server پر، AI والا کوڈ ایک ہی رہتا ہے۔

---

## 2. یہ کیسے کام کرتا ہے (مختصر)

1. صارف ہاتھ منتخب کرتا ہے (دایاں/بایاں) اور تصویر اپلوڈ یا کیمرے سے کھینچتا ہے۔
2. "Analyze Palm" دبانے پر تصویر (base64) `/api/analyze` پر بھیجی جاتی ہے۔
3. Backend (`api/analyze.js`) خفیہ طور پر OpenAI کے GPT-4o Vision API کو کال کرتا ہے، ایک تفصیلی system prompt کے ساتھ جو:
   - image quality چیک کرواتا ہے
   - ہر feature کے ساتھ confidence (High/Medium/Low/Not visible) منگواتا ہے
   - جھوٹی/فرضی تفصیل بیان کرنے سے منع کرتا ہے
   - لکیروں اور نشانات کے لیے تصویر پر annotation کوآرڈینیٹس منگواتا ہے (صرف جب اعتماد زیادہ ہو)
   - ہمیشہ disclaimer شامل کرواتا ہے
4. نتیجہ structured JSON کی صورت میں frontend کو واپس ملتا ہے اور خوبصورت cards + annotated تصویر میں دکھایا جاتا ہے۔

API key ہمیشہ صرف backend/environment variable میں رہتی ہے — کبھی frontend کوڈ میں نہیں۔

---

## 3. Local Testing (اپنے کمپیوٹر پر چلانا)

### Step 1 — Node.js انسٹال کریں
اگر پہلے سے نہیں ہے تو [nodejs.org](https://nodejs.org) سے Node.js (version 18 یا اس سے اوپر) انسٹال کریں۔

### Step 2 — پراجیکٹ فولڈر میں جائیں
```bash
cd palmistry-app
```

### Step 3 — Dependencies انسٹال کریں
```bash
npm install
```

### Step 4 — Environment Variable سیٹ کریں
```bash
cp .env.example .env
```
اب `.env` فائل کھولیں اور اپنی اصل OpenAI API key ڈالیں:
```
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
```
(API key آپ کو [platform.openai.com/api-keys](https://platform.openai.com/api-keys) سے ملے گی — اکاؤنٹ بنانا اور billing سیٹ کرنا ضروری ہے کیونکہ GPT-4o Vision paid API ہے۔)

### Step 5 — Server چلائیں
```bash
npm start
```
اب براؤزر میں یہ کھولیں:
```
http://localhost:3000
```

بس — ایپ چلنی چاہیے۔ تصویر اپلوڈ کریں اور Analyze دبائیں۔

---

## 4. Deployment (انٹرنیٹ پر لائیو کرنا)

### Option A — Vercel (تجویز کردہ، سب سے آسان)

1. اپنا کوڈ ایک GitHub repository میں push کریں۔
2. [vercel.com](https://vercel.com) پر جائیں، GitHub سے لاگ ان کریں، اور "New Project" سے اپنا repo import کریں۔
3. Vercel خودبخود پہچان لے گا کہ `api/analyze.js` ایک serverless function ہے اور `index.html` static frontend ہے۔
4. Deploy سے پہلے، Vercel کے Project Settings → Environment Variables میں جا کر یہ شامل کریں:
   - Key: `OPENAI_API_KEY`
   - Value: آپ کی اصل API key
5. "Deploy" دبائیں۔ چند منٹ میں آپ کو ایک لائیو لنک مل جائے گا (مثلاً `your-app.vercel.app`)۔

### Option B — کوئی اور Node Host (Render، Railway، وغیرہ)

1. `server.js` کو entry point کے طور پر استعمال کریں (`npm start`)۔
2. اپنے hosting پلیٹ فارم کی Environment Variables سیٹنگ میں `OPENAI_API_KEY` شامل کریں۔
3. Build/Start command: `npm install` پھر `npm start`۔
4. پلیٹ فارم آپ کو ایک public URL دے گا۔

### Option C — اپنا VPS (مثلاً DigitalOcean، AWS EC2)

1. سرور پر Node.js انسٹال کریں۔
2. کوڈ سرور پر کاپی کریں، `npm install` چلائیں۔
3. `.env` فائل میں `OPENAI_API_KEY` سیٹ کریں (یہ فائل کبھی public نہ کریں / git میں کبھی commit نہ کریں)۔
4. `pm2` جیسے process manager سے `server.js` کو مستقل چلائیں:
   ```bash
   npm install -g pm2
   pm2 start server.js --name palmistry-app
   ```
5. Nginx کو reverse proxy کے طور پر سیٹ کر کے اپنے ڈومین سے جوڑیں، اور HTTPS کے لیے Let's Encrypt استعمال کریں۔

---

## 5. API Key کی حفاظت (بہت اہم)

- API key **کبھی بھی** `index.html` یا کسی frontend فائل میں نہ لکھیں — یہ صرف backend/environment variable میں رہتی ہے۔
- `.env` فائل کو کبھی GitHub پر push نہ کریں (`.gitignore` میں یہ پہلے ہی شامل ہے)۔
- ہر deployment پلیٹ فارم پر یہ key سرور کی سیٹنگز (Environment Variables) کے ذریعے دیں، کوڈ کے ذریعے نہیں۔

---

## 6. Privacy

- تصویر browser سے سیدھا `/api/analyze` کو بھیجی جاتی ہے، AI ماڈل کو forward ہوتی ہے، اور جواب واپس آنے کے بعد سرور اسے کہیں بھی مستقل طور پر save نہیں کرتا (کوئی database یا file write نہیں ہے)۔
- اگر آپ چاہیں تو تصاویر کو مستقل طور پر log/store کرنے سے مکمل گریز کریں — موجودہ کوڈ ایسا نہیں کرتا۔

---

## 7. Error Handling / Timeout

- Frontend: 45 سیکنڈ کے بعد request خودبخود cancel ہو جاتی ہے اور صارف کو واضح پیغام ملتا ہے۔
- Backend: 40 سیکنڈ کا internal timeout OpenAI کال پر لگا ہے، اور تمام ناکامیوں (missing key, network error, invalid response, rate limit) پر مناسب error پیغام واپس آتا ہے۔
- Invalid/غلط image (مثلاً غیر image فائل) کو frontend اور backend دونوں سطح پر reject کیا جاتا ہے۔
- اگر تصویر دھندلی/غیر واضح ہو تو AI خود `image_quality.status = "poor"` واپس بھیجتا ہے اور صارف کو دوبارہ تصویر لینے کی ہدایت ملتی ہے۔

---

## 8. Customization کے لیے مختصر رہنمائی

- زبان کی ترجمہ شدہ text `index.html` کے اندر `I18N` object میں ہے — نئی زبان شامل کرنے کے لیے وہاں ایک نیا key (مثلاً `ar`) شامل کریں۔
- رنگ/تھیم CSS کے `:root { --gold: ...; }` والے حصے سے تبدیل کیے جا سکتے ہیں۔
- AI ماڈل کا رویہ اور JSON فارمیٹ `api/analyze.js` کے اندر `buildSystemPrompt()` فنکشن میں ہے۔

---

اگر کوئی مرحلہ سمجھ نہ آئے یا کوئی error پیغام ملے تو وہ پیغام مجھے بتائیں، میں آگے مدد جاری رکھوں گا۔
