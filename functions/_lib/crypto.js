/**
 * X 凭据加密存储。
 *
 * 原站的 GET /api/admin/credentials 把 ct0 / auth_token 明文回传前端, 前端再写进
 * localStorage —— 这两个 Cookie 等同 X 账号完全控制权。这里改成 AES-GCM 加密入库,
 * 只有服务端在真正调用 X 时才解密, 永不回传。
 *
 * CREDENTIAL_ENC_KEY: 32 字节 base64。生成: node scripts/gen-keys.mjs
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function importKey(b64Key) {
  if (!b64Key) throw new Error('CREDENTIAL_ENC_KEY 未配置');
  const raw = Uint8Array.from(atob(b64Key), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('CREDENTIAL_ENC_KEY 必须是 32 字节的 base64');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** -> base64(iv || ciphertext) */
export async function encryptSecret(plaintext, b64Key) {
  const key = await importKey(b64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...out));
}

export async function decryptSecret(b64Blob, b64Key) {
  const key = await importKey(b64Key);
  const all = Uint8Array.from(atob(b64Blob), (c) => c.charCodeAt(0));
  const iv = all.slice(0, 12);
  const ct = all.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}

// ── settings 表读写 ────────────────────────────────────────────

export async function getSetting(db, key) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row?.value ?? null;
}

export async function setSetting(db, key, value) {
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value, new Date().toISOString()).run();
}

/** 取出解密后的 X 凭据, 仅供服务端内部调用 X 时使用 */
export async function getXCredentials(env) {
  const ct0Enc = await getSetting(env.DB, 'x_ct0_enc');
  const authEnc = await getSetting(env.DB, 'x_auth_token_enc');
  if (!ct0Enc || !authEnc) return null;
  return {
    ct0: await decryptSecret(ct0Enc, env.CREDENTIAL_ENC_KEY),
    authToken: await decryptSecret(authEnc, env.CREDENTIAL_ENC_KEY),
  };
}

export async function setXCredentials(env, ct0, authToken) {
  await setSetting(env.DB, 'x_ct0_enc', await encryptSecret(ct0, env.CREDENTIAL_ENC_KEY));
  await setSetting(env.DB, 'x_auth_token_enc', await encryptSecret(authToken, env.CREDENTIAL_ENC_KEY));
}
