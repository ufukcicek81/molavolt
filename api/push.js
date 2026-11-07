// MolaVolt push sender: the admin panel posts {idToken, title, body, url}; this sends a Web Push message
// (RFC 8291 aes128gcm + RFC 8292 VAPID) to every saved subscription.
// No server secrets: the caller's Firebase ID token is checked with Google, and the VAPID key pair and the
// subscriptions are read from Firestore with that token, so the Firestore rules (admin only) decide access.
import crypto from "node:crypto";

const PROJECT = "molavolt";
const API_KEY = "AIzaSyAcmXWfZMcSpTrZ5hDBNCDta8xmsIk4TwY"; // public Firebase web key (same as the app)
const ADMIN_EMAIL = "ufuk8790@gmail.com";
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
// Only real push services are contacted: subscriptions are written by app users, so their endpoints are untrusted.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];

const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

export function allowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch (_) {
    return false;
  }
}

// RFC 8291: encrypt one message for a subscription (p256dh public key, auth secret)
export function encryptPayload(payload, p256dh, authSecret, salt = crypto.randomBytes(16), ecdh = null) {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const local = ecdh || crypto.createECDH("prime256v1");
  if (!ecdh) local.generateKeys();
  const asPublic = local.getPublicKey();
  const shared = local.computeSecret(uaPublic);
  const prkKey = hmac(auth, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// RFC 8292: VAPID header for one push service origin
export function vapidHeader(endpoint, privateJwk, publicKeyB64u) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://molavolt.com" }));
  const key = crypto.createPrivateKey({ key: privateJwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKeyB64u}`;
}

const str = (f) => (f && (f.stringValue ?? "")) || "";

async function fsGet(path, token) {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST gerekli" });

  let input = req.body;
  if (typeof input === "string") { try { input = JSON.parse(input); } catch (_) { input = {}; } }
  const { idToken, title, body, url } = input || {};
  if (!idToken || !title) return res.status(400).json({ ok: false, error: "idToken ve başlık gerekli" });

  // 1) who is calling
  const who = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  }).then((r) => r.json()).catch(() => ({}));
  const user = who && who.users && who.users[0];
  if (!user || String(user.email || "").toLowerCase() !== ADMIN_EMAIL || !user.emailVerified) {
    return res.status(403).json({ ok: false, error: "Bildirim yalnızca yönetici hesabıyla gönderilir." });
  }

  // 2) VAPID keys (admin-only document)
  const keyDoc = await fsGet("molavoltPrivate/push", idToken);
  if (keyDoc.status !== 200) return res.status(500).json({ ok: false, error: "Bildirim anahtarı bulunamadı. Yönetim panelinden anahtar oluştur." });
  const f = keyDoc.json.fields || {};
  let privateJwk;
  try { privateJwk = JSON.parse(str(f.privateJwk)); } catch (_) { privateJwk = null; }
  const publicKey = str(f.publicKey);
  if (!privateJwk || !publicKey) return res.status(500).json({ ok: false, error: "Bildirim anahtarı bozuk." });

  // 3) subscriptions
  const subs = [];
  let pageToken = "";
  for (let i = 0; i < 50; i++) {
    const page = await fsGet(`pushSubs?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, idToken);
    if (page.status !== 200) return res.status(500).json({ ok: false, error: "Abone listesi okunamadı (Firestore kuralları yayınlandı mı?)." });
    (page.json.documents || []).forEach((d) => {
      const x = d.fields || {};
      subs.push({ name: d.name, endpoint: str(x.endpoint), p256dh: str(x.p256dh), auth: str(x.auth) });
    });
    pageToken = page.json.nextPageToken;
    if (!pageToken) break;
  }

  // 4) send
  const payload = JSON.stringify({
    title: String(title).slice(0, 80),
    body: String(body || "").slice(0, 240),
    url: String(url || "https://molavolt.com/").slice(0, 500),
    tag: "molavolt-" + Date.now(),
  });
  let sent = 0, removed = 0, failed = 0;
  const queue = subs.filter((s) => s.endpoint && s.p256dh && s.auth);
  const work = async (s) => {
    if (!allowedEndpoint(s.endpoint)) { failed++; return; }
    try {
      const r = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          TTL: "86400", Urgency: "normal", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
          Authorization: vapidHeader(s.endpoint, privateJwk, publicKey),
        },
        body: encryptPayload(payload, s.p256dh, s.auth),
      });
      if (r.status === 404 || r.status === 410) {
        removed++;
        await fetch(`https://firestore.googleapis.com/v1/${s.name}`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } }).catch(() => {});
      } else if (r.ok) sent++;
      else failed++;
    } catch (_) { failed++; }
  };
  for (let i = 0; i < queue.length; i += 20) await Promise.all(queue.slice(i, i + 20).map(work));
  return res.status(200).json({ ok: true, total: queue.length, sent, removed, failed });
}
